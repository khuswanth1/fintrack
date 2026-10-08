from datetime import date
from decimal import Decimal

from sqlalchemy import case, extract, func, select
from sqlalchemy.orm import Session

from app.core.cache import cache
from app.core.config import settings
from app.models import Category, Goal, Transaction, User
from app.schemas.finance import TransactionOut

from .budgets import budgets_with_usage
from .common import add_months, month_bounds

ZERO = Decimal("0")
CENT = Decimal("0.01")


def _jsonable(v):
    """Money is always serialised as a 2-decimal string, identically on cache hits and misses."""
    if isinstance(v, Decimal):
        return str(v.quantize(CENT))
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, dict):
        return {k: _jsonable(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_jsonable(x) for x in v]
    return v


def _sum_kind(kind: str):
    return func.coalesce(func.sum(case((Transaction.kind == kind, Transaction.amount), else_=0)), 0)


def _totals(db: Session, user_id: int, start: date | None = None, end: date | None = None) -> tuple[Decimal, Decimal]:
    q = select(_sum_kind("income"), _sum_kind("expense")).where(Transaction.user_id == user_id)
    if start:
        q = q.where(Transaction.date >= start)
    if end:
        q = q.where(Transaction.date <= end)
    inc, exp = db.execute(q).one()
    return Decimal(inc or 0), Decimal(exp or 0)


def _pct_change(cur: Decimal, prev: Decimal) -> float | None:
    return round(float((cur - prev) / prev * 100), 1) if prev else None


def _rate(inc: Decimal, exp: Decimal) -> float:
    return round(float((inc - exp) / inc * 100), 1) if inc else 0.0


def category_breakdown(db: Session, user_id: int, start: date, end: date, kind: str = "expense") -> list[dict]:
    rows = db.execute(
        select(Category.id, Category.name, Category.color, func.sum(Transaction.amount))
        .select_from(Transaction).outerjoin(Category, Transaction.category_id == Category.id)
        .where(Transaction.user_id == user_id, Transaction.kind == kind,
               Transaction.date >= start, Transaction.date <= end)
        .group_by(Category.id, Category.name, Category.color)
        .order_by(func.sum(Transaction.amount).desc())).all()
    total = sum((Decimal(r[3] or 0) for r in rows), ZERO)
    return [{"category_id": cid, "name": name or "Uncategorized", "color": color or "#94a3b8",
             "amount": Decimal(amt or 0), "pct": round(float(Decimal(amt or 0) / total * 100), 1) if total else 0}
            for cid, name, color, amt in rows]


def monthly_trend(db: Session, user_id: int, end_year: int, end_month: int, months: int = 12) -> list[dict]:
    first = add_months(date(end_year, end_month, 1), -(months - 1))
    _, last = month_bounds(end_year, end_month)
    y, m = extract("year", Transaction.date), extract("month", Transaction.date)
    rows = db.execute(select(y, m, _sum_kind("income"), _sum_kind("expense"))
                      .where(Transaction.user_id == user_id, Transaction.date >= first, Transaction.date <= last)
                      .group_by(y, m)).all()
    data = {(int(r[0]), int(r[1])): (Decimal(r[2] or 0), Decimal(r[3] or 0)) for r in rows}
    out = []
    for i in range(months):
        d = add_months(first, i)
        inc, exp = data.get((d.year, d.month), (ZERO, ZERO))
        out.append({"month": f"{d:%Y-%m}", "income": inc, "expense": exp, "savings": inc - exp,
                    "savings_rate": _rate(inc, exp)})
    return out


def yearly_trend(db: Session, user_id: int) -> list[dict]:
    y = extract("year", Transaction.date)
    rows = db.execute(select(y, _sum_kind("income"), _sum_kind("expense"))
                      .where(Transaction.user_id == user_id).group_by(y).order_by(y)).all()
    return [{"year": int(r[0]), "income": Decimal(r[1] or 0), "expense": Decimal(r[2] or 0),
             "savings": Decimal(r[1] or 0) - Decimal(r[2] or 0)} for r in rows]


def build_summary(db: Session, user: User, year: int, month: int) -> dict:
    start, end = month_bounds(year, month)
    prev = add_months(start, -1)
    prev_start, prev_end = month_bounds(prev.year, prev.month)
    all_inc, all_exp = _totals(db, user.id)
    inc, exp = _totals(db, user.id, start, end)
    p_inc, p_exp = _totals(db, user.id, prev_start, prev_end)
    budgets = budgets_with_usage(db, user.id, year, month)
    budget_total = sum((b.amount for b in budgets), ZERO)
    budget_spent = sum((b.spent for b in budgets), ZERO)
    goals = db.scalars(select(Goal).where(Goal.user_id == user.id, Goal.status == "active")).all()
    recent = db.scalars(select(Transaction).where(Transaction.user_id == user.id)
                        .order_by(Transaction.date.desc(), Transaction.id.desc()).limit(6)).all()
    return _jsonable({
        "period": {"year": year, "month": month, "start": start, "end": end},
        "currency": user.currency,
        "balance": all_inc - all_exp,
        "income": inc,
        "expenses": exp,
        "savings": inc - exp,
        "savings_rate": _rate(inc, exp),
        "changes": {"income_pct": _pct_change(inc, p_inc), "expenses_pct": _pct_change(exp, p_exp),
                    "savings_pct": _pct_change(inc - exp, p_inc - p_exp) if (p_inc - p_exp) > 0 else None},
        "budget_usage": {"total_budget": budget_total, "total_spent": budget_spent,
                         "used_pct": round(float(budget_spent / budget_total * 100), 1) if budget_total else 0,
                         "items": [b.model_dump() for b in budgets]},
        "category_breakdown": category_breakdown(db, user.id, start, end),
        "income_breakdown": category_breakdown(db, user.id, start, end, "income"),
        "monthly_trend": monthly_trend(db, user.id, year, month),
        "yearly_trend": yearly_trend(db, user.id),
        "goals": {"active": len(goals), "saved": sum((g.current_amount for g in goals), ZERO),
                  "target": sum((g.target_amount for g in goals), ZERO)},
        "recent_transactions": [TransactionOut.model_validate(t).model_dump() for t in recent],
    })


def get_summary(db: Session, user: User, year: int, month: int) -> dict:
    key = f"dash:{user.id}:{cache.user_version(user.id)}:{year}-{month}"
    cached = cache.get_json(key)
    if cached is not None:
        return cached
    data = build_summary(db, user, year, month)
    cache.set_json(key, data, settings.dashboard_cache_seconds)
    return data
