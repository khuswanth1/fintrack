import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import Conflict, Forbidden, Unauthorized
from app.core.security import (
    DUMMY_HASH,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    hash_token_id,
    verify_password,
)
from app.models import Category, RefreshToken, User

DEFAULT_CATEGORIES = [
    ("Salary", "income", "#10b981"), ("Freelance", "income", "#14b8a6"), ("Investments", "income", "#22c55e"),
    ("Housing", "expense", "#6366f1"), ("Groceries", "expense", "#f59e0b"), ("Dining", "expense", "#ef4444"),
    ("Transport", "expense", "#06b6d4"), ("Utilities", "expense", "#8b5cf6"), ("Entertainment", "expense", "#ec4899"),
    ("Health", "expense", "#84cc16"), ("Shopping", "expense", "#f97316"), ("Subscriptions", "expense", "#a855f7"),
]


def _now() -> datetime:
    return datetime.now(UTC)


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)  # SQLite returns naive datetimes


def _create_user(db: Session, email: str, full_name: str, password_hash: str | None, role: str = "user",
                 google_sub: str | None = None) -> User:
    user = User(email=email.lower(), full_name=full_name, password_hash=password_hash, role=role,
                google_sub=google_sub)
    db.add(user)
    db.flush()
    db.add_all(Category(user_id=user.id, name=n, kind=k, color=c) for n, k, c in DEFAULT_CATEGORIES)
    return user


def register_user(db: Session, email: str, password: str, full_name: str = "", role: str = "user") -> User:
    if db.scalar(select(User.id).where(User.email == email.lower())):
        raise Conflict("An account with this email already exists")
    return _create_user(db, email, full_name, hash_password(password), role)


def login_with_google(db: Session, claims: dict) -> tuple[User, bool]:
    """Sign in or sign up from verified Google ID-token claims. Returns (user, created).

    Lookup order: the Google account id (stable even if the Gmail address changes), then the email address.
    An existing password account with the same email is linked, which is safe only because Google has
    verified the caller owns that address (`verify_id_token` rejects unverified emails)."""
    sub, email = claims["sub"], claims["email"].lower()
    user = db.scalar(select(User).where(User.google_sub == sub))
    created = False
    if user is None:
        user = db.scalar(select(User).where(User.email == email))
        if user is not None:
            if user.google_sub and user.google_sub != sub:
                raise Conflict("This email is already linked to a different Google account")
            user.google_sub = sub
        else:
            name = (claims.get("name") or "")[:120]
            user = _create_user(db, email, name, password_hash=None, google_sub=sub)
            created = True
    if not user.is_active:
        raise Forbidden("This account has been deactivated")
    return user, created


def authenticate(db: Session, email: str, password: str) -> User:
    user = db.scalar(select(User).where(User.email == email.lower()))
    # Always run a hash comparison so response time doesn't reveal whether the email exists.
    # Google-only accounts have no password hash and can never sign in this way.
    ok = verify_password(password, user.password_hash if user and user.password_hash else DUMMY_HASH)
    if not user or not ok:
        raise Unauthorized("Invalid email or password", code="invalid_credentials")
    if not user.is_active:
        raise Forbidden("This account has been deactivated")
    return user


def issue_tokens(db: Session, user: User, user_agent: str = "") -> tuple[str, str]:
    jti = uuid.uuid4().hex
    db.add(RefreshToken(user_id=user.id, jti_hash=hash_token_id(jti), user_agent=user_agent[:255],
                        expires_at=_now() + timedelta(days=settings.refresh_token_ttl_days)))
    return create_access_token(user.id, user.role), create_refresh_token(user.id, jti)


def rotate_refresh(db: Session, token: str, user_agent: str = "") -> tuple[User, str, str]:
    """Single-use refresh tokens. Presenting an already-rotated token is treated as theft:
    every session for that user is revoked."""
    payload = decode_token(token, "refresh")
    row = db.scalar(select(RefreshToken).where(RefreshToken.jti_hash == hash_token_id(payload.get("jti", ""))))
    if row is None:
        raise Unauthorized("Invalid refresh token")
    if row.revoked_at is not None:
        revoke_all(db, row.user_id)
        db.commit()
        raise Unauthorized("Refresh token reuse detected; all sessions revoked", code="token_reused")
    if _aware(row.expires_at) < _now():
        raise Unauthorized("Refresh token expired", code="token_expired")
    user = db.get(User, row.user_id)
    if not user or not user.is_active:
        raise Unauthorized("Account unavailable")
    row.revoked_at = _now()
    access, refresh = issue_tokens(db, user, user_agent)
    return user, access, refresh


def revoke_refresh(db: Session, token: str) -> None:
    try:
        payload = decode_token(token, "refresh")
    except Unauthorized:
        return
    db.execute(update(RefreshToken).where(RefreshToken.jti_hash == hash_token_id(payload.get("jti", "")),
                                          RefreshToken.revoked_at.is_(None)).values(revoked_at=_now()))


def revoke_all(db: Session, user_id: int) -> None:
    db.execute(update(RefreshToken).where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
               .values(revoked_at=_now()))


def change_password(db: Session, user: User, current: str | None, new: str) -> None:
    # Accounts created with Google may set a first password without one; everyone else must prove the old one.
    if user.password_hash and not verify_password(current or "", user.password_hash):
        raise Unauthorized("Current password is incorrect", code="invalid_credentials")
    user.password_hash = hash_password(new)
    revoke_all(db, user.id)


def link_google(db: Session, user: User, claims: dict) -> None:
    """Explicitly link a Google account to the signed-in user (the Google email may differ from theirs)."""
    owner = db.scalar(select(User).where(User.google_sub == claims["sub"]))
    if owner is not None and owner.id != user.id:
        raise Conflict("That Google account is already linked to another FinTrack account")
    user.google_sub = claims["sub"]


def unlink_google(db: Session, user: User) -> None:
    if not user.google_sub:
        raise Conflict("No Google account is linked")
    if not user.password_hash:
        raise Conflict("Set a password before disconnecting Google, or you will be locked out")
    user.google_sub = None
