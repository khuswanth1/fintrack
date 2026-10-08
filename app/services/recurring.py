import logging
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.cache import cache
from app.models import RecurringTransaction, Transaction

from .common import add_months
from .events import emit, publish_now, transaction_payload

log = logging.getLogger("fintrack.recurring")
MAX_CATCH_UP = 366  # guards against runaway loops for very old daily schedules


def next_date(d: date, frequency: str, anchor_day: int) -> date:
    if frequency == "daily":
        return d + timedelta(days=1)
    if frequency == "weekly":
        return d + timedelta(weeks=1)
    months = 1 if frequency == "monthly" else 12
    nd = add_months(d, months)
    # Keep the original day of month where possible (Jan 31 -> Feb 28 -> Mar 31).
    try:
        return nd.replace(day=anchor_day)
    except ValueError:
        return nd


def materialize_due(db: Session, today: date | None = None, user_id: int | None = None) -> int:
    """Create transactions for every schedule occurrence up to `today`. Idempotent: the
    (recurring_id, date) unique constraint plus the pre-check prevents duplicates on retries."""
    today = today or date.today()
    q = select(RecurringTransaction).where(RecurringTransaction.is_active.is_(True),
                                           RecurringTransaction.next_run_date <= today)
    if user_id:
        q = q.where(RecurringTransaction.user_id == user_id)
    created, touched = 0, set()
    for r in db.scalars(q.with_for_update(skip_locked=True, of=RecurringTransaction) if db.bind.dialect.name == "postgresql" else q).all():
        for _ in range(MAX_CATCH_UP):
            if r.next_run_date > today or (r.end_date and r.next_run_date > r.end_date):
                break
            exists = db.scalar(select(Transaction.id).where(Transaction.recurring_id == r.id,
                                                            Transaction.date == r.next_run_date))
            if not exists:
                t = Transaction(user_id=r.user_id, category_id=r.category_id, recurring_id=r.id, kind=r.kind,
                                amount=r.amount, description=r.description, date=r.next_run_date)
                db.add(t)
                db.flush()
                # Webhooks get one event per row; sockets get a single "data.changed" per user below.
                emit(db, r.user_id, "transaction.created", transaction_payload(t), realtime=False)
                created += 1
                touched.add(r.user_id)
            r.next_run_date = next_date(r.next_run_date, r.frequency, r.start_date.day)
        if r.end_date and r.next_run_date > r.end_date:
            r.is_active = False
    db.commit()
    for uid in touched:
        cache.bump_user_version(uid)
        publish_now(uid, "data.changed", {"source": "recurring"})
    if created:
        log.info("materialized %d recurring transactions", created)
    return created
