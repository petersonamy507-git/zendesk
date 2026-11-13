"""Live visitors (Visitors page) and visitor profiles (History › User info)."""

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select

from app.api.deps import DB, Current, Principal, client_ip, require
from app.core.events import publish_sync
from app.core.security import utcnow
from app.models import BannedVisitor, Chat, Department, User, Visitor, VisitorEvent, VisitorSession
from app.repositories.base import Repo
from app.schemas.common import Ok
from app.services import audit, visitors
from app.services import chat as chat_svc
from app.services import settings as settings_svc

router = APIRouter(prefix="/visitors", tags=["visitors"])

GroupBy = Literal["activity", "page_title", "page_url", "country", "serving_agent", "department", "browser", "search_engine", "search_term"]


def _live(db, account_id: str) -> list[dict]:
    cutoff = utcnow() - visitors.LIVE_WINDOW
    sessions = db.scalars(select(VisitorSession).where(VisitorSession.account_id == account_id, VisitorSession.ended_at.is_(None), VisitorSession.last_seen_at >= cutoff)).all()
    if not sessions:
        return []
    vids = [s.visitor_id for s in sessions]
    vmap = {v.id: v for v in db.scalars(select(Visitor).where(Visitor.id.in_(vids)))}
    chats = {c.visitor_id: c for c in db.scalars(select(Chat).where(Chat.visitor_id.in_(vids), Chat.state.in_(["incoming", "active", "proactive"])))}
    out = []
    for s in sessions:
        c = chats.get(s.visitor_id)
        snap = visitors.visitor_snapshot(vmap[s.visitor_id], s, chatting=bool(c and c.state == "active"), serving=[c.assignee_id] if c and c.assignee_id and c.state == "active" else [])
        snap["activity"] = "Currently served" if c and c.state == "active" else "Incoming chats" if c and c.state == "incoming" else "Idle" if (utcnow() - s.last_seen_at).total_seconds() > 60 else "Browsing"
        snap["chat_id"] = c.id if c else None
        # Visual-mode status (legend: Incoming, Assigned, Clicked, Served, Triggered, Active, Idle)
        if c and c.state == "incoming":
            snap["status"] = "assigned" if c.assignee_id else "incoming"
        elif c and c.state == "active":
            snap["status"] = "served"
        elif c and c.state == "proactive":
            snap["status"] = "clicked"
        elif s.triggered:
            snap["status"] = "triggered"
        else:
            snap["status"] = "idle" if snap["activity"] == "Idle" else "active"
        out.append(snap)
    if settings_svc.get_section(db, account_id, "account.visitor_list").get("high_load"):
        out = [r for r in out if r["activity"] in ("Incoming chats", "Currently served")]  # High Load Dashboard
    return out


@router.get("")
def live_visitors(p: Current, db: DB, q: str | None = None, group_by: GroupBy = "activity"):
    p.require("visitors.view")
    rows = _live(db, p.account_id)
    if q:
        ql = q.lower()
        rows = [r for r in rows if any(ql in str(r.get(k) or "").lower() for k in ("name", "email", "current_url", "current_title", "country_name", "city", "display_id"))]
    agents = {u.id: (u.display_name or u.name) for u in db.scalars(select(User).where(User.account_id == p.account_id))}
    depts = {d.id: d.name for d in db.scalars(select(Department).where(Department.account_id == p.account_id))}
    key = {
        "activity": lambda r: r["activity"],
        "page_title": lambda r: r["current_title"] or "(no title)",
        "page_url": lambda r: r["current_url"] or "(unknown)",
        "country": lambda r: r["country_name"] or r["country_code"] or "Unknown",
        "serving_agent": lambda r: ", ".join(agents.get(a, "?") for a in r["serving_agent_ids"]) or "Not served",
        "department": lambda r: depts.get(r["department_id"], "No department"),
        "browser": lambda r: r["browser"] or "Other",
        "search_engine": lambda r: r["search_engine"] or "None",
        "search_term": lambda r: r["search_terms"] or "None",
    }[group_by]
    order = {"Incoming chats": 0, "Currently served": 1, "Browsing": 2, "Idle": 3}
    for r in rows:
        r["group"] = key(r)
    rows.sort(key=lambda r: (order.get(r["group"], 9) if group_by == "activity" else 0, str(r["group"]), -r["online_seconds"]))
    return {"items": rows, "total": len(rows)}


