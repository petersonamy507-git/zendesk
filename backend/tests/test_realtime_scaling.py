"""Guards for the real-time scaling changes: fan-out isolation and the settings cache."""

import asyncio
import json

from app.core.events import OVERFLOW, MemoryBroker
from app.services import settings as settings_svc


def test_slow_subscriber_does_not_block_fanout():
    async def run():
        b = MemoryBroker()
        await b.start()
        slow, fast = asyncio.Queue(maxsize=2), asyncio.Queue(maxsize=100)
        b.subscribe("chat:1", slow)
        b.subscribe("chat:1", fast)
        for i in range(5):
            await b.publish("chat:1", "chat.message", {"n": i})
        assert fast.qsize() == 5  # unaffected by the full queue
        items = [slow.get_nowait() for _ in range(slow.qsize())]
        assert OVERFLOW in items  # the slow socket is told to disconnect and re-sync
        evt = fast.get_nowait()
        assert json.loads(evt.raw) == dict(evt)  # serialized once, identical to the dict
        b.unsubscribe("chat:1", slow)
        b.unsubscribe("chat:1", fast)
        assert "chat:1" not in b._subs

    asyncio.run(run())


def test_settings_cache_invalidated_on_write(client):
    from app.core.db import SessionLocal

    r = client.post("/api/v1/auth/register", json={"company": "Cache", "subdomain": "cache", "name": "Owner", "email": "o@cache.io", "password": "Password123"})
    acc = r.json()["user"]["account_id"] if "user" in r.json() else None
    with SessionLocal() as db:
        from sqlalchemy import select

        from app.models import Account

        acc = acc or db.scalar(select(Account.id).where(Account.subdomain == "cache"))
        assert settings_svc.get_section(db, acc, "widget.settings")["sounds"] is True
        settings_svc.put_section(db, acc, "widget.settings", {"sounds": False})
        db.commit()
    with SessionLocal() as db:
        assert settings_svc.get_section(db, acc, "widget.settings")["sounds"] is False
