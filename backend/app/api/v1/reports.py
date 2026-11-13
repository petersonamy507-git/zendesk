import csv
import io
from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.api.deps import DB, Current
from app.core.errors import AppError
from app.core.security import utcnow
from app.models import ReportDefinition
from app.repositories.base import Repo
from app.schemas.common import Ok
from app.services import reports as svc

router = APIRouter(prefix="/reports", tags=["reports"])


def _range(date_from: datetime | None, date_to: datetime | None) -> tuple[datetime, datetime]:
    end = (date_to.replace(tzinfo=None) + timedelta(days=1)) if date_to else utcnow()
    start = date_from.replace(tzinfo=None) if date_from else end - timedelta(days=30)
    if start >= end:
        raise AppError("Start date must be before end date")
    if (end - start).days > 366:
        raise AppError("Range can't exceed one year")
    return start, end


def _scope_agent(p, agent_id: str | None) -> str | None:
    if p.can("reports.view_all"):
        return agent_id
    return p.id  # agents only see their own numbers


@router.get("/website")
def website(p: Current, db: DB, bucket: Literal["hour", "day", "week", "month"] = "hour"):
    p.require("reports.view")
    return svc.website(db, p.account_id, bucket)


@router.get("/chats")
def chats(p: Current, db: DB, date_from: datetime | None = None, date_to: datetime | None = None, agent_id: str | None = None, department_id: str | None = None):
    p.require("reports.view")
    start, end = _range(date_from, date_to)
    return svc.chat_metrics(db, p.account_id, start=start, end=end, agent_id=_scope_agent(p, agent_id), department_id=department_id)


@router.get("/tickets")
def tickets(p: Current, db: DB, date_from: datetime | None = None, date_to: datetime | None = None, agent_id: str | None = None, group_id: str | None = None, channel: str | None = None):
    p.require("reports.view")
    start, end = _range(date_from, date_to)
    return svc.ticket_metrics(db, p.account_id, start=start, end=end, agent_id=_scope_agent(p, agent_id), group_id=group_id, channel=channel)


@router.get("/realtime")
def realtime(p: Current, db: DB):
    p.require("reports.view")
    return svc.realtime_snapshot(db, p.account_id)


@router.get("/chats.csv")
def chats_csv(p: Current, db: DB, date_from: datetime | None = None, date_to: datetime | None = None, agent_id: str | None = None, department_id: str | None = None):
    p.require("reports.view")
    start, end = _range(date_from, date_to)
    m = svc.chat_metrics(db, p.account_id, start=start, end=end, agent_id=_scope_agent(p, agent_id), department_id=department_id)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["date", "chats", "missed"])
    for r in m["daily"]:
        w.writerow([r["date"], r["chats"], r["missed"]])
    w.writerow([])
    w.writerow(["agent", "chats", "satisfaction_pct", "avg_duration_s", "median_first_response_s"])
    for a in m["agents"]:
        w.writerow([a["name"], a["chats"], a["satisfaction_pct"], a["avg_duration_s"], a["median_first_response_s"]])
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="chat-report.csv"'})


class SavedReportIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    metric: Literal["chats", "tickets", "website"]
    filters: dict = {}


@router.get("/saved")
def list_saved(p: Current, db: DB):
    rows = db.scalars(Repo(db, ReportDefinition, p.account_id).query().where(ReportDefinition.owner_id == p.id).order_by(ReportDefinition.name)).all()
    return [{"id": r.id, "name": r.name, "metric": r.metric, "filters": r.filters} for r in rows]


@router.post("/saved", status_code=201)
def save(body: SavedReportIn, p: Current, db: DB):
    p.require("reports.view")
    r = Repo(db, ReportDefinition, p.account_id).add(owner_id=p.id, name=body.name, metric=body.metric, filters=body.filters)
    db.commit()
    return {"id": r.id, "name": r.name, "metric": r.metric, "filters": r.filters}


@router.delete("/saved/{rid}", response_model=Ok)
def delete_saved(rid: str, p: Current, db: DB):
    r = Repo(db, ReportDefinition, p.account_id).get(rid)
    if r.owner_id != p.id:
        raise AppError("Not your report")
    db.delete(r)
    db.commit()
    return Ok()
