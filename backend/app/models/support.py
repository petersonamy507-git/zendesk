from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, IdMixin, TenantMixin, TimestampMixin, fk


# ---------------------------------------------------------------- customers & organizations
class Organization(IdMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "organizations"
    __table_args__ = (UniqueConstraint("account_id", "name", name="uq_org_name"),)
    name: Mapped[str] = mapped_column(String(160))
    domains: Mapped[list] = mapped_column(JSON, default=list)
    notes: Mapped[str | None] = mapped_column(Text)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    group_id: Mapped[str | None] = fk("departments.id")  # default group mapping
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, index=True)


class Customer(IdMixin, TenantMixin, TimestampMixin, Base):
    """End user / requester. May sign in to the Help Center (password_hash set)."""

    __tablename__ = "customers"
    __table_args__ = (UniqueConstraint("account_id", "email", name="uq_customer_email"),)
    name: Mapped[str] = mapped_column(String(160))
    email: Mapped[str | None] = mapped_column(String(254))
    phone: Mapped[str | None] = mapped_column(String(40))
    organization_id: Mapped[str | None] = fk("organizations.id")
    tags: Mapped[list] = mapped_column(JSON, default=list)
    custom_fields: Mapped[dict] = mapped_column(JSON, default=dict)
    password_hash: Mapped[str | None] = mapped_column(String(255))
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime)
    merged_into_id: Mapped[str | None] = fk("customers.id")
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, index=True)


class CustomerNote(IdMixin, TenantMixin, Base):
    __tablename__ = "customer_notes"
    customer_id: Mapped[str] = fk("customers.id", nullable=False, ondelete="CASCADE")
    author_id: Mapped[str | None] = fk("users.id")
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime)


