"""AI chat assistant: a multi-turn conversation where the LLM (OpenAI, Groq, ...) answers questions about the signed-in user's own
finances by calling read-only tools that query the database.

Scope and safety:
- Tools are bound to the authenticated user's id server-side; the model never chooses whose data to read.
- Every tool is read-only. The assistant cannot create, edit or delete anything.
- Unlike the insights narrator, answering "what did I spend at X?" needs transaction descriptions, so those are
  sent for the rows a tool returns. Notes, emails and ids of other records are never included.
- Conversation history is held by the client and sent each turn as plain text; nothing is stored server-side."""
import json
import logging
from datetime import date
from decimal import Decimal
from typing import Literal

# pyrefly: ignore [missing-import]
import openai

# pyrefly: ignore [missing-import]
from pydantic import BaseModel, Field

# pyrefly: ignore [missing-import]
from sqlalchemy import select

# pyrefly: ignore [missing-import]
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import Category, Goal, RecurringTransaction, Transaction, User

from . import llm
from .budgets import budgets_with_usage
from .dashboard import build_summary
from .insights import get_insights

log = logging.getLogger("fintrack.assistant")

MAX_TOOL_ROUNDS = 6
MAX_TX_ROWS = 50


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=40)


class ChatReply(BaseModel):
    reply: str
    available: bool = True


SYSTEM_PROMPT = """You are FinTrack Assistant, a friendly budgeting helper inside the FinTrack personal finance app.
You help the signed-in user understand their own income, spending, budgets, savings goals and recurring payments.

How to work:
- Use the tools to look up real numbers before answering any question about the user's data. Never guess or
  invent amounts, dates, merchants or categories. If a tool returns nothing, say so.
- Amounts are in the user's currency ({currency}). Today's date is {today}.
- Keep answers short and concrete: lead with the answer, then a brief supporting detail or a short list.
  Use plain Markdown (short lists, bold for key figures); no tables wider than four columns.
- You can only read data. If the user asks you to add, change or delete something, explain which FinTrack page
  to use (Transactions, Budgets, Goals, Recurring, Categories).
- This is budgeting guidance only. Do not recommend specific securities, funds, crypto, loans, insurance or
  other financial products, and do not give tax or legal advice; suggest a qualified professional instead.
- Politely decline questions unrelated to personal budgeting and the FinTrack app."""

