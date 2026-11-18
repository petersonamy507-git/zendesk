"""Fixed-window rate limiter.

With REDIS_URL set the counters live in Redis, so a limit holds across all API workers (with
per-process counters, N workers would allow N times the limit). Without Redis it falls back to
per-process memory (single-worker development)."""

import logging
import threading
import time
from collections import defaultdict

from app.core.config import get_settings
from app.core.errors import TooManyRequests

log = logging.getLogger(__name__)

_hits: dict[str, list[float]] = defaultdict(list)
_lock = threading.Lock()
_last_prune = time.monotonic()
_redis = None
_redis_init = False


def _client():
    global _redis, _redis_init
    if not _redis_init:
        _redis_init = True
        url = get_settings().redis_url
        if url:
            import redis

            _redis = redis.Redis.from_url(url, socket_timeout=1, socket_connect_timeout=1)
    return _redis


def _hit_redis(r, key: str, limit: int, window_s: int) -> bool:
    bucket = f"rl:{key}:{int(time.time() // window_s)}"
    pipe = r.pipeline(transaction=False)
    pipe.incr(bucket)
    pipe.expire(bucket, window_s + 1)
    count = pipe.execute()[0]
    return count <= limit


def _hit_memory(key: str, limit: int, window_s: int) -> bool:
    global _last_prune
    now = time.monotonic()
    with _lock:
        if now - _last_prune > 60:  # drop idle keys so thousands of one-off visitors don't accumulate
            _last_prune = now
            for k in [k for k, v in _hits.items() if not v or now - v[-1] > 3600]:
                del _hits[k]
        bucket = [t for t in _hits[key] if now - t < window_s]
        if len(bucket) >= limit:
            _hits[key] = bucket
            return False
        bucket.append(now)
        _hits[key] = bucket
        return True


def hit(key: str, *, limit: int, window_s: int) -> None:
    r = _client()
    ok = None
    if r is not None:
        try:
            ok = _hit_redis(r, key, limit, window_s)
        except Exception:  # noqa: BLE001 - Redis hiccup: fall back to per-process limiting, never fail the request
            log.warning("rate limiter: redis unavailable, using in-process counters", exc_info=True)
    if ok is None:
        ok = _hit_memory(key, limit, window_s)
    if not ok:
        raise TooManyRequests("Too many requests, please slow down")


def reset() -> None:
    with _lock:
        _hits.clear()
    r = _client()
    if r is not None:
        try:
            for k in r.scan_iter("rl:*", count=1000):
                r.delete(k)
        except Exception:  # noqa: BLE001
            pass
