from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, IdMixin, TenantMixin, TimestampMixin, fk


class Visitor(IdMixin, TenantMixin, TimestampMixin, Base):
    """A website visitor (persistent identity across visits via a widget-issued visitor key)."""

    __tablename__ = "visitors"
    __table_args__ = (UniqueConstraint("account_id", "visitor_key", name="uq_visitor_key"),)
    visitor_key: Mapped[str] = mapped_column(String(64))
    display_id: Mapped[str] = mapped_column(String(20))  # "#27171980"-style handle shown when name unknown
    name: Mapped[str | None] = mapped_column(String(120))
    email: Mapped[str | None] = mapped_column(String(254), index=True)
    phone: Mapped[str | None] = mapped_column(String(40))
    notes: Mapped[str | None] = mapped_column(Text)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    visits_count: Mapped[int] = mapped_column(Integer, default=0)
    chats_count: Mapped[int] = mapped_column(Integer, default=0)
    customer_id: Mapped[str | None] = fk("customers.id")
    is_simulated: Mapped[bool] = mapped_column(Boolean, default=False)


class VisitorSession(IdMixin, TenantMixin, Base):
    """One visit. `ended_at` NULL means currently on site (live visitor list)."""

    __tablename__ = "visitor_sessions"
    __table_args__ = (Index("ix_vs_live", "account_id", "ended_at"),)
    visitor_id: Mapped[str] = fk("visitors.id", nullable=False, ondelete="CASCADE")
    started_at: Mapped[datetime] = mapped_column(DateTime)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime)
    ip: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(512))
    browser: Mapped[str | None] = mapped_column(String(64))
    platform: Mapped[str | None] = mapped_column(String(64))
    device: Mapped[str | None] = mapped_column(String(64))
    country_code: Mapped[str | None] = mapped_column(String(2))
    country_name: Mapped[str | None] = mapped_column(String(80))
    region: Mapped[str | None] = mapped_column(String(80))
    city: Mapped[str | None] = mapped_column(String(80))
    referrer: Mapped[str | None] = mapped_column(String(1024))
    search_engine: Mapped[str | None] = mapped_column(String(40))
    search_terms: Mapped[str | None] = mapped_column(String(255))
    current_url: Mapped[str | None] = mapped_column(String(1024))
    current_title: Mapped[str | None] = mapped_column(String(255))
    page_count: Mapped[int] = mapped_column(Integer, default=0)
    department_id: Mapped[str | None] = fk("departments.id")
    triggered: Mapped[bool] = mapped_column(Boolean, default=False)
    dashboard_note: Mapped[str | None] = mapped_column(String(500))


class VisitorEvent(IdMixin, TenantMixin, Base):
    """Page views and widget events for analytics and the visitor path."""

    __tablename__ = "visitor_events"
    __table_args__ = (Index("ix_ve_account_time", "account_id", "created_at"),)
    session_id: Mapped[str] = fk("visitor_sessions.id", nullable=False, ondelete="CASCADE")
    kind: Mapped[str] = mapped_column(String(32))  # page_view | widget_loaded | ...
    url: Mapped[str | None] = mapped_column(String(1024))
    title: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime)


class Chat(IdMixin, TenantMixin, TimestampMixin, Base):
    """A chat conversation (also covers offline messages: kind='offline')."""

    __tablename__ = "chats"
    __table_args__ = (
        Index("ix_chat_state", "account_id", "state"),
        Index("ix_chat_started", "account_id", "started_at"),
    )
    kind: Mapped[str] = mapped_column(String(16), default="chat")  # chat | offline
    # incoming -> active -> ended ; incoming -> missed ; active -> (agent leaves) dropped
    state: Mapped[str] = mapped_column(String(16), default="incoming")
    outcome: Mapped[str | None] = mapped_column(String(16))  # completed|dropped|missed|unresponsive
    visitor_id: Mapped[str] = fk("visitors.id", nullable=False, ondelete="CASCADE")
    session_id: Mapped[str | None] = fk("visitor_sessions.id")
    department_id: Mapped[str | None] = fk("departments.id")
    assignee_id: Mapped[str | None] = fk("users.id")
    initiated_by: Mapped[str] = mapped_column(String(16), default="visitor")  # visitor | agent | trigger
    question: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime] = mapped_column(DateTime)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime)
    first_response_at: Mapped[datetime | None] = mapped_column(DateTime)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime)
    rating: Mapped[str | None] = mapped_column(String(8))  # good | bad
    rating_comment: Mapped[str | None] = mapped_column(Text)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    message_count: Mapped[int] = mapped_column(Integer, default=0)
    preview: Mapped[str | None] = mapped_column(String(255))
    unread: Mapped[bool] = mapped_column(Boolean, default=True)
    triggered: Mapped[bool] = mapped_column(Boolean, default=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, index=True)
    ticket_id: Mapped[str | None] = fk("tickets.id")
    version: Mapped[int] = mapped_column(Integer, default=0)  # optimistic concurrency for claim
    participants: Mapped[list["ChatParticipant"]] = relationship(cascade="all, delete-orphan", lazy="selectin")


