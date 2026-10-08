"""Outgoing webhooks: signed, retried, user-configured HTTP callbacks.

Wire format (modelled on Stripe):
    POST <endpoint url>
    Content-Type: application/json
    X-FinTrack-Event: transaction.created
    X-FinTrack-Event-Id: evt_...          (stable across retries; receivers should dedupe on it)
    X-FinTrack-Delivery: 42               (one per attempt chain)
    X-FinTrack-Signature: t=<unix ts>,v1=<hex HMAC-SHA256(secret, "<ts>.<raw body>")>

Receivers should recompute the HMAC over the raw body, compare in constant time, and reject timestamps older
than a few minutes to stop replays. See `verify_signature` for a reference implementation."""
import hashlib
import hmac
import ipaddress
import json
import logging
import secrets
import socket
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit

import httpx
from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.errors import AppError
from app.models import WebhookDelivery, WebhookEndpoint

from .events import after_commit, make_event

log = logging.getLogger("fintrack.webhooks")

EVENT_TYPES: dict[str, str] = {
    "transaction.created": "A transaction was added",
    "transaction.updated": "A transaction was edited",
    "transaction.deleted": "A transaction was deleted",
    "transactions.imported": "A CSV/Excel import finished",
    "budget.alert": "A budget crossed its alert threshold or was exceeded",
    "goal.completed": "A savings goal reached its target",
}
TEST_EVENT = "webhook.test"
WILDCARD = "*"

SIGNATURE_TOLERANCE_SECONDS = 300
CLAIM_LEASE = timedelta(minutes=5)  # a crashed worker's claim expires and the sweeper retries it
RESPONSE_BODY_LIMIT = 1000

# Test hooks: tests swap these for an httpx.MockTransport and a fake resolver.
_transport: httpx.BaseTransport | None = None
_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="webhook")


class UnsafeTarget(AppError):
    status_code, code = 422, "unsafe_webhook_url"


def _now() -> datetime:
    return datetime.now(UTC)


# --- secrets & signatures ---
def generate_secret() -> str:
    return "whsec_" + secrets.token_urlsafe(32)


def secret_hint(secret: str) -> str:
    return f"{secret[:10]}…{secret[-4:]}"


def compute_signature(secret: str, timestamp: int, body: bytes) -> str:
    return hmac.new(secret.encode(), f"{timestamp}.".encode() + body, hashlib.sha256).hexdigest()


def signature_header(secret: str, body: bytes, timestamp: int | None = None) -> str:
    ts = int(time.time()) if timestamp is None else timestamp
    return f"t={ts},v1={compute_signature(secret, ts, body)}"


def verify_signature(secret: str, body: bytes, header: str, tolerance: int = SIGNATURE_TOLERANCE_SECONDS) -> bool:
    """Reference receiver-side check (also used by the tests)."""
    try:
        parts = dict(p.split("=", 1) for p in header.split(","))
        ts = int(parts["t"])
    except (ValueError, KeyError):
        return False
    if abs(time.time() - ts) > tolerance:
        return False
    return hmac.compare_digest(compute_signature(secret, ts, body), parts.get("v1", ""))


# --- SSRF protection ---
def _resolve_host(host: str, port: int) -> list[str]:
    return [info[4][0] for info in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)]


def _ip_allowed(addr: str) -> bool:
    ip = ipaddress.ip_address(addr.split("%", 1)[0])
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return settings.webhook_allow_private_targets or ip.is_global


def validate_url(url: str) -> str:
    """Static checks, applied when an endpoint is saved."""
    parts = urlsplit(url.strip())
    allowed = ("https",) if settings.is_production else ("https", "http")
    if parts.scheme not in allowed:
        raise UnsafeTarget("Webhook URL must use https" if settings.is_production else "Webhook URL must be http(s)")
    if not parts.hostname:
        raise UnsafeTarget("Webhook URL must include a host")
    if parts.username or parts.password:
        raise UnsafeTarget("Webhook URL must not contain credentials")
    host = parts.hostname
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if not settings.webhook_allow_private_targets:
        if literal is not None and not _ip_allowed(str(literal)):
            raise UnsafeTarget("Webhook URL must not point at a private or reserved address")
        if host == "localhost" or host.endswith((".localhost", ".local", ".internal")):
            raise UnsafeTarget("Webhook URL must be publicly reachable")
    return url.strip()


