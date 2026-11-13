"""Settings › Shortcuts, Banned, Triggers and Account › Chat tags."""

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, or_, select

from app.api.deps import DB, Current, Principal, require
from app.core.errors import AppError, Conflict, Forbidden
from app.core.security import utcnow
from app.models import Account, BannedVisitor, ChatTag, Department, DepartmentMember, Shortcut, Trigger
from app.repositories.base import Repo
from app.schemas.common import Ok, Schema
from app.services import audit, chat_triggers

router = APIRouter(tags=["chat-config"])


# ------------------------------------------------------------------ shortcuts
class ShortcutOut(Schema):
    id: str
    name: str
    message: str
    options: list
    tags: list
    department_id: str | None
    owner_id: str | None


class ShortcutIn(BaseModel):
    name: str = Field(min_length=1, max_length=64, pattern=r"^[^\s/]+$")
    message: str = Field(min_length=1, max_length=5000)
    options: list[str] = Field(default=[], max_length=20)
    tags: list[str] = []
    availability: Literal["all", "department", "personal"] = "all"
    department_id: str | None = None

    @field_validator("tags")
    @classmethod
    def _norm(cls, v: list[str]) -> list[str]:
        return list(dict.fromkeys(t.strip().lower() for t in v if t.strip()))


def _visible_shortcuts(db, p: Principal):
    my_depts = select(DepartmentMember.department_id).where(DepartmentMember.user_id == p.id)
    shared = Shortcut.owner_id.is_(None)
    if not p.can("shortcuts.manage"):
        shared = shared & (Shortcut.department_id.is_(None) | Shortcut.department_id.in_(my_depts))
    return Repo(db, Shortcut, p.account_id).query().where(or_(Shortcut.owner_id == p.id, shared))


@router.get("/shortcuts")
def list_shortcuts(p: Current, db: DB, q: str | None = None, availability: Literal["all", "department", "personal"] | None = None, sort: Literal["name", "-name"] = "name"):
    stmt = Repo.search(_visible_shortcuts(db, p), q, Shortcut.name, Shortcut.message)
    if availability == "personal":
        stmt = stmt.where(Shortcut.owner_id == p.id)
    elif availability == "department":
        stmt = stmt.where(Shortcut.department_id.is_not(None))
    elif availability == "all":
        stmt = stmt.where(Shortcut.owner_id.is_(None), Shortcut.department_id.is_(None))
    stmt = stmt.order_by(Shortcut.name.desc() if sort == "-name" else Shortcut.name)
    items = db.scalars(stmt).all()
    return {"items": [ShortcutOut.model_validate(s) for s in items], "total": len(items)}


def _shortcut_values(body: ShortcutIn, p: Principal, db) -> dict:
    if body.availability != "personal" and not p.can("shortcuts.manage"):
        raise Forbidden("Only admins can create shared shortcuts")
    dept = None
    if body.availability == "department":
        if not body.department_id:
            raise AppError("Choose a department")
        dept = Repo(db, Department, p.account_id).get(body.department_id).id
    return {"name": body.name, "message": body.message, "options": body.options, "tags": body.tags, "department_id": dept, "owner_id": p.id if body.availability == "personal" else None}


@router.post("/shortcuts", response_model=ShortcutOut, status_code=201)
def create_shortcut(body: ShortcutIn, p: Current, db: DB):
    vals = _shortcut_values(body, p, db)
    if db.scalar(select(Shortcut.id).where(Shortcut.account_id == p.account_id, Shortcut.name == body.name, (Shortcut.owner_id == vals["owner_id"]) if vals["owner_id"] else Shortcut.owner_id.is_(None))):
        raise Conflict("A shortcut with this name already exists")
    s = Repo(db, Shortcut, p.account_id).add(**vals)
    audit.record(db, account_id=p.account_id, actor_id=p.id, action="shortcut.created", entity_type="shortcut", entity_id=s.id)
    db.commit()
    return s


def _own_or_manage(s: Shortcut, p: Principal) -> None:
    if s.owner_id != p.id and not p.can("shortcuts.manage"):
        raise Forbidden("You can't edit this shortcut")


