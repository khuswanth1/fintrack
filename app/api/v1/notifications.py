from fastapi import APIRouter, Query
from sqlalchemy import func, select, update

from app.api.deps import DB, CurrentUser
from app.models import Notification
from app.schemas.common import Page
from app.schemas.finance import NotificationOut
from app.services.common import get_owned

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=Page[NotificationOut])
def list_notifications(user: CurrentUser, db: DB, unread_only: bool = False,
                       page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100)):
    q = select(Notification).where(Notification.user_id == user.id)
    if unread_only:
        q = q.where(Notification.is_read.is_(False))
    total = db.scalar(select(func.count()).select_from(q.subquery()))
    items = db.scalars(q.order_by(Notification.created_at.desc(), Notification.id.desc())
                       .offset((page - 1) * size).limit(size)).all()
    return Page.build(items, total, page, size)


@router.get("/unread-count")
def unread_count(user: CurrentUser, db: DB):
    n = db.scalar(select(func.count()).where(Notification.user_id == user.id, Notification.is_read.is_(False)))
    return {"count": n}


@router.post("/{notification_id}/read", response_model=NotificationOut)
def mark_read(notification_id: int, user: CurrentUser, db: DB):
    n = get_owned(db, Notification, notification_id, user.id, "Notification")
    n.is_read = True
    db.commit()
    return n


@router.post("/read-all", status_code=204)
def mark_all_read(user: CurrentUser, db: DB):
    db.execute(update(Notification).where(Notification.user_id == user.id, Notification.is_read.is_(False))
               .values(is_read=True))
    db.commit()
