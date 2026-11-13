"""Authentication service: signup, login (lockout + optional TOTP), refresh-token rotation with
reuse detection, logout, password reset, email verification."""

import re
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import totp
from app.core.config import get_settings
from app.core.errors import AppError, Conflict, Unauthorized
from app.core.permissions import SYSTEM_ROLES
from app.core.security import create_access_token, hash_password, new_opaque_token, sha256, utcnow, verify_password
from app.models import Account, OneTimeToken, Role, RolePermission, User, UserSession
from app.services import audit
from app.services.mailer import send_mail

PASSWORD_RULE = re.compile(r"^(?=.*[A-Za-z])(?=.*\d).{10,}$")


def validate_password(pw: str) -> None:
    if not PASSWORD_RULE.match(pw):
        raise AppError("Password must be at least 10 characters and include letters and numbers", code="weak_password")


def seed_roles(db: Session, account_id: str) -> dict[str, Role]:
    roles = {}
    for key, spec in SYSTEM_ROLES.items():
        role = Role(account_id=account_id, key=key, name=spec["name"], is_system=True)
        role.permissions = [RolePermission(permission=p) for p in spec["permissions"]]
        db.add(role)
        roles[key] = role
    db.flush()
    return roles


def register_account(db: Session, *, company: str, subdomain: str, name: str, email: str, password: str) -> User:
    validate_password(password)
    if db.scalar(select(Account).where(Account.subdomain == subdomain)):
        raise Conflict("That workspace address is taken")
    acc = Account(name=company, subdomain=subdomain)
    db.add(acc)
    db.flush()
    roles = seed_roles(db, acc.id)
    owner = User(account_id=acc.id, email=email.lower(), name=name, display_name=name, password_hash=hash_password(password), role_id=roles["owner"].id, presence="invisible")
    db.add(owner)
    db.flush()
    audit.record(db, account_id=acc.id, actor_id=owner.id, action="account.created", entity_type="account", entity_id=acc.id)
    issue_token(db, owner, "verify_email", hours=48)
    return owner


def _find_user(db: Session, email: str, subdomain: str | None) -> User | None:
    stmt = select(User).where(User.email == email.lower(), User.deleted_at.is_(None))
    if subdomain:
        stmt = stmt.join(Account, Account.id == User.account_id).where(Account.subdomain == subdomain)
    return db.scalars(stmt).first()


def login(db: Session, *, email: str, password: str, subdomain: str | None, otp: str | None, ip: str | None, user_agent: str | None) -> tuple[User, str, str]:
    s = get_settings()
    user = _find_user(db, email, subdomain)
    now = utcnow()
    generic = Unauthorized("Email or password is incorrect")
    if not user or not user.enabled:
        verify_password(password, None)  # constant-ish time
        raise generic
    if user.locked_until and user.locked_until > now:
        raise Unauthorized("Account temporarily locked after too many failed attempts", code="locked")
    if not verify_password(password, user.password_hash):
        user.failed_logins += 1
        if user.failed_logins >= s.login_max_attempts:
            user.locked_until = now + timedelta(minutes=s.login_lockout_minutes)
            user.failed_logins = 0
        db.commit()
        raise generic
    if user.mfa_enabled:
        if not otp:
            raise Unauthorized("Verification code required", code="mfa_required")
        if not totp.verify(user.mfa_secret or "", otp):
            raise Unauthorized("Invalid verification code", code="mfa_invalid")
    user.failed_logins = 0
    user.locked_until = None
    user.last_login_at = now
    access, refresh = _open_session(db, user, ip=ip, user_agent=user_agent)
    audit.record(db, account_id=user.account_id, actor_id=user.id, action="auth.login", entity_type="user", entity_id=user.id, ip=ip)
    return user, access, refresh


def _open_session(db: Session, user: User, *, ip: str | None, user_agent: str | None) -> tuple[str, str]:
    refresh = new_opaque_token()
    sess = UserSession(user_id=user.id, token_hash=sha256(refresh), ip=ip, user_agent=(user_agent or "")[:255], expires_at=utcnow() + timedelta(days=get_settings().refresh_token_days), last_used_at=utcnow())
    db.add(sess)
    db.flush()
    return create_access_token(user_id=user.id, account_id=user.account_id, role=user.role.key, session_id=sess.id), refresh


def refresh(db: Session, refresh_token: str) -> tuple[User, str, str]:
    h = sha256(refresh_token)
    sess = db.scalar(select(UserSession).where(UserSession.token_hash == h))
    if sess is None:
        # Reuse of a rotated-out token => likely theft: revoke the whole family.
        stolen = db.scalar(select(UserSession).where(UserSession.previous_hash == h))
        if stolen:
            stolen.revoked_at = utcnow()
            db.commit()
        raise Unauthorized("Invalid refresh token")
    if sess.revoked_at or sess.expires_at < utcnow():
        raise Unauthorized("Session expired")
    user = db.get(User, sess.user_id)
    if not user or not user.enabled or user.deleted_at:
        raise Unauthorized("User is not active")
    new = new_opaque_token()
    sess.previous_hash = h
    sess.token_hash = sha256(new)
    sess.last_used_at = utcnow()
    db.flush()
    return user, create_access_token(user_id=user.id, account_id=user.account_id, role=user.role.key, session_id=sess.id), new


def logout(db: Session, session_id: str) -> None:
    sess = db.get(UserSession, session_id)
    if sess and not sess.revoked_at:
        sess.revoked_at = utcnow()


def issue_token(db: Session, user: User, purpose: str, hours: int = 2) -> str:
    raw = new_opaque_token()
    db.add(OneTimeToken(user_id=user.id, purpose=purpose, token_hash=sha256(raw), expires_at=utcnow() + timedelta(hours=hours)))
    db.flush()
    s = get_settings()
    path = {"verify_email": "verify-email", "reset_password": "reset-password", "invite": "accept-invite"}[purpose]
    send_mail(to=user.email, subject={"verify_email": "Verify your email", "reset_password": "Reset your password", "invite": "You're invited"}[purpose], body=f"{s.frontend_url}/{path}?token={raw}")
    return raw


def consume_token(db: Session, raw: str, purpose: str) -> User:
    tok = db.scalar(select(OneTimeToken).where(OneTimeToken.token_hash == sha256(raw), OneTimeToken.purpose == purpose))
    if not tok or tok.used_at or tok.expires_at < utcnow():
        raise AppError("This link is invalid or has expired", code="invalid_token")
    tok.used_at = utcnow()
    user = db.get(User, tok.user_id)
    assert user
    return user


def forgot_password(db: Session, email: str) -> None:
    for user in db.scalars(select(User).where(User.email == email.lower(), User.deleted_at.is_(None))):
        issue_token(db, user, "reset_password", hours=1)


def reset_password(db: Session, raw: str, new_password: str) -> None:
    validate_password(new_password)
    user = consume_token(db, raw, "reset_password")
    user.password_hash = hash_password(new_password)
    for s in db.scalars(select(UserSession).where(UserSession.user_id == user.id, UserSession.revoked_at.is_(None))):
        s.revoked_at = utcnow()
    audit.record(db, account_id=user.account_id, actor_id=user.id, action="auth.password_reset", entity_type="user", entity_id=user.id)


def accept_invite(db: Session, raw: str, password: str, name: str | None) -> User:
    validate_password(password)
    user = consume_token(db, raw, "invite")
    user.password_hash = hash_password(password)
    user.email_verified_at = utcnow()
    if name:
        user.name = name
    return user
