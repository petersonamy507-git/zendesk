from dataclasses import dataclass, field
from typing import Annotated

import jwt
from fastapi import Depends, Header, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import Forbidden, Unauthorized
from app.core.netutil import resolve_client_ip
from app.core.security import decode_access_token
from app.models import RolePermission, User, UserSession

DB = Annotated[Session, Depends(get_db)]


@dataclass
class Principal:
    user: User
    account_id: str
    session_id: str
    permissions: set[str] = field(default_factory=set)

    @property
    def id(self) -> str:
        return self.user.id

    def can(self, perm: str) -> bool:
        return perm in self.permissions

    def require(self, perm: str) -> None:
        if perm not in self.permissions:
            raise Forbidden(f"Missing permission: {perm}")


def principal_from_token(db: Session, token: str) -> Principal:
    try:
        claims = decode_access_token(token)
    except jwt.PyJWTError as e:
        raise Unauthorized("Invalid or expired token") from e
    user = db.get(User, claims["sub"])
    if not user or not user.enabled or user.deleted_at or user.account_id != claims["acc"]:
        raise Unauthorized("User is not active")
    sess = db.get(UserSession, claims["sid"])
    if not sess or sess.revoked_at:
        raise Unauthorized("Session revoked")
    perms = set(db.scalars(select(RolePermission.permission).where(RolePermission.role_id == user.role_id)))
    return Principal(user=user, account_id=user.account_id, session_id=sess.id, permissions=perms)


def get_principal(db: DB, authorization: Annotated[str | None, Header()] = None) -> Principal:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise Unauthorized("Missing bearer token")
    return principal_from_token(db, authorization.split(" ", 1)[1])


Current = Annotated[Principal, Depends(get_principal)]


def require(perm: str):
    def _dep(p: Current) -> Principal:
        p.require(perm)
        return p

    return Depends(_dep)


def client_ip(request: Request) -> str | None:
    """Real client address (X-Forwarded-For only trusted from configured reverse proxies; see core/netutil.py)."""
    return resolve_client_ip(request.client.host if request.client else None, request.headers.get("x-forwarded-for"))
