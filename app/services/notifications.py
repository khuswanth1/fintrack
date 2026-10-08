from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Notification

from .events import emit


def notify(db: Session, user_id: int, type_: str, title: str, message: str, dedupe_key: str | None = None) -> bool:
    """Create a notification unless one with the same dedupe key already exists. Returns True if created.
    The new notification is pushed to the user's open WebSocket connections once the transaction commits."""
    if dedupe_key and db.scalar(select(Notification.id).where(Notification.user_id == user_id,
                                                               Notification.dedupe_key == dedupe_key)):
        return False
    n = Notification(user_id=user_id, type=type_, title=title[:120], message=message[:500], dedupe_key=dedupe_key)
    db.add(n)
    db.flush()
    emit(db, user_id, "notification.created",
         {"id": n.id, "type": n.type, "title": n.title, "message": n.message, "is_read": False,
          "created_at": n.created_at.isoformat()}, webhooks=False)
    return True
