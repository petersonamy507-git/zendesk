"""Public API for the embeddable visitor widget. Visitors authenticate with a signed visitor
token (issued by POST /widget/{subdomain}/session) sent as `X-Visitor-Token`."""

import hashlib
import hmac
from typing import Annotated, Literal

import jwt
from fastapi import APIRouter, Depends, Header, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import DB, client_ip
from app.core import ratelimit
from app.core.db import get_db
from app.core.errors import AppError, Forbidden, NotFound, Unauthorized
from app.core.events import publish_sync
from app.core.security import create_visitor_token, decode_visitor_token, utcnow
from app.models import Account, Chat, Department, User, Visitor, VisitorSession
from app.services import chat as chat_svc
from app.services import chat_triggers, routing, visitors
from app.services import settings as settings_svc

router = APIRouter(prefix="/widget", tags=["widget"])


class VisitorCtx:
    def __init__(self, visitor: Visitor, session: VisitorSession | None):
        self.visitor = visitor
        self.session = session


def visitor_from_token(db: Session, token: str | None) -> VisitorCtx:
    if not token:
        raise Unauthorized("Missing visitor token")
    try:
        claims = decode_visitor_token(token)
    except jwt.PyJWTError as e:
        raise Unauthorized("Invalid visitor token") from e
    v = db.get(Visitor, claims["sub"])
    if not v or v.account_id != claims["acc"]:
        raise Unauthorized("Unknown visitor")
    s = db.scalar(select(VisitorSession).where(VisitorSession.visitor_id == v.id, VisitorSession.ended_at.is_(None)).order_by(VisitorSession.started_at.desc()))
    if visitors.is_banned(db, v.account_id, v.id, s.ip if s else None):
        raise Forbidden("Visitor is banned", code="banned")
    return VisitorCtx(v, s)


def get_visitor(db: Annotated[Session, Depends(get_db)], x_visitor_token: Annotated[str | None, Header()] = None) -> VisitorCtx:
    return visitor_from_token(db, x_visitor_token)


VisitorDep = Annotated[VisitorCtx, Depends(get_visitor)]


def _public_config(db: Session, account: Account) -> dict:
    sec = settings_svc.get_section(db, account.id, "widget.security")
    hours = settings_svc.get_section(db, account.id, "account.operating_hours")
    depts = db.scalars(select(Department).where(Department.account_id == account.id, Department.enabled.is_(True)).order_by(Department.name)).all()
    return {
        "account_name": account.name,
        "appearance": settings_svc.get_section(db, account.id, "widget.appearance"),
        "forms": settings_svc.get_section(db, account.id, "widget.forms"),
        "settings": settings_svc.get_section(db, account.id, "widget.settings"),
        "file_sending": settings_svc.get_section(db, account.id, "account.file_sending")["enabled"],
        "auth_required": bool(sec.get("auth_enabled")),
        "operating_hours": hours if hours.get("display") else None,
        "departments": [{"id": d.id, "name": d.name, "online": routing.any_agent_available(db, account.id, d.id)} for d in depts],
        "online": routing.any_agent_available(db, account.id) and _within_hours(hours, account.timezone),
    }


def _within_hours(hours: dict, tz: str) -> bool:
    if not hours.get("enabled"):
        return True
    from datetime import datetime
    from zoneinfo import ZoneInfo

    now = datetime.now(ZoneInfo(tz or "UTC"))
    day = now.strftime("%a").lower()[:3]
    hm = now.strftime("%H:%M")
    return any(a <= hm < b for a, b in hours.get("schedule", {}).get(day, []))


def _origin_allowed(db: Session, account_id: str, origin: str | None) -> bool:
    sec = settings_svc.get_section(db, account_id, "widget.security")
    allowed = (sec.get("allowed_domains") or []) if sec.get("allowed_domains_enabled") else []
    if not allowed or not origin:
        return True
    host = origin.split("://")[-1].split(":")[0].lower()
    return any(host == d.lower() or host.endswith("." + d.lower()) for d in allowed)


