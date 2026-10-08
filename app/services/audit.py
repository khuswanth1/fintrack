from fastapi import Request
from sqlalchemy.orm import Session

from app.core.rate_limit import client_ip
from app.models import AuditLog


def record(db: Session, user_id: int | None, action: str, *, entity_type: str | None = None,
           entity_id: int | None = None, request: Request | None = None, details: dict | None = None) -> None:
    """Adds an audit row to the current unit of work; it commits together with the change it describes."""
    db.add(AuditLog(user_id=user_id, action=action, entity_type=entity_type, entity_id=entity_id,
                    ip_address=client_ip(request) if request else None, details=details))
