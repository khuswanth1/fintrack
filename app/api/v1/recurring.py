from datetime import date

from fastapi import APIRouter, Request
from sqlalchemy import select

from app.api.deps import DB, CurrentUser
from app.core.errors import AppError
from app.models import Category, RecurringTransaction
from app.schemas.finance import RecurringIn, RecurringOut, RecurringUpdate
from app.services import audit
from app.services.common import get_owned
from app.services.recurring import materialize_due

router = APIRouter(prefix="/recurring", tags=["recurring transactions"])


def _check_category(db, user_id, category_id, kind):
    if category_id is not None:
        cat = get_owned(db, Category, category_id, user_id, "Category")
        if cat.kind != kind:
            raise AppError(f"Category '{cat.name}' is for {cat.kind}, not {kind}", code="category_kind_mismatch")


@router.get("", response_model=list[RecurringOut])
def list_recurring(user: CurrentUser, db: DB):
    return db.scalars(select(RecurringTransaction).where(RecurringTransaction.user_id == user.id)
                      .order_by(RecurringTransaction.is_active.desc(), RecurringTransaction.next_run_date)).all()


@router.post("", response_model=RecurringOut, status_code=201)
def create_recurring(body: RecurringIn, user: CurrentUser, db: DB, request: Request):
    _check_category(db, user.id, body.category_id, body.kind)
    r = RecurringTransaction(user_id=user.id, next_run_date=body.start_date, **body.model_dump())
    db.add(r)
    db.flush()
    audit.record(db, user.id, "recurring.create", entity_type="recurring", entity_id=r.id, request=request)
    db.commit()
    if r.start_date <= date.today():
        materialize_due(db, user_id=user.id)  # back-fill occurrences already due
    db.refresh(r)
    return r


@router.patch("/{recurring_id}", response_model=RecurringOut)
def update_recurring(recurring_id: int, body: RecurringUpdate, user: CurrentUser, db: DB, request: Request):
    r = get_owned(db, RecurringTransaction, recurring_id, user.id, "Recurring transaction")
    data = body.model_dump(exclude_unset=True)
    if "category_id" in data:
        _check_category(db, user.id, data["category_id"], r.kind)
    for k, v in data.items():
        if v is not None or k in ("category_id", "end_date"):
            setattr(r, k, v)
    if r.end_date and r.end_date < r.start_date:
        raise AppError("end_date must be on or after start_date", code="invalid_dates")
    audit.record(db, user.id, "recurring.update", entity_type="recurring", entity_id=r.id, request=request)
    db.commit()
    db.refresh(r)
    return r


@router.delete("/{recurring_id}", status_code=204)
def delete_recurring(recurring_id: int, user: CurrentUser, db: DB, request: Request):
    r = get_owned(db, RecurringTransaction, recurring_id, user.id, "Recurring transaction")
    db.delete(r)  # already-generated transactions are kept (recurring_id is set to NULL)
    audit.record(db, user.id, "recurring.delete", entity_type="recurring", entity_id=recurring_id, request=request)
    db.commit()
