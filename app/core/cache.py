"""Small cache facade over Redis with an in-process fallback.

Per-user cached views (dashboard, insights) are keyed by a user "data version"
that is bumped on every financial write, so stale entries are never served and
simply expire."""
import json
import logging
import threading
import time
from typing import Any

from .config import settings

log = logging.getLogger("fintrack.cache")


class MemoryBackend:
    def __init__(self):
        self._data: dict[str, tuple[float | None, Any]] = {}
        self._lock = threading.Lock()

    def get(self, key):
        with self._lock:
            item = self._data.get(key)
            if not item:
                return None
            exp, val = item
            if exp and exp < time.time():
                self._data.pop(key, None)
                return None
            return val

    def set(self, key, value, ex=None):
        with self._lock:
            self._data[key] = (time.time() + ex if ex else None, value)

    def incr(self, key, ex=None):
        with self._lock:
            exp, val = self._data.get(key, (None, 0))
            if exp and exp < time.time():
                exp, val = None, 0
            val = int(val) + 1
            self._data[key] = (exp or (time.time() + ex if ex else None), val)
            return val

    def delete(self, *keys):
        with self._lock:
            for k in keys:
                self._data.pop(k, None)

    def flushall(self):
        with self._lock:
            self._data.clear()


class Cache:
    def __init__(self):
        self._client = None
        self._memory = MemoryBackend()
        if settings.cache_backend == "redis":
            try:
                import redis

                self._client = redis.Redis.from_url(settings.redis_url, decode_responses=True, socket_timeout=2)
                self._client.ping()
            except Exception as exc:  # degrade gracefully: caching and rate limits stay per-process
                log.warning("Redis unavailable (%s); falling back to in-memory cache", exc)
                self._client = None

    @property
    def backend(self):
        return self._client or self._memory

    def get_json(self, key: str):
        try:
            raw = self.backend.get(key)
            return json.loads(raw) if raw else None
        except Exception:
            log.exception("cache get failed")
            return None

    def set_json(self, key: str, value, ttl: int):
        try:
            self.backend.set(key, json.dumps(value, default=str), ex=ttl)
        except Exception:
            log.exception("cache set failed")

    def incr_window(self, key: str, window_seconds: int) -> int:
        """Fixed-window counter used by the rate limiter."""
        try:
            if self._client:
                pipe = self._client.pipeline()
                pipe.incr(key)
                pipe.expire(key, window_seconds, nx=True)
                return int(pipe.execute()[0])
            return self._memory.incr(key, ex=window_seconds)
        except Exception:
            log.exception("rate limit counter failed")
            return 0  # fail open rather than lock everybody out

    # --- per-user data versioning ---
    def user_version(self, user_id: int) -> str:
        try:
            return str(self.backend.get(f"uver:{user_id}") or 0)
        except Exception:
            return "0"

    def bump_user_version(self, user_id: int) -> None:
        try:
            self.backend.incr(f"uver:{user_id}")
        except Exception:
            log.exception("cache version bump failed")

    def clear(self):
        self._memory.flushall()


cache = Cache()
