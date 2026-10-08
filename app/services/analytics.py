"""Deterministic transaction analytics. Every number shown to the user is computed here, in code;
the LLM layer only turns these findings into readable recommendations and never invents figures."""
import calendar
import re
import statistics
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

DISCRETIONARY = {"dining", "entertainment", "shopping", "subscriptions", "travel", "fun"}
ESSENTIAL = {"housing", "rent", "utilities", "insurance", "health", "groceries", "transport", "childcare", "education"}


@dataclass(frozen=True)
class Tx:
    id: int
    kind: str
    amount: float
    date: date
    category: str
    description: str = ""


@dataclass(frozen=True)
class BudgetInfo:
    category: str
    limit: float


def _month_key(d: date) -> str:
    return f"{d:%Y-%m}"


def _months_back(today: date, n: int) -> list[str]:
    out, y, m = [], today.year, today.month
    for _ in range(n):
        m -= 1
        if m == 0:
            y, m = y - 1, 12
        out.append(f"{y:04d}-{m:02d}")
    return out


def _norm_desc(s: str) -> str:
    return re.sub(r"[\d#*]+", "", s.lower()).strip()


def _prior_month_split(expenses: list[Tx], today: date, months: int = 3) -> dict[str, list[tuple[float, float]]]:
    """Per category, for each of the previous `months` months: (spend on days <= today.day, spend after)."""
    keys = _months_back(today, months)
    acc: dict[str, dict[str, list[float]]] = defaultdict(lambda: {k: [0.0, 0.0] for k in keys})
    for t in expenses:
        k = _month_key(t.date)
        if k in keys:
            acc[t.category][k][0 if t.date.day <= today.day else 1] += t.amount
    return {cat: [(a, b) for a, b in per_month.values()] for cat, per_month in acc.items()}


def detect_anomalies(expenses: list[Tx], min_samples: int = 5, threshold: float = 3.5) -> list[dict]:
    """Robust outliers per category via the modified z-score (median / MAD), which, unlike mean/stdev,
    isn't dragged around by the very outliers it is trying to find."""
    by_cat: dict[str, list[Tx]] = defaultdict(list)
    for t in expenses:
        by_cat[t.category].append(t)
    out = []
    for cat, items in by_cat.items():
        if len(items) < min_samples:
            continue
        vals = [t.amount for t in items]
        med = statistics.median(vals)
        mad = statistics.median(abs(v - med) for v in vals)
        for t in items:
            if mad:
                score = 0.6745 * (t.amount - med) / mad
            else:  # most amounts identical: flag anything well above the norm
                score = threshold + 1 if t.amount > med * 2 and t.amount - med > 20 else 0
            if score > threshold:
                out.append({"transaction_id": t.id, "date": t.date, "category": cat, "amount": round(t.amount, 2),
                            "description": t.description[:80], "typical_amount": round(med, 2),
                            "excess": round(t.amount - med, 2),
                            "times_typical": round(t.amount / med, 1) if med else None})
    return sorted(out, key=lambda a: a["date"], reverse=True)[:10]


def spending_patterns(expenses: list[Tx], today: date) -> dict:
    """Month-to-date spend is compared with spend over the same days of the previous three months,
    so bills paid early in the month don't look like spikes."""
    cur_key = _month_key(today)
    prior_keys = set(_months_back(today, 3))
    history = _prior_month_split(expenses, today)
    mtd: dict[str, float] = defaultdict(float)
    totals: dict[str, float] = defaultdict(float)
    weekday: dict[int, float] = defaultdict(float)
    for t in expenses:
        k = _month_key(t.date)
        if k == cur_key:
            mtd[t.category] += t.amount
        elif k in prior_keys:
            totals[t.category] += t.amount
        weekday[t.date.weekday()] += t.amount

    trends = []
    for cat in set(mtd) | set(history):
        typical = sum(before for before, _ in history.get(cat, [])) / 3
        current = mtd.get(cat, 0.0)
        if typical >= 25 and abs(current - typical) >= 15:
            change = (current - typical) / typical * 100
            if abs(change) >= 20:
                trends.append({"category": cat, "month_to_date": round(current, 2),
                               "typical_by_this_date": round(typical, 2), "change_pct": round(change, 1),
                               "direction": "up" if change > 0 else "down"})
    trends.sort(key=lambda t: -abs(t["change_pct"]))

    grand = sum(totals.values()) or 1
    top = sorted(totals.items(), key=lambda kv: -kv[1])[:5]
    busiest = max(weekday, key=weekday.get) if weekday else None
    return {
        "top_categories": [{"category": c, "three_month_total": round(v, 2), "share_pct": round(v / grand * 100, 1)}
                           for c, v in top if v > 0],
        "trends": trends[:6],
        "busiest_weekday": calendar.day_name[busiest] if busiest is not None else None,
    }


