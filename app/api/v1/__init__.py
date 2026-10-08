from fastapi import APIRouter

from . import (
    admin,
    analytics,
    assistant,
    auth,
    budgets,
    categories,
    goals,
    notifications,
    realtime,
    recurring,
    transactions,
    users,
    webhooks,
)

api_router = APIRouter()
for module in (auth, users, categories, transactions, budgets, goals, recurring, analytics, notifications, webhooks,
               realtime, assistant, admin):
    api_router.include_router(module.router)
