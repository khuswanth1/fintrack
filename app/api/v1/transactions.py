from datetime import date
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import DB, CurrentUser, commit_and_invalidate
from app.core.errors import AppError
from app.models import Category, Transaction
from app.schemas.common import Page
from app.schemas.finance import ImportResult, TransactionFilters, TransactionIn, TransactionOut, TransactionUpdate
from app.services import audit
from app.services import io as io_svc
from app.services.budgets import check_budget_alerts
from app.services.common import get_owned
from app.services.events import emit, transaction_payload

router = APIRouter(prefix="/transactions", tags=["transactions"])
EXPORT_LIMIT = 50_000


def filter_params(
    q: str | None = Query(None, max_length=100, description="Search description and notes"),
    kind: Literal["income", "expense"] | None = None,
    category_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    min_amount: Decimal | None = Query(None, ge=0),
    max_amount: Decimal | None = Query(None, ge=0),
    sort: Literal["date", "amount", "description", "created_at"] = "date",
    order: Literal["asc", "desc"] = "desc",
) -> TransactionFilters:
    return TransactionFilters(q=q, kind=kind, category_id=category_id, date_from=date_from, date_to=date_to,
                              min_amount=min_amount, max_amount=max_amount, sort=sort, order=order)


Filters = Annotated[TransactionFilters, Depends(filter_params)]


def _check_category(db: Session, user_id: int, category_id: int | None, kind: str) -> None:
    if category_id is None:
        return
    cat = get_owned(db, Category, category_id, user_id, "Category")
    if cat.kind != kind:
        raise AppError(f"Category '{cat.name}' is for {cat.kind}, not {kind}", code="category_kind_mismatch")


def _filtered(user_id: int, f: TransactionFilters):
    q = select(Transaction).where(Transaction.user_id == user_id)
    if f.q:
        escaped = f.q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        term = f"%{escaped}%"
        q = q.where(or_(Transaction.description.ilike(term, escape="\\"), Transaction.notes.ilike(term, escape="\\")))
    if f.kind:
        q = q.where(Transaction.kind == f.kind)
    if f.category_id:
        q = q.where(Transaction.category_id == f.category_id)
    if f.date_from:
        q = q.where(Transaction.date >= f.date_from)
    if f.date_to:
        q = q.where(Transaction.date <= f.date_to)
    if f.min_amount is not None:
        q = q.where(Transaction.amount >= f.min_amount)
    if f.max_amount is not None:
        q = q.where(Transaction.amount <= f.max_amount)
    return q


def _ordered(q, f: TransactionFilters):
    col = getattr(Transaction, f.sort)
    return q.order_by(col.desc() if f.order == "desc" else col.asc(), Transaction.id.desc())


@router.get("", response_model=Page[TransactionOut])
def list_transactions(user: CurrentUser, db: DB, filters: Filters,
                      page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100)):
    q = _filtered(user.id, filters)
    total = db.scalar(select(func.count()).select_from(q.order_by(None).subquery()))
    items = db.scalars(_ordered(q, filters).offset((page - 1) * size).limit(size)).all()
    return Page.build(items, total, page, size)


@router.post("", response_model=TransactionOut, status_code=201)
def create_transaction(body: TransactionIn, user: CurrentUser, db: DB, request: Request):
    _check_category(db, user.id, body.category_id, body.kind)
    t = Transaction(user_id=user.id, **body.model_dump())
    db.add(t)
    db.flush()
    audit.record(db, user.id, "transaction.create", entity_type="transaction", entity_id=t.id, request=request,
                 details={"kind": t.kind, "amount": str(t.amount)})
    if t.kind == "expense":
        check_budget_alerts(db, user.id)
    emit(db, user.id, "transaction.created", transaction_payload(t))
    commit_and_invalidate(db, user.id, "transactions")
    db.refresh(t)
    return t


@router.get("/export")
def export_transactions(user: CurrentUser, db: DB, filters: Filters,
                        format: Literal["csv", "xlsx"] = "csv"):
    txs = db.scalars(_ordered(_filtered(user.id, filters), filters).limit(EXPORT_LIMIT)).all()
    stamp = date.today().isoformat()
    if format == "xlsx":
        return Response(io_svc.export_xlsx(txs),
                        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        headers={"Content-Disposition": f'attachment; filename="fintrack-{stamp}.xlsx"'})
    return Response(io_svc.export_csv(txs), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="fintrack-{stamp}.csv"'})


@router.get("/import/template")
def import_template():
    return Response(io_svc.template_csv(), media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="fintrack-import-template.csv"'})


@router.post("/import", response_model=ImportResult)
async def import_transactions(user: CurrentUser, db: DB, request: Request, file: UploadFile = File(...)):
    data, ext = await io_svc.read_upload(file)
    result = io_svc.import_transactions(db, user.id, data, ext)
    audit.record(db, user.id, "transaction.import", request=request,
                 details={"file_type": ext, "imported": result["imported"], "skipped": result["skipped"]})
    check_budget_alerts(db, user.id)
    emit(db, user.id, "transactions.imported", {"imported": result["imported"], "skipped": result["skipped"],
                                                 "file_type": ext})
    commit_and_invalidate(db, user.id, "transactions")
    return result


@router.get("/{transaction_id}", response_model=TransactionOut)
def get_transaction(transaction_id: int, user: CurrentUser, db: DB):
    return get_owned(db, Transaction, transaction_id, user.id, "Transaction")


@router.patch("/{transaction_id}", response_model=TransactionOut)
def update_transaction(transaction_id: int, body: TransactionUpdate, user: CurrentUser, db: DB, request: Request):
    t = get_owned(db, Transaction, transaction_id, user.id, "Transaction")
    data = body.model_dump(exclude_unset=True)
    for field in ("kind", "amount", "date", "description", "notes"):
        if field in data and data[field] is None:
            data.pop(field)  # null is only meaningful for category_id (to clear it)
    kind = data.get("kind", t.kind)
    category_id = data["category_id"] if "category_id" in data else t.category_id
    _check_category(db, user.id, category_id, kind)
    for k, v in data.items():
        setattr(t, k, v)
    audit.record(db, user.id, "transaction.update", entity_type="transaction", entity_id=t.id, request=request,
                 details={"fields": sorted(data)})
    check_budget_alerts(db, user.id)
    db.flush()
    db.refresh(t)
    emit(db, user.id, "transaction.updated", {**transaction_payload(t), "changed_fields": sorted(data)})
    commit_and_invalidate(db, user.id, "transactions")
    db.refresh(t)
    return t


@router.delete("/{transaction_id}", status_code=204)
def delete_transaction(transaction_id: int, user: CurrentUser, db: DB, request: Request):
    t = get_owned(db, Transaction, transaction_id, user.id, "Transaction")
    db.delete(t)
    audit.record(db, user.id, "transaction.delete", entity_type="transaction", entity_id=transaction_id,
                 request=request, details={"amount": str(t.amount), "date": t.date.isoformat()})
    emit(db, user.id, "transaction.deleted", {"id": transaction_id, "kind": t.kind, "amount": str(t.amount),
                                              "date": t.date.isoformat(), "description": t.description})
    commit_and_invalidate(db, user.id, "transactions")
