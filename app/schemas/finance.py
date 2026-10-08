from datetime import date as Date
from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from .common import ORMModel

Kind = Literal["income", "expense"]
Frequency = Literal["daily", "weekly", "monthly", "yearly"]
PositiveMoney = Annotated[Decimal, Field(gt=0, max_digits=14, decimal_places=2)]
HexColor = Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")]


def _clean(v: str | None) -> str | None:
    return v.strip() if isinstance(v, str) else v


# ---------- categories ----------
class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    kind: Kind = "expense"
    color: HexColor = "#6366f1"

    _n = field_validator("name")(_clean)


class CategoryUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=60)
    color: HexColor | None = None


class CategoryOut(ORMModel):
    id: int
    name: str
    kind: Kind
    color: str


class CategoryRef(ORMModel):
    id: int
    name: str
    color: str


# ---------- transactions ----------
class TransactionIn(BaseModel):
    kind: Kind
    amount: PositiveMoney
    date: Date
    description: str = Field("", max_length=255)
    notes: str = Field("", max_length=2000)
    category_id: int | None = None

    _d = field_validator("description", "notes")(_clean)

    @field_validator("date")
    @classmethod
    def sane_date(cls, v: Date) -> Date:
        if v.year < 1970 or v.year > 2100:
            raise ValueError("Date out of supported range")
        return v


class TransactionUpdate(BaseModel):
    kind: Kind | None = None
    amount: PositiveMoney | None = None
    date: Date | None = None
    description: str | None = Field(None, max_length=255)
    notes: str | None = Field(None, max_length=2000)
    category_id: int | None = None


class TransactionOut(ORMModel):
    id: int
    kind: Kind
    amount: Decimal
    date: Date
    description: str
    notes: str
    category: CategoryRef | None
    recurring_id: int | None
    created_at: datetime


class TransactionFilters(BaseModel):
    q: str | None = Field(None, max_length=100)
    kind: Kind | None = None
    category_id: int | None = None
    date_from: Date | None = None
    date_to: Date | None = None
    min_amount: Decimal | None = Field(None, ge=0)
    max_amount: Decimal | None = Field(None, ge=0)
    sort: Literal["date", "amount", "description", "created_at"] = "date"
    order: Literal["asc", "desc"] = "desc"


class ImportResult(BaseModel):
    imported: int
    skipped: int
    errors: list[dict]


# ---------- budgets ----------
class BudgetIn(BaseModel):
    category_id: int
    amount: PositiveMoney
    alert_threshold: int = Field(80, ge=1, le=100)


class BudgetUpdate(BaseModel):
    amount: PositiveMoney | None = None
    alert_threshold: int | None = Field(None, ge=1, le=100)


class BudgetOut(ORMModel):
    id: int
    category: CategoryRef
    amount: Decimal
    alert_threshold: int
    spent: Decimal = Decimal("0")
    remaining: Decimal = Decimal("0")
    used_pct: float = 0
    status: Literal["ok", "warning", "exceeded"] = "ok"


class BudgetInsight(BudgetOut):
    last_month_spent: Decimal
    avg_spent_3m: Decimal
    projected: Decimal
    projected_pct: float
    projected_status: Literal["ok", "warning", "exceeded"]
    safe_daily: Decimal | None


class BudgetSuggestion(BaseModel):
    category: CategoryRef
    spent: Decimal
    avg_spent_3m: Decimal
    suggested_amount: Decimal


class BudgetOverview(BaseModel):
    month: str
    is_current: bool
    days_left: int
    budgets: list[BudgetInsight]
    unbudgeted_spent: Decimal
    suggestions: list[BudgetSuggestion]


# ---------- goals ----------
class GoalIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    target_amount: PositiveMoney
    current_amount: Annotated[Decimal, Field(ge=0, max_digits=14, decimal_places=2)] = Decimal("0")
    target_date: Date | None = None

    _n = field_validator("name")(_clean)


class GoalUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    target_amount: PositiveMoney | None = None
    target_date: Date | None = None
    status: Literal["active", "completed", "archived"] | None = None


class GoalContribution(BaseModel):
    amount: Annotated[Decimal, Field(max_digits=14, decimal_places=2)]

    @field_validator("amount")
    @classmethod
    def nonzero(cls, v):
        if v == 0:
            raise ValueError("Amount must be non-zero (negative to withdraw)")
        return v


class GoalOut(ORMModel):
    id: int
    name: str
    target_amount: Decimal
    current_amount: Decimal
    target_date: Date | None
    status: str
    progress_pct: float = 0
    monthly_needed: Decimal | None = None


# ---------- recurring ----------
class RecurringIn(BaseModel):
    kind: Kind
    amount: PositiveMoney
    description: str = Field("", max_length=255)
    category_id: int | None = None
    frequency: Frequency = "monthly"
    start_date: Date
    end_date: Date | None = None

    @model_validator(mode="after")
    def check_dates(self):
        if self.end_date and self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        return self


class RecurringUpdate(BaseModel):
    amount: PositiveMoney | None = None
    description: str | None = Field(None, max_length=255)
    category_id: int | None = None
    end_date: Date | None = None
    is_active: bool | None = None


class RecurringOut(ORMModel):
    id: int
    kind: Kind
    amount: Decimal
    description: str
    category: CategoryRef | None
    frequency: Frequency
    start_date: Date
    next_run_date: Date
    end_date: Date | None
    is_active: bool


# ---------- notifications / audit ----------
class NotificationOut(ORMModel):
    id: int
    type: str
    title: str
    message: str
    is_read: bool
    created_at: datetime


class AuditLogOut(ORMModel):
    id: int
    user_id: int | None
    action: str
    entity_type: str | None
    entity_id: int | None
    ip_address: str | None
    details: dict | None
    created_at: datetime
