"""Reporting: every metric is computed from stored rows (no synthetic data).

Bucketing is done in Python over bounded ranges so the same code runs on MySQL and the SQLite
unit-test profile. Ranges are capped (max 366 buckets) to keep queries bounded."""

from collections import Counter, defaultdict
from datetime import datetime, timedelta
from statistics import mean, median

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import utcnow
from app.models import Chat, Ticket, User, VisitorEvent, VisitorSession

BUCKETS = {"hour": (timedelta(hours=1), 24), "day": (timedelta(days=1), 30), "week": (timedelta(weeks=1), 12), "month": (timedelta(days=30), 12)}


def _floor(dt: datetime, bucket: str) -> datetime:
    if bucket == "hour":
        return dt.replace(minute=0, second=0, microsecond=0)
    d = dt.replace(hour=0, minute=0, second=0, microsecond=0)
    if bucket == "week":
        return d - timedelta(days=d.weekday())
    if bucket == "month":
        return d.replace(day=1)
    return d


def _series_keys(bucket: str, end: datetime) -> list[datetime]:
    step, n = BUCKETS[bucket]
    keys, cur = [], _floor(end, bucket)
    for _ in range(n):
        keys.append(cur)
        if bucket == "month":
            cur = (cur - timedelta(days=1)).replace(day=1)
        else:
            cur = cur - step
    return list(reversed(keys))


def website(db: Session, account_id: str, bucket: str) -> dict:
    now = utcnow()
    keys = _series_keys(bucket, now)
    start = keys[0]
    pv = Counter(_floor(t, bucket) for (t,) in db.execute(select(VisitorEvent.created_at).where(VisitorEvent.account_id == account_id, VisitorEvent.kind == "page_view", VisitorEvent.created_at >= start)))
    visits_rows = db.execute(select(VisitorSession.started_at, VisitorSession.visitor_id).where(VisitorSession.account_id == account_id, VisitorSession.started_at >= start)).all()
    visits = Counter(_floor(t, bucket) for t, _ in visits_rows)
    uniq: dict[datetime, set] = defaultdict(set)
    for t, vid in visits_rows:
        uniq[_floor(t, bucket)].add(vid)
    chats = Counter(_floor(t, bucket) for (t,) in db.execute(select(Chat.started_at).where(Chat.account_id == account_id, Chat.kind == "chat", Chat.state.not_in(["proactive"]), Chat.started_at >= start, Chat.deleted_at.is_(None))))
    return {
        "bucket": bucket,
        "points": [{"t": k.isoformat() + "Z", "page_views": pv[k], "visits": visits[k], "unique_visitors": len(uniq[k]), "chats": chats[k]} for k in keys],
        "totals": {"page_views": sum(pv.values()), "visits": sum(visits.values()), "unique_visitors": len({v for _, v in visits_rows}), "chats": sum(chats.values())},
    }


def chat_metrics(db: Session, account_id: str, *, start: datetime, end: datetime, agent_id: str | None = None, department_id: str | None = None) -> dict:
    stmt = select(Chat).where(Chat.account_id == account_id, Chat.kind == "chat", Chat.state.in_(["ended", "missed", "active", "incoming"]), Chat.started_at >= start, Chat.started_at < end, Chat.deleted_at.is_(None))
    if agent_id:
        stmt = stmt.where(Chat.assignee_id == agent_id)
    if department_id:
        stmt = stmt.where(Chat.department_id == department_id)
    chats = db.scalars(stmt).all()
    outcomes = Counter(c.outcome or c.state for c in chats)
    waits = [(c.accepted_at - c.started_at).total_seconds() for c in chats if c.accepted_at]
    frt = [(c.first_response_at - c.started_at).total_seconds() for c in chats if c.first_response_at]
    durations = [(c.ended_at - (c.accepted_at or c.started_at)).total_seconds() for c in chats if c.ended_at and c.accepted_at]
    rated = [c.rating for c in chats if c.rating]
    good = sum(1 for r in rated if r == "good")
    day_keys = []
    d = start.replace(hour=0, minute=0, second=0, microsecond=0)
    while d < end and len(day_keys) < 366:
        day_keys.append(d)
        d += timedelta(days=1)
    day = lambda c: c.started_at.replace(hour=0, minute=0, second=0, microsecond=0)  # noqa: E731
    per_day = Counter(day(c) for c in chats)
    missed_day = Counter(day(c) for c in chats if (c.outcome or c.state) == "missed")
    wait_by_day: dict[datetime, list[float]] = defaultdict(list)
    for c in chats:
        if c.accepted_at:
            wait_by_day[day(c)].append((c.accepted_at - c.started_at).total_seconds())
    by_agent: dict[str, dict] = defaultdict(lambda: {"chats": 0, "good": 0, "bad": 0, "durations": [], "frt": []})
    for c in chats:
        if not c.assignee_id:
            continue
        a = by_agent[c.assignee_id]
        a["chats"] += 1
        if c.rating == "good":
            a["good"] += 1
        elif c.rating == "bad":
            a["bad"] += 1
        if c.ended_at and c.accepted_at:
            a["durations"].append((c.ended_at - c.accepted_at).total_seconds())
        if c.first_response_at:
            a["frt"].append((c.first_response_at - c.started_at).total_seconds())
    names = {u.id: (u.display_name or u.name) for u in db.scalars(select(User).where(User.account_id == account_id))}
    return {
        "total": len(chats),
        "served": outcomes.get("completed", 0) + outcomes.get("unresponsive", 0) + outcomes.get("dropped", 0) + outcomes.get("active", 0),
        "missed": outcomes.get("missed", 0),
        "dropped": outcomes.get("dropped", 0),
        "outcomes": dict(outcomes),
        "avg_wait_s": round(mean(waits), 1) if waits else None,
        "good": sum(1 for r in rated if r == "good"),
        "bad": sum(1 for r in rated if r == "bad"),
        "median_first_response_s": round(median(frt), 1) if frt else None,
        "avg_duration_s": round(mean(durations), 1) if durations else None,
        "satisfaction_pct": round(100 * good / len(rated), 1) if rated else None,
        "rated": len(rated),
        "daily": [
            {"date": k.date().isoformat(), "chats": per_day[k], "missed": missed_day[k], "served": per_day[k] - missed_day[k], "avg_wait_s": round(mean(wait_by_day[k]), 1) if wait_by_day[k] else None}
            for k in day_keys
        ],
        "agents": sorted(
            [
                {
                    "agent_id": aid,
                    "name": names.get(aid, "Unknown"),
                    "chats": v["chats"],
                    "satisfaction_pct": round(100 * v["good"] / (v["good"] + v["bad"]), 1) if v["good"] + v["bad"] else None,
                    "avg_duration_s": round(mean(v["durations"]), 1) if v["durations"] else None,
                    "median_first_response_s": round(median(v["frt"]), 1) if v["frt"] else None,
                }
                for aid, v in by_agent.items()
            ],
            key=lambda r: -r["chats"],
        ),
    }