@router.post("/simulate", status_code=201)
def simulate(p: Current, db: DB):
    """'Simulate visitor' — creates a clearly-labelled test visitor so agents can try chatting."""
    p.require("visitors.view")
    v = visitors.get_or_create_visitor(db, p.account_id, None, simulated=True)
    v.name = f"Test visitor {v.display_id.lstrip('#')[-4:]}"
    s, _ = visitors.touch_session(db, v, ip="127.0.0.1", user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36", url="https://example.com/pricing", title="Pricing — Example", referrer="https://www.google.com/search?q=live+chat+software")
    s.country_code, s.country_name, s.city = "US", "United States", "Austin"
    db.commit()
    snap = visitors.visitor_snapshot(v, s)
    publish_sync(f"account:{p.account_id}", "visitor.arrived", snap)
    return snap


@router.get("/{visitor_id}")
def visitor_detail(visitor_id: str, p: Current, db: DB):
    v = Repo(db, Visitor, p.account_id).get(visitor_id)
    sessions = db.scalars(select(VisitorSession).where(VisitorSession.visitor_id == v.id).order_by(VisitorSession.started_at.desc()).limit(10)).all()
    latest = sessions[0] if sessions else None
    path = []
    if latest:
        path = [{"url": e.url, "title": e.title, "at": e.created_at.isoformat() + "Z"} for e in db.scalars(select(VisitorEvent).where(VisitorEvent.session_id == latest.id, VisitorEvent.kind == "page_view").order_by(VisitorEvent.created_at).limit(100))]
    past = db.scalars(select(Chat).where(Chat.visitor_id == v.id, Chat.deleted_at.is_(None)).order_by(Chat.started_at.desc()).limit(20)).all()
    banned = db.scalar(select(BannedVisitor.id).where(BannedVisitor.account_id == p.account_id, BannedVisitor.visitor_id == v.id)) is not None
    snap = visitors.visitor_snapshot(v, latest)
    snap.update(
        notes=v.notes,
        banned=banned,
        ip=latest.ip if latest else None,
        user_agent=latest.user_agent if latest else None,
        region=latest.region if latest else None,
        path=path,
        past_chats=[chat_svc.chat_out(c, v) for c in past],
        online=bool(latest and latest.ended_at is None),
    )
    return snap


class VisitorPatch(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=40)
    notes: str | None = Field(default=None, max_length=5000)
    tags: list[str] | None = None


@router.patch("/{visitor_id}")
def update_visitor(visitor_id: str, body: VisitorPatch, p: Current, db: DB):
    v = Repo(db, Visitor, p.account_id).get(visitor_id)
    changes = Repo(db, Visitor, p.account_id).update(v, body.model_dump(exclude_unset=True))
    audit.record(db, account_id=p.account_id, actor_id=p.id, action="visitor.updated", entity_type="visitor", entity_id=v.id, changes=changes)
    db.commit()
    publish_sync(f"account:{p.account_id}", "visitor.updated", {"visitor_id": v.id})
    return visitor_detail(visitor_id, p, db)


class StartChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=5000)


@router.post("/{visitor_id}/chat", status_code=201)
def start_chat(visitor_id: str, body: StartChatIn, db: DB, p: Principal = require("chats.serve")):
    """Agent-initiated chat from the Visitors list."""
    v = Repo(db, Visitor, p.account_id).get(visitor_id)
    s = db.scalar(select(VisitorSession).where(VisitorSession.visitor_id == v.id, VisitorSession.ended_at.is_(None)))
    c = db.scalar(select(Chat).where(Chat.visitor_id == v.id, Chat.state.in_(["incoming", "active", "proactive"])))
    if c is None:
        c = chat_svc.create_chat(db, visitor=v, session_id=s.id if s else None, department_id=None, question=None, initiated_by="agent", assignee_id=p.id)
    elif c.state != "active":
        c = chat_svc.accept(db, c.id, p.user) if c.state == "incoming" else c
        if c.state == "proactive":
            c.state, c.assignee_id, c.accepted_at = "active", p.id, utcnow()
            from app.models import ChatParticipant

            c.participants.append(ChatParticipant(user_id=p.id, joined_at=utcnow()))
            db.commit()
    chat_svc.agent_send(db, c, p.user, body=body.message, kind="text", attachment_id=None, client_id=None)
    publish_sync(f"visitor:{v.id}", "chat.proactive", {"chat_id": c.id})
    return chat_svc.chat_out(c, v)


class BanIn(BaseModel):
    reason: str | None = Field(default=None, max_length=500)
    ban_ip: bool = True


@router.post("/{visitor_id}/ban", response_model=Ok)
def ban(visitor_id: str, body: BanIn, db: DB, p: Principal = require("visitors.ban")):
    v = Repo(db, Visitor, p.account_id).get(visitor_id)
    s = db.scalar(select(VisitorSession).where(VisitorSession.visitor_id == v.id).order_by(VisitorSession.started_at.desc()))
    db.add(BannedVisitor(account_id=p.account_id, visitor_id=v.id, ip=s.ip if s and body.ban_ip else None, label=v.name or f"Visitor {v.display_id.lstrip('#')}", reason=body.reason, created_by=p.id, created_at=utcnow()))
    for c in db.scalars(select(Chat).where(Chat.visitor_id == v.id, Chat.state.in_(["incoming", "active", "proactive"]))):
        chat_svc.end(db, c, by="agent", agent=None)
    audit.record(db, account_id=p.account_id, actor_id=p.id, action="visitor.banned", entity_type="visitor", entity_id=v.id, changes={"reason": body.reason})
    db.commit()
    publish_sync(f"visitor:{v.id}", "visitor.banned", {})
    return Ok()
