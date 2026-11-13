import hashlib
import secrets
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

from app.core.config import get_settings

_ph = PasswordHasher()


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    if not password_hash:
        return False
    try:
        return _ph.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


def utcnow() -> datetime:
    """Naive UTC timestamp — all persisted datetimes are UTC."""
    return datetime.now(UTC).replace(tzinfo=None)


def create_access_token(*, user_id: str, account_id: str, role: str, session_id: str) -> str:
    s = get_settings()
    now = datetime.now(UTC)
    payload = {
        "sub": user_id,
        "acc": account_id,
        "role": role,
        "sid": session_id,
        "typ": "access",
        "iat": now,
        "exp": now + timedelta(minutes=s.access_token_minutes),
    }
    return jwt.encode(payload, s.jwt_secret, algorithm=s.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    s = get_settings()
    data = jwt.decode(token, s.jwt_secret, algorithms=[s.jwt_algorithm])
    if data.get("typ") != "access":
        raise jwt.InvalidTokenError("wrong token type")
    return data


def create_visitor_token(*, visitor_id: str, account_id: str) -> str:
    s = get_settings()
    now = datetime.now(UTC)
    payload = {"sub": visitor_id, "acc": account_id, "typ": "visitor", "iat": now, "exp": now + timedelta(days=30)}
    return jwt.encode(payload, s.jwt_secret, algorithm=s.jwt_algorithm)


def decode_visitor_token(token: str) -> dict:
    s = get_settings()
    data = jwt.decode(token, s.jwt_secret, algorithms=[s.jwt_algorithm])
    if data.get("typ") != "visitor":
        raise jwt.InvalidTokenError("wrong token type")
    return data


def new_opaque_token() -> str:
    return secrets.token_urlsafe(48)


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()
