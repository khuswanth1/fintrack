import json
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy import select

from app.core.config import settings
from app.core.database import SessionLocal
from app.models import Notification, WebhookDelivery
from app.services import webhooks

from .conftest import API, category_id, h, make_user

HOOK_URL = "https://hooks.example.com/fintrack"


class Receiver:
    """Fake webhook receiver: records requests and replies with a configurable status."""

    def __init__(self):
        self.requests: list[httpx.Request] = []
        self.status = 200

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return httpx.Response(self.status, text="ok" if self.status < 300 else "nope")

    def bodies(self):
        return [json.loads(r.content) for r in self.requests]


@pytest.fixture
def receiver(monkeypatch):
    rx = Receiver()
    monkeypatch.setattr(webhooks, "_transport", httpx.MockTransport(rx))
    monkeypatch.setattr(webhooks, "_resolve_host", lambda host, port: ["93.184.215.14"])  # a public address
    return rx


def create_endpoint(client, user, events=("transaction.created",), url=HOOK_URL):
    r = client.post(f"{API}/webhooks", headers=h(user), json={"url": url, "events": list(events)})
    assert r.status_code == 201, r.text
    return r.json()


def add_expense(client, user, amount="12.50", category="Groceries"):
    r = client.post(f"{API}/transactions", headers=h(user), json={
        "kind": "expense", "amount": amount, "date": datetime.now(UTC).date().isoformat(),
        "description": "Coffee beans", "category_id": category_id(client, user, category)})
    assert r.status_code == 201, r.text
    return r.json()


def deliveries(client, user, endpoint_id):
    return client.get(f"{API}/webhooks/{endpoint_id}/deliveries", headers=h(user)).json()["items"]


def test_event_catalog(client):
    types = {e["type"] for e in client.get(f"{API}/webhooks/events").json()}
    assert {"transaction.created", "budget.alert", "goal.completed"} <= types


def test_secret_is_shown_only_on_create_and_rotate(client, user):
    ep = create_endpoint(client, user)
    assert ep["secret"].startswith("whsec_")
    listed = client.get(f"{API}/webhooks", headers=h(user)).json()
    assert "secret" not in listed[0] and listed[0]["secret_hint"].endswith(ep["secret"][-4:])
    rotated = client.post(f"{API}/webhooks/{ep['id']}/rotate-secret", headers=h(user)).json()
    assert rotated["secret"] != ep["secret"]


@pytest.mark.parametrize("url", ["http://127.0.0.1/x", "http://localhost:8000/x", "http://10.1.2.3/x",
                                 "http://169.254.169.254/latest/meta-data", "ftp://example.com/x",
                                 "https://user:pass@example.com/x", "http://[::1]/x", "not a url"])
def test_unsafe_urls_are_rejected(client, user, url):
    r = client.post(f"{API}/webhooks", headers=h(user), json={"url": url, "events": ["transaction.created"]})
    assert r.status_code == 422, url


def test_unknown_events_are_rejected(client, user):
    r = client.post(f"{API}/webhooks", headers=h(user), json={"url": HOOK_URL, "events": ["money.printed"]})
    assert r.status_code == 422


def test_transaction_created_is_delivered_and_signed(client, user, receiver):
    ep = create_endpoint(client, user)
    tx = add_expense(client, user)

    assert len(receiver.requests) == 1
    req = receiver.requests[0]
    assert req.headers["X-FinTrack-Event"] == "transaction.created"
    assert webhooks.verify_signature(ep["secret"], req.content, req.headers["X-FinTrack-Signature"])
    assert not webhooks.verify_signature("whsec_wrong", req.content, req.headers["X-FinTrack-Signature"])
    body = json.loads(req.content)
    assert body["type"] == "transaction.created" and body["data"]["id"] == tx["id"]
    assert body["id"] == req.headers["X-FinTrack-Event-Id"]

    [d] = deliveries(client, user, ep["id"])
    assert d["status"] == "success" and d["attempts"] == 1 and d["response_status"] == 200


def test_only_subscribed_events_are_sent(client, user, receiver):
    create_endpoint(client, user, events=["transaction.deleted"])
    tx = add_expense(client, user)
    assert receiver.requests == []
    client.delete(f"{API}/transactions/{tx['id']}", headers=h(user))
    assert [b["type"] for b in receiver.bodies()] == ["transaction.deleted"]


def test_wildcard_and_budget_alert(client, user, receiver):
    create_endpoint(client, user, events=["*"])
    client.post(f"{API}/budgets", headers=h(user),
                json={"category_id": category_id(client, user, "Groceries"), "amount": "100", "alert_threshold": 80})
    add_expense(client, user, amount="150")
    types = [b["type"] for b in receiver.bodies()]
    assert "transaction.created" in types and "budget.alert" in types
    alert = next(b for b in receiver.bodies() if b["type"] == "budget.alert")
    assert alert["data"]["status"] == "exceeded" and alert["data"]["category"]["name"] == "Groceries"


