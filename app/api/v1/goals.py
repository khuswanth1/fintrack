from fastapi import APIRouter, Request
from sqlalchemy import select

from app.api.deps import DB, CurrentUser, commit_and_invalidate
from app.core.errors import AppError
from app.models import Goal
from app.schemas.finance import GoalContribution, GoalIn, GoalOut, GoalUpdate
from app.services import audit
from app.services.common import get_owned
from app.services.events import emit
from app.services.goals import goal_out
from app.services.notifications import notify

router = APIRouter(prefix="/goals", tags=["goals"])


def _maybe_complete(db, goal: Goal) -> None:
    if goal.status == "active" and goal.current_amount >= goal.target_amount:
        goal.status = "completed"
        notify(db, goal.user_id, "goal_reached", f"Goal reached: {goal.name}",
               f"Congratulations! You've saved {goal.current_amount} towards '{goal.name}'.",
               dedupe_key=f"goal:{goal.id}:completed")
        emit(db, goal.user_id, "goal.completed", {"id": goal.id, "name": goal.name,
                                                  "target_amount": str(goal.target_amount),
                                                  "current_amount": str(goal.current_amount)}, realtime=False)


@router.get("", response_model=list[GoalOut])
def list_goals(user: CurrentUser, db: DB):
    goals = db.scalars(select(Goal).where(Goal.user_id == user.id).order_by(Goal.status, Goal.target_date, Goal.id))
    return [goal_out(g) for g in goals]


@router.post("", response_model=GoalOut, status_code=201)
def create_goal(body: GoalIn, user: CurrentUser, db: DB, request: Request):
    g = Goal(user_id=user.id, **body.model_dump())
    db.add(g)
    db.flush()
    _maybe_complete(db, g)
    audit.record(db, user.id, "goal.create", entity_type="goal", entity_id=g.id, request=request)
    commit_and_invalidate(db, user.id)
    return goal_out(g)


@router.patch("/{goal_id}", response_model=GoalOut)
def update_goal(goal_id: int, body: GoalUpdate, user: CurrentUser, db: DB, request: Request):
    g = get_owned(db, Goal, goal_id, user.id, "Goal")
    for k, v in body.model_dump(exclude_unset=True).items():
        if v is not None or k == "target_date":
            setattr(g, k, v)
    _maybe_complete(db, g)
    audit.record(db, user.id, "goal.update", entity_type="goal", entity_id=g.id, request=request)
    commit_and_invalidate(db, user.id)
    return goal_out(g)


@router.post("/{goal_id}/contributions", response_model=GoalOut)
def contribute(goal_id: int, body: GoalContribution, user: CurrentUser, db: DB, request: Request):
    g = get_owned(db, Goal, goal_id, user.id, "Goal")
    new_amount = g.current_amount + body.amount
    if new_amount < 0:
        raise AppError("Withdrawal exceeds the amount saved", code="insufficient_goal_balance")
    g.current_amount = new_amount
    _maybe_complete(db, g)
    audit.record(db, user.id, "goal.contribution", entity_type="goal", entity_id=g.id, request=request,
                 details={"amount": str(body.amount)})
    commit_and_invalidate(db, user.id)
    return goal_out(g)


@router.delete("/{goal_id}", status_code=204)
def delete_goal(goal_id: int, user: CurrentUser, db: DB, request: Request):
    g = get_owned(db, Goal, goal_id, user.id, "Goal")
    db.delete(g)
    audit.record(db, user.id, "goal.delete", entity_type="goal", entity_id=goal_id, request=request)
    commit_and_invalidate(db, user.id)
