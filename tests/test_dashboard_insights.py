from datetime import date, timedelta
from types import SimpleNamespace

from app.services import llm
from app.services.analytics import BudgetInfo, Tx, analyze, budget_risks, cash_flow_projection, detect_anomalies, detect_recurring_charges

from .conftest import API, category_id, h


def test_dashboard_summary_numbers(client, user):
    today = date.today()
    groceries = category_id(client, user, "Groceries")
    for body in ({"kind": "income", "amount": "1000.00"},
                 {"kind": "expense", "amount": "250.00", "category_id": groceries},
                 {"kind": "expense", "amount": "50.00"}):
        client.post(f"{API}/transactions", json=body | {"date": today.isoformat()}, headers=h(user))
    d = client.get(f"{API}/dashboard/summary", headers=h(user)).json()
    assert d["income"] == "1000.00" and d["expenses"] == "300.00" and d["savings"] == "700.00"
    assert d["savings_rate"] == 70.0 and d["balance"] == "700.00"
    names = {c["name"]: c for c in d["category_breakdown"]}
    assert names["Groceries"]["pct"] == 83.3 and "Uncategorized" in names
    assert len(d["monthly_trend"]) == 12 and d["monthly_trend"][-1]["month"] == f"{today:%Y-%m}"
    assert d["yearly_trend"][-1]["year"] == today.year
    assert len(d["recent_transactions"]) == 3


def test_dashboard_cache_invalidated_on_write(client, user):
    today = date.today().isoformat()
    assert client.get(f"{API}/dashboard/summary", headers=h(user)).json()["income"] == "0.00"
    client.post(f"{API}/transactions", json={"kind": "income", "amount": "10", "date": today}, headers=h(user))
    assert client.get(f"{API}/dashboard/summary", headers=h(user)).json()["income"] == "10.00"


def test_insights_endpoint_falls_back_to_rules_without_api_key(client, user):
    r = client.get(f"{API}/insights", headers=h(user))
    assert r.status_code == 200
    body = r.json()
    assert body["narrative"]["source"] == "rules" and body["narrative"]["recommendations"]
    assert 0 <= body["health_score"] <= 100


def test_monthly_pdf_report(client, user):
    client.post(f"{API}/transactions", json={"kind": "expense", "amount": "12", "date": date.today().isoformat(),
                                             "description": "<b>Tags & ampersands</b>"}, headers=h(user))
    r = client.get(f"{API}/reports/monthly", headers=h(user))
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF")


# ---------- pure analytics ----------
TODAY = date(2026, 6, 20)


def _tx(i, amount, days_ago, cat="Dining", kind="expense", desc="Meal"):
    return Tx(i, kind, amount, TODAY - timedelta(days=days_ago), cat, desc)


def test_anomaly_detection_flags_outlier_only():
    txs = [_tx(i, 20 + (i % 5), i * 3) for i in range(12)] + [_tx(99, 300, 2)]
    found = detect_anomalies(txs)
    assert [a["transaction_id"] for a in found] == [99]
    assert found[0]["times_typical"] > 10


def test_recurring_charge_detection_separates_subscriptions_from_bills():
    txs = [_tx(i, 15.49, 30 * i, cat="Subscriptions", desc=f"StreamFlix #{i}") for i in range(4)]
    subs = detect_recurring_charges(txs)
    assert len(subs) == 1 and subs[0]["monthly_amount"] == 15.49 and subs[0]["annual_cost"] == 185.88
    assert subs[0]["is_subscription"] and subs[0]["next_expected"] == TODAY + timedelta(days=30)
    rent = detect_recurring_charges([_tx(i, 1500, 30 * i, cat="Housing", desc="Rent") for i in range(4)])
    assert rent and not rent[0]["is_subscription"]


def test_budget_risk_without_history_uses_run_rate():
    # 20 days into a 30-day month with 180 spent of 200 -> projected 270 (135%).
    txs = [_tx(1, 180, 5)]
    risks = budget_risks(txs, [BudgetInfo("Dining", 200)], TODAY)
    assert risks[0]["risk"] == "high" and risks[0]["projected_pct"] == 135.0
    assert budget_risks(txs, [BudgetInfo("Dining", 2000)], TODAY) == []


def test_budget_risk_uses_typical_rest_of_month():
    # Previous three months: 100 spent after the 20th. This month: 120 so far -> forecast 220.
    txs = [_tx(1, 120, 3)] + [Tx(10 + m, "expense", 100, date(2026, m, 25), "Dining") for m in (3, 4, 5)]
    r = budget_risks(txs, [BudgetInfo("Dining", 200)], TODAY)[0]
    assert r["projected_month_end"] == 220.0 and r["risk"] == "high"


def test_fixed_bills_early_in_month_are_not_trends_or_anomalies():
    early = date(2026, 6, 3)
    rent = [Tx(m, "expense", 1500, date(2026, m, 1), "Housing", "Rent") for m in range(1, 7)]
    result = analyze(rent, [], early)
    assert result["spending_patterns"]["trends"] == []
    assert result["unusual_transactions"] == []
    assert result["recurring_bills"][0]["description"] == "Rent"


