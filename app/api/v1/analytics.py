"""Dashboard, AI insights and PDF reports."""
import calendar
from datetime import date

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response

from app.api.deps import DB, CurrentUser
from app.core.rate_limit import limit
from app.services import insights as insights_svc
from app.services.dashboard import get_summary
from app.services.reports import monthly_report_pdf

router = APIRouter(tags=["dashboard & insights"])


def _period(year: int | None, month: int | None) -> tuple[int, int]:
    today = date.today()
    return year or today.year, month or today.month


@router.get("/dashboard/summary")
def dashboard_summary(user: CurrentUser, db: DB, year: int | None = Query(None, ge=1970, le=2100),
                      month: int | None = Query(None, ge=1, le=12)):
    """Balance, income, expenses, savings & rate, budget usage, category breakdown,
    12-month and yearly trends, goals and recent transactions for the selected month."""
    return get_summary(db, user, *_period(year, month))


@router.get("/insights")
def get_insights(user: CurrentUser, db: DB, refresh: bool = False):
    """Spending patterns, unusual transactions, subscriptions, budget risks, savings opportunities,
    a health score and personalised recommendations. Cached until the user's data changes."""
    return insights_svc.get_insights(db, user, refresh=refresh)


@router.post("/insights/refresh", dependencies=[Depends(limit("insights", 5))])
def refresh_insights(user: CurrentUser, db: DB):
    return insights_svc.get_insights(db, user, refresh=True)


@router.get("/reports/monthly")
def monthly_report(user: CurrentUser, db: DB, year: int | None = Query(None, ge=1970, le=2100),
                   month: int | None = Query(None, ge=1, le=12), include_insights: bool = True):
    y, m = _period(year, month)
    insights = insights_svc.get_insights(db, user) if include_insights and (y, m) == _period(None, None) else None
    pdf = monthly_report_pdf(db, user, y, m, insights)
    name = f"fintrack-{y}-{m:02d}-{calendar.month_abbr[m].lower()}.pdf"
    return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{name}"'})
