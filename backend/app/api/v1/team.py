"""Agents, departments, roles and account settings (Settings › Agents/Departments/Roles/Routing/Widget/Account)."""

from fastapi import APIRouter, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select

from app.api.deps import DB, Current, Principal, client_ip, require
from app.core.errors import AppError, Conflict, Forbidden
from app.core.events import publish_sync
from app.core.permissions import ALL_PERMISSIONS
from app.core.security import new_opaque_token, utcnow
from app.models import Account, Department, DepartmentMember, Role, RolePermission, User
from app.repositories.base import Repo
from app.schemas.common import Ok, Schema
from app.schemas.identity import UserOut
from app.services import audit, settings as settings_svc
from app.services.auth import issue_token

router = APIRouter(tags=["team"])


# ------------------------------------------------------------------ agents
class AgentOut(UserOut):
    department_ids: list[str] = []


class AgentIn(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=120)
    display_name: str | None = None
    role_id: str
    department_ids: list[str] = []
    chat_limit: int | None = Field(default=None, ge=1, le=20)
    skills: list[str] = Field(default=[], max_length=5)


class AgentPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    display_name: str | None = None
    role_id: str | None = None
    enabled: bool | None = None
    department_ids: list[str] | None = None
    chat_limit: int | None = Field(default=None, ge=1, le=20)
    skills: list[str] | None = Field(default=None, max_length=5)


class AgentBulk(BaseModel):
    """Bulk actions from the Agents list: Set chat limit (1–20), Reassign role, Assign skills (≤ 5)."""

    ids: list[str] = Field(min_length=1, max_length=200)
    chat_limit: int | None = Field(default=None, ge=1, le=20)
    role_id: str | None = None
    skills: list[str] | None = Field(default=None, max_length=5)


def _dept_map(db, account_id: str) -> dict[str, list[str]]:
    rows = db.execute(select(DepartmentMember.user_id, DepartmentMember.department_id).join(Department).where(Department.account_id == account_id)).all()
    out: dict[str, list[str]] = {}
    for uid, did in rows:
        out.setdefault(uid, []).append(did)
    return out


def _agent_out(u: User, dm: dict) -> AgentOut:
    return AgentOut.model_validate(u).model_copy(update={"department_ids": dm.get(u.id, [])})


def _set_departments(db, account_id: str, user_id: str, dept_ids: list[str]) -> None:
    repo = Repo(db, Department, account_id)
    for d in dept_ids:
        repo.get(d)  # tenant check
    db.query(DepartmentMember).filter(DepartmentMember.user_id == user_id).delete()
    for d in dict.fromkeys(dept_ids):
        db.add(DepartmentMember(department_id=d, user_id=user_id))


@router.get("/agents", response_model=dict)
def list_agents(p: Current, db: DB, q: str | None = None, department_id: str | None = None, page: int = 1, per_page: int = 50):
    repo = Repo(db, User, p.account_id)
    stmt = repo.search(repo.query().where(User.is_agent.is_(True)), q, User.name, User.email, User.display_name)
    if department_id:
        stmt = stmt.join(DepartmentMember, DepartmentMember.user_id == User.id).where(DepartmentMember.department_id == department_id)
    pg = repo.paginate(stmt.order_by(User.display_name, User.name), page, per_page)
    dm = _dept_map(db, p.account_id)
    enabled = db.scalar(select(func.count()).select_from(User).where(User.account_id == p.account_id, User.is_agent.is_(True), User.enabled.is_(True), User.deleted_at.is_(None)))
    return {"items": [_agent_out(u, dm) for u in pg.items], "total": pg.total, "page": pg.page, "per_page": pg.per_page, "page_count": pg.page_count, "enabled_count": enabled}


@router.post("/agents", response_model=AgentOut, status_code=201)
def invite_agent(body: AgentIn, request: Request, db: DB, p: Principal = require("agents.manage")):
    acc = db.get(Account, p.account_id)
    active = db.scalar(select(func.count()).select_from(User).where(User.account_id == p.account_id, User.is_agent.is_(True), User.enabled.is_(True), User.deleted_at.is_(None)))
    if active >= acc.max_agents:
        raise Conflict(f"Account limit reached: your plan allows {acc.max_agents} agent(s)", code="plan_limit")
    role = Repo(db, Role, p.account_id).get(body.role_id)
    if role.key == "owner" and p.user.role.key != "owner":
        raise Forbidden("Only the account owner can grant the owner role")
    if db.scalar(select(User).where(User.account_id == p.account_id, User.email == body.email.lower())):
        raise Conflict("A user with this email already exists")
    u = Repo(db, User, p.account_id).add(email=body.email.lower(), name=body.name, display_name=body.display_name or body.name, role_id=role.id, chat_limit=body.chat_limit, skills=body.skills, is_agent=role.key != "end_user")
    _set_departments(db, p.account_id, u.id, body.department_ids)
    issue_token(db, u, "invite", hours=72)
    audit.record(db, account_id=p.account_id, actor_id=p.id, action="agent.invited", entity_type="user", entity_id=u.id, changes={"email": body.email, "role": role.key}, ip=client_ip(request))
    db.commit()
    db.refresh(u)
    return _agent_out(u, _dept_map(db, p.account_id))


