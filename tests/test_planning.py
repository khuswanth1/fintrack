"""Budgets, goals, recurring transactions and notifications."""
from datetime import date, timedelta
from decimal import Decimal

from app.services.budgets import budget_overview
from app.services.recurring import materialize_due, next_date

from .conftest import API, category_id, h


def test_budget_usage_and_alert_notifications(client, user):
    dining = category_id(client, user, "Dining")
    r = client.post(f"{API}/budgets", json={"category_id": dining, "amount": "100", "alert_threshold": 80}, headers=h(user))
    assert r.status_code == 201 and r.json()["status"] == "ok"
    assert client.post(f"{API}/budgets", json={"category_id": dining, "amount": "50"}, headers=h(user)).status_code == 409

    today = date.today().isoformat()
    client.post(f"{API}/transactions", json={"kind": "expense", "amount": "85", "date": today, "category_id": dining}, headers=h(user))
    b = client.get(f"{API}/budgets", headers=h(user)).json()[0]
    assert b["status"] == "warning" and b["used_pct"] == 85.0 and b["spent"] == "85.00"
    client.post(f"{API}/transactions", json={"kind": "expense", "amount": "30", "date": today, "category_id": dining}, headers=h(user))
    assert client.get(f"{API}/budgets", headers=h(user)).json()[0]["status"] == "exceeded"

    notes = client.get(f"{API}/notifications", headers=h(user)).json()
    assert notes["total"] == 2  # one warning + one exceeded, no duplicates
    assert client.get(f"{API}/notifications/unread-count", headers=h(user)).json()["count"] == 2
    assert client.post(f"{API}/notifications/read-all", headers=h(user)).status_code == 204
    assert client.get(f"{API}/notifications/unread-count", headers=h(user)).json()["count"] == 0


def test_budget_overview_forecast_and_suggestions(client, user, db):
    dining, groceries = category_id(client, user, "Dining"), category_id(client, user, "Groceries")
    client.post(f"{API}/budgets", json={"category_id": dining, "amount": "200"}, headers=h(user))
    # Previous three months: Dining 150 (100 of it after the 20th), Groceries 320. This month: Dining 120 so far.
    for m in (3, 4, 5):
        for amount, day, cat in (("50", 5, dining), ("100", 25, dining), ("320", 10, groceries)):
            client.post(f"{API}/transactions", headers=h(user),
                        json={"kind": "expense", "amount": amount, "date": f"2026-{m:02d}-{day:02d}", "category_id": cat})
    client.post(f"{API}/transactions", headers=h(user),
                json={"kind": "expense", "amount": "120", "date": "2026-06-10", "category_id": dining})

    o = budget_overview(db, user["_id"], 2026, 6, today=date(2026, 6, 20))
    b = o.budgets[0]
    assert o.is_current and o.days_left == 10
    assert (b.spent, b.last_month_spent, b.avg_spent_3m, b.projected) == (120, 150, 150, 220)
    assert b.projected_pct == 110.0 and b.projected_status == "exceeded" and b.status == "ok"
    assert b.safe_daily == Decimal("7.27")  # 80 left over the 11 days including today
    s = o.suggestions[0]
    assert s.category.name == "Groceries" and s.avg_spent_3m == 320 and s.suggested_amount == 320

    past = client.get(f"{API}/budgets/overview", params={"year": 2026, "month": 5}, headers=h(user)).json()
    assert not past["is_current"] and past["budgets"][0]["projected"] == "150.00" and past["budgets"][0]["safe_daily"] is None


def test_budget_requires_expense_category(client, user):
    salary = category_id(client, user, "Salary", "income")
    assert client.post(f"{API}/budgets", json={"category_id": salary, "amount": "100"}, headers=h(user)).status_code == 400


def test_goal_contributions_and_completion(client, user):
    g = client.post(f"{API}/goals", json={"name": "Trip", "target_amount": "1000", "target_date": str(date.today() + timedelta(days=150))},
                    headers=h(user)).json()
    assert g["progress_pct"] == 0 and g["monthly_needed"] is not None
    g = client.post(f"{API}/goals/{g['id']}/contributions", json={"amount": "400"}, headers=h(user)).json()
    assert g["progress_pct"] == 40.0
    r = client.post(f"{API}/goals/{g['id']}/contributions", json={"amount": "-500"}, headers=h(user))
    assert r.status_code == 400
    g = client.post(f"{API}/goals/{g['id']}/contributions", json={"amount": "600"}, headers=h(user)).json()
    assert g["status"] == "completed"
    titles = [n["title"] for n in client.get(f"{API}/notifications", headers=h(user)).json()["items"]]
    assert "Goal reached: Trip" in titles


def test_next_date_handles_month_ends():
    assert next_date(date(2026, 1, 31), "monthly", 31) == date(2026, 2, 28)
    assert next_date(date(2026, 2, 28), "monthly", 31) == date(2026, 3, 31)
    assert next_date(date(2024, 2, 29), "yearly", 29) == date(2025, 2, 28)
    assert next_date(date(2026, 1, 1), "weekly", 1) == date(2026, 1, 8)


def test_recurring_backfills_and_is_idempotent(client, user, db):
    start = date.today() - timedelta(days=14)
    r = client.post(f"{API}/recurring", json={"kind": "expense", "amount": "5", "description": "Daily coffee",
                                              "frequency": "daily", "start_date": str(start)}, headers=h(user))
    assert r.status_code == 201
    assert r.json()["next_run_date"] == str(date.today() + timedelta(days=1))
    assert client.get(f"{API}/transactions", params={"q": "Daily coffee"}, headers=h(user)).json()["total"] == 15
    assert materialize_due(db) == 0  # running the job again creates nothing new
    assert client.get(f"{API}/transactions", params={"q": "Daily coffee"}, headers=h(user)).json()["total"] == 15


def test_recurring_respects_end_date(client, user):
    start = date.today() - timedelta(days=70)
    r = client.post(f"{API}/recurring", json={"kind": "income", "amount": "100", "description": "Gig", "frequency": "monthly",
                                              "start_date": str(start), "end_date": str(start + timedelta(days=35))},
                    headers=h(user)).json()
    assert r["is_active"] is False
    assert client.get(f"{API}/transactions", params={"q": "Gig"}, headers=h(user)).json()["total"] == 2
    bad = client.post(f"{API}/recurring", json={"kind": "income", "amount": "1", "frequency": "monthly",
                                                "start_date": "2026-05-01", "end_date": "2026-04-01"}, headers=h(user))
    assert bad.status_code == 422
