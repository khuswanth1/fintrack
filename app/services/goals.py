from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from app.models import Goal
from app.schemas.finance import GoalOut


def goal_out(goal: Goal, today: date | None = None) -> GoalOut:
    today = today or date.today()
    out = GoalOut.model_validate(goal)
    out.progress_pct = round(min(100.0, float(goal.current_amount / goal.target_amount * 100)), 1)
    remaining = goal.target_amount - goal.current_amount
    if goal.target_date and remaining > 0 and goal.status == "active":
        months = max(1, (goal.target_date.year - today.year) * 12 + goal.target_date.month - today.month)
        out.monthly_needed = (remaining / months).quantize(Decimal("0.01"), ROUND_HALF_UP)
    return out