@router.post("/agents/bulk", response_model=Ok)
def bulk_update_agents(body: AgentBulk, request: Request, db: DB, p: Principal = require("agents.manage")):
    if body.chat_limit is None and body.role_id is None and body.skills is None:
        raise AppError("Choose a chat limit, role or skills to apply")
    repo = Repo(db, User, p.account_id)
    role = Repo(db, Role, p.account_id).get(body.role_id) if body.role_id else None
    if role and role.key == "owner" and p.user.role.key != "owner":
        raise Forbidden("Only the account owner can grant the owner role")
    users = [repo.get(i) for i in dict.fromkeys(body.ids)]  # 404 if any id is outside this tenant
    for u in users:
        if role and (u.role.key == "owner" or u.id == p.id) and p.user.role.key != "owner":
            raise Forbidden("Only the account owner can change the owner role or their own role")
        if role and u.role.key == "owner" and role.key != "owner":
            owners = db.scalar(select(func.count()).select_from(User).join(Role, Role.id == User.role_id).where(User.account_id == p.account_id, Role.key == "owner", User.deleted_at.is_(None)))
            if (owners or 0) <= 1:
                raise Conflict("An account needs at least one owner")
    changes: dict = {}
    for u in users:
        vals: dict = {}
        if body.chat_limit is not None:
            vals["chat_limit"] = body.chat_limit
        if role:
            vals["role_id"] = role.id
        if body.skills is not None:
            vals["skills"] = list(dict.fromkeys(s.strip() for s in body.skills if s.strip()))
        changes[u.id] = repo.update(u, vals)
    audit.record(db, account_id=p.account_id, actor_id=p.id, action="agent.bulk_updated", entity_type="user", changes=changes, ip=client_ip(request))
    db.commit()
    publish_sync(f"account:{p.account_id}", "agent.updated", {"user_ids": body.ids})
    return Ok()


@router.get("/agents/{agent_id}", response_model=AgentOut)
def get_agent(agent_id: str, p: Current, db: DB):
    return _agent_out(Repo(db, User, p.account_id).get(agent_id), _dept_map(db, p.account_id))


@router.patch("/agents/{agent_id}", response_model=AgentOut)
def update_agent(agent_id: str, body: AgentPatch, request: Request, db: DB, p: Principal = require("agents.manage")):
    repo = Repo(db, User, p.account_id)
    u = repo.get(agent_id)
    values = body.model_dump(exclude_unset=True)
    depts = values.pop("department_ids", None)
    if "role_id" in values:
        role = Repo(db, Role, p.account_id).get(values["role_id"])
        if (role.key == "owner" or u.role.key == "owner") and p.user.role.key != "owner":
            raise Forbidden("Only the account owner can change the owner role")
    if values.get("enabled") is False and u.id == p.id:
        raise AppError("You can't deactivate yourself")
    if values.get("enabled") is True and not u.enabled:
        acc = db.get(Account, p.account_id)
        active = db.scalar(select(func.count()).select_from(User).where(User.account_id == p.account_id, User.is_agent.is_(True), User.enabled.is_(True), User.deleted_at.is_(None)))
        if active >= acc.max_agents:
            raise Conflict("Account limit reached", code="plan_limit")
    changes = repo.update(u, values)
    if depts is not None:
        _set_departments(db, p.account_id, u.id, depts)
        changes["department_ids"] = depts
    if values.get("enabled") is False:
        u.presence = "invisible"
    audit.record(db, account_id=p.account_id, actor_id=p.id, action="agent.updated", entity_type="user", entity_id=u.id, changes=changes, ip=client_ip(request))
    db.commit()
    db.refresh(u)
    publish_sync(f"account:{p.account_id}", "agent.updated", {"user_id": u.id})
    return _agent_out(u, _dept_map(db, p.account_id))


@router.delete("/agents/{agent_id}", response_model=Ok)
def delete_agent(agent_id: str, request: Request, db: DB, p: Principal = require("agents.manage")):
    u = Repo(db, User, p.account_id).get(agent_id)
    if u.id == p.id or u.role.key == "owner":
        raise AppError("This user can't be deleted")
    u.deleted_at = utcnow()
    u.enabled = False
    u.email = f"deleted+{new_opaque_token()[:8]}+{u.email}"[:254]
    audit.record(db, account_id=p.account_id, actor_id=p.id, action="agent.deleted", entity_type="user", entity_id=u.id, ip=client_ip(request))
    db.commit()
    return Ok()