# ---------------------------------------------------------------- tickets
class TicketForm(IdMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "ticket_forms"
    name: Mapped[str] = mapped_column(String(120))
    field_ids: Mapped[list] = mapped_column(JSON, default=list)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    end_user_visible: Mapped[bool] = mapped_column(Boolean, default=True)


class TicketField(IdMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "ticket_fields"
    key: Mapped[str] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(120))
    type: Mapped[str] = mapped_column(String(16))  # text|textarea|number|checkbox|date|dropdown|multiselect
    options: Mapped[list] = mapped_column(JSON, default=list)
    required: Mapped[bool] = mapped_column(Boolean, default=False)
    required_on_solve: Mapped[bool] = mapped_column(Boolean, default=False)
    end_user_visible: Mapped[bool] = mapped_column(Boolean, default=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    position: Mapped[int] = mapped_column(Integer, default=0)


class Ticket(IdMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "tickets"
    __table_args__ = (
        UniqueConstraint("account_id", "number", name="uq_ticket_number"),
        Index("ix_ticket_status", "account_id", "status"),
        Index("ix_ticket_assignee", "account_id", "assignee_id", "status"),
    )
    number: Mapped[int] = mapped_column(Integer)  # human-readable per-account sequence
    subject: Mapped[str] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(16), default="new")  # new|open|pending|hold|solved|closed
    priority: Mapped[str | None] = mapped_column(String(16))  # low|normal|high|urgent
    type: Mapped[str | None] = mapped_column(String(16))  # question|incident|problem|task
    channel: Mapped[str] = mapped_column(String(16), default="web")  # web|email|chat|api|portal
    requester_id: Mapped[str] = fk("customers.id", nullable=False, ondelete="RESTRICT")
    assignee_id: Mapped[str | None] = fk("users.id")
    group_id: Mapped[str | None] = fk("departments.id")
    organization_id: Mapped[str | None] = fk("organizations.id")
    form_id: Mapped[str | None] = fk("ticket_forms.id")
    tags: Mapped[list] = mapped_column(JSON, default=list)
    custom_fields: Mapped[dict] = mapped_column(JSON, default=dict)
    follower_ids: Mapped[list] = mapped_column(JSON, default=list)
    cc_emails: Mapped[list] = mapped_column(JSON, default=list)
    problem_id: Mapped[str | None] = fk("tickets.id")
    merged_into_id: Mapped[str | None] = fk("tickets.id")
    via_followup_of: Mapped[str | None] = fk("tickets.id")
    is_spam: Mapped[bool] = mapped_column(Boolean, default=False)
    sla_policy_id: Mapped[str | None] = fk("sla_policies.id")
    first_response_due_at: Mapped[datetime | None] = mapped_column(DateTime)
    next_response_due_at: Mapped[datetime | None] = mapped_column(DateTime)
    resolution_due_at: Mapped[datetime | None] = mapped_column(DateTime)
    first_responded_at: Mapped[datetime | None] = mapped_column(DateTime)
    solved_at: Mapped[datetime | None] = mapped_column(DateTime)
    status_changed_at: Mapped[datetime | None] = mapped_column(DateTime)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, index=True)


class TicketEvent(IdMixin, TenantMixin, Base):
    """Immutable ticket history: comments (public/private) and field-change audits."""

    __tablename__ = "ticket_events"
    __table_args__ = (Index("ix_te_ticket", "ticket_id", "created_at"),)
    ticket_id: Mapped[str] = fk("tickets.id", nullable=False, ondelete="CASCADE")
    kind: Mapped[str] = mapped_column(String(16))  # comment | change | system
    public: Mapped[bool] = mapped_column(Boolean, default=True)
    author_type: Mapped[str] = mapped_column(String(16))  # agent | customer | system
    author_id: Mapped[str | None] = mapped_column(String(36))
    body: Mapped[str | None] = mapped_column(Text)
    changes: Mapped[dict | None] = mapped_column(JSON)
    attachment_ids: Mapped[list] = mapped_column(JSON, default=list)
    via: Mapped[str | None] = mapped_column(String(32))  # macro:<id> | trigger:<id> | automation:<id>
    created_at: Mapped[datetime] = mapped_column(DateTime)


class View(IdMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "views"
    title: Mapped[str] = mapped_column(String(120))
    owner_id: Mapped[str | None] = fk("users.id", ondelete="CASCADE")  # NULL = shared
    group_id: Mapped[str | None] = fk("departments.id", ondelete="CASCADE")
    all_conditions: Mapped[list] = mapped_column(JSON, default=list)
    any_conditions: Mapped[list] = mapped_column(JSON, default=list)
    columns: Mapped[list] = mapped_column(JSON, default=list)
    group_by: Mapped[str | None] = mapped_column(String(40))
    sort_by: Mapped[str] = mapped_column(String(40), default="updated_at")
    sort_dir: Mapped[str] = mapped_column(String(4), default="desc")
    position: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Macro(IdMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "macros"
    title: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(String(500))
    owner_id: Mapped[str | None] = fk("users.id", ondelete="CASCADE")
    actions: Mapped[list] = mapped_column(JSON, default=list)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    usage_count: Mapped[int] = mapped_column(Integer, default=0)


class TicketTrigger(IdMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "ticket_triggers"
    title: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(String(500))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    all_conditions: Mapped[list] = mapped_column(JSON, default=list)
    any_conditions: Mapped[list] = mapped_column(JSON, default=list)
    actions: Mapped[list] = mapped_column(JSON, default=list)
    position: Mapped[int] = mapped_column(Integer, default=0)


class Automation(IdMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "automations"
    title: Mapped[str] = mapped_column(String(120))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    all_conditions: Mapped[list] = mapped_column(JSON, default=list)
    any_conditions: Mapped[list] = mapped_column(JSON, default=list)
    actions: Mapped[list] = mapped_column(JSON, default=list)
    position: Mapped[int] = mapped_column(Integer, default=0)


class RuleExecution(IdMixin, TenantMixin, Base):
    """Execution log for ticket triggers / automations / macros. (rule_type, rule_id, ticket_id,
    idempotency_key) prevents an automation from firing twice for the same ticket state."""

    __tablename__ = "rule_executions"
    __table_args__ = (UniqueConstraint("rule_id", "idempotency_key", name="uq_rule_idem"),)
    rule_type: Mapped[str] = mapped_column(String(16))
    rule_id: Mapped[str] = mapped_column(String(36), index=True)
    ticket_id: Mapped[str | None] = fk("tickets.id", ondelete="CASCADE")
    idempotency_key: Mapped[str] = mapped_column(String(128))
    status: Mapped[str] = mapped_column(String(16))  # ok | error | skipped
    attempts: Mapped[int] = mapped_column(Integer, default=1)
    error: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime, index=True)


class BusinessHours(IdMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "business_hours"
    name: Mapped[str] = mapped_column(String(120))
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")
    # {"mon": [["09:00","17:00"]], ...}
    schedule: Mapped[dict] = mapped_column(JSON, default=dict)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)


class Holiday(IdMixin, TenantMixin, Base):
    __tablename__ = "holidays"
    business_hours_id: Mapped[str] = fk("business_hours.id", nullable=False, ondelete="CASCADE")
    name: Mapped[str] = mapped_column(String(120))
    start_date: Mapped[str] = mapped_column(String(10))  # YYYY-MM-DD (local)
    end_date: Mapped[str] = mapped_column(String(10))


class SlaPolicy(IdMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "sla_policies"
    title: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(String(500))
    all_conditions: Mapped[list] = mapped_column(JSON, default=list)
    any_conditions: Mapped[list] = mapped_column(JSON, default=list)
    # {"urgent": {"first_reply": 30, "next_reply": 60, "resolution": 240, "business_hours": true}, ...} minutes
    targets: Mapped[dict] = mapped_column(JSON, default=dict)
    business_hours_id: Mapped[str | None] = fk("business_hours.id")
    position: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


# ---------------------------------------------------------------- knowledge base
class KnowledgeCategory(IdMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "knowledge_categories"
    name: Mapped[str] = mapped_column(String(160))
    description: Mapped[str | None] = mapped_column(Text)
    position: Mapped[int] = mapped_column(Integer, default=0)


class KnowledgeSection(IdMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "knowledge_sections"
    category_id: Mapped[str] = fk("knowledge_categories.id", nullable=False, ondelete="CASCADE")
    name: Mapped[str] = mapped_column(String(160))
    description: Mapped[str | None] = mapped_column(Text)
    position: Mapped[int] = mapped_column(Integer, default=0)
    visibility: Mapped[str] = mapped_column(String(16), default="everyone")  # everyone|signed_in|agents


class KnowledgeArticle(IdMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "knowledge_articles"
    section_id: Mapped[str] = fk("knowledge_sections.id", nullable=False, ondelete="CASCADE")
    title: Mapped[str] = mapped_column(String(255))
    body: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="draft")  # draft | published | archived
    author_id: Mapped[str | None] = fk("users.id")
    position: Mapped[int] = mapped_column(Integer, default=0)
    labels: Mapped[list] = mapped_column(JSON, default=list)
    attachment_ids: Mapped[list] = mapped_column(JSON, default=list)
    version: Mapped[int] = mapped_column(Integer, default=1)
    published_at: Mapped[datetime | None] = mapped_column(DateTime)
    helpful_count: Mapped[int] = mapped_column(Integer, default=0)
    unhelpful_count: Mapped[int] = mapped_column(Integer, default=0)
    view_count: Mapped[int] = mapped_column(Integer, default=0)


class ArticleVersion(IdMixin, TenantMixin, Base):
    __tablename__ = "article_versions"
    article_id: Mapped[str] = fk("knowledge_articles.id", nullable=False, ondelete="CASCADE")
    version: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(255))
    body: Mapped[str] = mapped_column(Text)
    author_id: Mapped[str | None] = fk("users.id")
    created_at: Mapped[datetime] = mapped_column(DateTime)


class ArticleFeedback(IdMixin, TenantMixin, Base):
    __tablename__ = "article_feedback"
    article_id: Mapped[str] = fk("knowledge_articles.id", nullable=False, ondelete="CASCADE")
    helpful: Mapped[bool] = mapped_column(Boolean)
    comment: Mapped[str | None] = mapped_column(String(1000))
    customer_id: Mapped[str | None] = fk("customers.id")
    created_at: Mapped[datetime] = mapped_column(DateTime)


# ---------------------------------------------------------------- reporting & channels
class ReportDefinition(IdMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "report_definitions"
    owner_id: Mapped[str | None] = fk("users.id", ondelete="CASCADE")
    name: Mapped[str] = mapped_column(String(120))
    metric: Mapped[str] = mapped_column(String(40))
    filters: Mapped[dict] = mapped_column(JSON, default=dict)


class Channel(IdMixin, TenantMixin, TimestampMixin, Base):
    """Channel configuration. `status` is 'connected' only after a real provider handshake succeeded."""

    __tablename__ = "channels"
    kind: Mapped[str] = mapped_column(String(24))  # web_chat | email | portal | messaging | voice
    name: Mapped[str] = mapped_column(String(120))
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(16), default="not_configured")
    last_error: Mapped[str | None] = mapped_column(String(500))
