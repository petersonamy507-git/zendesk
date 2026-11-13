from fastapi import APIRouter
from sqlalchemy import select

from app.api.deps import DB, Current
from app.core import totp
from app.core.config import get_settings
from app.core.errors import AppError
from app.core.security import hash_password, utcnow, verify_password
from app.models import Account, ActivityEvent, UserSession
from app.schemas.common import Ok
from app.schemas.identity import MeOut, MfaVerifyIn, PasswordChangeIn, PresenceIn, ProfileIn, SessionOut, UserOut
from app.services import audit, presence
from app.services.auth import validate_password

router = APIRouter(prefix="/users", tags=["users"])

SOUND_TONES = {"none", "alert", "bright", "chime", "soft"}

PREF_DEFAULTS = {
    "language": "en",
    "keyboard_shortcuts": True,
    "offline_message_notification": True,
    "notify_chat_request": True,
    "notify_new_message": True,
    "notify_status_change": True,
    "notify_session_expiry": True,
    # Sounds: a tone name ("none" mutes) and a 0-100 volume per event
    "sound_incoming_visitor": "alert",
    "volume_incoming_visitor": 100,
    "sound_incoming_chat": "bright",
    "volume_incoming_chat": 100,
    "sound_incoming_chat_repeat": 1,
    "sound_new_message": "bright",
    "volume_new_message": 100,
    "sound_status_change": "alert",
    "volume_status_change": 100,
    "idle_enabled": False,
    "idle_ignore_if_chatting": True,
    "idle_minutes": 15,
    "idle_status": "away",
    "email_report_daily": False,
    "email_report_weekly": False,
    "email_report_monthly": False,
    "docked_chat_panel": False,
}


def _me(db, p) -> MeOut:
    acc = db.get(Account, p.account_id)
    return MeOut(
        user=UserOut.model_validate(p.user),
        account={"id": acc.id, "name": acc.name, "subdomain": acc.subdomain, "timezone": acc.timezone, "plan": acc.plan, "max_agents": acc.max_agents, "max_departments": acc.max_departments, "max_triggers": acc.max_triggers},
        permissions=sorted(p.permissions),
        preferences=PREF_DEFAULTS | (p.user.preferences or {}),
    )


@router.get("/me", response_model=MeOut)
def me(p: Current, db: DB):
    return _me(db, p)


@router.patch("/me", response_model=MeOut)
def update_me(body: ProfileIn, p: Current, db: DB):
    changes = {}
    for k, v in body.model_dump(exclude_unset=True).items():
        if getattr(p.user, k) != v:
            changes[k] = [getattr(p.user, k), v]
            setattr(p.user, k, v)
    audit.record(db, account_id=p.account_id, actor_id=p.id, action="user.profile_updated", entity_type="user", entity_id=p.id, changes=changes)
    db.commit()
    return _me(db, p)


@router.put("/me/preferences", response_model=MeOut)
def update_prefs(body: dict, p: Current, db: DB):
    clean = {k: v for k, v in body.items() if k in PREF_DEFAULTS and type(v) is type(PREF_DEFAULTS[k])}
    for k, v in list(clean.items()):
        if k.startswith("volume_") and not 0 <= v <= 100:
            raise AppError(f"{k} must be between 0 and 100")
        if k.startswith("sound_") and isinstance(v, str) and v not in SOUND_TONES:
            raise AppError(f"Unknown sound '{v}'")
        if k == "sound_incoming_chat_repeat" and not 1 <= v <= 10:
            raise AppError("Repeat must be between 1 and 10")
        if k == "idle_minutes" and not 1 <= v <= 480:
            raise AppError("Inactivity period must be between 1 and 480 minutes")
        if k == "idle_status" and v not in ("away", "invisible"):
            raise AppError("Idle status must be away or invisible")
    p.user.preferences = (p.user.preferences or {}) | clean
    db.commit()
    return _me(db, p)


@router.put("/me/presence", response_model=Ok)
def set_presence(body: PresenceIn, p: Current, db: DB):
    presence.set_status(db, p.user, body.status)
    return Ok()


@router.post("/me/password", response_model=Ok)
def change_password(body: PasswordChangeIn, p: Current, db: DB):
    if not verify_password(body.current_password, p.user.password_hash):
        raise AppError("Current password is incorrect", code="invalid_password")
    validate_password(body.new_password)
    p.user.password_hash = hash_password(body.new_password)
    for s in db.scalars(select(UserSession).where(UserSession.user_id == p.id, UserSession.id != p.session_id, UserSession.revoked_at.is_(None))):
        s.revoked_at = utcnow()
    audit.record(db, account_id=p.account_id, actor_id=p.id, action="user.password_changed", entity_type="user", entity_id=p.id)
    db.commit()
    return Ok()


@router.get("/me/sessions", response_model=list[SessionOut])
def sessions(p: Current, db: DB):
    return db.scalars(select(UserSession).where(UserSession.user_id == p.id, UserSession.revoked_at.is_(None), UserSession.expires_at > utcnow()).order_by(UserSession.last_used_at.desc())).all()


@router.delete("/me/sessions/{session_id}", response_model=Ok)
def revoke_session(session_id: str, p: Current, db: DB):
    s = db.get(UserSession, session_id)
    if s and s.user_id == p.id:
        s.revoked_at = utcnow()
        db.commit()
    return Ok()


@router.post("/me/mfa/setup")
def mfa_setup(p: Current, db: DB):
    secret = totp.new_secret()
    p.user.mfa_secret = secret
    p.user.mfa_enabled = False
    db.commit()
    return {"secret": secret, "uri": totp.provisioning_uri(secret, p.user.email, get_settings().app_name)}


@router.post("/me/mfa/enable", response_model=Ok)
def mfa_enable(body: MfaVerifyIn, p: Current, db: DB):
    if not p.user.mfa_secret or not totp.verify(p.user.mfa_secret, body.code):
        raise AppError("Invalid verification code", code="mfa_invalid")
    p.user.mfa_enabled = True
    audit.record(db, account_id=p.account_id, actor_id=p.id, action="user.mfa_enabled", entity_type="user", entity_id=p.id)
    db.commit()
    return Ok()


@router.post("/me/mfa/disable", response_model=Ok)
def mfa_disable(body: MfaVerifyIn, p: Current, db: DB):
    if p.user.mfa_enabled and not totp.verify(p.user.mfa_secret or "", body.code):
        raise AppError("Invalid verification code", code="mfa_invalid")
    p.user.mfa_enabled = False
    p.user.mfa_secret = None
    db.commit()
    return Ok()


@router.get("/me/activity")
def activity(p: Current, db: DB, limit: int = 20):
    rows = db.scalars(select(ActivityEvent).where(ActivityEvent.account_id == p.account_id, (ActivityEvent.user_id == p.id) | (ActivityEvent.user_id.is_(None))).order_by(ActivityEvent.created_at.desc()).limit(min(limit, 100))).all()
    return [{"id": r.id, "kind": r.kind, "message": r.message, "created_at": r.created_at.isoformat() + "Z"} for r in rows]
