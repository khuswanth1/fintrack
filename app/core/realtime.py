"""WebSocket fan-out.

Each API process keeps the sockets it owns. Events are published to a Redis channel so that a write handled
by one gunicorn worker (or a Celery task) reaches sockets held by every other worker. Without Redis the hub
degrades to in-process delivery, which is exactly right for a single-process dev server and the test suite."""
import asyncio
import json
import logging
from contextlib import suppress

from starlette.websockets import WebSocket

from .cache import cache
from .config import settings

log = logging.getLogger("fintrack.realtime")

CHANNEL = "fintrack:realtime"
SEND_TIMEOUT_SECONDS = 5


class RealtimeHub:
    def __init__(self):
        self._sockets: dict[int, set[WebSocket]] = {}
        self._loop: asyncio.AbstractEventLoop | None = None
        self._listener: asyncio.Task | None = None

    # --- lifecycle (called from the FastAPI lifespan) ---
    async def start(self) -> None:
        self._loop = asyncio.get_running_loop()
        if cache._client is not None:
            self._listener = asyncio.create_task(self._listen(), name="realtime-redis-listener")

    async def stop(self) -> None:
        if self._listener:
            self._listener.cancel()
            with suppress(asyncio.CancelledError):
                await self._listener
            self._listener = None
        for sockets in list(self._sockets.values()):
            for ws in list(sockets):
                with suppress(Exception):
                    await ws.close(code=1001, reason="Server shutting down")
        self._sockets.clear()
        self._loop = None

    # --- connection registry (event-loop thread only) ---
    def connect(self, user_id: int, ws: WebSocket) -> None:
        self._sockets.setdefault(user_id, set()).add(ws)

    def disconnect(self, user_id: int, ws: WebSocket) -> None:
        sockets = self._sockets.get(user_id)
        if sockets is not None:
            sockets.discard(ws)
            if not sockets:
                del self._sockets[user_id]

    def connection_count(self, user_id: int | None = None) -> int:
        if user_id is not None:
            return len(self._sockets.get(user_id, ()))
        return sum(len(s) for s in self._sockets.values())

    # --- publishing (any thread, any process) ---
    def publish(self, user_id: int, message: dict) -> None:
        """Send `message` to every socket of `user_id`, wherever it is connected. Never raises."""
        if cache._client is not None:
            try:
                cache._client.publish(CHANNEL, json.dumps({"user_id": user_id, "message": message}, default=str))
                return
            except Exception:
                log.exception("realtime publish to redis failed; delivering locally only")
        self._dispatch_local(user_id, message)

    def _dispatch_local(self, user_id: int, message: dict) -> None:
        loop = self._loop
        if loop is None or loop.is_closed() or user_id not in self._sockets:
            return
        coro = self._send(user_id, message)
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if running is loop:
            loop.create_task(coro)
        else:  # sync route handlers run in a worker thread
            asyncio.run_coroutine_threadsafe(coro, loop)

    async def _send(self, user_id: int, message: dict) -> None:
        sockets = list(self._sockets.get(user_id, ()))
        if not sockets:
            return
        text = json.dumps(message, default=str)

        async def send_one(ws: WebSocket):
            try:
                await asyncio.wait_for(ws.send_text(text), timeout=SEND_TIMEOUT_SECONDS)
            except Exception:  # dead or stalled client: drop it rather than slow everyone else down
                self.disconnect(user_id, ws)
                with suppress(Exception):
                    await ws.close(code=1011)

        await asyncio.gather(*(send_one(ws) for ws in sockets))

    async def _listen(self) -> None:
        import redis.asyncio as aioredis

        while True:
            client = aioredis.from_url(settings.redis_url, decode_responses=True)
            try:
                async with client.pubsub() as pubsub:
                    await pubsub.subscribe(CHANNEL)
                    async for item in pubsub.listen():
                        if item.get("type") != "message":
                            continue
                        try:
                            envelope = json.loads(item["data"])
                            await self._send(int(envelope["user_id"]), envelope["message"])
                        except Exception:
                            log.exception("bad realtime envelope")
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.warning("realtime redis listener error (%s); reconnecting", exc)
                await asyncio.sleep(2)
            finally:
                with suppress(Exception):
                    await client.aclose()


hub = RealtimeHub()
