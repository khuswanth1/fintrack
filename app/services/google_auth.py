"""Verifies Google Identity Services ID tokens ("Sign in with Google").

The browser obtains a signed JWT from Google and posts it to us; we check its signature against Google's
published keys and validate audience, issuer, expiry and email verification. No Google client secret is
needed for this flow."""
import jwt

from app.core.config import settings
from app.core.errors import AppError, Unauthorized

GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_ISSUERS = ("accounts.google.com", "https://accounts.google.com")

# Keys are cached in-process and refetched when Google rotates them (unknown `kid`).
_jwks = jwt.PyJWKClient(GOOGLE_CERTS_URL, cache_keys=True, lifespan=3600, timeout=10)


class GoogleUnavailable(AppError):
    status_code, code = 503, "google_unavailable"


def is_enabled() -> bool:
    return bool(settings.google_client_id)


def verify_id_token(credential: str) -> dict:
    if not is_enabled():
        raise AppError("Google sign-in is not configured on this server", status_code=404,
                       code="google_not_configured")
    try:
        signing_key = _jwks.get_signing_key_from_jwt(credential)
        claims = jwt.decode(credential, signing_key.key, algorithms=["RS256"], audience=settings.google_client_id,
                            leeway=30, options={"require": ["exp", "iat", "iss", "sub", "aud"]})
    except jwt.PyJWKClientConnectionError:
        raise GoogleUnavailable("Could not reach Google to verify the sign-in. Please try again.") from None
    except jwt.PyJWTError:
        raise Unauthorized("Invalid or expired Google sign-in", code="invalid_google_token") from None
    if claims.get("iss") not in GOOGLE_ISSUERS:
        raise Unauthorized("Invalid Google token issuer", code="invalid_google_token")
    if not claims.get("email") or claims.get("email_verified") is not True:
        raise Unauthorized("Your Google account email is not verified", code="google_email_unverified")
    return claims
