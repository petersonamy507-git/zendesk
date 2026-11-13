"""Admin: audit log, privacy (data export / erasure), retention."""

from fastapi import APIRouter
from sqlalchemy import select

from app.api.deps import DB, Principal, require
from app.core.security import utcnow
from app.models import AuditLog, Chat, ChatMessage, User, Visitor, VisitorEvent, VisitorSession
from app.repositories.base import Repo
from app.schemas.common import Ok
from app.services import audit

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/audit-logs")
def audit_logs(db: DB, p: Principal = require("audit.view"), page: int = 1, per_page: int = 50, entity_type: str | None = None, action: str | None = None):
    repo = Repo(db, AuditLog, p.account_id)
    stmt = repo.query()
    if entity_type:
        stmt = stmt.where(AuditLog.entity_type == entity_type)
    if action:
        stmt = stmt.where(AuditLog.action.like(f"{action}%"))
    pg = repo.paginate(stmt.order_by(AuditLog.created_at.desc()), page, per_page)
    names = {u.id: (u.display_name or u.name) for u in db.scalars(select(User).where(User.account_id == p.account_id))}
    return {
        "items": [{"id": a.id, "action": a.action, "entity_type": a.entity_type, "entity_id": a.entity_id, "actor_id": a.actor_id, "actor_name": names.get(a.actor_id), "changes": a.changes, "ip": a.ip, "created_at": a.created_at.isoformat() + "Z"} for a in pg.items],
        "total": pg.total,
        "page": pg.page,
        "page_count": pg.page_count,
    }


@router.get("/privacy/visitors/{visitor_id}/export")
def export_visitor(visitor_id: str, db: DB, p: Principal = require("settings.manage")):
    """Data-subject export: everything stored about one visitor."""
    v = Repo(db, Visitor, p.account_id).get(visitor_id)
    sessions = db.scalars(select(VisitorSession).where(VisitorSession.visitor_id == v.id)).all()
    chats = db.scalars(select(Chat).where(Chat.visitor_id == v.id)).all()
    audit.record(db, account_id=p.account_id, actor_id=p.id, action="privacy.export", entity_type="visitor", entity_id=v.id)
    db.commit()
    return {
        "visitor": {"id": v.id, "name": v.name, "email": v.email, "phone": v.phone, "notes": v.notes, "tags": v.tags, "created_at": v.created_at.isoformat()},
        "sessions": [{"started_at": s.started_at.isoformat(), "ip": s.ip, "user_agent": s.user_agent, "country": s.country_code, "city": s.city, "referrer": s.referrer} for s in sessions],
        "chats": [
            {"id": c.id, "started_at": c.started_at.isoformat(), "rating": c.rating, "messages": [{"at": m.created_at.isoformat(), "from": m.sender_type, "body": m.body} for m in db.scalars(select(ChatMessage).where(ChatMessage.chat_id == c.id, ChatMessage.kind != "note").order_by(ChatMessage.seq))]}
            for c in chats
        ],
    }


@router.post("/privacy/visitors/{visitor_id}/erase", response_model=Ok)
def erase_visitor(visitor_id: str, db: DB, p: Principal = require("settings.manage")):
    """Right to erasure: anonymize the visitor and redact their messages; keeps aggregate counts."""
    v = Repo(db, Visitor, p.account_id).get(visitor_id)
    v.name, v.email, v.phone, v.notes, v.tags = None, None, None, None, []
    for s in db.scalars(select(VisitorSession).where(VisitorSession.visitor_id == v.id)):
        s.ip, s.user_agent, s.city, s.region, s.referrer, s.search_terms = None, None, None, None, None, None
        db.query(VisitorEvent).filter(VisitorEvent.session_id == s.id).delete()
    chat_ids = [c.id for c in db.scalars(select(Chat).where(Chat.visitor_id == v.id))]
    if chat_ids:
        for m in db.scalars(select(ChatMessage).where(ChatMessage.chat_id.in_(chat_ids), ChatMessage.sender_type == "visitor")):
            m.body = "[redacted]"
        for c in db.scalars(select(Chat).where(Chat.id.in_(chat_ids))):
            c.preview, c.question, c.rating_comment = None, None, None
    audit.record(db, account_id=p.account_id, actor_id=p.id, action="privacy.erase", entity_type="visitor", entity_id=v.id, changes={"erased_at": utcnow().isoformat()})
    db.commit()
    return Ok()
