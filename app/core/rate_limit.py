import time

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from .cache import cache
from .config import settings
from .errors import RateLimited


def client_ip(request: Request) -> str:
    # X-Forwarded-For is client-controlled unless a proxy we own overwrites it, so it is opt-in.
    if settings.trust_proxy_headers:
        fwd = request.headers.get("x-real-ip") or request.headers.get("x-forwarded-for")
        if fwd:
            return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Global per-IP fixed-window limit. Health checks and docs are exempt."""

    EXEMPT = ("/health", "/docs", "/openapi.json", "/redoc")

    async def dispatch(self, request: Request, call_next):
        if request.url.path.startswith(self.EXEMPT):
            return await call_next(request)
        window = int(time.time() // 60)
        count = cache.incr_window(f"rl:g:{client_ip(request)}:{window}", 60)
        if count > settings.rate_limit_per_minute:
            return JSONResponse(
                {"error": {"code": "rate_limited", "message": "Too many requests", "details": None,
                           "request_id": getattr(request.state, "request_id", None)}},
                status_code=429, headers={"Retry-After": str(60 - int(time.time()) % 60)})
        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(settings.rate_limit_per_minute)
        response.headers["X-RateLimit-Remaining"] = str(max(0, settings.rate_limit_per_minute - count))
        return response


def limit(bucket: str, per_minute: int | None = None):
    """Route dependency for tighter limits on sensitive endpoints (login, register, refresh)."""

    def dep(request: Request):
        max_hits = per_minute or settings.auth_rate_limit_per_minute
        window = int(time.time() // 60)
        if cache.incr_window(f"rl:{bucket}:{client_ip(request)}:{window}", 60) > max_hits:
            raise RateLimited("Too many attempts, please try again in a minute")

    return dep
