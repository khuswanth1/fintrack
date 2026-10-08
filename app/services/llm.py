"""LLM narration of computed findings, with a deterministic fallback.

Privacy: only aggregates leave the server -- category names, amounts, percentages. Transaction
descriptions/merchant names, notes, emails and ids are stripped before the request is built."""
import json
import logging
from typing import Literal

# pyrefly: ignore [missing-import]
import openai

# pyrefly: ignore [missing-import]
from pydantic import BaseModel, Field, ValidationError

from app.core.config import settings

log = logging.getLogger("fintrack.llm")

GROQ_BASE_URL = "https://api.groq.com/openai/v1"


def client() -> openai.OpenAI:
    """OpenAI-SDK client for whichever OpenAI-compatible provider is configured (OpenAI, Groq, ...)."""
    base_url = settings.llm_base_url or (GROQ_BASE_URL if settings.llm_api_key.startswith("gsk_") else None)
    return openai.OpenAI(api_key=settings.llm_api_key, base_url=base_url,
                         timeout=settings.llm_timeout_seconds, max_retries=1)


class Recommendation(BaseModel):
    title: str = Field(max_length=120)
    detail: str = Field(max_length=600)
    priority: Literal["high", "medium", "low"]
    category: str = ""
    estimated_monthly_saving: float = 0


class Narrative(BaseModel):
    summary: str
    recommendations: list[Recommendation]
    source: Literal["ai", "rules"] = "rules"


OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string", "description": "2-3 sentence plain-language overview of the user's month"},
        "recommendations": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "detail": {"type": "string"},
                    "priority": {"type": "string", "enum": ["high", "medium", "low"]},
                    "category": {"type": "string"},
                    "estimated_monthly_saving": {"type": "number"},
                },
                "required": ["title", "detail", "priority", "category", "estimated_monthly_saving"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["summary", "recommendations"],
    "additionalProperties": False,
}

SYSTEM_PROMPT = """You are the insights writer inside FinTrack, a personal budgeting app.
You receive findings that the app has already computed from the user's own transactions.
Write a short summary and 3-5 specific, actionable recommendations.

Rules:
- Use only the numbers present in the findings. Never invent amounts, merchants, or percentages.
- Be specific: name the category and the amount involved.
- Be encouraging and practical, not judgmental. Plain language, no jargon.
- This is budgeting guidance only. Do not recommend specific securities, funds, crypto, loans, or other
  financial products.
- If data is sparse, say so and suggest tracking more transactions.
- You must output your response as a single JSON object matching the requested schema."""


def _strip_private(findings: dict) -> dict:
    private = {"unusual_transactions", "subscriptions", "recurring_bills"}
    safe = {k: v for k, v in findings.items() if k not in private}
    safe["unusual_transactions"] = [{"category": a["category"], "amount": a["amount"], "typical_amount": a["typical_amount"]}
                                    for a in findings.get("unusual_transactions", [])]
    for key in ("subscriptions", "recurring_bills"):
        safe[key] = [{"category": s["category"], "monthly_amount": s["monthly_amount"]} for s in findings.get(key, [])]
    return safe


def rule_based(findings: dict) -> Narrative:
    recs: list[Recommendation] = []
    for r in findings["budget_risks"][:2]:
        if r["risk"] == "exceeded":
            detail = (f"{r['category']} is {r['over_by']:,.2f} over its {r['limit']:,.2f} budget. "
                      f"Pause non-essential {r['category'].lower()} spending until next month.")
        else:
            detail = (f"{r['category']} is on track to reach {r['projected_pct']:.0f}% of its {r['limit']:,.2f} budget. "
                      f"Aim for about {r['daily_allowance_left']:,.2f}/day for the rest of the month.")
        recs.append(Recommendation(title=f"Rein in {r['category']}", detail=detail, category=r["category"],
                                   priority="high" if r["risk"] in ("exceeded", "high") else "medium"))
    for o in findings["savings_opportunities"][:3]:
        recs.append(Recommendation(title=f"Opportunity: {o['category'] or 'savings rate'}", detail=o["detail"],
                                   priority="medium", category=o["category"] or "",
                                   estimated_monthly_saving=o["monthly_saving"]))
    if findings["unusual_transactions"]:
        a = findings["unusual_transactions"][0]
        recs.append(Recommendation(title="Review an unusual charge", priority="low", category=a["category"],
                                   detail=f"A {a['amount']:,.2f} {a['category']} expense is about {a['times_typical'] or '?'}x your usual amount there."))
    if not recs:
        recs.append(Recommendation(title="Keep it up", priority="low",
                                   detail="No budget risks or unusual spending detected. Consider setting a savings goal."))
    rate = findings["savings_rate_3m"]
    summary = (f"Over the last three months you saved {rate:.1f}% of your income "
               f"(average income {findings['avg_monthly_income']:,.2f}, expenses {findings['avg_monthly_expenses']:,.2f}). "
               f"Financial health score: {findings['health_score']}/100.")
    p = findings.get("projection")
    if p and p["based_on_months"]:
        summary += (f" This month you're on track to spend {p['projected_expenses']:,.2f} "
                    f"and save {p['projected_savings']:,.2f}.")
    if findings["data_points"] < 10:
        summary = "There isn't much transaction history yet, so these insights are preliminary. " + summary
    return Narrative(summary=summary, recommendations=recs[:5], source="rules")


def generate(findings: dict) -> Narrative:
    if not settings.llm_api_key:
        return rule_based(findings)
    try:
        response = client().chat.completions.create(
            model=settings.llm_model,
            max_tokens=4000,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT + "\n\nSchema:\n" + json.dumps(OUTPUT_SCHEMA)},
                {"role": "user", "content": "Findings (JSON):\n" + json.dumps(_strip_private(findings), default=str)}
            ],
            response_format={"type": "json_object"},
        )
        if response.choices[0].finish_reason in ("length", "content_filter"):
            log.warning("LLM finish_reason=%s; using rule-based insights", response.choices[0].finish_reason)
            return rule_based(findings)
        text = response.choices[0].message.content or ""
        narrative = Narrative.model_validate_json(text)
        narrative.source = "ai"
        return narrative
    except openai.RateLimitError:
        log.warning("LLM rate limited; using rule-based insights")
    except openai.APIStatusError as exc:
        log.error("LLM API error %s: %s", exc.status_code, exc.message)
    except openai.APIConnectionError:
        log.error("LLM connection error")
    except (ValidationError, ValueError):
        log.exception("LLM returned unparseable output")
    return rule_based(findings)
