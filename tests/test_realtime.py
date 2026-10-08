import time
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta

import pytest
from starlette.websockets import WebSocketDisconnect

from app.core import security

from .conftest import API, category_id, h, make_user

WS = f"{API}/ws"


@contextmanager
def connect(client, user):
    with client.websocket_connect(WS) as ws:
        ws.send_json({"type": "auth", "token": user["Authorization"].split()[1]})
        assert ws.receive_json() == {"type": "ready", "data": {"user_id": user["_id"]}}
        yield ws


def next_event(ws, event_type):
    for _ in range(10):
        msg = ws.receive_json()
        if msg["type"] == event_type:
            return msg
    raise AssertionError(f"no {event_type} event")


def add_expense(client, user, amount="20"):
    return client.post(f"{API}/transactions", headers=h(user), json={
        "kind": "expense", "amount": amount, "date": datetime.now(UTC).date().isoformat(),
        "category_id": category_id(client, user, "Dining")})


@pytest.mark.parametrize("first_frame", [{"type": "auth", "token": "garbage"}, {"type": "hello"}, "not json"])
def test_bad_auth_is_closed_with_4001(client, first_frame):
    with client.websocket_connect(WS) as ws:
        ws.send_json(first_frame) if isinstance(first_frame, dict) else ws.send_text(first_frame)
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
        assert exc.value.code == 4001


def test_refresh_token_is_not_accepted(client, user):
    with client.websocket_connect(WS) as ws:
        ws.send_json({"type": "auth", "token": user["_refresh"]})
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
        assert exc.value.code == 4001


def test_ping_pong(client, user):
    with connect(client, user) as ws:
        ws.send_json({"type": "ping"})
        assert ws.receive_json() == {"type": "pong"}


def test_writes_push_data_changed(client, user):
    with connect(client, user) as ws:
        assert add_expense(client, user).status_code == 201
        msg = next_event(ws, "data.changed")
        assert msg["data"] == {"source": "transactions"} and msg["id"].startswith("evt_")


def test_notifications_are_pushed_live(client, user):
    with connect(client, user) as ws:
        client.post(f"{API}/budgets", headers=h(user),
                    json={"category_id": category_id(client, user, "Dining"), "amount": "50", "alert_threshold": 80})
        add_expense(client, user, amount="60")
        msg = next_event(ws, "notification.created")
        assert msg["data"]["type"] == "budget_alert" and "exceeded" in msg["data"]["title"]
        assert client.get(f"{API}/notifications/unread-count", headers=h(user)).json()["count"] == 1


def test_events_are_isolated_per_user(client, user):
    other = make_user(client)
    with connect(client, other) as ws:
        add_expense(client, user)
        # If `other` had been sent user's event it would arrive before the pong.
        ws.send_json({"type": "ping"})
        assert ws.receive_json() == {"type": "pong"}


def test_socket_closes_when_access_token_expires(client, user):
    token = security._encode({"sub": str(user["_id"]), "role": "user", "type": "access"}, timedelta(seconds=1))
    with client.websocket_connect(WS) as ws:
        ws.send_json({"type": "auth", "token": token})
        assert ws.receive_json()["type"] == "ready"
        time.sleep(1.2)
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
        assert exc.value.code == 4001


def test_deactivated_account_is_refused_with_4003(client, admin, user):
    client.patch(f"{API}/admin/users/{user['_id']}", headers=h(admin), json={"is_active": False})
    with client.websocket_connect(WS) as ws:
        ws.send_json({"type": "auth", "token": user["Authorization"].split()[1]})
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
        assert exc.value.code == 4003