@router.put("/shortcuts/{sid}", response_model=ShortcutOut)
def update_shortcut(sid: str, body: ShortcutIn, p: Current, db: DB):
    repo = Repo(db, Shortcut, p.account_id)
    s = repo.get(sid)
    _own_or_manage(s, p)
    changes = repo.update(s, _shortcut_values(body, p, db))
    audit.record(db, account_id=p.account_id, actor_id=p.id, action="shortcut.updated", entity_type="shortcut", entity_id=s.id, changes=changes)
    db.commit()
    return s


class IdsIn(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=500)


@router.post("/shortcuts/bulk-delete", response_model=Ok)
def delete_shortcuts(body: IdsIn, p: Current, db: DB):
    for s in db.scalars(Repo(db, Shortcut, p.account_id).query().where(Shortcut.id.in_(body.ids))):
        _own_or_manage(s, p)
        db.delete(s)
    audit.record(db, account_id=p.account_id, actor_id=p.id, action="shortcut.deleted", entity_type="shortcut", changes={"ids": body.ids})
    db.commit()
    return Ok()


# ------------------------------------------------------------------ banned
class BannedOut(Schema):
    id: str
    visitor_id: str | None
    ip: str | None
    label: str
    reason: str | None
    created_at: object


class BanIn(BaseModel):
    ip: str = Field(min_length=3, max_length=64, pattern=r"^[0-9a-fA-F:.]+$")
    reason: str | None = Field(default=None, max_length=500)


@router.get("/banned")
def list_banned(p: Current, db: DB, q: str | None = None, kind: Literal["all", "visitor", "ip"] = "all", page: int = 1, per_page: int = 50, sort: Literal["created_at", "-created_at"] = "-created_at"):
    repo = Repo(db, BannedVisitor, p.account_id)
    stmt = repo.search(repo.query(), q, BannedVisitor.label, BannedVisitor.ip, BannedVisitor.reason)
    if kind == "visitor":
        stmt = stmt.where(BannedVisitor.visitor_id.is_not(None))
    elif kind == "ip":
        stmt = stmt.where(BannedVisitor.visitor_id.is_(None))
    pg = repo.paginate(stmt.order_by(BannedVisitor.created_at if sort == "created_at" else BannedVisitor.created_at.desc()), page, per_page)
    return {"items": [BannedOut.model_validate(b).model_dump(mode="json") for b in pg.items], "total": pg.total, "page": pg.page, "page_count": pg.page_count, "per_page": pg.per_page}


@router.post("/banned", status_code=201)
def ban_ip(body: BanIn, db: DB, p: Principal = require("visitors.ban")):
    b = Repo(db, BannedVisitor, p.account_id).add(ip=body.ip, label=body.ip, reason=body.reason, created_by=p.id, created_at=utcnow())
    audit.record(db, account_id=p.account_id, actor_id=p.id, action="ban.created", entity_type="ban", entity_id=b.id, changes={"ip": body.ip})
    db.commit()
    return BannedOut.model_validate(b).model_dump(mode="json")


@router.post("/banned/bulk-delete", response_model=Ok)
def unban(body: IdsIn, db: DB, p: Principal = require("visitors.ban")):
    for b in db.scalars(Repo(db, BannedVisitor, p.account_id).query().where(BannedVisitor.id.in_(body.ids))):
        db.delete(b)
    audit.record(db, account_id=p.account_id, actor_id=p.id, action="ban.deleted", entity_type="ban", changes={"ids": body.ids})
    db.commit()
    return Ok()


# ------------------------------------------------------------------ triggers
class Condition(BaseModel):
    field: str
    operator: str
    value: object = None


class Action(BaseModel):
    type: str
    value: object = None
    name: str | None = None


class TriggerIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    enabled: bool = True
    event: str
    match: Literal["all", "any"] = "all"
    conditions: list[Condition] = []
    actions: list[Action]
    fire_once_per_visitor: bool = True


class TriggerOut(Schema):
    id: str
    name: str
    description: str | None
    enabled: bool
    event: str
    match: str
    conditions: list
    actions: list
    fire_once_per_visitor: bool


def _check_trigger_limit(db, account_id: str, enabling: bool, exclude_id: str | None = None) -> None:
    if not enabling:
        return
    acc = db.get(Account, account_id)
    stmt = select(func.count()).select_from(Trigger).where(Trigger.account_id == account_id, Trigger.enabled.is_(True))
    if exclude_id:
        stmt = stmt.where(Trigger.id != exclude_id)
    if (db.scalar(stmt) or 0) >= acc.max_triggers:
        raise Conflict(f"Trigger limit reached ({acc.max_triggers} enabled)", code="plan_limit")


