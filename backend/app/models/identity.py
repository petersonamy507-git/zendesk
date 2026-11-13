from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, IdMixin, TenantMixin, TimestampMixin, fk


class Account(IdMixin, TimestampMixin, Base):
    __tablename__ = "accounts"
    name: Mapped[str] = mapped_column(String(120))
    subdomain: Mapped[str] = mapped_column(String(63), unique=True)
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")
    plan: Mapped[str] = mapped_column(String(32), default="team")
    # Plan limits (the reference shows e.g. "1 of 1 Agent used", "0 of 2 Departments used").
    max_agents: Mapped[int] = mapped_column(Integer, default=25)
    max_departments: Mapped[int] = mapped_column(Integer, default=10)
    max_triggers: Mapped[int] = mapped_column(Integer, default=50)


class AccountSetting(IdMixin, TenantMixin, TimestampMixin, Base):
    """One JSON document per settings section (widget.appearance, routing, account.file_sending, ...)."""

    __tablename__ = "account_settings"
    __table_args__ = (UniqueConstraint("account_id", "section", name="uq_account_section"),)
    section: Mapped[str] = mapped_column(String(64))
    data: Mapped[dict] = mapped_column(JSON, default=dict)


class Role(IdMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "roles"
    __table_args__ = (UniqueConstraint("account_id", "key", name="uq_role_key"),)
    key: Mapped[str] = mapped_column(String(40))
    name: Mapped[str] = mapped_column(String(80))
    description: Mapped[str | None] = mapped_column(String(255))
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)
    permissions: Mapped[list["RolePermission"]] = relationship(cascade="all, delete-orphan", lazy="selectin")


class RolePermission(IdMixin, Base):
    __tablename__ = "role_permissions"
    __table_args__ = (UniqueConstraint("role_id", "permission", name="uq_role_perm"),)
    role_id: Mapped[str] = fk("roles.id", nullable=False, ondelete="CASCADE")
    permission: Mapped[str] = mapped_column(String(64))


class User(IdMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "users"
    __table_args__ = (UniqueConstraint("account_id", "email", name="uq_user_email"),)
    email: Mapped[str] = mapped_column(String(254))
    name: Mapped[str] = mapped_column(String(120))
    display_name: Mapped[str | None] = mapped_column(String(120))
    tagline: Mapped[str | None] = mapped_column(String(255))
    avatar_url: Mapped[str | None] = mapped_column(Text)  # small image as a data: URI (≤100 KB) so the public widget can show it
    password_hash: Mapped[str | None] = mapped_column(String(255))
    role_id: Mapped[str] = fk("roles.id", nullable=False, ondelete="RESTRICT")
    is_agent: Mapped[bool] = mapped_column(Boolean, default=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime)
    mfa_secret: Mapped[str | None] = mapped_column(String(64))
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    failed_logins: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, index=True)
    # Agent-specific
    presence: Mapped[str] = mapped_column(String(16), default="invisible")  # online|away|invisible
    chat_limit: Mapped[int | None] = mapped_column(Integer)
    skills: Mapped[list] = mapped_column(JSON, default=list)
    preferences: Mapped[dict] = mapped_column(JSON, default=dict)
    role: Mapped[Role] = relationship(lazy="joined")


class UserSession(IdMixin, TimestampMixin, Base):
    """Refresh-token family. Rotation: each refresh replaces token_hash; reuse of an old token revokes the family."""

    __tablename__ = "user_sessions"
    user_id: Mapped[str] = fk("users.id", nullable=False, ondelete="CASCADE")
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    previous_hash: Mapped[str | None] = mapped_column(String(64), index=True)
    user_agent: Mapped[str | None] = mapped_column(String(255))
    ip: Mapped[str | None] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime)


class OneTimeToken(IdMixin, TimestampMixin, Base):
    """Password reset / email verification / invitation tokens (hashed)."""

    __tablename__ = "one_time_tokens"
    user_id: Mapped[str] = fk("users.id", nullable=False, ondelete="CASCADE")
    purpose: Mapped[str] = mapped_column(String(32))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    used_at: Mapped[datetime | None] = mapped_column(DateTime)


class Department(IdMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "departments"
    __table_args__ = (UniqueConstraint("account_id", "name", name="uq_department_name"),)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(Text)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    members: Mapped[list["DepartmentMember"]] = relationship(cascade="all, delete-orphan", lazy="selectin")


class DepartmentMember(IdMixin, Base):
    __tablename__ = "department_members"
    __table_args__ = (UniqueConstraint("department_id", "user_id", name="uq_dept_member"),)
    department_id: Mapped[str] = fk("departments.id", nullable=False, ondelete="CASCADE")
    user_id: Mapped[str] = fk("users.id", nullable=False, ondelete="CASCADE")


class AuditLog(IdMixin, TenantMixin, Base):
    """Immutable audit trail (no update path in the API)."""

    __tablename__ = "audit_logs"
    actor_id: Mapped[str | None] = fk("users.id")
    action: Mapped[str] = mapped_column(String(64), index=True)
    entity_type: Mapped[str] = mapped_column(String(40), index=True)
    entity_id: Mapped[str | None] = mapped_column(String(36), index=True)
    changes: Mapped[dict | None] = mapped_column(JSON)
    ip: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime, index=True)


class ActivityEvent(IdMixin, TenantMixin, Base):
    """Per-user feed shown on Home ("Recent website activity")."""

    __tablename__ = "activity_events"
    user_id: Mapped[str | None] = fk("users.id", ondelete="CASCADE")
    kind: Mapped[str] = mapped_column(String(40))
    message: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, index=True)


class Notification(IdMixin, TenantMixin, Base):
    __tablename__ = "notifications"
    user_id: Mapped[str] = fk("users.id", nullable=False, ondelete="CASCADE")
    kind: Mapped[str] = mapped_column(String(40))
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str | None] = mapped_column(String(500))
    link: Mapped[str | None] = mapped_column(String(255))
    read_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, index=True)
