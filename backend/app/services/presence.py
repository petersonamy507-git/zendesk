"""Agent presence. Durable status lives in users.presence (MySQL); live connection state
(which agents have an open socket) lives in the broker's ephemeral presence store."""

from sqlalchemy.orm import Session

from app.core.events import publish_sync
from app.models import User
from app.services import audit

LABEL = {"online": "Online", "away": "Away", "invisible": "Invisible"}


def set_status(db: Session, user: User, status: str, *, reason: str = "manual") -> None:
    if user.presence == status:
        return
    old = user.presence
    user.presence = status
    audit.activity(db, account_id=user.account_id, user_id=user.id, kind="presence", message=f"You are now {LABEL[status]}" + (" (idle)" if reason == "idle" else ""))
    audit.record(db, account_id=user.account_id, actor_id=user.id, action="agent.presence", entity_type="user", entity_id=user.id, changes={"presence": [old, status], "reason": reason})
    db.commit()
    publish_sync(f"account:{user.account_id}", "presence.updated", {"user_id": user.id, "status": status})