def check_target(url: str) -> None:
    """Delivery-time check: resolve the host and refuse internal addresses (DNS may have changed since save)."""
    validate_url(url)
    parts = urlsplit(url)
    port = parts.port or (443 if parts.scheme == "https" else 80)
    try:
        addrs = _resolve_host(parts.hostname, port)
    except OSError as exc:
        raise UnsafeTarget(f"Could not resolve {parts.hostname}") from exc
    if not addrs or not all(_ip_allowed(a) for a in addrs):
        raise UnsafeTarget("Webhook host resolves to a private or reserved address")


# --- enqueue (inside the caller's transaction) ---
def _subscribed(endpoint: WebhookEndpoint, event_type: str) -> bool:
    events = endpoint.events or []
    return WILDCARD in events or event_type in events


def enqueue(db: Session, user_id: int, message: dict, endpoint: WebhookEndpoint | None = None) -> list[WebhookDelivery]:
    if endpoint is not None:
        targets = [endpoint]
    else:
        endpoints = db.scalars(select(WebhookEndpoint).where(WebhookEndpoint.user_id == user_id,
                                                             WebhookEndpoint.is_active.is_(True))).all()
        targets = [e for e in endpoints if _subscribed(e, message["type"])]
    if not targets:
        return []
    deliveries = [WebhookDelivery(endpoint_id=e.id, event_id=message["id"], event_type=message["type"],
                                  payload=message, status="pending", attempts=0) for e in targets]
    db.add_all(deliveries)
    db.flush()
    ids = [d.id for d in deliveries]
    after_commit(db, lambda: dispatch(ids))
    return deliveries


def send_test(db: Session, endpoint: WebhookEndpoint) -> WebhookDelivery:
    message = make_event(TEST_EVENT, {"message": "This is a test event from FinTrack.", "endpoint_id": endpoint.id})
    return enqueue(db, endpoint.user_id, message, endpoint=endpoint)[0]


def redeliver(db: Session, original: WebhookDelivery) -> WebhookDelivery:
    """A fresh attempt chain for the same event (same event id, so receivers can still dedupe)."""
    endpoint = db.get(WebhookEndpoint, original.endpoint_id)
    return enqueue(db, endpoint.user_id, original.payload, endpoint=endpoint)[0]


# --- dispatch (after commit) ---
def dispatch(delivery_ids: list[int]) -> None:
    mode = settings.webhook_dispatch
    if mode == "off" or not delivery_ids:
        return
    for delivery_id in delivery_ids:
        try:
            if mode == "celery":
                from app.worker.tasks import deliver_webhook

                deliver_webhook.delay(delivery_id)
            elif mode == "thread":
                _executor.submit(deliver, delivery_id)
            else:
                deliver(delivery_id)
        except Exception:  # broker down etc.: the row stays pending and the sweeper retries it
            log.exception("could not dispatch webhook delivery %s", delivery_id)


def _backoff(attempts: int) -> timedelta:
    return timedelta(seconds=min(30 * 4 ** (attempts - 1), 6 * 3600))  # 30s, 2m, 8m, 32m, ~2h, 6h cap


def _claim(db: Session, delivery_id: int) -> bool:
    """Atomically lease a delivery so concurrent workers/sweeps never send the same attempt twice."""
    now = _now()
    result = db.execute(
        update(WebhookDelivery)
        .where(WebhookDelivery.id == delivery_id, WebhookDelivery.status.in_(("pending", "retrying")),
               or_(WebhookDelivery.next_attempt_at.is_(None), WebhookDelivery.next_attempt_at <= now))
        .values(next_attempt_at=now + CLAIM_LEASE))
    db.commit()
    return result.rowcount == 1