class ChatParticipant(IdMixin, Base):
    __tablename__ = "chat_participants"
    __table_args__ = (UniqueConstraint("chat_id", "user_id", name="uq_chat_participant"),)
    chat_id: Mapped[str] = fk("chats.id", nullable=False, ondelete="CASCADE")
    user_id: Mapped[str] = fk("users.id", nullable=False, ondelete="CASCADE")
    joined_at: Mapped[datetime] = mapped_column(DateTime)
    left_at: Mapped[datetime | None] = mapped_column(DateTime)


class ChatMessage(IdMixin, TenantMixin, Base):
    __tablename__ = "chat_messages"
    # (chat_id, seq) unique: backstop for the application-level ordering lock; also serves reconnect catch-up scans.
    __table_args__ = (UniqueConstraint("chat_id", "seq", name="uq_msg_chat_seq"), UniqueConstraint("chat_id", "client_id", name="uq_msg_client"))
    chat_id: Mapped[str] = fk("chats.id", nullable=False, ondelete="CASCADE")
    seq: Mapped[int] = mapped_column(Integer)  # ordering within a chat; used for reconnect catch-up
    client_id: Mapped[str | None] = mapped_column(String(64))  # idempotency key from sender
    sender_type: Mapped[str] = mapped_column(String(16))  # visitor | agent | system | trigger
    sender_id: Mapped[str | None] = mapped_column(String(36))
    sender_name: Mapped[str | None] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(16), default="text")  # text | event | file | note | options
    body: Mapped[str | None] = mapped_column(Text)
    options: Mapped[list | None] = mapped_column(JSON)
    attachment_id: Mapped[str | None] = fk("files.id")
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime)
    read_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime)


class ChatTransfer(IdMixin, TenantMixin, Base):
    __tablename__ = "chat_transfers"
    chat_id: Mapped[str] = fk("chats.id", nullable=False, ondelete="CASCADE")
    from_user_id: Mapped[str | None] = fk("users.id")
    to_user_id: Mapped[str | None] = fk("users.id")
    to_department_id: Mapped[str | None] = fk("departments.id")
    note: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime)


class Shortcut(IdMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "shortcuts"
    __table_args__ = (UniqueConstraint("account_id", "name", "owner_id", name="uq_shortcut_name"),)
    name: Mapped[str] = mapped_column(String(64))
    message: Mapped[str] = mapped_column(Text)
    options: Mapped[list] = mapped_column(JSON, default=list)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    # Availability: all agents, a department, or personal (owner_id set)
    department_id: Mapped[str | None] = fk("departments.id", ondelete="CASCADE")
    owner_id: Mapped[str | None] = fk("users.id", ondelete="CASCADE")


class BannedVisitor(IdMixin, TenantMixin, Base):
    __tablename__ = "banned_visitors"
    visitor_id: Mapped[str | None] = fk("visitors.id", ondelete="CASCADE")
    ip: Mapped[str | None] = mapped_column(String(64), index=True)
    label: Mapped[str] = mapped_column(String(120))
    reason: Mapped[str | None] = mapped_column(String(500))
    created_by: Mapped[str | None] = fk("users.id")
    created_at: Mapped[datetime] = mapped_column(DateTime, index=True)


class ChatTag(IdMixin, TenantMixin, Base):
    """Predefined chat tags (Account › Chat tags)."""

    __tablename__ = "chat_tags"
    __table_args__ = (UniqueConstraint("account_id", "name", name="uq_chat_tag"),)
    name: Mapped[str] = mapped_column(String(64))


class Trigger(IdMixin, TenantMixin, TimestampMixin, Base):
    """Chat trigger: event → conditions (all/any) → actions. Conditions/actions are JSON rows
    evaluated by the shared rule engine (app.services.rules)."""

    __tablename__ = "triggers"
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(String(500))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    event: Mapped[str] = mapped_column(String(32))  # widget_loaded | chat_requested | message_sent
    match: Mapped[str] = mapped_column(String(3), default="all")  # all | any
    conditions: Mapped[list] = mapped_column(JSON, default=list)
    actions: Mapped[list] = mapped_column(JSON, default=list)
    fire_once_per_visitor: Mapped[bool] = mapped_column(Boolean, default=True)
    position: Mapped[int] = mapped_column(Integer, default=0)


class TriggerExecution(IdMixin, TenantMixin, Base):
    __tablename__ = "trigger_executions"
    __table_args__ = (Index("ix_te_once", "trigger_id", "visitor_id"),)
    trigger_id: Mapped[str] = fk("triggers.id", nullable=False, ondelete="CASCADE")
    visitor_id: Mapped[str | None] = fk("visitors.id", ondelete="CASCADE")
    chat_id: Mapped[str | None] = fk("chats.id", ondelete="CASCADE")
    status: Mapped[str] = mapped_column(String(16))  # ok | skipped | error
    error: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime)


class FileObject(IdMixin, TenantMixin, Base):
    __tablename__ = "files"
    storage_key: Mapped[str] = mapped_column(String(255), unique=True)
    filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(127))
    size: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    uploaded_by_type: Mapped[str] = mapped_column(String(16))  # user | visitor
    uploaded_by_id: Mapped[str | None] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(DateTime)