class SessionIn(BaseModel):
    visitor_key: str | None = Field(default=None, max_length=64)
    url: str | None = Field(default=None, max_length=2048)
    title: str | None = Field(default=None, max_length=255)
    referrer: str | None = Field(default=None, max_length=2048)
    # Visitor authentication (Widget › Security): HMAC-SHA256(shared_secret, external_id + email)
    auth_external_id: str | None = None
    auth_email: EmailStr | None = None
    auth_name: str | None = None
    auth_signature: str | None = None
    simulated: bool = False


@router.post("/{subdomain}/session")
def start_session(subdomain: str, body: SessionIn, request: Request, db: DB):
    ip = client_ip(request)
    ratelimit.hit(f"widget-session:{ip}", limit=120, window_s=60)
    account = db.scalar(select(Account).where(Account.subdomain == subdomain))
    if not account:
        raise NotFound("Unknown workspace")
    if not _origin_allowed(db, account.id, request.headers.get("origin")):
        raise Forbidden("Widget is not allowed on this domain", code="domain_not_allowed")
    sec = settings_svc.get_section(db, account.id, "widget.security")
    country = request.headers.get("cf-ipcountry") or request.headers.get("x-country-code")
    if sec.get("blocked_countries_enabled") and country and country.upper() in [c.upper() for c in sec.get("blocked_countries") or []]:
        raise Forbidden("Chat is not available in your region", code="country_blocked")
    v = visitors.get_or_create_visitor(db, account.id, body.visitor_key, simulated=body.simulated)
    if sec.get("auth_enabled") and body.auth_signature and sec.get("shared_secret"):
        expected = hmac.new(sec["shared_secret"].encode(), f"{body.auth_external_id}{body.auth_email}".encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, body.auth_signature):
            raise Unauthorized("Visitor authentication failed")
        v.email = body.auth_email
        v.name = body.auth_name or v.name
    s, is_new = visitors.touch_session(db, v, ip=ip, user_agent=request.headers.get("user-agent"), url=body.url, title=body.title, referrer=body.referrer, country_code=(country or None) and country[:2].upper())
    db.commit()
    publish_sync(f"account:{account.id}", "visitor.updated" if not is_new else "visitor.arrived", visitors.visitor_snapshot(v, s))
    chat_triggers.fire(db, "widget_loaded", visitor=v, session=s, chat=_open_chat(db, v))
    open_chat = _open_chat(db, v)
    return {
        "visitor_token": create_visitor_token(visitor_id=v.id, account_id=account.id),
        "visitor": {"id": v.id, "key": v.visitor_key, "name": v.name, "email": v.email, "phone": v.phone},
        "config": _public_config(db, account),
        "chat": _widget_chat(db, open_chat) if open_chat else None,
    }


def _open_chat(db: Session, v: Visitor) -> Chat | None:
    return db.scalar(select(Chat).where(Chat.visitor_id == v.id, Chat.state.in_(["proactive", "incoming", "active"]), Chat.deleted_at.is_(None)).order_by(Chat.started_at.desc()))


def _widget_chat(db: Session, c: Chat) -> dict:
    agent = db.get(User, c.assignee_id) if c.assignee_id and c.state == "active" else None
    return {
        "id": c.id,
        "state": c.state,
        "rating": c.rating,
        "agent": {"name": agent.display_name or agent.name, "avatar_url": agent.avatar_url, "tagline": agent.tagline} if agent else None,
        "messages": [chat_svc.message_out(m) for m in chat_svc.messages_after(db, c.id, 0, include_notes=False)],
    }


class HeartbeatIn(BaseModel):
    url: str | None = Field(default=None, max_length=2048)
    title: str | None = Field(default=None, max_length=255)


