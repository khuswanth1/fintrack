"""WebSocket endpoint for live updates.

Protocol (JSON text frames):
  client -> {"type": "auth", "token": "<access token>"}   must be the first frame, within WS_AUTH_TIMEOUT_SECONDS
  server -> {"type": "ready", "data": {"user_id": 1}}
  server -> {"id": "evt_...", "type": "notification.created" | "data.changed" | ..., "created_at": ..., "data": {...}}
  client -> {"type": "ping"}   server -> {"type": "pong"}

The token travels in the first frame rather than the URL so it never lands in proxy or access logs. The server
closes with 4001 when the token is invalid or expires (refresh and reconnect) and 4003 when the account is
disabled (do not reconnect)."""
import asyncio
import json
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from starlette.concurrency import run_in_threadpool

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.errors import Unauthorized
from app.core.realtime import hub
from app.core.security import decode_token
from app.models import User

router = APIRouter(tags=["realtime"])

CLOSE_UNAUTHORIZED = 4001
CLOSE_FORBIDDEN = 4003
MAX_FRAME_CHARS = 4096


def _user_active(user_id: int) -> bool:
    with SessionLocal() as db:
        user = db.get(User, user_id)
        return bool(user and user.is_active)


async def _authenticate(ws: WebSocket) -> tuple[int, float] | None:
    try:
        frame = await asyncio.wait_for(ws.receive_text(), timeout=settings.ws_auth_timeout_seconds)
        msg = json.loads(frame[:MAX_FRAME_CHARS])
        if not isinstance(msg, dict) or msg.get("type") != "auth":
            raise Unauthorized("First message must be an auth message")
        payload = decode_token(str(msg.get("token", "")), "access")
    except WebSocketDisconnect:
        return None
    except (TimeoutError, ValueError, Unauthorized) as exc:
        reason = exc.message if isinstance(exc, Unauthorized) else "Authentication required"
        await ws.close(code=CLOSE_UNAUTHORIZED, reason=reason[:120])
        return None
    user_id = int(payload["sub"])
    if not await run_in_threadpool(_user_active, user_id):
        await ws.close(code=CLOSE_FORBIDDEN, reason="Account unavailable")
        return None
    return user_id, float(payload["exp"])


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    auth = await _authenticate(ws)
    if auth is None:
        return
    user_id, expires_at = auth
    hub.connect(user_id, ws)
    try:
        await ws.send_json({"type": "ready", "data": {"user_id": user_id}})
        while True:
            remaining = expires_at - time.time()
            if remaining <= 0:
                await ws.close(code=CLOSE_UNAUTHORIZED, reason="Token expired")
                return
            try:
                frame = await asyncio.wait_for(ws.receive_text(), timeout=remaining)
            except TimeoutError:
                continue
            try:
                msg = json.loads(frame[:MAX_FRAME_CHARS])
            except ValueError:
                continue
            if isinstance(msg, dict) and msg.get("type") == "ping":
                await ws.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    finally:
        hub.disconnect(user_id, ws)