def detect_recurring_charges(expenses: list[Tx]) -> list[dict]:
    """Same description with a similar amount roughly monthly, three or more times. Essential bills
    (rent, utilities...) are reported, but only discretionary ones count as subscriptions."""
    groups: dict[str, list[Tx]] = defaultdict(list)
    for t in expenses:
        key = _norm_desc(t.description)
        if key:
            groups[key].append(t)
    found = []
    for key, items in groups.items():
        if len(items) < 3:
            continue
        items.sort(key=lambda t: t.date)
        gaps = [(b.date - a.date).days for a, b in zip(items, items[1:], strict=False)]
        amounts = [t.amount for t in items]
        mean_amt = statistics.mean(amounts)
        if all(25 <= g <= 35 for g in gaps[-3:]) and statistics.pstdev(amounts) <= 0.1 * mean_amt:
            found.append({"key": key, "description": items[-1].description[:80], "category": items[-1].category,
                          "monthly_amount": round(mean_amt, 2), "annual_cost": round(mean_amt * 12, 2),
                          "last_charged": items[-1].date,
                          "next_expected": items[-1].date + timedelta(days=round(statistics.median(gaps[-3:]))),
                          "is_subscription": items[-1].category.lower() not in ESSENTIAL})
    return sorted(found, key=lambda s: -s["monthly_amount"])


def budget_risks(expenses: list[Tx], budgets: list[BudgetInfo], today: date) -> list[dict]:
    """Forecast = spent so far + what the category typically costs in the rest of the month
    (last three months). Falls back to a linear run-rate when there is no history."""
    days_in = calendar.monthrange(today.year, today.month)[1]
    history = _prior_month_split(expenses, today)
    spent: dict[str, float] = defaultdict(float)
    for t in expenses:
        if t.date.year == today.year and t.date.month == today.month:
            spent[t.category] += t.amount
    risks = []
    for b in budgets:
        s = spent.get(b.category, 0.0)
        past = history.get(b.category)
        if past and any(before or after for before, after in past):
            projected = s + sum(after for _, after in past) / len(past)
        else:
            projected = s / today.day * days_in if today.day >= 7 else s
        used = s / b.limit * 100 if b.limit else 0
        proj_pct = projected / b.limit * 100 if b.limit else 0
        if used >= 100:
            level = "exceeded"
        elif proj_pct >= 110 or used >= 90:
            level = "high"
        elif proj_pct >= 95 or used >= 75:
            level = "medium"
        else:
            continue
        risks.append({"category": b.category, "limit": round(b.limit, 2), "spent": round(s, 2),
                      "used_pct": round(used, 1), "projected_month_end": round(projected, 2),
                      "projected_pct": round(proj_pct, 1), "risk": level, "over_by": round(max(0.0, s - b.limit), 2),
                      "daily_allowance_left": round(max(0.0, (b.limit - s) / max(1, days_in - today.day + 1)), 2)})
    order = {"exceeded": 0, "high": 1, "medium": 2}
    return sorted(risks, key=lambda r: (order[r["risk"]], -r["projected_pct"]))


def _months_ahead(today: date, n: int) -> list[str]:
    out, y, m = [], today.year, today.month
    for _ in range(n):
        m += 1
        if m == 13:
            y, m = y + 1, 1
        out.append(f"{y:04d}-{m:02d}")
    return out