@router.post("/heartbeat")
def heartbeat(body: HeartbeatIn, ctx: VisitorDep, request: Request, db: DB):
    """Page views + keep-alive (also fires Still on site/page timers via widget_loaded on navigation)."""
    prev_url = ctx.session.current_url if ctx.session else None
    s, is_new = visitors.touch_session(db, ctx.visitor, ip=client_ip(request), user_agent=request.headers.get("user-agent"), url=body.url, title=body.title, referrer=None)
    db.commit()
    publish_sync(f"account:{ctx.visitor.account_id}", "visitor.updated", visitors.visitor_snapshot(ctx.visitor, s))
    if is_new or (body.url and body.url != prev_url):
        chat_triggers.fire(db, "widget_loaded", visitor=ctx.visitor, session=s, chat=_open_chat(db, ctx.visitor))
    return {"ok": True}


class ChatRequestIn(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=40)
    department_id: str | None = None
    message: str | None = Field(default=None, max_length=5000)


def _apply_profile(v: Visitor, body: ChatRequestIn) -> None:
    if body.name:
        v.name = body.name.strip()
    if body.email:
        v.email = str(body.email).lower()
    if body.phone:
        v.phone = body.phone.strip()


@router.post("/chats", status_code=201)
def request_chat(body: ChatRequestIn, ctx: VisitorDep, db: DB):
    ratelimit.hit(f"widget-chat:{ctx.visitor.id}", limit=10, window_s=60)
    forms = settings_svc.get_section(db, ctx.visitor.account_id, "widget.forms")
    if forms["prechat_enabled"]:
        if forms["require_identity"] and not (body.name or ctx.visitor.name) or forms["require_identity"] and not (body.email or ctx.visitor.email):
            raise AppError("Name and email are required", code="identity_required")
        if forms["require_phone"] and not (body.phone or ctx.visitor.phone):
            raise AppError("Phone number is required", code="phone_required")
        if forms["require_question"] and not body.message:
            raise AppError("Please enter your question", code="question_required")
    if not forms["allow_phone"]:
        body.phone = None  # phone numbers are only collected when enabled in Widget › Forms
    _apply_profile(ctx.visitor, body)
    existing = _open_chat(db, ctx.visitor)
    if existing and existing.state == "proactive":
        existing.state = "incoming"
        existing.department_id = body.department_id
        db.commit()
        if body.message:
            chat_svc.add_message(db, existing, sender_type="visitor", sender_id=ctx.visitor.id, sender_name=ctx.visitor.name or f"Visitor {ctx.visitor.display_id.lstrip('#')}", body=body.message)
        routing.route(db, existing)
        chat_svc.broadcast_chat(db, existing, "chat.incoming")
        c = existing
    else:
        c = chat_svc.create_chat(db, visitor=ctx.visitor, session_id=ctx.session.id if ctx.session else None, department_id=body.department_id or (ctx.session.department_id if ctx.session else None), question=body.message)
    chat_triggers.fire(db, "chat_requested", visitor=ctx.visitor, session=ctx.session, chat=c)
    db.refresh(c)
    return _widget_chat(db, c)


@router.post("/offline-message", status_code=201)
def offline_message(body: ChatRequestIn, ctx: VisitorDep, db: DB):
    """Offline form: stored as an offline chat in History (scope 'Offline msg')."""
    ratelimit.hit(f"widget-offline:{ctx.visitor.id}", limit=5, window_s=600)
    forms = settings_svc.get_section(db, ctx.visitor.account_id, "widget.forms")
    if not forms["offline_enabled"]:
        raise AppError("The offline form is disabled", code="offline_disabled")
    if not (body.name and body.email and body.message):
        raise AppError("Name, email and message are required", code="offline_fields_required")
    if forms["offline_require_phone"] and not body.phone:
        raise AppError("Phone number is required", code="phone_required")
    _apply_profile(ctx.visitor, body)
    now = utcnow()
    c = Chat(account_id=ctx.visitor.account_id, kind="offline", state="ended", outcome="missed", visitor_id=ctx.visitor.id, session_id=ctx.session.id if ctx.session else None, department_id=body.department_id, question=body.message, started_at=now, ended_at=now)
    db.add(c)
    db.flush()
    chat_svc.add_message(db, c, sender_type="visitor", sender_id=ctx.visitor.id, sender_name=ctx.visitor.name, body=body.message, publish=False)
    db.commit()
    publish_sync(f"account:{c.account_id}", "chat.offline_message", chat_svc.chat_out(c, ctx.visitor))
    return {"ok": True}


