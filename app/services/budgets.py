from collections import defaultdict
from datetime import date
from decimal import ROUND_CEILING, Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Budget, Category, Transaction
from app.schemas.finance import BudgetInsight, BudgetOut, BudgetOverview, BudgetSuggestion, CategoryRef

from .common import add_months, month_bounds
from .events import emit
from .notifications import notify

CENT = Decimal("0.01")


def spent_by_category(db: Session, user_id: int, start: date, end: date) -> dict[int, Decimal]:
    rows = db.execute(
        select(Transaction.category_id, func.sum(Transaction.amount))
        .where(Transaction.user_id == user_id, Transaction.kind == "expense",
               Transaction.date >= start, Transaction.date <= end, Transaction.category_id.is_not(None))
        .group_by(Transaction.category_id)).all()
    return {cid: Decimal(total or 0) for cid, total in rows}


def budget_status(budget: Budget, spent: Decimal) -> BudgetOut:
    pct = float(spent / budget.amount * 100) if budget.amount else 0.0
    status = _status(pct, budget.alert_threshold)
    return BudgetOut(id=budget.id, category=CategoryRef.model_validate(budget.category), amount=budget.amount,
                     alert_threshold=budget.alert_threshold, spent=spent, remaining=budget.amount - spent,
                     used_pct=round(pct, 1), status=status)


def budgets_with_usage(db: Session, user_id: int, year: int, month: int) -> list[BudgetOut]:
    start, end = month_bounds(year, month)
    spent = spent_by_category(db, user_id, start, end)
    budgets = db.scalars(select(Budget).where(Budget.user_id == user_id).order_by(Budget.id)).all()
    return [budget_status(b, spent.get(b.category_id, Decimal("0"))) for b in budgets]


def _status(pct: float, threshold: int) -> str:
    return "exceeded" if pct >= 100 else "warning" if pct >= threshold else "ok"


def budget_overview(db: Session, user_id: int, year: int, month: int, today: date | None = None) -> BudgetOverview:
    """Budgets for a month with context: last month, the three-month average, and (for the current month) a
    month-end forecast = spent so far + what the category usually costs in the rest of the month."""
    today = today or date.today()
    start, end = month_bounds(year, month)
    is_current = start <= today <= end
    ref_day = today.day if is_current else end.day
    prior = [add_months(start, -i) for i in (1, 2, 3)]
    rows = db.execute(select(Transaction.category_id, Transaction.date, Transaction.amount)
                      .where(Transaction.user_id == user_id, Transaction.kind == "expense",
                             Transaction.date >= prior[-1], Transaction.date <= end)).all()

    spent: dict[int | None, Decimal] = defaultdict(Decimal)
    month_total: dict[tuple[int | None, date], Decimal] = defaultdict(Decimal)
    rest: dict[int | None, Decimal] = defaultdict(Decimal)
    active: set[date] = set()
    for cid, d, amount in rows:
        if d >= start:
            spent[cid] += amount
            continue
        m = d.replace(day=1)
        active.add(m)
        month_total[(cid, m)] += amount
        if d.day > ref_day:
            rest[cid] += amount
    n = len(active)

    def avg(cid) -> Decimal:
        return (sum((month_total[(cid, m)] for m in prior), Decimal(0)) / n).quantize(CENT) if n else Decimal(0)

    days_left = (end - today).days if is_current else 0
    out = []
    for b in db.scalars(select(Budget).where(Budget.user_id == user_id).order_by(Budget.id)).all():
        base = budget_status(b, spent.get(b.category_id, Decimal(0)))
        if is_current and n:
            projected = base.spent + rest[b.category_id] / n
        elif is_current and today.day >= 7:
            projected = base.spent / today.day * end.day
        else:
            projected = base.spent
        projected = Decimal(projected).quantize(CENT)
        proj_pct = round(float(projected / b.amount * 100), 1) if b.amount else 0.0
        out.append(BudgetInsight(**base.model_dump(), last_month_spent=month_total[(b.category_id, prior[0])],
                                 avg_spent_3m=avg(b.category_id), projected=projected, projected_pct=proj_pct,
                                 projected_status=_status(proj_pct, b.alert_threshold),
                                 safe_daily=(max(Decimal(0), base.remaining) / (days_left + 1)).quantize(CENT) if is_current else None))

    budgeted = {b.category.id for b in out}
    suggestions = []
    for c in db.scalars(select(Category).where(Category.user_id == user_id, Category.kind == "expense")).all():
        a, s = avg(c.id), spent.get(c.id, Decimal(0))
        if c.id in budgeted or not (a or s):
            continue
        # Round the typical month up to a tidy number so the limit isn't breached by small noise.
        step = Decimal(50) if max(a, s) >= 500 else Decimal(10)
        suggested = ((max(a, s) / step).to_integral_value(rounding=ROUND_CEILING) * step).quantize(CENT)
        suggestions.append(BudgetSuggestion(category=CategoryRef.model_validate(c), spent=s, avg_spent_3m=a,
                                            suggested_amount=suggested))
    suggestions.sort(key=lambda s: -s.suggested_amount)

    unbudgeted = sum((v for cid, v in spent.items() if cid not in budgeted), Decimal(0))
    return BudgetOverview(month=f"{start:%Y-%m}", is_current=is_current, days_left=days_left, budgets=out,
                          unbudgeted_spent=unbudgeted, suggestions=suggestions)


def check_budget_alerts(db: Session, user_id: int, today: date | None = None) -> int:
    """Emit at most one warning and one exceeded notification per budget per month."""
    today = today or date.today()
    created = 0
    for b in budgets_with_usage(db, user_id, today.year, today.month):
        if b.status == "ok":
            continue
        key = f"budget:{b.id}:{today:%Y-%m}:{b.status}"
        if b.status == "exceeded":
            title, msg = f"{b.category.name} budget exceeded", f"You've spent {b.spent} of your {b.amount} {b.category.name} budget this month."
        else:
            title, msg = f"{b.category.name} budget at {b.used_pct:.0f}%", f"{b.remaining} left in your {b.category.name} budget this month."
        if notify(db, user_id, "budget_alert", title, msg, dedupe_key=key):
            created += 1
            emit(db, user_id, "budget.alert", {
                "budget_id": b.id, "status": b.status, "month": f"{today:%Y-%m}",
                "category": {"id": b.category.id, "name": b.category.name},
                "amount": str(b.amount), "spent": str(b.spent), "remaining": str(b.remaining),
                "used_pct": b.used_pct, "alert_threshold": b.alert_threshold}, realtime=False)
    return created