def test_failed_delivery_is_retried_with_backoff(client, user, receiver, monkeypatch):
    monkeypatch.setattr(settings, "webhook_max_attempts", 2)
    ep = create_endpoint(client, user)
    receiver.status = 500
    add_expense(client, user)
    [d] = deliveries(client, user, ep["id"])
    assert d["status"] == "retrying" and d["attempts"] == 1 and d["next_attempt_at"]
    assert "HTTP 500" in d["error"]

    # Not due yet: the sweeper leaves it alone.
    assert webhooks.retry_due() == 0
    with SessionLocal() as s:
        s.get(WebhookDelivery, d["id"]).next_attempt_at = datetime.now(UTC) - timedelta(seconds=1)
        s.commit()
    assert webhooks.retry_due() == 1
    [d] = deliveries(client, user, ep["id"])
    assert d["status"] == "failed" and d["attempts"] == 2 and d["next_attempt_at"] is None
    assert len(receiver.requests) == 2

    # Manual redelivery starts a new chain for the same event.
    receiver.status = 200
    r = client.post(f"{API}/webhooks/{ep['id']}/deliveries/{d['id']}/redeliver", headers=h(user))
    assert r.status_code == 202 and r.json()["status"] == "success" and r.json()["event_id"] == d["event_id"]


def test_claim_prevents_double_delivery(client, user, receiver):
    ep = create_endpoint(client, user)
    receiver.status = 500
    add_expense(client, user)
    [d] = deliveries(client, user, ep["id"])
    assert webhooks.deliver(d["id"]) is None, "still inside its backoff window, so it cannot be claimed"
    assert len(receiver.requests) == 1


def test_endpoint_is_disabled_after_repeated_failures(client, user, receiver, monkeypatch):
    monkeypatch.setattr(settings, "webhook_disable_after_failures", 2)
    ep = create_endpoint(client, user)
    receiver.status = 503
    add_expense(client, user)
    add_expense(client, user)
    got = client.get(f"{API}/webhooks/{ep['id']}", headers=h(user)).json()
    assert got["is_active"] is False and "consecutive" in got["disabled_reason"]
    with SessionLocal() as s:
        assert s.scalar(select(Notification).where(Notification.user_id == user["_id"],
                                                   Notification.type == "webhook_disabled"))
    # Disabled endpoints receive nothing; re-enabling resets the failure counter.
    add_expense(client, user)
    assert len(receiver.requests) == 2
    got = client.patch(f"{API}/webhooks/{ep['id']}", headers=h(user), json={"is_active": True}).json()
    assert got["is_active"] and got["consecutive_failures"] == 0 and got["disabled_reason"] is None


def test_test_ping(client, user, receiver):
    ep = create_endpoint(client, user)
    r = client.post(f"{API}/webhooks/{ep['id']}/test", headers=h(user))
    assert r.status_code == 202 and r.json()["status"] == "success"
    assert receiver.bodies()[0]["type"] == "webhook.test"


def test_dns_pointing_inside_is_blocked_at_delivery(client, user, receiver, monkeypatch):
    ep = create_endpoint(client, user)
    monkeypatch.setattr(webhooks, "_resolve_host", lambda host, port: ["10.0.0.5"])  # DNS rebinding attempt
    r = client.post(f"{API}/webhooks/{ep['id']}/test", headers=h(user)).json()
    assert r["status"] == "failed" and "private" in r["error"]
    assert receiver.requests == []


def test_endpoints_are_private_to_their_owner(client, user):
    ep = create_endpoint(client, user)
    other = make_user(client)
    for method, path in [("GET", ""), ("PATCH", ""), ("DELETE", ""), ("POST", "/test"), ("GET", "/deliveries")]:
        r = client.request(method, f"{API}/webhooks/{ep['id']}{path}", headers=h(other), json={} if method == "PATCH" else None)
        assert r.status_code == 404, (method, path)
    assert client.get(f"{API}/webhooks", headers=h(other)).json() == []


def test_endpoint_limit(client, user, monkeypatch):
    monkeypatch.setattr(settings, "webhook_max_endpoints_per_user", 1)
    create_endpoint(client, user)
    r = client.post(f"{API}/webhooks", headers=h(user), json={"url": HOOK_URL, "events": ["*"]})
    assert r.status_code == 400 and r.json()["error"]["code"] == "limit_reached"


def test_signature_rejects_stale_timestamps():
    body = b'{"x":1}'
    old = webhooks.signature_header("whsec_s", body, timestamp=1_000_000)
    assert not webhooks.verify_signature("whsec_s", body, old)
    assert webhooks.verify_signature("whsec_s", body, webhooks.signature_header("whsec_s", body))
    assert not webhooks.verify_signature("whsec_s", body, "garbage")
