"""Real-time event bus.

Events are published to topics (e.g. ``account:<id>``, ``chat:<id>``, ``visitor:<id>``).
Two interchangeable backends share one interface:

* ``MemoryBroker`` – in-process fan-out; fine for a single API worker (local dev).
* ``RedisBroker``  – Redis pub/sub for cross-worker distribution (production).

Every event carries a monotonically increasing ``seq`` per topic and a unique ``id`` so
clients can de-duplicate and detect gaps (then re-fetch from MySQL, the source of truth).
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from collections import defaultdict
from collections.abc import Callable
from typing import Any

from app.core.config import get_settings
from app.core.security import utcnow

log = logging.getLogger(__name__)

Listener = Callable[[dict], Any]


class MemoryBroker:
    def __init__(self) -> None:
        self._subs: dict[str, set[asyncio.Queue]] = defaultdict(set)
        self._seq: dict[str, int] = defaultdict(int)
        self._presence: dict[str, dict[str, Any]] = {}
        self.loop: asyncio.AbstractEventLoop | None = None

    async def start(self) -> None:
        self.loop = asyncio.get_running_loop()

    async def stop(self) -> None:
        pass

    def _next_seq(self, topic: str) -> int:
        self._seq[topic] += 1
        return self._seq[topic]

    async def publish(self, topic: str, type_: str, data: dict) -> dict:
        evt = {"id": uuid.uuid4().hex, "topic": topic, "seq": self._next_seq(topic), "type": type_, "ts": utcnow().isoformat() + "Z", "data": data}
        for q in list(self._subs.get(topic, ())):
            q.put_nowait(evt)
        return evt

    def subscribe(self, topic: str, q: asyncio.Queue) -> None:
        self._subs[topic].add(q)

    def unsubscribe(self, topic: str, q: asyncio.Queue) -> None:
        self._subs[topic].discard(q)

    # --- ephemeral presence ---
    async def set_presence(self, key: str, value: dict) -> None:
        self._presence[key] = value

    async def get_presence(self, key: str) -> dict | None:
        return self._presence.get(key)

    async def del_presence(self, key: str) -> None:
        self._presence.pop(key, None)


class RedisBroker(MemoryBroker):
    """Redis-backed variant: publishes via Redis and relays to local subscribers."""

    def __init__(self, url: str) -> None:
        super().__init__()
        import redis.asyncio as aioredis

        self._r = aioredis.from_url(url, decode_responses=True)
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        await super().start()
        self._pubsub = self._r.pubsub()
        await self._pubsub.psubscribe("evt:*")
        self._task = asyncio.create_task(self._relay())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
        await self._r.aclose()

    async def _relay(self) -> None:
        async for msg in self._pubsub.listen():
            if msg.get("type") != "pmessage":
                continue
            evt = json.loads(msg["data"])
            for q in list(self._subs.get(evt["topic"], ())):
                q.put_nowait(evt)

    async def publish(self, topic: str, type_: str, data: dict) -> dict:
        seq = await self._r.incr(f"seq:{topic}")
        evt = {"id": uuid.uuid4().hex, "topic": topic, "seq": seq, "type": type_, "ts": utcnow().isoformat() + "Z", "data": data}
        await self._r.publish(f"evt:{topic}", json.dumps(evt, default=str))
        return evt

    async def set_presence(self, key: str, value: dict) -> None:
        await self._r.set(f"presence:{key}", json.dumps(value), ex=120)

    async def get_presence(self, key: str) -> dict | None:
        v = await self._r.get(f"presence:{key}")
        return json.loads(v) if v else None

    async def del_presence(self, key: str) -> None:
        await self._r.delete(f"presence:{key}")


def _make_broker() -> MemoryBroker:
    url = get_settings().redis_url
    if url:
        return RedisBroker(url)
    log.warning("REDIS_URL not set: using in-process event broker (single worker only)")
    return MemoryBroker()


broker: MemoryBroker = _make_broker()


def publish_sync(topic: str, type_: str, data: dict) -> None:
    """Publish from synchronous service code (runs in a threadpool)."""
    loop = broker.loop
    if loop is None or loop.is_closed():
        return
    try:
        running = asyncio.get_running_loop()
    except RuntimeError:
        running = None
    if running is loop:
        loop.create_task(broker.publish(topic, type_, data))
    else:
        asyncio.run_coroutine_threadsafe(broker.publish(topic, type_, data), loop)
