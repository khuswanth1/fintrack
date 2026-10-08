"""Seed fictional demo data. Idempotent: existing demo accounts are left untouched.

    python -m app.seed            # create demo users + ~12 months of history
    python -m app.seed --reset    # delete and recreate the demo users first

All names, merchants and amounts are invented. No real financial data is used."""
import argparse
import random
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import delete, select

from app.core.database import SessionLocal
from app.models import Budget, Category, Goal, Notification, RecurringTransaction, Transaction, User
from app.services.auth import register_user
from app.services.budgets import check_budget_alerts
from app.services.common import add_months
from app.services.recurring import next_date

DEMO_USERS = [
    # email, password, name, role
    ("demo@fintrack.dev", "demo12345", "Alex Demo", "user"),
    ("admin@fintrack.dev", "admin12345", "Avery Admin", "admin"),
]

VARIABLE = {
    # category: (description options, min, max, times per month)
    "Groceries": (["FreshMart weekly shop", "Corner Grocer", "Organic Basket"], 35, 140, 5),
    "Dining": (["Noodle House", "Cafe Aurora", "Pizza Planet Delivery", "Taco Truck"], 12, 65, 6),
    "Transport": (["Metro card top-up", "RideShare trip", "Fuel - QuickGas"], 8, 60, 5),
    "Entertainment": (["Cinema tickets", "Bowling night", "Concert tickets"], 15, 90, 2),
    "Shopping": (["Online store order", "Bookshop", "Home goods"], 20, 160, 2),
    "Health": (["Pharmacy", "Dental check-up"], 10, 120, 1),
}
FIXED = [  # description, category, amount, day of month, kind
    ("Monthly salary - Acme Example Corp", "Salary", Decimal("5200.00"), 1, "income"),
    ("Apartment rent", "Housing", Decimal("1650.00"), 1, "expense"),
    ("Electricity & water", "Utilities", Decimal("135.00"), 12, "expense"),
    ("Internet service", "Utilities", Decimal("59.99"), 15, "expense"),
    ("StreamFlix subscription", "Subscriptions", Decimal("15.49"), 7, "expense"),
    ("TuneBox music", "Subscriptions", Decimal("10.99"), 18, "expense"),
    ("FitLife gym membership", "Subscriptions", Decimal("39.00"), 3, "expense"),
]


def _seed_user(db, email, password, name, role, rng: random.Random) -> User:
    user = register_user(db, email, password, name, role)
    db.flush()
    cats = {c.name: c for c in db.scalars(select(Category).where(Category.user_id == user.id))}
    today = date.today()
    start = add_months(today.replace(day=1), -11)

    month = start
    while month <= today:
        for desc, cat, amount, day, kind in FIXED:
            d = month.replace(day=day)
            if d <= today:
                db.add(Transaction(user_id=user.id, category_id=cats[cat].id, kind=kind, amount=amount,
                                   description=desc, date=d))
        if rng.random() < 0.4:  # occasional freelance income
            d = month.replace(day=rng.randint(5, 25))
            if d <= today:
                db.add(Transaction(user_id=user.id, category_id=cats["Freelance"].id, kind="income",
                                   amount=Decimal(rng.randrange(300, 1500)), description="Freelance design project", date=d))
        days = (add_months(month, 1) - month).days
        for cat, (descs, lo, hi, n) in VARIABLE.items():
            for _ in range(n + rng.randint(-1, 1)):
                d = month + timedelta(days=rng.randrange(days))
                if d <= today:
                    db.add(Transaction(user_id=user.id, category_id=cats[cat].id, kind="expense",
                                       amount=Decimal(str(round(rng.uniform(lo, hi), 2))),
                                       description=rng.choice(descs), date=d))
        month = add_months(month, 1)

    # A few deliberate outliers so anomaly detection has something to find.
    for days_ago, cat, amount, desc in [(4, "Dining", "289.00", "Anniversary dinner - Le Fictif"),
                                        (9, "Shopping", "749.00", "New laptop stand & monitor"),
                                        (20, "Transport", "310.00", "Car repair - Example Motors")]:
        db.add(Transaction(user_id=user.id, category_id=cats[cat].id, kind="expense", amount=Decimal(amount),
                           description=desc, date=today - timedelta(days=days_ago)))

    for cat, limit in [("Groceries", "500"), ("Dining", "250"), ("Transport", "200"), ("Entertainment", "120"),
                       ("Shopping", "300"), ("Subscriptions", "80")]:
        db.add(Budget(user_id=user.id, category_id=cats[cat].id, amount=Decimal(limit), alert_threshold=80))

    db.add_all([
        Goal(user_id=user.id, name="Emergency fund", target_amount=Decimal("15000"), current_amount=Decimal("8200"),
             target_date=add_months(today, 10)),
        Goal(user_id=user.id, name="Summer trip", target_amount=Decimal("3000"), current_amount=Decimal("1150"),
             target_date=add_months(today, 6)),
        Goal(user_id=user.id, name="New bike", target_amount=Decimal("900"), current_amount=Decimal("900"),
             status="completed"),
    ])

    # Recurring schedules whose next run is in the future (history above already covers the past).
    first_next = add_months(today.replace(day=1), 1)
    for desc, cat, amount, day, kind in FIXED[:3]:
        db.add(RecurringTransaction(user_id=user.id, category_id=cats[cat].id, kind=kind, amount=amount,
                                    description=desc, frequency="monthly", start_date=start.replace(day=day),
                                    next_run_date=first_next.replace(day=day)))
    db.add(RecurringTransaction(user_id=user.id, category_id=cats["Transport"].id, kind="expense",
                                amount=Decimal("25.00"), description="Weekly metro pass", frequency="weekly",
                                start_date=today, next_run_date=next_date(today, "weekly", today.day)))
    db.flush()
    check_budget_alerts(db, user.id)
    db.add(Notification(user_id=user.id, type="welcome", title="Welcome to FinTrack",
                        message="This account contains fictional demo data so you can explore every feature."))
    return user


def run(reset: bool = False) -> None:
    rng = random.Random(42)
    with SessionLocal() as db:
        for email, password, name, role in DEMO_USERS:
            existing = db.scalar(select(User).where(User.email == email))
            if existing and reset:
                db.execute(delete(User).where(User.id == existing.id))
                db.flush()
                existing = None
            if existing:
                print(f"skip {email} (exists)")
                continue
            _seed_user(db, email, password, name, role, rng)
            print(f"seeded {email} ({role})")
        db.commit()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--reset", action="store_true", help="recreate demo users")
    run(parser.parse_args().reset)
