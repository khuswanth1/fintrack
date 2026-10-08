from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api.v1 import api_router
from app.core.config import settings
from app.core.database import engine
from app.core.errors import register_error_handlers
from app.core.logging import RequestContextMiddleware, configure_logging
from app.core.rate_limit import RateLimitMiddleware
from app.core.realtime import hub

configure_logging(settings.log_level, json_logs=settings.environment != "development")

DESCRIPTION = """
FinTrack REST API — personal finance tracking with AI-assisted insights.

**Auth:** obtain a token from `POST /api/v1/auth/login`, then click *Authorize* and paste the `access_token`.
Access tokens last 15 minutes; refresh with `POST /api/v1/auth/refresh` (single-use, rotating refresh tokens).
Browsers can also sign in or sign up with Google via `POST /api/v1/auth/google`.

**Live updates:** connect a WebSocket to `/api/v1/ws` and send `{"type": "auth", "token": "<access_token>"}` first.

**Webhooks:** register endpoints under `/api/v1/webhooks`; every delivery is signed with
`X-FinTrack-Signature: t=<ts>,v1=<HMAC-SHA256(secret, "<ts>.<body>")>`.

**Errors** always use the envelope `{"error": {"code", "message", "details", "request_id"}}`.
"""


@asynccontextmanager
async def lifespan(_: FastAPI):
    await hub.start()
    yield
    await hub.stop()
    engine.dispose()


def create_app() -> FastAPI:
    app = FastAPI(
        title=f"{settings.app_name} API", version="1.0.0", description=DESCRIPTION, lifespan=lifespan,
        docs_url="/docs", redoc_url="/redoc", openapi_url="/openapi.json",
        openapi_tags=[{"name": n} for n in ("auth", "users", "categories", "transactions", "budgets", "goals",
                                            "recurring transactions", "dashboard & insights", "notifications",
                                            "webhooks", "realtime", "admin", "system")])

    # Middleware runs bottom-up: request context wraps everything so rate-limit rejections are logged too.
    app.add_middleware(RateLimitMiddleware)
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origin_list, allow_credentials=True,
                       allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
                       allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
                       expose_headers=["X-Request-ID", "Content-Disposition"])
    app.add_middleware(RequestContextMiddleware)

    @app.middleware("http")
    async def security_headers(request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        if request.url.path.startswith(settings.api_prefix):
            response.headers.setdefault("Cache-Control", "no-store")
        return response

    register_error_handlers(app)
    app.include_router(api_router, prefix=settings.api_prefix)

    @app.get("/health", tags=["system"])
    def health():
        return {"status": "ok"}

    @app.get("/health/ready", tags=["system"])
    def ready():
        from app.core.cache import cache

        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return {"status": "ready", "database": "ok", "cache": "redis" if cache._client else "memory"}

    return app


app = create_app()
