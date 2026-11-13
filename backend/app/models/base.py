import uuid
from datetime import datetime

from sqlalchemy import CHAR, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.security import utcnow

# Identifier strategy: UUIDv4 strings stored as CHAR(36). Tenant isolation: every tenant-owned
# row carries an indexed `account_id`; repositories always filter by it.


def new_id() -> str:
    return str(uuid.uuid4())


class IdMixin:
    id: Mapped[str] = mapped_column(CHAR(36), primary_key=True, default=new_id)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


class TenantMixin:
    account_id: Mapped[str] = mapped_column(CHAR(36), ForeignKey("accounts.id", ondelete="CASCADE"), index=True, nullable=False)


def fk(target: str, *, nullable: bool = True, ondelete: str = "SET NULL", index: bool = True):
    return mapped_column(CHAR(36), ForeignKey(target, ondelete=ondelete), nullable=nullable, index=index)


__all__ = ["Base", "IdMixin", "TimestampMixin", "TenantMixin", "fk", "new_id", "String"]
