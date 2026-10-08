from typing import Literal

from fastapi import APIRouter, Request
from sqlalchemy import func, select

from app.api.deps import DB, CurrentUser, commit_and_invalidate
from app.core.errors import Conflict
from app.models import Category
from app.schemas.finance import CategoryIn, CategoryOut, CategoryUpdate
from app.services import audit
from app.services.common import get_owned

router = APIRouter(prefix="/categories", tags=["categories"])


def _ensure_unique(db, user_id: int, name: str, kind: str, exclude_id: int | None = None):
    q = select(Category.id).where(Category.user_id == user_id, Category.kind == kind,
                                  func.lower(Category.name) == name.lower())
    if exclude_id:
        q = q.where(Category.id != exclude_id)
    if db.scalar(q):
        raise Conflict(f"A {kind} category named '{name}' already exists")


@router.get("", response_model=list[CategoryOut])
def list_categories(user: CurrentUser, db: DB, kind: Literal["income", "expense"] | None = None):
    q = select(Category).where(Category.user_id == user.id).order_by(Category.kind, Category.name)
    if kind:
        q = q.where(Category.kind == kind)
    return db.scalars(q).all()


@router.post("", response_model=CategoryOut, status_code=201)
def create_category(body: CategoryIn, user: CurrentUser, db: DB, request: Request):
    _ensure_unique(db, user.id, body.name, body.kind)
    c = Category(user_id=user.id, **body.model_dump())
    db.add(c)
    db.flush()
    audit.record(db, user.id, "category.create", entity_type="category", entity_id=c.id, request=request)
    db.commit()
    return c


@router.patch("/{category_id}", response_model=CategoryOut)
def update_category(category_id: int, body: CategoryUpdate, user: CurrentUser, db: DB, request: Request):
    c = get_owned(db, Category, category_id, user.id, "Category")
    data = body.model_dump(exclude_unset=True, exclude_none=True)
    if "name" in data:
        _ensure_unique(db, user.id, data["name"], c.kind, exclude_id=c.id)
    for k, v in data.items():
        setattr(c, k, v)
    audit.record(db, user.id, "category.update", entity_type="category", entity_id=c.id, request=request)
    commit_and_invalidate(db, user.id)
    return c


@router.delete("/{category_id}", status_code=204)
def delete_category(category_id: int, user: CurrentUser, db: DB, request: Request):
    c = get_owned(db, Category, category_id, user.id, "Category")
    db.delete(c)  # transactions keep their data with category set to NULL; budgets on it are removed
    audit.record(db, user.id, "category.delete", entity_type="category", entity_id=category_id, request=request)
    commit_and_invalidate(db, user.id)