# ------------------------------------------------------------------ departments
class DepartmentOut(Schema):
    id: str
    name: str
    description: str | None
    enabled: bool
    agent_ids: list[str] = []


class DepartmentIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    enabled: bool = True
    agent_ids: list[str] = Field(min_length=1)


class DepartmentPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    enabled: bool | None = None
    agent_ids: list[str] | None = Field(default=None, min_length=1)


def _dept_out(d: Department) -> DepartmentOut:
    return DepartmentOut(id=d.id, name=d.name, description=d.description, enabled=d.enabled, agent_ids=[m.user_id for m in d.members])


def _check_dept_limit(db, account_id: str, enabling: bool) -> None:
    if not enabling:
        return
    acc = db.get(Account, account_id)
    n = db.scalar(select(func.count()).select_from(Department).where(Department.account_id == account_id, Department.enabled.is_(True)))
    if n >= acc.max_departments:
        raise Conflict(f"Department limit reached ({acc.max_departments})", code="plan_limit")


def _set_members(db, account_id: str, d: Department, agent_ids: list[str]) -> None:
    urepo = Repo(db, User, account_id)
    for a in agent_ids:
        urepo.get(a)
    d.members = [DepartmentMember(user_id=a) for a in dict.fromkeys(agent_ids)]


@router.get("/departments", response_model=dict)
def list_departments(p: Current, db: DB, q: str | None = None):
    repo = Repo(db, Department, p.account_id)
    items = db.scalars(repo.search(repo.query(), q, Department.name, Department.description).order_by(Department.name)).all()
    return {"items": [_dept_out(d) for d in items], "total": len(items), "enabled_count": sum(d.enabled for d in items)}


@router.post("/departments", response_model=DepartmentOut, status_code=201)
def create_department(body: DepartmentIn, db: DB, p: Principal = require("departments.manage")):
    _check_dept_limit(db, p.account_id, body.enabled)
    d = Repo(db, Department, p.account_id).add(name=body.name.strip(), description=body.description, enabled=body.enabled)
    _set_members(db, p.account_id, d, body.agent_ids)
    audit.record(db, account_id=p.account_id, actor_id=p.id, action="department.created", entity_type="department", entity_id=d.id, changes={"name": body.name})
    db.commit()
    return _dept_out(d)


@router.get("/departments/{dept_id}", response_model=DepartmentOut)
def get_department(dept_id: str, p: Current, db: DB):
    return _dept_out(Repo(db, Department, p.account_id).get(dept_id))


@router.patch("/departments/{dept_id}", response_model=DepartmentOut)
def update_department(dept_id: str, body: DepartmentPatch, db: DB, p: Principal = require("departments.manage")):
    repo = Repo(db, Department, p.account_id)
    d = repo.get(dept_id)
    values = body.model_dump(exclude_unset=True)
    agents = values.pop("agent_ids", None)
    if values.get("enabled") and not d.enabled:
        _check_dept_limit(db, p.account_id, True)
    changes = repo.update(d, values)
    if agents is not None:
        _set_members(db, p.account_id, d, agents)
        changes["agent_ids"] = agents
    audit.record(db, account_id=p.account_id, actor_id=p.id, action="department.updated", entity_type="department", entity_id=d.id, changes=changes)
    db.commit()
    return _dept_out(d)


@router.delete("/departments/{dept_id}", response_model=Ok)
def delete_department(dept_id: str, db: DB, p: Principal = require("departments.manage")):
    d = Repo(db, Department, p.account_id).get(dept_id)
    db.delete(d)
    audit.record(db, account_id=p.account_id, actor_id=p.id, action="department.deleted", entity_type="department", entity_id=dept_id)
    db.commit()
    return Ok()


# ------------------------------------------------------------------ roles
class RoleOut(Schema):
    id: str
    key: str
    name: str
    description: str | None
    is_system: bool
    permissions: list[str]


class RoleIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str | None = None
    permissions: list[str]


def _role_out(r: Role) -> RoleOut:
    return RoleOut(id=r.id, key=r.key, name=r.name, description=r.description, is_system=r.is_system, permissions=sorted(x.permission for x in r.permissions))


@router.get("/roles", response_model=list[RoleOut])
def list_roles(p: Current, db: DB):
    return [_role_out(r) for r in db.scalars(Repo(db, Role, p.account_id).query().order_by(Role.is_system.desc(), Role.name))]


@router.get("/permissions")
def list_permissions(_: Current):
    return [{"code": k, "description": v} for k, v in ALL_PERMISSIONS.items()]