@router.get("/triggers/schema")
def trigger_schema(_: Current):
    from app.services.rules import OPERATORS

    return {"events": chat_triggers.EVENTS, "fields": chat_triggers.FIELDS, "actions": chat_triggers.ACTIONS, "operators": list(OPERATORS)}


@router.get("/triggers")
def list_triggers(p: Current, db: DB, q: str | None = None):
    repo = Repo(db, Trigger, p.account_id)
    items = db.scalars(repo.search(repo.query(), q, Trigger.name, Trigger.description).order_by(Trigger.position, Trigger.name)).all()
    return {"items": [TriggerOut.model_validate(t) for t in items], "total": len(items), "enabled_count": sum(t.enabled for t in items)}


@router.get("/triggers/{tid}", response_model=TriggerOut)
def get_trigger(tid: str, p: Current, db: DB):
    return Repo(db, Trigger, p.account_id).get(tid)


@router.post("/triggers", response_model=TriggerOut, status_code=201)
def create_trigger(body: TriggerIn, db: DB, p: Principal = require("triggers.manage")):
    data = body.model_dump()
    chat_triggers.validate(data["event"], data["match"], data["conditions"], data["actions"])
    _check_trigger_limit(db, p.account_id, body.enabled)
    t = Repo(db, Trigger, p.account_id).add(**data)
    audit.record(db, account_id=p.account_id, actor_id=p.id, action="trigger.created", entity_type="trigger", entity_id=t.id, changes=data)
    db.commit()
    return t


@router.put("/triggers/{tid}", response_model=TriggerOut)
def update_trigger(tid: str, body: TriggerIn, db: DB, p: Principal = require("triggers.manage")):
    repo = Repo(db, Trigger, p.account_id)
    t = repo.get(tid)
    data = body.model_dump()
    chat_triggers.validate(data["event"], data["match"], data["conditions"], data["actions"])
    _check_trigger_limit(db, p.account_id, body.enabled and not t.enabled, exclude_id=t.id)
    changes = repo.update(t, data)
    audit.record(db, account_id=p.account_id, actor_id=p.id, action="trigger.updated", entity_type="trigger", entity_id=t.id, changes=changes)
    db.commit()
    return t


class EnabledIn(BaseModel):
    ids: list[str] = Field(min_length=1)
    enabled: bool


@router.post("/triggers/bulk-enable", response_model=Ok)
def bulk_enable(body: EnabledIn, db: DB, p: Principal = require("triggers.manage")):
    for t in db.scalars(Repo(db, Trigger, p.account_id).query().where(Trigger.id.in_(body.ids))):
        if body.enabled and not t.enabled:
            _check_trigger_limit(db, p.account_id, True)
        t.enabled = body.enabled
        db.flush()
    db.commit()
    return Ok()


@router.post("/triggers/bulk-delete", response_model=Ok)
def delete_triggers(body: IdsIn, db: DB, p: Principal = require("triggers.manage")):
    for t in db.scalars(Repo(db, Trigger, p.account_id).query().where(Trigger.id.in_(body.ids))):
        db.delete(t)
    audit.record(db, account_id=p.account_id, actor_id=p.id, action="trigger.deleted", entity_type="trigger", changes={"ids": body.ids})
    db.commit()
    return Ok()


# ------------------------------------------------------------------ chat tags
@router.get("/chat-tags")
def list_tags(p: Current, db: DB):
    return sorted(db.scalars(select(ChatTag.name).where(ChatTag.account_id == p.account_id)))


class TagsIn(BaseModel):
    tags: list[str]


@router.put("/chat-tags")
def set_tags(body: TagsIn, db: DB, p: Principal = require("settings.manage")):
    wanted = {t.strip().lower() for t in body.tags if t.strip()}
    existing = {t.name: t for t in db.scalars(select(ChatTag).where(ChatTag.account_id == p.account_id))}
    for name, row in existing.items():
        if name not in wanted:
            db.delete(row)
    for name in wanted - set(existing):
        db.add(ChatTag(account_id=p.account_id, name=name[:64]))
    db.commit()
    return sorted(wanted)
