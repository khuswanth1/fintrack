#!/bin/sh
set -e
case "$1" in
  api)
    # Only the API container runs migrations; RUN_MIGRATIONS=false lets you scale API replicas safely.
    if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then alembic upgrade head; fi
    exec gunicorn app.main:app -k uvicorn.workers.UvicornWorker \
      --bind 0.0.0.0:8000 --workers "${WEB_CONCURRENCY:-2}" --timeout 90 --graceful-timeout 30 \
      --access-logfile - --forwarded-allow-ips "${FORWARDED_ALLOW_IPS:-127.0.0.1}"
    ;;
  worker) exec celery -A app.worker.celery_app worker --loglevel "${LOG_LEVEL:-INFO}" --concurrency "${CELERY_CONCURRENCY:-2}" ;;
  beat)   exec celery -A app.worker.celery_app beat --loglevel "${LOG_LEVEL:-INFO}" --schedule /tmp/celerybeat-schedule ;;
  seed)   exec python -m app.seed ;;
  *)      exec "$@" ;;
esac