def test_analyze_end_to_end_shape():
    txs = [_tx(i, 3000, 30 * i, cat="Salary", kind="income") for i in range(6)]
    txs += [_tx(100 + i, 40, i * 2) for i in range(60)]
    result = analyze(txs, [BudgetInfo("Dining", 100)], TODAY)
    assert set(result) >= {"spending_patterns", "unusual_transactions", "budget_risks", "savings_opportunities", "health_score"}
    assert result["savings_rate_3m"] > 0
    assert result["budget_risks"][0]["category"] == "Dining"
    assert len(result["projection"]["months"]) == 7
    assert sum(f["points"] for f in result["health_breakdown"]) == result["health_score"]


def test_projection_adds_typical_rest_of_month():
    # Previous three months: 3000 salary on the 1st, 100 spent after the 20th. This month: 3000 + 120 so far.
    txs = [_tx(1, 3000, 19, cat="Salary", kind="income"), _tx(2, 120, 3)]
    for m in (3, 4, 5):
        txs += [Tx(10 + m, "income", 3000, date(2026, m, 1), "Salary"), Tx(20 + m, "expense", 100, date(2026, m, 25), "Dining")]
    p = cash_flow_projection(txs, TODAY)
    assert p["projected_income"] == 3000.0 and p["projected_expenses"] == 220.0 and p["projected_savings"] == 2780.0
    assert p["expenses_vs_typical_pct"] == 120.0 and p["based_on_months"] == 3
    assert [m["projected"] for m in p["months"]] == [False] * 3 + [True] * 4
    assert p["months"][-1] == {"month": "2026-09", "income": 3000.0, "expenses": 100.0, "savings": 2900.0, "projected": True}
    assert p["categories"][0] == {"category": "Dining", "spent": 120.0, "projected_month_end": 220.0,
                                  "typical_month": 100.0, "change_pct": 120.0}


def test_sections_carry_projections():
    # Dining: 30/40/50/60 on the 5th, 60/75/90 on the 25th, a 300 outlier this month; plus a monthly gym charge.
    txs = [Tx(i, "expense", 30 + 10 * i, date(2026, m, 5), "Dining", "Meal") for i, m in enumerate((3, 4, 5, 6))]
    txs += [Tx(10 + m, "expense", 60 + 15 * (m - 3), date(2026, m, 25), "Dining", "Dinner") for m in (3, 4, 5)]
    txs += [Tx(30, "expense", 300, date(2026, 6, 12), "Dining", "Party")]
    txs += [Tx(40 + m, "expense", 39, date(2026, m, 28), "Subscriptions", "Gym") for m in (2, 3, 4, 5)]
    r = analyze(txs, [], TODAY)
    dining = next(c for c in r["spending_patterns"]["top_categories"] if c["category"] == "Dining")
    assert dining["projected_month_end"] == 60 + 300 + 75
    gym = r["subscriptions"][0]
    assert gym["next_expected"] == date(2026, 6, 27) and gym["due_this_month"] and gym["due_in_days"] == 7
    p = r["projection"]
    assert p["recurring_still_due"] == 39.0
    late = analyze([Tx(50 + m, "expense", 9.99, date(2026, m, 17), "Subscriptions", "Music") for m in (2, 3, 4, 5)], [], TODAY)
    assert late["subscriptions"][0]["due_in_days"] == -4 and late["projection"]["recurring_still_due"] == 9.99
    assert p["unusual_excess_this_month"] == r["unusual_transactions"][0]["excess"] > 0
    assert p["expenses_without_unusual"] == round(p["projected_expenses"] - p["unusual_excess_this_month"], 2)


def test_projection_without_history_uses_run_rate():
    p = cash_flow_projection([_tx(1, 200, 5)], TODAY)  # 200 by day 20 of 30
    assert p["projected_expenses"] == 300.0 and p["based_on_months"] == 0 and p["expenses_vs_typical_pct"] is None


def test_llm_path_parses_structured_output(monkeypatch):
    findings = analyze([_tx(1, 50, 1)], [], TODAY)
    payload = '{"summary": "Solid month.", "recommendations": [{"title": "Cook more", "detail": "Dining is up.", ' \
              '"priority": "medium", "category": "Dining", "estimated_monthly_saving": 40}]}'
    captured = {}

    class FakeCompletions:
        def create(self, **kw):
            captured.update(kw)
            return SimpleNamespace(choices=[SimpleNamespace(finish_reason="stop",
                                                            message=SimpleNamespace(content=payload))])

    class FakeClient:
        def __init__(self, **_):
            self.chat = SimpleNamespace(completions=FakeCompletions())

    monkeypatch.setattr(llm.settings, "llm_api_key", "test-key")
    monkeypatch.setattr(llm.openai, "OpenAI", FakeClient)
    out = llm.generate(findings)
    assert out.source == "ai" and out.recommendations[0].title == "Cook more"
    assert captured["response_format"] == {"type": "json_object"}
    # Merchant descriptions never leave the server.
    assert "Meal" not in captured["messages"][1]["content"]


def test_llm_content_filter_falls_back_to_rules(monkeypatch):
    class FakeClient:
        def __init__(self, **_):
            self.chat = SimpleNamespace(completions=SimpleNamespace(create=lambda **kw: SimpleNamespace(
                choices=[SimpleNamespace(finish_reason="content_filter", message=SimpleNamespace(content=None))])))

    monkeypatch.setattr(llm.settings, "llm_api_key", "test-key")
    monkeypatch.setattr(llm.openai, "OpenAI", FakeClient)
    assert llm.generate(analyze([], [], TODAY)).source == "rules"