def cash_flow_projection(recent: list[Tx], today: date, ahead: int = 3) -> dict:
    """Month-end forecast uses the same method as budget risks: spent so far + what typically comes in or
    goes out in the rest of the month (last three months). Future months use the average full month."""
    cur_key = _month_key(today)
    prior = _months_back(today, 3)
    days_in = calendar.monthrange(today.year, today.month)[1]
    full: dict[str, dict[str, float]] = {k: {"income": 0.0, "expense": 0.0} for k in prior}
    rest: dict[str, float] = defaultdict(float)
    mtd: dict[str, float] = defaultdict(float)
    cat_mtd: dict[str, float] = defaultdict(float)
    cat_rest: dict[str, float] = defaultdict(float)
    cat_full: dict[str, float] = defaultdict(float)
    for t in recent:
        k = _month_key(t.date)
        if k == cur_key:
            mtd[t.kind] += t.amount
            if t.kind == "expense":
                cat_mtd[t.category] += t.amount
        elif k in full:
            full[k][t.kind] += t.amount
            if t.date.day > today.day:
                rest[t.kind] += t.amount
            if t.kind == "expense":
                cat_full[t.category] += t.amount
                if t.date.day > today.day:
                    cat_rest[t.category] += t.amount

    active = [k for k in prior if full[k]["income"] or full[k]["expense"]]
    n = len(active) or 1

    def month_end(kind: str) -> float:
        if active:
            return mtd[kind] + rest[kind] / n
        # No history: extrapolate expenses at the current run rate; income is too lumpy to extrapolate.
        return mtd[kind] / today.day * days_in if kind == "expense" and today.day >= 7 else mtd[kind]

    inc_end, exp_end = month_end("income"), month_end("expense")
    typical_inc = sum(full[k]["income"] for k in active) / n if active else inc_end
    typical_exp = sum(full[k]["expense"] for k in active) / n if active else exp_end

    months = [{"month": k, "income": round(full[k]["income"], 2), "expenses": round(full[k]["expense"], 2),
               "savings": round(full[k]["income"] - full[k]["expense"], 2), "projected": False} for k in reversed(prior)]
    months.append({"month": cur_key, "income": round(inc_end, 2), "expenses": round(exp_end, 2),
                   "savings": round(inc_end - exp_end, 2), "projected": True})
    months += [{"month": k, "income": round(typical_inc, 2), "expenses": round(typical_exp, 2),
                "savings": round(typical_inc - typical_exp, 2), "projected": True} for k in _months_ahead(today, ahead)]

    categories = []
    for cat in set(cat_mtd) | set(cat_full):
        projected = cat_mtd[cat] + cat_rest[cat] / n if active else cat_mtd[cat]
        typical = cat_full[cat] / n if active else 0.0
        categories.append({"category": cat, "spent": round(cat_mtd[cat], 2), "projected_month_end": round(projected, 2),
                           "typical_month": round(typical, 2),
                           "change_pct": round((projected - typical) / typical * 100, 1) if typical >= 25 else None})
    categories.sort(key=lambda c: -c["projected_month_end"])

    return {
        "month": cur_key,
        "days_left": days_in - today.day,
        "income_so_far": round(mtd["income"], 2),
        "expenses_so_far": round(mtd["expense"], 2),
        "projected_income": round(inc_end, 2),
        "projected_expenses": round(exp_end, 2),
        "projected_savings": round(inc_end - exp_end, 2),
        "expenses_vs_typical_pct": round((exp_end - typical_exp) / typical_exp * 100, 1) if active and typical_exp else None,
        "next_months_savings": round((typical_inc - typical_exp) * ahead, 2),
        "months": months,
        "categories": categories,
        "based_on_months": len(active),
    }


def savings_opportunities(patterns: dict, subscriptions: list[dict], savings_rate: float, avg_income: float) -> list[dict]:
    ops = []
    for t in patterns["trends"]:
        if t["direction"] == "up" and t["category"].lower() not in ESSENTIAL:
            extra = t["month_to_date"] - t["typical_by_this_date"]
            ops.append({"type": "rising_category", "category": t["category"], "monthly_saving": round(extra, 2),
                        "detail": f"{t['category']} spending so far this month is {t['change_pct']:.0f}% above "
                                  f"what you usually spend by this date ({t['typical_by_this_date']:,.2f})."})
    for c in patterns["top_categories"]:
        if c["category"].lower() in DISCRETIONARY:
            monthly = c["three_month_total"] / 3
            ops.append({"type": "discretionary_cut", "category": c["category"], "monthly_saving": round(monthly * 0.15, 2),
                        "detail": f"Trimming {c['category']} by 15% would free about {monthly * 0.15:,.2f} a month."})
    if subscriptions:
        total = sum(s["monthly_amount"] for s in subscriptions)
        ops.append({"type": "subscriptions", "category": "Subscriptions", "monthly_saving": round(total * 0.25, 2),
                    "detail": f"{len(subscriptions)} subscriptions cost {total:,.2f}/month ({total * 12:,.2f}/year); "
                              f"review which ones you still use."})
    if avg_income and savings_rate < 20:
        target = avg_income * 0.20
        ops.append({"type": "savings_rate", "category": None,
                    "monthly_saving": round(target - avg_income * savings_rate / 100, 2),
                    "detail": f"Savings rate is {savings_rate:.1f}%; reaching 20% means saving about {target:,.2f} a month."})
    seen, unique = set(), []
    for o in sorted(ops, key=lambda o: -o["monthly_saving"]):
        k = (o["type"], o["category"])
        if k not in seen and o["monthly_saving"] > 0:
            seen.add(k)
            unique.append(o)
    return unique[:6]


