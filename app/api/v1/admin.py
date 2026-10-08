from datetime import UTC, date, datetime, time

from fastapi import APIRouter, Query, Request
from sqlalchemy import func, select

from app.api.deps import DB, AdminUser
from app.core.errors import AppError, NotFound
from app.models import AuditLog, Transaction, User
from app.schemas.auth import AdminUserUpdate, UserOut
from app.schemas.common import Page
from app.schemas.finance import AuditLogOut
from app.services import audit
from app.services.auth import revoke_all

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/stats")
def platform_stats(_: AdminUser, db: DB):
    return {"users": db.scalar(select(func.count(User.id))),
            "active_users": db.scalar(select(func.count(User.id)).where(User.is_active.is_(True))),
            "transactions": db.scalar(select(func.count(Transaction.id)))}


@router.get("/users", response_model=Page[UserOut])
def list_users(_: AdminUser, db: DB, q: str | None = Query(None, max_length=100),
               page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100)):
    stmt = select(User)
    if q:
        stmt = stmt.where(func.lower(User.email).contains(q.lower()) | func.lower(User.full_name).contains(q.lower()))
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    items = db.scalars(stmt.order_by(User.id).offset((page - 1) * size).limit(size)).all()
    return Page.build(items, total, page, size)


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(user_id: int, body: AdminUserUpdate, admin: AdminUser, db: DB, request: Request):
    user = db.get(User, user_id)
    if user is None:
        raise NotFound("User not found")
    if user.id == admin.id:
        raise AppError("Admins cannot change their own role or status", code="self_modification", status_code=403)
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    for k, v in changes.items():
        setattr(user, k, v)
    if changes.get("is_active") is False or "role" in changes:
        revoke_all(db, user.id)  # force re-login so new privileges take effect
    audit.record(db, admin.id, "admin.user_update", entity_type="user", entity_id=user.id, request=request,
                 details=changes)
    db.commit()
    return user


@router.get("/audit-logs", response_model=Page[AuditLogOut])
def audit_logs(_: AdminUser, db: DB, user_id: int | None = None, action: str | None = Query(None, max_length=60),
               date_from: date | None = None, date_to: date | None = None,
               page: int = Query(1, ge=1), size: int = Query(50, ge=1, le=200)):
    stmt = select(AuditLog)
    if user_id is not None:
        stmt = stmt.where(AuditLog.user_id == user_id)
    if action:
        stmt = stmt.where(AuditLog.action.startswith(action))
    if date_from:
        stmt = stmt.where(AuditLog.created_at >= datetime.combine(date_from, time.min, UTC))
    if date_to:
        stmt = stmt.where(AuditLog.created_at <= datetime.combine(date_to, time.max, UTC))
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    items = db.scalars(stmt.order_by(AuditLog.id.desc()).offset((page - 1) * size).limit(size)).all()
    return Page.build(items, total, page, size)