class VisitorMessageIn(BaseModel):
    body: str | None = Field(default=None, max_length=5000)
    attachment_id: str | None = None
    client_id: str | None = Field(default=None, max_length=64)


def _own_chat(db: Session, ctx: VisitorCtx, chat_id: str) -> Chat:
    c = db.get(Chat, chat_id)
    if not c or c.visitor_id != ctx.visitor.id or c.deleted_at:
        raise NotFound("Chat not found")
    return c


@router.post("/chats/{chat_id}/messages", status_code=201)
def visitor_send(chat_id: str, body: VisitorMessageIn, ctx: VisitorDep, db: DB):
    ratelimit.hit(f"widget-msg:{ctx.visitor.id}", limit=60, window_s=60)
    c = _own_chat(db, ctx, chat_id)
    if c.state in ("ended", "missed"):
        raise AppError("This chat has ended", code="chat_ended")
    if not body.body and not body.attachment_id:
        raise AppError("Message is empty")
    if c.state == "proactive":
        c.state = "incoming"
        db.commit()
        routing.route(db, c)
        chat_svc.broadcast_chat(db, c, "chat.incoming")
    m = chat_svc.add_message(db, c, sender_type="visitor", sender_id=ctx.visitor.id, sender_name=ctx.visitor.name or f"Visitor {ctx.visitor.display_id.lstrip('#')}", body=body.body, kind="file" if body.attachment_id else "text", attachment_id=body.attachment_id, client_id=body.client_id)
    chat_triggers.fire(db, "message_sent", visitor=ctx.visitor, session=ctx.session, chat=c, message=m)
    return chat_svc.message_out(m)


@router.get("/chats/{chat_id}")
def visitor_chat(chat_id: str, ctx: VisitorDep, db: DB):
    return _widget_chat(db, _own_chat(db, ctx, chat_id))


@router.get("/chats/{chat_id}/messages")
def visitor_messages(chat_id: str, ctx: VisitorDep, db: DB, after_seq: int = 0):
    c = _own_chat(db, ctx, chat_id)
    return [chat_svc.message_out(m) for m in chat_svc.messages_after(db, c.id, after_seq, include_notes=False)]


class RatingIn(BaseModel):
    rating: Literal["good", "bad"] | None = None
    comment: str | None = Field(default=None, max_length=2000)


@router.post("/chats/{chat_id}/rating")
def visitor_rate(chat_id: str, body: RatingIn, ctx: VisitorDep, db: DB):
    return chat_svc.chat_out(chat_svc.rate(db, _own_chat(db, ctx, chat_id), body.rating, body.comment), ctx.visitor)


@router.post("/chats/{chat_id}/end")
def visitor_end(chat_id: str, ctx: VisitorDep, db: DB):
    c = chat_svc.end(db, _own_chat(db, ctx, chat_id), by="visitor")
    return {"id": c.id, "state": c.state}


class ProfileIn(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=40)


@router.patch("/me")
def visitor_profile(body: ProfileIn, ctx: VisitorDep, db: DB):
    _apply_profile(ctx.visitor, ChatRequestIn(**body.model_dump()))
    db.commit()
    publish_sync(f"account:{ctx.visitor.account_id}", "visitor.updated", visitors.visitor_snapshot(ctx.visitor, ctx.session))
    return {"id": ctx.visitor.id, "name": ctx.visitor.name, "email": ctx.visitor.email, "phone": ctx.visitor.phone}
