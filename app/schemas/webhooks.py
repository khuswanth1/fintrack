from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from .common import ORMModel


def _check_events(v: list[str] | None) -> list[str] | None:
    from app.services.webhooks import EVENT_TYPES, WILDCARD

    if v is None:
        return v
    unknown = sorted(set(v) - set(EVENT_TYPES) - {WILDCARD})
    if unknown:
        raise ValueError(f"Unknown event type(s): {', '.join(unknown)}")
    if not v:
        raise ValueError("Subscribe to at least one event")
    return sorted(set(v))


def _check_url(v: str | None) -> str | None:
    from app.services.webhooks import UnsafeTarget, validate_url

    if v is None:
        return v
    try:
        return validate_url(v)
    except UnsafeTarget as exc:
        raise ValueError(exc.message) from None


class WebhookEndpointIn(BaseModel):
    url: str = Field(max_length=500)
    description: str = Field("", max_length=120)
    events: list[str] = Field(min_length=1, max_length=20)

    _url = field_validator("url")(_check_url)
    _events = field_validator("events")(_check_events)


class WebhookEndpointUpdate(BaseModel):
    url: str | None = Field(None, max_length=500)
    description: str | None = Field(None, max_length=120)
    events: list[str] | None = Field(None, max_length=20)
    is_active: bool | None = None

    _url = field_validator("url")(_check_url)
    _events = field_validator("events")(_check_events)


class WebhookEndpointOut(ORMModel):
    id: int
    url: str
    description: str
    events: list[str]
    is_active: bool
    consecutive_failures: int
    disabled_reason: str | None
    secret_hint: str
    created_at: datetime


class WebhookEndpointWithSecret(WebhookEndpointOut):
    secret: str = Field(description="Shown only once. Use it to verify the X-FinTrack-Signature header.")


class WebhookDeliveryOut(ORMModel):
    id: int
    event_id: str
    event_type: str
    status: str
    attempts: int
    response_status: int | None
    response_body: str | None
    error: str | None
    duration_ms: int | None
    next_attempt_at: datetime | None
    delivered_at: datetime | None
    created_at: datetime
    payload: dict


class WebhookEventType(BaseModel):
    type: str
    description: str
