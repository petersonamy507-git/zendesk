"""Celery app for production (Redis broker). Beat runs the same sweeper used in-process during development."""

from celery import Celery

from app.core.config import get_settings

s = get_settings()
celery = Celery("parley", broker=s.redis_url or "memory://", backend=None)
celery.conf.update(
    timezone="UTC",
    beat_schedule={"sweep-visitors-and-chats": {"task": "app.workers.celery_app.sweep", "schedule": 30.0}},
)


@celery.task(name="app.workers.celery_app.sweep")
def sweep() -> int:
    from app.workers.sweeper import sweep_once

    return sweep_once()