def _post(url: str, body: bytes, headers: dict) -> tuple[int, str]:
    with httpx.Client(timeout=settings.webhook_timeout_seconds, follow_redirects=False, transport=_transport) as client:
        with client.stream("POST", url, content=body, headers=headers) as resp:
            chunk = b""
            for part in resp.iter_bytes():
                chunk += part
                if len(chunk) >= RESPONSE_BODY_LIMIT:
                    break
            return resp.status_code, chunk[:RESPONSE_BODY_LIMIT].decode("utf-8", "replace")


def deliver(delivery_id: int) -> str | None:
    """Make one delivery attempt. Returns the resulting status, or None if another worker owns it."""
    with SessionLocal() as db:
        if not _claim(db, delivery_id):
            return None
        d = db.get(WebhookDelivery, delivery_id)
        ep = db.get(WebhookEndpoint, d.endpoint_id)
        if not ep.is_active and d.event_type != TEST_EVENT:
            d.status, d.error, d.next_attempt_at = "failed", "Endpoint is disabled", None
            db.commit()
            return d.status

        body = json.dumps(d.payload, separators=(",", ":"), default=str).encode()
        headers = {"Content-Type": "application/json", "User-Agent": "FinTrack-Webhooks/1.0",
                   "X-FinTrack-Event": d.event_type, "X-FinTrack-Event-Id": d.event_id,
                   "X-FinTrack-Delivery": str(d.id), "X-FinTrack-Signature": signature_header(ep.secret, body)}
        d.attempts += 1
        started = time.perf_counter()
        error = None
        try:
            check_target(ep.url)
            status, text = _post(ep.url, body, headers)
            d.response_status, d.response_body = status, text
            if not 200 <= status < 300:
                error = f"Endpoint responded with HTTP {status}"
        except UnsafeTarget as exc:
            error = exc.message
        except httpx.TimeoutException:
            error = f"Timed out after {settings.webhook_timeout_seconds:g}s"
        except httpx.HTTPError as exc:
            error = f"{type(exc).__name__}: {exc}"[:300]
        d.duration_ms = int((time.perf_counter() - started) * 1000)

        if error is None:
            d.status, d.error, d.next_attempt_at, d.delivered_at = "success", None, None, _now()
            ep.consecutive_failures = 0
        else:
            d.error = error[:300]
            ep.consecutive_failures += 1
            if d.attempts >= settings.webhook_max_attempts or d.event_type == TEST_EVENT:
                d.status, d.next_attempt_at = "failed", None  # test pings are one-shot
            else:
                d.status, d.next_attempt_at = "retrying", _now() + _backoff(d.attempts)
            if ep.is_active and ep.consecutive_failures >= settings.webhook_disable_after_failures:
                _disable(db, ep)
        db.commit()
        log.info("webhook delivery", extra={"user_id": ep.user_id, "status": d.status})
        return d.status


def _disable(db: Session, ep: WebhookEndpoint) -> None:
    from .notifications import notify

    ep.is_active = False
    ep.disabled_reason = f"Disabled automatically after {ep.consecutive_failures} consecutive failed deliveries"
    notify(db, ep.user_id, "webhook_disabled", "Webhook endpoint disabled",
           f"{ep.url[:200]} failed {ep.consecutive_failures} times in a row and was turned off. "
           "Fix the endpoint, then re-enable it from the Webhooks page.")


def retry_due(limit: int = 200) -> int:
    """Re-dispatch deliveries whose backoff elapsed, plus pending ones whose dispatch was lost."""
    now = _now()
    with SessionLocal() as db:
        ids = db.scalars(
            select(WebhookDelivery.id)
            .where(or_((WebhookDelivery.status == "retrying") & (WebhookDelivery.next_attempt_at <= now),
                       (WebhookDelivery.status == "pending") & (WebhookDelivery.created_at <= now - timedelta(minutes=2))
                       & (or_(WebhookDelivery.next_attempt_at.is_(None), WebhookDelivery.next_attempt_at <= now))))
            .order_by(WebhookDelivery.id).limit(limit)).all()
    dispatch(list(ids))
    return len(ids)