def realtime_snapshot(db: Session, account_id: str) -> dict:
    """Monitor page: live counts from current state."""
    from app.services import visitors as vsvc

    cutoff = utcnow() - vsvc.LIVE_WINDOW
    agents = db.execute(select(User.presence, func.count()).where(User.account_id == account_id, User.is_agent.is_(True), User.enabled.is_(True), User.deleted_at.is_(None)).group_by(User.presence)).all()
    states = dict(db.execute(select(Chat.state, func.count()).where(Chat.account_id == account_id, Chat.state.in_(["incoming", "active"]), Chat.deleted_at.is_(None)).group_by(Chat.state)).all())
    oldest = db.scalar(select(func.min(Chat.started_at)).where(Chat.account_id == account_id, Chat.state == "incoming"))
    today = utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    m = chat_metrics(db, account_id, start=today, end=utcnow() + timedelta(seconds=1))
    return {
        "visitors_online": db.scalar(select(func.count()).select_from(VisitorSession).where(VisitorSession.account_id == account_id, VisitorSession.ended_at.is_(None), VisitorSession.last_seen_at >= cutoff)) or 0,
        "agents": {k: v for k, v in agents},
        "incoming": states.get("incoming", 0),
        "active": states.get("active", 0),
        "longest_wait_s": int((utcnow() - oldest).total_seconds()) if oldest else 0,
        "today": {k: m[k] for k in ("total", "served", "missed", "avg_wait_s", "satisfaction_pct", "avg_duration_s", "good", "bad")},
    }


def ticket_metrics(db: Session, account_id: str, *, start: datetime, end: datetime, agent_id: str | None = None, group_id: str | None = None, channel: str | None = None) -> dict:
    stmt = select(Ticket).where(Ticket.account_id == account_id, Ticket.deleted_at.is_(None), Ticket.created_at >= start, Ticket.created_at < end)
    if agent_id:
        stmt = stmt.where(Ticket.assignee_id == agent_id)
    if group_id:
        stmt = stmt.where(Ticket.group_id == group_id)
    if channel:
        stmt = stmt.where(Ticket.channel == channel)
    rows = db.scalars(stmt).all()
    status = Counter(t.status for t in rows)
    frt = [(t.first_responded_at - t.created_at).total_seconds() / 60 for t in rows if t.first_responded_at]
    res = [(t.solved_at - t.created_at).total_seconds() / 3600 for t in rows if t.solved_at]
    with_sla = [t for t in rows if t.resolution_due_at and t.solved_at]
    met = sum(1 for t in with_sla if t.solved_at <= t.resolution_due_at)
    return {
        "total": len(rows),
        "by_status": dict(status),
        "by_channel": dict(Counter(t.channel for t in rows)),
        "by_priority": dict(Counter(t.priority or "none" for t in rows)),
        "median_first_response_min": round(median(frt), 1) if frt else None,
        "median_resolution_h": round(median(res), 1) if res else None,
        "sla_compliance_pct": round(100 * met / len(with_sla), 1) if with_sla else None,
    }