@router.post("/roles", response_model=RoleOut, status_code=201)
def create_role(body: RoleIn, db: DB, p: Principal = require("roles.manage")):
    bad = set(body.permissions) - set(ALL_PERMISSIONS)
    if bad:
        raise AppError(f"Unknown permissions: {', '.join(sorted(bad))}")
    if "billing.manage" in body.permissions and p.user.role.key != "owner":
        raise Forbidden("Only the owner can grant billing permissions")
    key = "custom_" + new_opaque_token()[:8].lower()
    r = Repo(db, Role, p.account_id).add(key=key, name=body.name, description=body.description, is_system=False)
    r.permissions = [RolePermission(permission=x) for x in dict.fromkeys(body.permissions)]
    audit.record(db, account_id=p.account_id, actor_id=p.id, action="role.created", entity_type="role", entity_id=r.id, changes={"permissions": body.permissions})
    db.commit()
    return _role_out(r)


@router.put("/roles/{role_id}", response_model=RoleOut)
def update_role(role_id: str, body: RoleIn, db: DB, p: Principal = require("roles.manage")):
    r = Repo(db, Role, p.account_id).get(role_id)
    if r.is_system:
        raise AppError("System roles can't be edited")
    bad = set(body.permissions) - set(ALL_PERMISSIONS)
    if bad:
        raise AppError(f"Unknown permissions: {', '.join(sorted(bad))}")
    r.name, r.description = body.name, body.description
    r.permissions = [RolePermission(permission=x) for x in dict.fromkeys(body.permissions)]
    audit.record(db, account_id=p.account_id, actor_id=p.id, action="role.updated", entity_type="role", entity_id=r.id, changes={"permissions": body.permissions})
    db.commit()
    return _role_out(r)


@router.delete("/roles/{role_id}", response_model=Ok)
def delete_role(role_id: str, db: DB, p: Principal = require("roles.manage")):
    r = Repo(db, Role, p.account_id).get(role_id)
    if r.is_system:
        raise AppError("System roles can't be deleted")
    if db.scalar(select(func.count()).select_from(User).where(User.role_id == r.id, User.deleted_at.is_(None))):
        raise Conflict("Reassign users with this role before deleting it")
    db.delete(r)
    db.commit()
    return Ok()


# ------------------------------------------------------------------ settings sections
@router.get("/settings/{section}")
def get_settings_section(section: str, p: Current, db: DB):
    data = settings_svc.get_section(db, p.account_id, section)
    if section == "widget.security" and data.get("shared_secret") and not p.can("settings.manage"):
        data["shared_secret"] = None
    return data


@router.put("/settings/{section}")
def put_settings_section(section: str, body: dict, request: Request, db: DB, p: Principal = require("settings.manage")):
    data, changes = settings_svc.put_section(db, p.account_id, section, body)
    audit.record(db, account_id=p.account_id, actor_id=p.id, action="settings.updated", entity_type="settings", entity_id=None, changes={"section": section, **changes}, ip=client_ip(request))
    db.commit()
    publish_sync(f"account:{p.account_id}", "settings.updated", {"section": section})
    return data


@router.post("/settings/{section}/reset")
def reset_settings_section(section: str, db: DB, p: Principal = require("settings.manage")):
    data, changes = settings_svc.put_section(db, p.account_id, section, {}, reset=True)
    audit.record(db, account_id=p.account_id, actor_id=p.id, action="settings.reset", entity_type="settings", changes={"section": section, **changes})
    db.commit()
    return data


@router.post("/settings/widget.security/regenerate-secret")
def regenerate_secret(db: DB, p: Principal = require("settings.manage")):
    data, _ = settings_svc.put_section(db, p.account_id, "widget.security", {"shared_secret": new_opaque_token()})
    audit.record(db, account_id=p.account_id, actor_id=p.id, action="widget.secret_regenerated", entity_type="settings")
    db.commit()
    return data


class AccountPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    timezone: str | None = None


@router.patch("/accounts/current")
def update_account(body: AccountPatch, db: DB, p: Principal = require("settings.manage")):
    acc = db.get(Account, p.account_id)
    changes = {}
    for k, v in body.model_dump(exclude_unset=True).items():
        if k == "timezone":
            from zoneinfo import ZoneInfo

            try:
                ZoneInfo(v)
            except Exception as e:
                raise AppError("Unknown timezone") from e
        if getattr(acc, k) != v:
            changes[k] = [getattr(acc, k), v]
            setattr(acc, k, v)
    audit.record(db, account_id=p.account_id, actor_id=p.id, action="account.updated", entity_type="account", entity_id=acc.id, changes=changes)
    db.commit()
    return {"id": acc.id, "name": acc.name, "timezone": acc.timezone, "subdomain": acc.subdomain, "plan": acc.plan}

