"""Agent-side chat API: queue, serving, history, transcripts."""

from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Query
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy import String, and_, exists, func, or_, select

from app.api.deps import DB, Current, Principal, require
from app.core.errors import AppError, NotFound
from app.core.security import utcnow
from app.models import Chat, ChatMessage, ChatTag, User, Visitor
from app.repositories.base import Repo
from app.schemas.common import Ok
from app.services import audit
from app.services import chat as svc

router = APIRouter(prefix="/chats", tags=["chats"])


def _get(db, p: Principal, chat_id: str) -> Chat:
    c = Repo(db, Chat, p.account_id).get(chat_id)
    if not (p.can("chats.view_all") or c.assignee_id == p.id or any(x.user_id == p.id for x in c.participants) or (c.state == "incoming" and p.can("chats.serve"))):
        raise NotFound("Chat not found")
    return c


def _out(db, c: Chat) -> dict:
    return svc.chat_out(c, db.get(Visitor, c.visitor_id))


@router.get("")
def list_open(p: Current, db: DB, state: Literal["incoming", "active", "open"] = "open", mine: bool = False):
    """Live queue for the agent dashboard (incoming requests + chats being served)."""
    states = ["incoming", "active"] if state == "open" else [state]
    stmt = Repo(db, Chat, p.account_id).query().where(Chat.state.in_(states))
    if mine or not p.can("chats.view_all"):
        stmt = stmt.where(or_(Chat.assignee_id == p.id, and_(Chat.state == "incoming", or_(Chat.assignee_id.is_(None), Chat.assignee_id == p.id))))
    chats = db.scalars(stmt.order_by(Chat.started_at)).all()
    vis = {v.id: v for v in db.scalars(select(Visitor).where(Visitor.id.in_([c.visitor_id for c in chats])))} if chats else {}
    return [svc.chat_out(c, vis.get(c.visitor_id)) for c in chats]


@router.get("/history")
def history(
    p: Current,
    db: DB,
    q: str | None = None,
    scope: Literal["all", "chat", "offline"] = "all",
    unread: bool | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    min_messages: int = Query(0, ge=0),
    served: list[Literal["completed", "dropped", "missed", "unresponsive"]] = Query(default=[]),
    rating: list[Literal["good", "bad"]] = Query(default=[]),
    tags: list[str] = Query(default=[]),
    triggered: bool | None = None,
    initiated_by: Literal["visitor", "agent", "trigger"] | None = None,
    visitor_name: str | None = None,
    agent_id: str | None = None,
    page: int = 1,
    per_page: int = 25,
):
    repo = Repo(db, Chat, p.account_id)
    stmt = repo.query().where(Chat.state.in_(["ended", "missed"]) | (Chat.kind == "offline"))
    if not p.can("chats.view_all"):
        stmt = stmt.where(Chat.assignee_id == p.id)
    if scope != "all":
        stmt = stmt.where(Chat.kind == scope)
    if unread is not None:
        stmt = stmt.where(Chat.unread.is_(unread))
    if date_from:
        stmt = stmt.where(Chat.started_at >= date_from.replace(tzinfo=None))
    if date_to:
        stmt = stmt.where(Chat.started_at < date_to.replace(tzinfo=None) + (timedelta(days=1) if date_to.time() == datetime.min.time() else timedelta()))
    if min_messages:
        stmt = stmt.where(Chat.message_count >= min_messages)
    if served:
        stmt = stmt.where(Chat.outcome.in_(served))
    if rating:
        stmt = stmt.where(Chat.rating.in_(rating))
    if triggered is not None:
        stmt = stmt.where(Chat.triggered.is_(triggered))
    if initiated_by:
        stmt = stmt.where(Chat.initiated_by == initiated_by)
    if agent_id:
        stmt = stmt.where(Chat.assignee_id == agent_id)
    if tags:
        # JSON tag arrays: portable "contains any" via LIKE on the serialized list
        stmt = stmt.where(or_(*[func.lower(func.cast(Chat.tags, String)).like(f'%"{t.lower()}"%') for t in tags]))
    if visitor_name or q:
        stmt = stmt.join(Visitor, Visitor.id == Chat.visitor_id)
        if visitor_name:
            stmt = stmt.where(Visitor.name.ilike(f"%{visitor_name}%"))
        if q:
            like = f"%{q}%"
            stmt = stmt.where(or_(Visitor.name.ilike(like), Visitor.email.ilike(like), Visitor.display_id.ilike(like), Chat.preview.ilike(like), exists().where(ChatMessage.chat_id == Chat.id, ChatMessage.body.ilike(like))))
    pg = repo.paginate(stmt.order_by(Chat.started_at.desc()), page, per_page)
    vis = {v.id: v for v in db.scalars(select(Visitor).where(Visitor.id.in_([c.visitor_id for c in pg.items])))} if pg.items else {}
    agents = {u.id: (u.display_name or u.name) for u in db.scalars(select(User).where(User.account_id == p.account_id))}
    unread_count = db.scalar(select(func.count()).select_from(Chat).where(Chat.account_id == p.account_id, Chat.unread.is_(True), Chat.state.in_(["ended", "missed"]), Chat.deleted_at.is_(None))) or 0
    items = []
    for c in pg.items:
        d = svc.chat_out(c, vis.get(c.visitor_id))
        d["agent_name"] = agents.get(c.assignee_id) if c.assignee_id else None
        items.append(d)
    return {"items": items, "total": pg.total, "page": pg.page, "per_page": pg.per_page, "page_count": pg.page_count, "unread_count": unread_count}


