from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.cache import cache
from app.core.config import settings
from app.models import Budget, Transaction, User

from . import llm
from .analytics import BudgetInfo, analyze, to_tx


def compute_findings(db: Session, user_id: int, today: date | None = None) -> dict:
    today = today or date.today()
    txs = db.scalars(select(Transaction).where(Transaction.user_id == user_id,
                                               Transaction.date >= today - timedelta(days=200))).all()
    budgets = db.scalars(select(Budget).where(Budget.user_id == user_id)).all()
    return analyze([to_tx(t, t.category.name if t.category else None) for t in txs],
                   [BudgetInfo(b.category.name, float(b.amount)) for b in budgets], today)


def get_insights(db: Session, user: User, refresh: bool = False) -> dict:
    key = f"insights:{user.id}:{cache.user_version(user.id)}:{date.today()}"
    if not refresh:
        cached = cache.get_json(key)
        if cached is not None:
            return cached
    findings = compute_findings(db, user.id)
    narrative = llm.generate(findings)
    result = {**findings, "narrative": narrative.model_dump()}
    cache.set_json(key, result, settings.insights_cache_seconds)
    return result
