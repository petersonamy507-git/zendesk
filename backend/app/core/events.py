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
import contextlib
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


class Event(dict):
    """An event as delivered to subscriber queues. Behaves like the plain dict it always was, and
    caches its JSON so a fan-out to N sockets serializes it once instead of N times."""

    def __init__(self, data: dict, raw: str | None = None) -> None:
        super().__init__(data)
        self._raw = raw

    @property
    def raw(self) -> str:
        if self._raw is None:
            self._raw = json.dumps(self, default=str)
        return self._raw


# Put on a subscriber queue when it overflowed (the socket can't keep up). The socket pump then
# closes the connection; the client reconnects and re-fetches from MySQL (it already does on seq gaps).
OVERFLOW = Event({"type": "_overflow"})


def _deliver(subs: set[asyncio.Queue] | None, evt: Event) -> None:
    """Non-blocking fan-out. One slow consumer must never stop delivery to the others (a bare
    ``put_nowait`` would raise QueueFull mid-loop and, with Redis, kill the relay task)."""
    if not subs:
        return
    for q in list(subs):
        try:
            q.put_nowait(evt)
        except asyncio.QueueFull:
            # Drop this consumer's backlog and tell its pump to disconnect.
            while not q.empty():
                q.get_nowait()
            q.put_nowait(OVERFLOW)


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
        evt = Event({"id": uuid.uuid4().hex, "topic": topic, "seq": self._next_seq(topic), "type": type_, "ts": utcnow().isoformat() + "Z", "data": data})
        _deliver(self._subs.get(topic), evt)
        return evt

    def subscribe(self, topic: str, q: asyncio.Queue) -> None:
        self._subs[topic].add(q)

    def unsubscribe(self, topic: str, q: asyncio.Queue) -> None:
        subs = self._subs.get(topic)
        if subs is not None:
            subs.discard(q)
            if not subs:
                del self._subs[topic]  # don't keep an empty set for every visitor/chat ever seen

    # --- ephemeral presence ---
    async def set_presence(self, key: str, value: dict) -> None:
        self._presence[key] = value

    async def get_presence(self, key: str) -> dict | None:
        return self._presence.get(key)

    async def del_presence(self, key: str) -> None:
        self._presence.pop(key, None)

    async def try_lock(self, key: str, ttl_s: int) -> bool:
        """Best-effort cluster-wide lock (a single process always holds it)."""
        return True


class RedisBroker(MemoryBroker):
    """Redis-backed variant: publishes via Redis and relays to local subscribers.

    Every API worker pattern-subscribes to ``evt:*`` and hands each event only to the sockets it
    holds, so any worker can publish and every connected client receives it."""

    def __init__(self, url: str) -> None:
        super().__init__()
        import redis.asyncio as aioredis

        self._r = aioredis.from_url(url, decode_responses=True, health_check_interval=30)
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        await super().start()
        await self._r.ping()  # fail fast at startup if Redis is unreachable
        self._task = asyncio.create_task(self._relay_forever())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
        await self._r.aclose()

    async def _relay_forever(self) -> None:
        """Keeps the relay alive across Redis restarts / network blips (otherwise real-time
        delivery would silently stop for this worker until it is restarted)."""
        backoff = 0.5
        while True:
            pubsub = self._r.pubsub()
            try:
                await pubsub.psubscribe("evt:*")
                backoff = 0.5
                async for msg in pubsub.listen():
                    if msg.get("type") != "pmessage":
                        continue
                    topic = msg["channel"][4:]  # strip "evt:"
                    subs = self._subs.get(topic)
                    if not subs:
                        continue  # no local socket cares: skip the JSON parse entirely
                    raw = msg["data"]
                    _deliver(subs, Event(json.loads(raw), raw))
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
                log.exception("redis relay failed; reconnecting in %.1fs", backoff)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 10)
            finally:
                with contextlib.suppress(Exception):
                    await pubsub.aclose()

    async def publish(self, topic: str, type_: str, data: dict) -> dict:
        # One round trip; the expiry keeps per-chat/per-visitor counters from piling up in Redis forever.
        async with self._r.pipeline(transaction=False) as pipe:
            seq, _ = await pipe.incr(f"seq:{topic}").expire(f"seq:{topic}", 86400).execute()
        evt = Event({"id": uuid.uuid4().hex, "topic": topic, "seq": seq, "type": type_, "ts": utcnow().isoformat() + "Z", "data": data})
        await self._r.publish(f"evt:{topic}", evt.raw)
        return evt

    async def set_presence(self, key: str, value: dict) -> None:
        await self._r.set(f"presence:{key}", json.dumps(value), ex=120)

    async def get_presence(self, key: str) -> dict | None:
        v = await self._r.get(f"presence:{key}")
        return json.loads(v) if v else None

    async def del_presence(self, key: str) -> None:
        await self._r.delete(f"presence:{key}")

    async def try_lock(self, key: str, ttl_s: int) -> bool:
        return bool(await self._r.set(f"lock:{key}", "1", nx=True, ex=max(1, ttl_s)))


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