@router.get("/{chat_id}")
def get_chat(chat_id: str, p: Current, db: DB):
    c = _get(db, p, chat_id)
    return _out(db, c) | {"messages": [svc.message_out(m) for m in svc.messages_after(db, c.id, 0)]}


@router.get("/{chat_id}/messages")
def get_messages(chat_id: str, p: Current, db: DB, after_seq: int = 0):
    """Reconnect catch-up: everything after the last seq the client saw."""
    c = _get(db, p, chat_id)
    return [svc.message_out(m) for m in svc.messages_after(db, c.id, after_seq)]


@router.post("/{chat_id}/accept")
def accept(chat_id: str, db: DB, p: Principal = require("chats.serve")):
    return _out(db, svc.accept(db, chat_id, p.user))


class MessageIn(BaseModel):
    body: str | None = Field(default=None, max_length=10000)
    kind: Literal["text", "note", "options"] = "text"
    options: list[str] | None = None
    attachment_id: str | None = None
    client_id: str | None = Field(default=None, max_length=64)


@router.post("/{chat_id}/messages", status_code=201)
def send(chat_id: str, body: MessageIn, db: DB, p: Principal = require("chats.serve")):
    c = _get(db, p, chat_id)
    m = svc.agent_send(db, c, p.user, body=body.body, kind=body.kind if not body.attachment_id else "file", attachment_id=body.attachment_id, client_id=body.client_id, options=body.options)
    return svc.message_out(m)


class TransferIn(BaseModel):
    to_user_id: str | None = None
    to_department_id: str | None = None
    note: str | None = Field(default=None, max_length=500)


@router.post("/{chat_id}/transfer")
def transfer(chat_id: str, body: TransferIn, db: DB, p: Principal = require("chats.serve")):
    c = _get(db, p, chat_id)
    return _out(db, svc.transfer(db, c, p.user, to_user_id=body.to_user_id, to_department_id=body.to_department_id, note=body.note))


@router.post("/{chat_id}/end")
def end_chat(chat_id: str, db: DB, p: Principal = require("chats.serve")):
    c = _get(db, p, chat_id)
    return _out(db, svc.end(db, c, by="agent", agent=p.user))


class ChatPatch(BaseModel):
    tags: list[str] | None = None
    unread: bool | None = None


@router.patch("/{chat_id}")
def patch_chat(chat_id: str, body: ChatPatch, p: Current, db: DB):
    c = _get(db, p, chat_id)
    if body.tags is not None:
        tags = list(dict.fromkeys(t.strip().lower() for t in body.tags if t.strip()))
        from app.services import settings as settings_svc

        if not settings_svc.get_section(db, p.account_id, "account.chat_tags")["allow_create_in_chat"] and not p.can("settings.manage"):
            known = set(db.scalars(select(ChatTag.name).where(ChatTag.account_id == p.account_id)))
            unknown = set(tags) - known - set(c.tags or [])
            if unknown:
                raise AppError(f"Unknown tags: {', '.join(sorted(unknown))}")
        else:
            for t in set(tags) - set(db.scalars(select(ChatTag.name).where(ChatTag.account_id == p.account_id))):
                db.add(ChatTag(account_id=p.account_id, name=t))
        audit.record(db, account_id=p.account_id, actor_id=p.id, action="chat.tags_updated", entity_type="chat", entity_id=c.id, changes={"tags": [c.tags, tags]})
        c.tags = tags
    if body.unread is not None:
        c.unread = body.unread
    db.commit()
    svc.broadcast_chat(db, c, "chat.updated")
    return _out(db, c)


@router.get("/{chat_id}/transcript", response_class=PlainTextResponse)
def transcript(chat_id: str, p: Current, db: DB):
    c = _get(db, p, chat_id)
    v = db.get(Visitor, c.visitor_id)
    lines = [f"Chat transcript — {v.name or v.display_id}", f"Started: {c.started_at.isoformat()}Z", f"Rating: {c.rating or '-'}", f"Tags: {', '.join(c.tags or []) or '-'}", ""]
    for m in svc.messages_after(db, c.id, 0, include_notes=False):
        who = m.sender_name or ("System" if m.sender_type == "system" else m.sender_type.title())
        lines.append(f"[{m.created_at.strftime('%Y-%m-%d %H:%M:%S')}] " + (f"*** {m.body}" if m.kind == "event" else f"{who}: {m.body or ''}"))
    return PlainTextResponse("\n".join(lines), headers={"Content-Disposition": f'attachment; filename="chat-{c.id[:8]}.txt"'})


class BulkIn(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=500)


@router.post("/bulk-delete", response_model=Ok)
def bulk_delete(body: BulkIn, db: DB, p: Principal = require("chats.delete")):
    rows = db.scalars(Repo(db, Chat, p.account_id).query().where(Chat.id.in_(body.ids), Chat.state.in_(["ended", "missed"]))).all()
    now = utcnow()
    for c in rows:
        c.deleted_at = now
    audit.record(db, account_id=p.account_id, actor_id=p.id, action="chat.bulk_deleted", entity_type="chat", changes={"ids": [c.id for c in rows]})
    db.commit()
    return Ok()


@router.post("/mark-read", response_model=Ok)
def mark_read(body: BulkIn, p: Current, db: DB):
    for c in db.scalars(Repo(db, Chat, p.account_id).query().where(Chat.id.in_(body.ids))):
        c.unread = False
    db.commit()
    return Ok()