def health_factors(savings_rate: float, risks: list[dict], anomalies: int, has_budgets: bool) -> list[dict]:
    """The pieces of the health score, so the page can show why the score is what it is."""
    return [
        {"label": "Starting point", "points": 50},
        {"label": f"Savings rate {savings_rate:.1f}%", "points": round(max(-30, min(30, (savings_rate - 10) * 1.5)))},
        {"label": f"{len(risks)} budget risk{'s' if len(risks) != 1 else ''}",
         "points": -sum({"exceeded": 10, "high": 6, "medium": 3}[r["risk"]] for r in risks)},
        {"label": f"{anomalies} unusual transaction{'s' if anomalies != 1 else ''}", "points": -min(10, anomalies * 2)},
        {"label": "Budgets set" if has_budgets else "No budgets set", "points": 10 if has_budgets else 0},
    ]


def health_score(savings_rate: float, risks: list[dict], anomalies: int, has_budgets: bool) -> int:
    score = sum(f["points"] for f in health_factors(savings_rate, risks, anomalies, has_budgets))
    return int(max(0, min(100, score)))


def _attach_projections(projection: dict, patterns: dict, recurring: list[dict], anomalies: list[dict], today: date) -> None:
    """Give each insight section its forward look, all derived from the one month-end projection so the
    numbers agree across the page."""
    by_cat = {c["category"]: c for c in projection["categories"]}
    for item in patterns["top_categories"] + patterns["trends"]:
        c = by_cat.get(item["category"], {})
        item["projected_month_end"] = c.get("projected_month_end", 0.0)
        item["typical_month"] = c.get("typical_month", 0.0)

    month_end = date(today.year, today.month, calendar.monthrange(today.year, today.month)[1])
    for r in recurring:
        r["due_in_days"] = (r["next_expected"] - today).days
        # A charge a few days late (weekend, bank delay) will most likely still land this month.
        r["due_this_month"] = r["due_in_days"] >= -5 and r["next_expected"] <= month_end
    projection["recurring_still_due"] = round(sum(r["monthly_amount"] for r in recurring if r["due_this_month"]), 2)

    this_month = [a for a in anomalies if a["date"].year == today.year and a["date"].month == today.month]
    excess = round(sum(a["excess"] for a in this_month), 2)
    projection["unusual_excess_this_month"] = excess
    projection["expenses_without_unusual"] = round(projection["projected_expenses"] - excess, 2)


def analyze(transactions: list[Tx], budgets: list[BudgetInfo], today: date | None = None) -> dict:
    today = today or date.today()
    window_start = today - timedelta(days=200)
    recent = [t for t in transactions if window_start <= t.date <= today]
    expenses = [t for t in recent if t.kind == "expense"]
    prior = set(_months_back(today, 3))
    inc3 = sum(t.amount for t in recent if t.kind == "income" and _month_key(t.date) in prior)
    exp3 = sum(t.amount for t in expenses if _month_key(t.date) in prior)
    savings_rate = round((inc3 - exp3) / inc3 * 100, 1) if inc3 else 0.0

    recurring = detect_recurring_charges(expenses)
    recurring_keys = {r.pop("key") for r in recurring}
    subscriptions = [r for r in recurring if r["is_subscription"]]
    # Fixed recurring charges are expected, not anomalies. The baseline uses the whole window,
    # but only recent outliers are surfaced.
    variable = [t for t in expenses if _norm_desc(t.description) not in recurring_keys]
    anomalies = [a for a in detect_anomalies(variable) if a["date"] >= today - timedelta(days=45)]
    patterns = spending_patterns(expenses, today)
    risks = budget_risks(expenses, budgets, today)
    projection = cash_flow_projection(recent, today)
    _attach_projections(projection, patterns, recurring, anomalies, today)
    return {
        "as_of": today,
        "data_points": len(recent),
        "savings_rate_3m": savings_rate,
        "avg_monthly_income": round(inc3 / 3, 2),
        "avg_monthly_expenses": round(exp3 / 3, 2),
        "health_score": health_score(savings_rate, risks, len(anomalies), bool(budgets)),
        "health_breakdown": health_factors(savings_rate, risks, len(anomalies), bool(budgets)),
        "spending_patterns": patterns,
        "unusual_transactions": anomalies,
        "subscriptions": subscriptions,
        "recurring_bills": [r for r in recurring if not r["is_subscription"]],
        "budget_risks": risks,
        "projection": projection,
        "savings_opportunities": savings_opportunities(patterns, subscriptions, savings_rate, inc3 / 3),
    }


def to_tx(t, category_name: str | None) -> Tx:
    amount = float(t.amount) if isinstance(t.amount, Decimal) else t.amount
    return Tx(t.id, t.kind, amount, t.date, category_name or "Uncategorized", t.description or "")
