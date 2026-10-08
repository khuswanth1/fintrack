from fastapi import APIRouter, Query, Request
from sqlalchemy import func, select

from app.api.deps import DB, CurrentUser
from app.core.config import settings
from app.core.errors import AppError, NotFound
from app.models import WebhookDelivery, WebhookEndpoint
from app.schemas.common import Page
from app.schemas.webhooks import (
    WebhookDeliveryOut,
    WebhookEndpointIn,
    WebhookEndpointOut,
    WebhookEndpointUpdate,
    WebhookEndpointWithSecret,
    WebhookEventType,
)
from app.services import audit
from app.services import webhooks as svc
from app.services.common import get_owned

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


def _delivery(db, endpoint: WebhookEndpoint, delivery_id: int) -> WebhookDelivery:
    d = db.scalar(select(WebhookDelivery).where(WebhookDelivery.id == delivery_id,
                                                WebhookDelivery.endpoint_id == endpoint.id))
    if d is None:
        raise NotFound("Delivery not found")
    return d


@router.get("/events", response_model=list[WebhookEventType])
def list_event_types():
    """Events you can subscribe to. Use `"*"` to receive all of them."""
    return [WebhookEventType(type=t, description=d) for t, d in svc.EVENT_TYPES.items()]


@router.get("", response_model=list[WebhookEndpointOut])
def list_endpoints(user: CurrentUser, db: DB):
    return db.scalars(select(WebhookEndpoint).where(WebhookEndpoint.user_id == user.id).order_by(WebhookEndpoint.id)).all()


@router.post("", response_model=WebhookEndpointWithSecret, status_code=201)
def create_endpoint(body: WebhookEndpointIn, user: CurrentUser, db: DB, request: Request):
    count = db.scalar(select(func.count()).where(WebhookEndpoint.user_id == user.id))
    if count >= settings.webhook_max_endpoints_per_user:
        raise AppError(f"You can register at most {settings.webhook_max_endpoints_per_user} webhook endpoints",
                       code="limit_reached")
    ep = WebhookEndpoint(user_id=user.id, url=body.url, description=body.description, events=body.events,
                         secret=svc.generate_secret(), is_active=True, consecutive_failures=0)
    db.add(ep)
    db.flush()
    audit.record(db, user.id, "webhook.create", entity_type="webhook", entity_id=ep.id, request=request,
                 details={"url": ep.url, "events": ep.events})
    db.commit()
    return WebhookEndpointWithSecret.model_validate(ep, from_attributes=True)


@router.get("/{endpoint_id}", response_model=WebhookEndpointOut)
def get_endpoint(endpoint_id: int, user: CurrentUser, db: DB):
    return get_owned(db, WebhookEndpoint, endpoint_id, user.id, "Webhook endpoint")


@router.patch("/{endpoint_id}", response_model=WebhookEndpointOut)
def update_endpoint(endpoint_id: int, body: WebhookEndpointUpdate, user: CurrentUser, db: DB, request: Request):
    ep = get_owned(db, WebhookEndpoint, endpoint_id, user.id, "Webhook endpoint")
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    for k, v in changes.items():
        setattr(ep, k, v)
    if changes.get("is_active"):  # re-enabling gives the endpoint a clean slate
        ep.consecutive_failures, ep.disabled_reason = 0, None
    audit.record(db, user.id, "webhook.update", entity_type="webhook", entity_id=ep.id, request=request,
                 details={"fields": sorted(changes)})
    db.commit()
    return ep


@router.delete("/{endpoint_id}", status_code=204)
def delete_endpoint(endpoint_id: int, user: CurrentUser, db: DB, request: Request):
    ep = get_owned(db, WebhookEndpoint, endpoint_id, user.id, "Webhook endpoint")
    db.delete(ep)
    audit.record(db, user.id, "webhook.delete", entity_type="webhook", entity_id=endpoint_id, request=request)
    db.commit()


@router.post("/{endpoint_id}/rotate-secret", response_model=WebhookEndpointWithSecret)
def rotate_secret(endpoint_id: int, user: CurrentUser, db: DB, request: Request):
    """Issue a new signing secret. The old one stops working immediately."""
    ep = get_owned(db, WebhookEndpoint, endpoint_id, user.id, "Webhook endpoint")
    ep.secret = svc.generate_secret()
    audit.record(db, user.id, "webhook.rotate_secret", entity_type="webhook", entity_id=ep.id, request=request)
    db.commit()
    return WebhookEndpointWithSecret.model_validate(ep, from_attributes=True)


@router.post("/{endpoint_id}/test", response_model=WebhookDeliveryOut, status_code=202)
def send_test_event(endpoint_id: int, user: CurrentUser, db: DB):
    """Send a signed `webhook.test` event. Poll the deliveries list for the outcome."""
    ep = get_owned(db, WebhookEndpoint, endpoint_id, user.id, "Webhook endpoint")
    delivery = svc.send_test(db, ep)
    db.commit()
    db.refresh(delivery)
    return delivery


@router.get("/{endpoint_id}/deliveries", response_model=Page[WebhookDeliveryOut])
def list_deliveries(endpoint_id: int, user: CurrentUser, db: DB, status: str | None = None,
                    page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100)):
    ep = get_owned(db, WebhookEndpoint, endpoint_id, user.id, "Webhook endpoint")
    q = select(WebhookDelivery).where(WebhookDelivery.endpoint_id == ep.id)
    if status:
        q = q.where(WebhookDelivery.status == status)
    total = db.scalar(select(func.count()).select_from(q.subquery()))
    items = db.scalars(q.order_by(WebhookDelivery.created_at.desc(), WebhookDelivery.id.desc())
                       .offset((page - 1) * size).limit(size)).all()
    return Page.build(items, total, page, size)


@router.post("/{endpoint_id}/deliveries/{delivery_id}/redeliver", response_model=WebhookDeliveryOut, status_code=202)
def redeliver(endpoint_id: int, delivery_id: int, user: CurrentUser, db: DB):
    ep = get_owned(db, WebhookEndpoint, endpoint_id, user.id, "Webhook endpoint")
    new = svc.redeliver(db, _delivery(db, ep, delivery_id))
    db.commit()
    db.refresh(new)
    return new
