from sqlalchemy.orm import Session

from app.core.security import utcnow
from app.models import ActivityEvent, AuditLog


def _jsonable(v):
    if isinstance(v, (str, int, float, bool)) or v is None:
        return v
    if isinstance(v, (list, tuple)):
        return [_jsonable(x) for x in v]
    if isinstance(v, dict):
        return {k: _jsonable(x) for k, x in v.items()}
    return str(v)


def record(db: Session, *, account_id: str, actor_id: str | None, action: str, entity_type: str, entity_id: str | None = None, changes: dict | None = None, ip: str | None = None) -> None:
    db.add(
        AuditLog(
            account_id=account_id,
            actor_id=actor_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            changes=_jsonable(changes) if changes else None,
            ip=ip,
            created_at=utcnow(),
        )
    )


def activity(db: Session, *, account_id: str, user_id: str | None, kind: str, message: str) -> None:
    db.add(ActivityEvent(account_id=account_id, user_id=user_id, kind=kind, message=message, created_at=utcnow()))
