from datetime import datetime
from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict, field_serializer

T = TypeVar("T")


class Schema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    @field_serializer("*", when_used="json", check_fields=False)
    def _utc(self, v):  # serialize naive UTC datetimes with an explicit Z
        if isinstance(v, datetime) and v.tzinfo is None:
            return v.isoformat() + "Z"
        return v


class PageOut(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    per_page: int
    page_count: int


def page_out(page, schema: type[Schema]) -> dict:
    return {
        "items": [schema.model_validate(i) for i in page.items],
        "total": page.total,
        "page": page.page,
        "per_page": page.per_page,
        "page_count": page.page_count,
    }


class Ok(BaseModel):
    ok: bool = True
