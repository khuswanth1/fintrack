import calendar
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import NotFound


def get_owned(db: Session, model, obj_id: int, user_id: int, label: str | None = None):
    """Fetch a row that must belong to the user. Missing and foreign rows are indistinguishable (404) to avoid IDOR leaks."""
    obj = db.scalar(select(model).where(model.id == obj_id, model.user_id == user_id))
    if obj is None:
        raise NotFound(f"{label or model.__name__} not found")
    return obj


def month_bounds(year: int, month: int) -> tuple[date, date]:
    return date(year, month, 1), date(year, month, calendar.monthrange(year, month)[1])


def add_months(d: date, months: int) -> date:
    m = d.month - 1 + months
    y, m = d.year + m // 12, m % 12 + 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))
