from datetime import date

from fastapi import APIRouter, Query, Request
from sqlalchemy import select

from app.api.deps import DB, CurrentUser, commit_and_invalidate
from app.core.errors import AppError, Conflict
from app.models import Budget, Category
from app.schemas.finance import BudgetIn, BudgetOut, BudgetOverview, BudgetUpdate
from app.services import audit
from app.services.budgets import budget_overview, budget_status, budgets_with_usage, check_budget_alerts, spent_by_category
from app.services.common import get_owned, month_bounds

router = APIRouter(prefix="/budgets", tags=["budgets"])


def _current_usage(db, budget: Budget) -> BudgetOut:
    today = date.today()
    spent = spent_by_category(db, budget.user_id, *month_bounds(today.year, today.month))
    return budget_status(budget, spent.get(budget.category_id, 0))


@router.get("", response_model=list[BudgetOut])
def list_budgets(user: CurrentUser, db: DB, year: int | None = Query(None, ge=1970, le=2100),
                 month: int | None = Query(None, ge=1, le=12)):
    today = date.today()
    return budgets_with_usage(db, user.id, year or today.year, month or today.month)


@router.get("/overview", response_model=BudgetOverview)
def overview(user: CurrentUser, db: DB, year: int | None = Query(None, ge=1970, le=2100),
             month: int | None = Query(None, ge=1, le=12)):
    """Budgets for a month with last month, three-month average, a month-end forecast, and suggested
    limits for categories you spend in but haven't budgeted."""
    today = date.today()
    return budget_overview(db, user.id, year or today.year, month or today.month, today)


@router.post("", response_model=BudgetOut, status_code=201)
def create_budget(body: BudgetIn, user: CurrentUser, db: DB, request: Request):
    cat = get_owned(db, Category, body.category_id, user.id, "Category")
    if cat.kind != "expense":
        raise AppError("Budgets can only be set on expense categories", code="invalid_category")
    if db.scalar(select(Budget.id).where(Budget.user_id == user.id, Budget.category_id == cat.id)):
        raise Conflict(f"A budget for '{cat.name}' already exists")
    b = Budget(user_id=user.id, **body.model_dump())
    db.add(b)
    db.flush()
    audit.record(db, user.id, "budget.create", entity_type="budget", entity_id=b.id, request=request)
    check_budget_alerts(db, user.id)
    commit_and_invalidate(db, user.id)
    db.refresh(b)
    return _current_usage(db, b)


@router.patch("/{budget_id}", response_model=BudgetOut)
def update_budget(budget_id: int, body: BudgetUpdate, user: CurrentUser, db: DB, request: Request):
    b = get_owned(db, Budget, budget_id, user.id, "Budget")
    for k, v in body.model_dump(exclude_unset=True, exclude_none=True).items():
        setattr(b, k, v)
    audit.record(db, user.id, "budget.update", entity_type="budget", entity_id=b.id, request=request)
    check_budget_alerts(db, user.id)
    commit_and_invalidate(db, user.id)
    return _current_usage(db, b)


@router.delete("/{budget_id}", status_code=204)
def delete_budget(budget_id: int, user: CurrentUser, db: DB, request: Request):
    b = get_owned(db, Budget, budget_id, user.id, "Budget")
    db.delete(b)
    audit.record(db, user.id, "budget.delete", entity_type="budget", entity_id=budget_id, request=request)
    commit_and_invalidate(db, user.id)
