import re
from datetime import datetime

# pyrefly: ignore [missing-import]
from pydantic import BaseModel, EmailStr, Field, field_validator

from .common import ORMModel

CURRENCY_RE = re.compile(r"^[A-Z]{3}$")


def _strong_password(v: str) -> str:
    if not (re.search(r"[A-Za-z]", v) and re.search(r"\d", v)):
        raise ValueError("Password must contain at least one letter and one digit")
    return v


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field("", max_length=120)

    _pw = field_validator("password")(_strong_password)

    @field_validator("email")
    @classmethod
    def lower_email(cls, v: str) -> str:
        return v.lower()


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class GoogleLoginIn(BaseModel):
    credential: str = Field(min_length=20, max_length=4096, description="ID token from Google Identity Services")


class RefreshIn(BaseModel):
    refresh_token: str | None = None


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    refresh_token: str | None = None  # for non-browser clients; browsers use the httpOnly cookie


class GoogleTokenOut(TokenOut):
    is_new_user: bool = False


class UserOut(ORMModel):
    id: int
    email: str
    full_name: str
    role: str
    is_active: bool
    currency: str
    created_at: datetime
    last_login_at: datetime | None = None
    has_password: bool = True
    google_linked: bool = False


class UserUpdate(BaseModel):
    full_name: str | None = Field(None, max_length=120)
    currency: str | None = None

    @field_validator("currency")
    @classmethod
    def valid_currency(cls, v):
        if v is not None and not CURRENCY_RE.match(v):
            raise ValueError("Currency must be a 3-letter ISO code, e.g. USD")
        return v


class PasswordChange(BaseModel):
    # Optional only for Google-created accounts setting their first password; enforced in the service.
    current_password: str | None = Field(None, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)

    _pw = field_validator("new_password")(_strong_password)


class AdminUserUpdate(BaseModel):
    role: str | None = Field(None, pattern="^(user|admin)$")
    is_active: bool | None = None
