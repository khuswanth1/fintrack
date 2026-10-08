from typing import Annotated

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.cache import cache
from app.core.database import get_db
from app.core.errors import Forbidden, Unauthorized
from app.core.security import decode_token
from app.models import User
from app.services.events import publish_now

bearer = HTTPBearer(auto_error=False)

DB = Annotated[Session, Depends(get_db)]


def get_current_user(db: DB, creds: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]) -> User:
    if creds is None:
        raise Unauthorized("Not authenticated")
    payload = decode_token(creds.credentials, "access")
    user = db.get(User, int(payload["sub"]))
    if user is None or not user.is_active:
        raise Unauthorized("Account unavailable")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_role(*roles: str):
    def checker(user: CurrentUser) -> User:
        if user.role not in roles:
            raise Forbidden("You do not have permission to perform this action")
        return user

    return checker


AdminUser = Annotated[User, Depends(require_role("admin"))]


def commit_and_invalidate(db: Session, user_id: int, source: str | None = None) -> None:
    """Commit a financial write, invalidate the user's cached dashboard/insights, and tell their other open
    tabs/devices to refresh."""
    db.commit()
    cache.bump_user_version(user_id)
    publish_now(user_id, "data.changed", {"source": source} if source else {})
