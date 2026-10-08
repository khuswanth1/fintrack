"""Monthly PDF report built with ReportLab from the same data the dashboard uses.
User text is escaped inside Paragraphs (which parse markup); plain Table cells are not parsed."""
import calendar
import io
from decimal import Decimal
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Transaction, User

from .common import month_bounds
from .dashboard import build_summary

BRAND = colors.HexColor("#4f46e5")


def _money(v, cur: str) -> str:
    return f"{cur} {Decimal(v):,.2f}"


def _table(rows, widths, header_bg=BRAND):
    t = Table(rows, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), header_bg), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f1f5f9")]),
        ("ALIGN", (-1, 1), (-1, -1), "RIGHT"), ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#cbd5e1")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t


def monthly_report_pdf(db: Session, user: User, year: int, month: int, insights: dict | None = None) -> bytes:
    s = build_summary(db, user, year, month)
    cur = user.currency
    styles = getSampleStyleSheet()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm,
                            bottomMargin=16 * mm, title=f"FinTrack report {year}-{month:02d}", author="FinTrack")
    story = [Paragraph(f"FinTrack monthly report — {calendar.month_name[month]} {year}", styles["Title"]),
             Paragraph(escape(user.full_name or user.email), styles["Normal"]), Spacer(1, 8 * mm)]

    story += [Paragraph("Summary", styles["Heading2"]), _table([
        ["Metric", "Value"],
        ["Income", _money(s["income"], cur)], ["Expenses", _money(s["expenses"], cur)],
        ["Net savings", _money(s["savings"], cur)], ["Savings rate", f"{s['savings_rate']:.1f}%"],
        ["Account balance (all time)", _money(s["balance"], cur)],
    ], [110 * mm, 60 * mm]), Spacer(1, 6 * mm)]

    if s["category_breakdown"]:
        rows = [["Category", "Share", "Amount"]] + [[c["name"], f"{c['pct']:.1f}%", _money(c["amount"], cur)]
                                                    for c in s["category_breakdown"]]
        story += [Paragraph("Spending by category", styles["Heading2"]), _table(rows, [90 * mm, 30 * mm, 50 * mm]),
                  Spacer(1, 6 * mm)]

    items = s["budget_usage"]["items"]
    if items:
        rows = [["Budget", "Limit", "Spent", "Used"]] + [[b["category"]["name"], _money(b["amount"], cur),
                                                          _money(b["spent"], cur), f"{b['used_pct']:.0f}%"] for b in items]
        story += [Paragraph("Budgets", styles["Heading2"]), _table(rows, [60 * mm, 40 * mm, 40 * mm, 30 * mm]),
                  Spacer(1, 6 * mm)]

    if insights:
        story.append(Paragraph("Insights", styles["Heading2"]))
        story.append(Paragraph(escape(insights["narrative"]["summary"]), styles["Normal"]))
        for r in insights["narrative"]["recommendations"]:
            story.append(Paragraph(f"• <b>{escape(r['title'])}</b> — {escape(r['detail'])}", styles["Normal"]))
        story.append(Spacer(1, 6 * mm))

    start, end = month_bounds(year, month)
    top = db.scalars(select(Transaction).where(Transaction.user_id == user.id, Transaction.kind == "expense",
                                               Transaction.date >= start, Transaction.date <= end)
                     .order_by(Transaction.amount.desc()).limit(10)).all()
    if top:
        rows = [["Date", "Description", "Category", "Amount"]] + [
            [t.date.isoformat(), t.description[:40], t.category.name if t.category else "—",
             _money(t.amount, cur)] for t in top]
        story += [Paragraph("Largest expenses", styles["Heading2"]),
                  _table(rows, [25 * mm, 70 * mm, 40 * mm, 35 * mm])]

    doc.build(story)
    return buf.getvalue()
