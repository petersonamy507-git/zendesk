"""Generic tenant-scoped repository. All data access for tenant-owned tables goes through
`Repo(db, Model, account_id)` so cross-tenant reads/writes are impossible by construction."""

from collections.abc import Sequence
from typing import Any, Generic, TypeVar

from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session

from app.core.errors import NotFound

M = TypeVar("M")


class Page(Generic[M]):
    def __init__(self, items: Sequence[M], total: int, page: int, per_page: int):
        self.items = list(items)
        self.total = total
        self.page = page
        self.per_page = per_page

    @property
    def page_count(self) -> int:
        return max(1, -(-self.total // self.per_page))


class Repo(Generic[M]):
    def __init__(self, db: Session, model: type[M], account_id: str):
        self.db = db
        self.model = model
        self.account_id = account_id

    def query(self) -> Select:
        stmt = select(self.model).where(self.model.account_id == self.account_id)  # type: ignore[attr-defined]
        if hasattr(self.model, "deleted_at"):
            stmt = stmt.where(self.model.deleted_at.is_(None))  # type: ignore[attr-defined]
        return stmt

    def get(self, id_: str) -> M:
        obj = self.db.scalar(self.query().where(self.model.id == id_))  # type: ignore[attr-defined]
        if obj is None:
            raise NotFound(f"{self.model.__name__} not found")
        return obj

    def find(self, id_: str | None) -> M | None:
        if not id_:
            return None
        return self.db.scalar(self.query().where(self.model.id == id_))  # type: ignore[attr-defined]

    def add(self, **values: Any) -> M:
        obj = self.model(account_id=self.account_id, **values)  # type: ignore[call-arg]
        self.db.add(obj)
        self.db.flush()
        return obj

    def update(self, obj: M, values: dict[str, Any]) -> dict[str, list]:
        """Apply values, returning a {field: [old, new]} diff for audit logs."""
        changes: dict[str, list] = {}
        for k, v in values.items():
            old = getattr(obj, k)
            if old != v:
                changes[k] = [old, v]
                setattr(obj, k, v)
        self.db.flush()
        return changes

    def paginate(self, stmt: Select, page: int = 1, per_page: int = 25) -> Page[M]:
        per_page = max(1, min(per_page, 200))
        page = max(1, page)
        total = self.db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
        items = self.db.scalars(stmt.limit(per_page).offset((page - 1) * per_page)).all()
        return Page(items, total, page, per_page)

    @staticmethod
    def search(stmt: Select, q: str | None, *cols) -> Select:
        if not q:
            return stmt
        like = f"%{q.strip()}%"
        return stmt.where(or_(*[c.ilike(like) for c in cols]))
