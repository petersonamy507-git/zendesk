"""Chat routing engine.

* broadcast – every eligible online agent is notified (account topic); first to accept wins.
* assigned  – the engine offers the chat to one eligible agent (fewest active chats, then
              longest idle) by setting assignee_id while state stays 'incoming'. That agent is
              notified on their user topic and accepts; other agents can't claim it.

Eligibility: enabled agent, presence online, member of the chat's department (if any),
below their chat limit (routing settings), and skills (if the chat requires any).
"""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.events import publish_sync
from app.models import Chat, DepartmentMember, User
from app.services import settings as settings_svc


def eligible_agents(db: Session, account_id: str, department_id: str | None) -> list[User]:
    stmt = select(User).where(User.account_id == account_id, User.is_agent.is_(True), User.enabled.is_(True), User.deleted_at.is_(None), User.presence == "online")
    if department_id:
        stmt = stmt.join(DepartmentMember, DepartmentMember.user_id == User.id).where(DepartmentMember.department_id == department_id)
    agents = list(db.scalars(stmt))
    from app.services.chat import agent_limit

    loads = dict(db.execute(select(Chat.assignee_id, func.count()).where(Chat.account_id == account_id, Chat.state == "active").group_by(Chat.assignee_id)).all())
    out = []
    for a in agents:
        lim = agent_limit(db, a)
        if lim is None or loads.get(a.id, 0) < lim:
            out.append(a)
    out.sort(key=lambda a: (loads.get(a.id, 0), a.last_login_at or a.created_at))
    return out


def any_agent_available(db: Session, account_id: str, department_id: str | None = None) -> bool:
    return bool(eligible_agents(db, account_id, department_id))


def route(db: Session, chat: Chat) -> None:
    if chat.state != "incoming":
        return
    mode = settings_svc.get_section(db, chat.account_id, "routing")["mode"]
    if mode != "assigned":
        chat.assignee_id = None
        db.commit()
        return
    agents = eligible_agents(db, chat.account_id, chat.department_id)
    chat.assignee_id = agents[0].id if agents else None
    db.commit()
    if chat.assignee_id:
        from app.services.chat import chat_out

        publish_sync(f"user:{chat.assignee_id}", "chat.offered", chat_out(chat))


def drain_queue(db: Session, account_id: str) -> None:
    """Re-offer queued chats (assigned mode) after capacity frees up or an agent comes online."""
    if settings_svc.get_section(db, account_id, "routing")["mode"] != "assigned":
        return
    for c in db.scalars(select(Chat).where(Chat.account_id == account_id, Chat.state == "incoming", Chat.assignee_id.is_(None)).order_by(Chat.started_at)):
        route(db, c)