TOOLS = [
    {
        "name": "get_month_summary",
        "description": "Income, expenses, savings, savings rate, change vs previous month, spending by category, "
                       "budget usage and goal totals for one calendar month. Defaults to the current month.",
        "input_schema": {
            "type": "object",
            "properties": {
                "year": {"type": "integer", "description": "Four-digit year, e.g. 2026"},
                "month": {"type": "integer", "description": "Month number 1-12"},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "search_transactions",
        "description": f"List the user's transactions, newest first, with optional filters. Returns at most "
                       f"{MAX_TX_ROWS} rows plus the total count and sum of all matches.",
        "input_schema": {
            "type": "object",
            "properties": {
                "start_date": {"type": "string", "description": "Inclusive, YYYY-MM-DD"},
                "end_date": {"type": "string", "description": "Inclusive, YYYY-MM-DD"},
                "kind": {"type": "string", "enum": ["income", "expense"]},
                "category": {"type": "string", "description": "Category name (case-insensitive)"},
                "text": {"type": "string", "description": "Substring to match in the description"},
                "min_amount": {"type": "number"},
                "max_amount": {"type": "number"},
                "limit": {"type": "integer", "description": f"Rows to return, 1-{MAX_TX_ROWS}"},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "list_budgets",
        "description": "Monthly budgets with amount, spent, remaining, used percentage and status for a month "
                       "(defaults to the current month).",
        "input_schema": {
            "type": "object",
            "properties": {"year": {"type": "integer"}, "month": {"type": "integer"}},
            "additionalProperties": False,
        },
    },
    {
        "name": "list_goals",
        "description": "Savings goals with target, saved amount, progress and target date.",
        "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "list_recurring",
        "description": "Active recurring transactions (subscriptions, salary, bills) with frequency and next date.",
        "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "list_categories",
        "description": "The user's category names, by kind (income or expense).",
        "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "get_insights",
        "description": "Computed analysis of the last few months: health score, average income/expenses, savings "
                       "rate, spending patterns, unusual transactions, subscriptions, budget risks and savings "
                       "opportunities.",
        "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
]


def _money(v) -> str:
    return str(Decimal(v).quantize(Decimal("0.01")))


def _period(args: dict) -> tuple[int, int]:
    today = date.today()
    year, month = int(args.get("year") or today.year), int(args.get("month") or today.month)
    if not (1970 <= year <= 2100 and 1 <= month <= 12):
        raise ValueError("year must be 1970-2100 and month 1-12")
    return year, month


class Tools:
    """Read-only tool implementations, scoped to one user."""

    def __init__(self, db: Session, user: User):
        self.db, self.user = db, user

    def run(self, name: str, args: dict):
        handler = getattr(self, f"tool_{name}", None)
        if handler is None:
            raise ValueError(f"Unknown tool: {name}")
        return handler(**args)

    def tool_get_month_summary(self, **args):
        s = build_summary(self.db, self.user, *_period(args))
        # Recent transactions and long trends are covered by other tools; keep the payload focused.
        return {k: v for k, v in s.items() if k not in ("recent_transactions", "yearly_trend", "income_breakdown")
                } | {"category_breakdown": [{"name": c["name"], "amount": c["amount"], "pct": c["pct"]}
                                            for c in s["category_breakdown"]],
                     "monthly_trend": s["monthly_trend"][-6:]}

    def tool_search_transactions(self, start_date=None, end_date=None, kind=None, category=None, text=None,
                                 min_amount=None, max_amount=None, limit=20):
        q = select(Transaction).outerjoin(Category, Transaction.category_id == Category.id).where(
            Transaction.user_id == self.user.id)
        if start_date:
            q = q.where(Transaction.date >= date.fromisoformat(start_date))
        if end_date:
            q = q.where(Transaction.date <= date.fromisoformat(end_date))
        if kind:
            q = q.where(Transaction.kind == kind)
        if category:
            if category.strip().lower() == "uncategorized":
                q = q.where(Transaction.category_id.is_(None))
            else:
                q = q.where(Category.name.ilike(category.strip()))
        if text:
            q = q.where(Transaction.description.ilike(f"%{text.strip()}%"))
        if min_amount is not None:
            q = q.where(Transaction.amount >= Decimal(str(min_amount)))
        if max_amount is not None:
            q = q.where(Transaction.amount <= Decimal(str(max_amount)))
        matches = self.db.scalars(q.order_by(Transaction.date.desc(), Transaction.id.desc())).unique().all()
        limit = max(1, min(int(limit or 20), MAX_TX_ROWS))
        return {
            "total_matches": len(matches),
            "sum_income": _money(sum((t.amount for t in matches if t.kind == "income"), Decimal(0))),
            "sum_expense": _money(sum((t.amount for t in matches if t.kind == "expense"), Decimal(0))),
            "transactions": [{"date": t.date.isoformat(), "kind": t.kind, "amount": _money(t.amount),
                              "category": t.category.name if t.category else "Uncategorized",
                              "description": t.description} for t in matches[:limit]],
        }

    def tool_list_budgets(self, **args):
        return [{"category": b.category.name, "amount": _money(b.amount), "spent": _money(b.spent),
                 "remaining": _money(b.remaining), "used_pct": b.used_pct, "status": b.status}
                for b in budgets_with_usage(self.db, self.user.id, *_period(args))]

    def tool_list_goals(self):
        goals = self.db.scalars(select(Goal).where(Goal.user_id == self.user.id).order_by(Goal.id)).all()
        return [{"name": g.name, "status": g.status, "target": _money(g.target_amount),
                 "saved": _money(g.current_amount),
                 "progress_pct": round(float(g.current_amount / g.target_amount * 100), 1),
                 "target_date": g.target_date.isoformat() if g.target_date else None} for g in goals]

    def tool_list_recurring(self):
        rows = self.db.scalars(select(RecurringTransaction).where(RecurringTransaction.user_id == self.user.id,
                                                                  RecurringTransaction.is_active)).all()
        return [{"description": r.description, "kind": r.kind, "amount": _money(r.amount),
                 "frequency": r.frequency, "next_date": r.next_run_date.isoformat(),
                 "category": r.category.name if r.category else "Uncategorized"} for r in rows]

    def tool_list_categories(self):
        cats = self.db.scalars(select(Category).where(Category.user_id == self.user.id)
                               .order_by(Category.kind, Category.name)).all()
        return {kind: [c.name for c in cats if c.kind == kind] for kind in ("expense", "income")}

    def tool_get_insights(self):
        data = get_insights(self.db, self.user)
        return {k: v for k, v in data.items() if k != "narrative"}


def _tool_result(tools: Tools, tool_call) -> dict:
    try:
        args = json.loads(tool_call.function.arguments or "{}")
        content = json.dumps(tools.run(tool_call.function.name, args), default=str)
    except Exception as exc:
        log.exception("Assistant tool %s failed", tool_call.function.name)
        content = f"Error: {exc}"
    return {"role": "tool", "tool_call_id": tool_call.id, "content": content}


def chat(db: Session, user: User, req: ChatRequest) -> ChatReply:
    if not settings.llm_api_key:
        return ChatReply(available=False, reply="The AI assistant isn't configured on this server yet. "
                                                "An administrator needs to set LLM_API_KEY.")
    if req.messages[-1].role != "user":
        raise ValueError("The last message must be from the user")

    tools = Tools(db, user)
    system = SYSTEM_PROMPT.format(currency=user.currency, today=date.today().isoformat())
    messages: list[dict] = [{"role": "system", "content": system}] + [{"role": m.role, "content": m.content} for m in req.messages]

    openai_tools = []
    for t in TOOLS:
        schema = dict(t["input_schema"])
        schema.pop("additionalProperties", None)
        openai_tools.append({
            "type": "function",
            "function": {
                "name": t["name"],
                "description": t["description"],
                "parameters": schema
            }
        })

    client = llm.client()
    try:
        for _ in range(MAX_TOOL_ROUNDS):
            response = client.chat.completions.create(
                model=settings.llm_model,
                messages=messages,
                tools=openai_tools,
            )
            msg = response.choices[0].message
            if getattr(msg, "refusal", None):
                return ChatReply(reply="Sorry, I can't help with that. Try asking about your spending, "
                                       "budgets or goals.")
            if msg.tool_calls:
                messages.append({"role": "assistant", "content": msg.content, "tool_calls": [
                    {"id": t.id, "type": "function",
                     "function": {"name": t.function.name, "arguments": t.function.arguments}}
                    for t in msg.tool_calls]})
                for tool_call in msg.tool_calls:
                    messages.append(_tool_result(tools, tool_call))
                continue

            text = msg.content or ""
            if response.choices[0].finish_reason == "length":
                text += "\n\n_(Answer cut short — try a narrower question.)_"
            return ChatReply(reply=text or "I couldn't come up with an answer. Could you rephrase?")
        return ChatReply(reply="That question needed more lookups than I can do at once. Try a narrower question.")
    except openai.RateLimitError:
        log.warning("Assistant rate limited")
        return ChatReply(reply="The assistant is busy right now. Please try again in a minute.")
    except openai.APIStatusError as exc:
        log.error("Assistant API error %s: %s", exc.status_code, exc.message)
    except openai.APIConnectionError:
        log.error("Assistant connection error")
    return ChatReply(reply="Sorry, the assistant is unavailable right now. Please try again later.")
