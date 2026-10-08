"""Background jobs. Each task is idempotent so retries and at-least-once delivery are harmless."""
import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select

from app.core.database import SessionLocal
from app.models import Budget, RefreshToken, User
from app.services import insights, webhooks
from app.services.budgets import check_budget_alerts
from app.services.recurring import materialize_due

from .celery_app import celery

log = logging.getLogger("fintrack.tasks")


@celery.task(name="fintrack.materialize_recurring", autoretry_for=(Exception,), retry_backoff=True, max_retries=3)
def materialize_recurring() -> int:
    with SessionLocal() as db:
        return materialize_due(db)


@celery.task(name="fintrack.budget_alerts")
def budget_alerts() -> int:
    created = 0
    with SessionLocal() as db:
        user_ids = db.scalars(select(Budget.user_id).distinct()).all()
        for uid in user_ids:
            try:
                created += check_budget_alerts(db, uid)
                db.commit()
            except Exception:
                db.rollback()
                log.exception("budget alert check failed for user %s", uid)
    return created


@celery.task(name="fintrack.precompute_insights")
def precompute_insights() -> int:
    """Warm the insights cache for active users so the dashboard loads instantly in the morning."""
    done = 0
    since = datetime.now(UTC) - timedelta(days=30)
    with SessionLocal() as db:
        users = db.scalars(select(User).where(User.is_active.is_(True), User.last_login_at >= since)).all()
        for user in users:
            try:
                insights.get_insights(db, user, refresh=True)
                done += 1
            except Exception:
                log.exception("insights precompute failed for user %s", user.id)
    return done


@celery.task(name="fintrack.purge_expired_tokens")
def purge_expired_tokens() -> int:
    cutoff = datetime.now(UTC) - timedelta(days=1)
    with SessionLocal() as db:
        result = db.execute(delete(RefreshToken).where(RefreshToken.expires_at < cutoff))
        db.commit()
        return result.rowcount or 0


@celery.task(name="fintrack.refresh_user_insights")
def refresh_user_insights(user_id: int) -> bool:
    with SessionLocal() as db:
        user = db.get(User, user_id)
        if user:
            insights.get_insights(db, user, refresh=True)
        return bool(user)


@celery.task(name="fintrack.deliver_webhook")
def deliver_webhook(delivery_id: int) -> str | None:
    """One delivery attempt. Failures are rescheduled in the row itself (next_attempt_at) rather than with
    Celery retries, so the schedule survives worker restarts and is visible in the delivery log."""
    return webhooks.deliver(delivery_id)


@celery.task(name="fintrack.retry_webhooks")
def retry_webhooks() -> int:
    return webhooks.retry_due()
