"""Periodic housekeeping, run by Celery beat in production (app.workers.celery_app) and by an
in-process loop in single-worker development.

* Ends visitor sessions with no heartbeat for 2 minutes.
* Chats whose visitor left: incoming → missed; active → ended (visitor left).
* Runs ticket automations and SLA breach checks (hourly cadence handled by the caller).
"""

import asyncio
import logging

from sqlalchemy import select
from starlette.concurrency import run_in_threadpool

from app.core.db import SessionLocal
from app.models import Chat, VisitorSession
from app.services import visitors

log = logging.getLogger(__name__)


def sweep_once() -> int:
    with SessionLocal() as db:
        n = visitors.end_stale_sessions(db)
        db.commit()
        from app.services import chat as chat_svc

        rows = db.scalars(
            select(Chat).join(VisitorSession, VisitorSession.id == Chat.session_id).where(Chat.state.in_(["incoming", "active", "proactive"]), VisitorSession.ended_at.is_not(None))
        ).all()
        for c in rows:
            if c.state == "proactive":
                c.state, c.outcome = "ended", None
                db.commit()
            else:
                chat_svc.end(db, c, by="visitor_left")
        return n + len(rows)


async def run_forever(interval: float = 30.0) -> None:
    from app.core.events import broker

    while True:
        try:
            # With several API workers only one sweeps per interval (otherwise each would end the
            # same stale chats and publish duplicate events).
            if await broker.try_lock("sweeper", int(interval * 0.9)):
                await run_in_threadpool(sweep_once)
        except Exception:  # noqa: BLE001
            log.exception("sweeper failed")
        await asyncio.sleep(interval)
