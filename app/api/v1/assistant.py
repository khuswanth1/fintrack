"""AI chat assistant that answers questions about the user's own finances."""
from fastapi import APIRouter, Depends

from app.api.deps import DB, CurrentUser
from app.core.config import settings
from app.core.errors import AppError
from app.core.rate_limit import limit
from app.services import assistant as assistant_svc

router = APIRouter(prefix="/assistant", tags=["assistant"])


@router.get("/status")
def assistant_status(user: CurrentUser):
    return {"available": bool(settings.llm_api_key)}


@router.post("/chat", response_model=assistant_svc.ChatReply, dependencies=[Depends(limit("assistant", 20))])
def assistant_chat(body: assistant_svc.ChatRequest, user: CurrentUser, db: DB):
    """Send the conversation so far (plain-text turns, last one from the user) and get the assistant's reply.
    The assistant can only read the caller's data."""
    try:
        return assistant_svc.chat(db, user, body)
    except ValueError as exc:
        raise AppError(str(exc)) from exc
