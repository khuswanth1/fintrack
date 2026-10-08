import hashlib
import hmac
import os
import uuid
from datetime import UTC, datetime, timedelta

import jwt

from .config import settings
from .errors import Unauthorized

# scrypt parameters are stored with each hash so they can be raised later without breaking old hashes.
_SCRYPT_N, _SCRYPT_R, _SCRYPT_P = 2**14, 8, 1


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, dklen=64)
    return f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt, digest = stored.split("$")
        if algo != "scrypt":
            return False
        candidate = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p),
                                   dklen=len(digest) // 2)
        return hmac.compare_digest(candidate.hex(), digest)
    except (ValueError, TypeError):
        return False


# A precomputed hash lets login spend the same time whether or not the email exists.
DUMMY_HASH = hash_password(uuid.uuid4().hex)


def _encode(claims: dict, ttl: timedelta) -> str:
    now = datetime.now(UTC)
    payload = {**claims, "iat": now, "nbf": now, "exp": now + ttl, "iss": settings.jwt_issuer, "aud": settings.jwt_audience}
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def create_access_token(user_id: int, role: str) -> str:
    return _encode({"sub": str(user_id), "role": role, "type": "access"},
                   timedelta(minutes=settings.access_token_ttl_minutes))


def create_refresh_token(user_id: int, jti: str) -> str:
    return _encode({"sub": str(user_id), "type": "refresh", "jti": jti}, timedelta(days=settings.refresh_token_ttl_days))


def decode_token(token: str, expected_type: str) -> dict:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm],
                             audience=settings.jwt_audience, issuer=settings.jwt_issuer,
                             options={"require": ["exp", "sub", "type"]})
    except jwt.ExpiredSignatureError:
        raise Unauthorized("Token expired", code="token_expired") from None
    except jwt.PyJWTError:
        raise Unauthorized("Invalid token") from None
    if payload.get("type") != expected_type:
        raise Unauthorized("Invalid token type")
    return payload


def hash_token_id(jti: str) -> str:
    """Refresh token ids are stored hashed so a DB leak cannot be replayed."""
    return hashlib.sha256(jti.encode()).hexdigest()
