from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Request, Response

from app.api.deps import DB, CurrentUser
from app.core.config import settings
from app.core.errors import Unauthorized
from app.core.rate_limit import limit
from app.schemas.auth import GoogleLoginIn, GoogleTokenOut, LoginIn, RefreshIn, RegisterIn, TokenOut, UserOut
from app.services import audit, google_auth
from app.services import auth as svc

router = APIRouter(prefix="/auth", tags=["auth"])


def _set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(settings.refresh_cookie_name, token, httponly=True, secure=settings.cookie_secure,
                        samesite="strict", max_age=settings.refresh_token_ttl_days * 86400,
                        path=f"{settings.api_prefix}/auth")


def _token_response(response: Response, access: str, refresh: str) -> TokenOut:
    _set_refresh_cookie(response, refresh)
    return TokenOut(access_token=access, refresh_token=refresh, expires_in=settings.access_token_ttl_minutes * 60)


@router.get("/providers")
def providers():
    """Sign-in methods this server supports. The Google client id is public by design."""
    return {"password": True,
            "google": {"enabled": google_auth.is_enabled(), "client_id": settings.google_client_id or None}}


@router.post("/register", response_model=UserOut, status_code=201, dependencies=[Depends(limit("register", 5))])
def register(body: RegisterIn, db: DB, request: Request):
    user = svc.register_user(db, body.email, body.password, body.full_name)
    audit.record(db, user.id, "auth.register", entity_type="user", entity_id=user.id, request=request)
    db.commit()
    return user


@router.post("/login", response_model=TokenOut, dependencies=[Depends(limit("login"))])
def login(body: LoginIn, db: DB, request: Request, response: Response):
    try:
        user = svc.authenticate(db, body.email, body.password)
    except Unauthorized:
        audit.record(db, None, "auth.login_failed", request=request, details={"email": body.email.lower()})
        db.commit()
        raise
    access, refresh = svc.issue_tokens(db, user, request.headers.get("user-agent", ""))
    user.last_login_at = datetime.now(UTC)
    audit.record(db, user.id, "auth.login", entity_type="user", entity_id=user.id, request=request)
    db.commit()
    return _token_response(response, access, refresh)


@router.post("/google", response_model=GoogleTokenOut, dependencies=[Depends(limit("google"))])
def google_login(body: GoogleLoginIn, db: DB, request: Request, response: Response):
    """Sign in **or sign up** with a Google ID token from Google Identity Services. New users are created on
    first use; an existing account with the same verified email is linked to the Google account."""
    claims = google_auth.verify_id_token(body.credential)
    user, created = svc.login_with_google(db, claims)
    access, refresh = svc.issue_tokens(db, user, request.headers.get("user-agent", ""))
    user.last_login_at = datetime.now(UTC)
    audit.record(db, user.id, "auth.register" if created else "auth.login", entity_type="user", entity_id=user.id,
                 request=request, details={"method": "google"})
    db.commit()
    tokens = _token_response(response, access, refresh)
    return GoogleTokenOut(**tokens.model_dump(), is_new_user=created)


@router.post("/refresh", response_model=TokenOut, dependencies=[Depends(limit("refresh", 30))])
def refresh(db: DB, request: Request, response: Response, body: RefreshIn | None = None):
    token = (body.refresh_token if body else None) or request.cookies.get(settings.refresh_cookie_name)
    if not token:
        raise Unauthorized("No refresh token")
    _, access, new_refresh = svc.rotate_refresh(db, token, request.headers.get("user-agent", ""))
    db.commit()
    return _token_response(response, access, new_refresh)


@router.post("/logout", status_code=204)
def logout(db: DB, request: Request, response: Response, body: RefreshIn | None = None):
    token = (body.refresh_token if body else None) or request.cookies.get(settings.refresh_cookie_name)
    if token:
        svc.revoke_refresh(db, token)
        db.commit()
    response.delete_cookie(settings.refresh_cookie_name, path=f"{settings.api_prefix}/auth")
    response.status_code = 204
    return response


@router.post("/logout-all", status_code=204)
def logout_all(user: CurrentUser, db: DB, request: Request, response: Response):
    svc.revoke_all(db, user.id)
    audit.record(db, user.id, "auth.logout_all", request=request)
    db.commit()
    response.delete_cookie(settings.refresh_cookie_name, path=f"{settings.api_prefix}/auth")
    response.status_code = 204
    return response
