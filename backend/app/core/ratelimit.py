"""Fixed-window rate limiter (per process). Swap for Redis INCR in multi-worker deployments."""

import time
from collections import defaultdict

from app.core.errors import TooManyRequests

_hits: dict[str, list[float]] = defaultdict(list)


def hit(key: str, *, limit: int, window_s: int) -> None:
    now = time.monotonic()
    bucket = [t for t in _hits[key] if now - t < window_s]
    if len(bucket) >= limit:
        _hits[key] = bucket
        raise TooManyRequests("Too many requests, please slow down")
    bucket.append(now)
    _hits[key] = bucket


def reset() -> None:
    _hits.clear()
