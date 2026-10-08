"""Domain events.

`emit()` is called inside a unit of work. Webhook delivery rows are written in the same transaction (an
outbox), while the WebSocket push and the webhook dispatch are held on the session and only released once
the transaction commits. Clients therefore never hear about data that was rolled back, and a crash between
commit and dispatch leaves a pending delivery that the retry sweeper picks up."""
import logging
import uuid
from collections.abc import Callable
from datetime import UTC, datetime

from sqlalchemy import event
from sqlalchemy.orm import Session

from app.core.realtime import hub

log = logging.getLogger("fintrack.events")

_KEY = "fintrack_after_commit"


def after_commit(db: Session, fn: Callable[[], None]) -> None:
    db.info.setdefault(_KEY, []).append(fn)


@event.listens_for(Session, "after_commit")
def _run_after_commit(session: Session) -> None:
    for fn in session.info.pop(_KEY, []):
        try:
            fn()
        except Exception:
            log.exception("after-commit hook failed")


@event.listens_for(Session, "after_rollback")
def _discard_on_rollback(session: Session) -> None:
    session.info.pop(_KEY, None)


def make_event(event_type: str, data: dict) -> dict:
    return {"id": f"evt_{uuid.uuid4().hex}", "type": event_type, "created_at": datetime.now(UTC).isoformat(),
            "data": data}


def emit(db: Session, user_id: int, event_type: str, data: dict, *, realtime: bool = True,
         webhooks: bool = True) -> dict:
    message = make_event(event_type, data)
    if webhooks:
        from . import webhooks as webhook_svc  # local import: webhooks -> notifications -> events

        webhook_svc.enqueue(db, user_id, message)
    if realtime:
        after_commit(db, lambda: hub.publish(user_id, message))
    return message


def transaction_payload(t) -> dict:
    from app.schemas.finance import TransactionOut

    return TransactionOut.model_validate(t).model_dump(mode="json")


def publish_now(user_id: int, event_type: str, data: dict | None = None) -> None:
    """For signals sent right after a commit the caller already made (e.g. "your data changed")."""
    hub.publish(user_id, make_event(event_type, data or {}))
