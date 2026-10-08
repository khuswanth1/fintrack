from celery import Celery
from celery.schedules import crontab

from app.core.config import settings

celery = Celery("fintrack", broker=settings.redis_url, backend=settings.redis_url, include=["app.worker.tasks"])
celery.conf.update(
    task_serializer="json", result_serializer="json", accept_content=["json"],
    timezone="UTC", enable_utc=True,
    task_acks_late=True,  # tasks are idempotent, so redelivery after a worker crash is safe
    worker_prefetch_multiplier=1,
    task_time_limit=600, task_soft_time_limit=540,
    result_expires=3600,
    beat_schedule={
        "materialize-recurring": {"task": "fintrack.materialize_recurring", "schedule": crontab(hour=0, minute=15)},
        "budget-alerts": {"task": "fintrack.budget_alerts", "schedule": crontab(hour="*/6", minute=0)},
        "precompute-insights": {"task": "fintrack.precompute_insights", "schedule": crontab(hour=2, minute=0)},
        "purge-expired-tokens": {"task": "fintrack.purge_expired_tokens", "schedule": crontab(hour=3, minute=30)},
        "retry-webhooks": {"task": "fintrack.retry_webhooks", "schedule": 60.0},
    },
)
