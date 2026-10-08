from fastapi import APIRouter, Request

from app.api.deps import DB, CurrentUser
from app.schemas.auth import GoogleLoginIn, PasswordChange, UserOut, UserUpdate
from app.schemas.common import Message
from app.services import audit, google_auth
from app.services import auth as auth_svc

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserOut)
def me(user: CurrentUser):
    return user


@router.patch("/me", response_model=UserOut)
def update_me(body: UserUpdate, user: CurrentUser, db: DB, request: Request):
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    for k, v in changes.items():
        setattr(user, k, v)
    audit.record(db, user.id, "user.update", entity_type="user", entity_id=user.id, request=request,
                 details={"fields": sorted(changes)})
    db.commit()
    return user


@router.post("/me/password", response_model=Message)
def change_password(body: PasswordChange, user: CurrentUser, db: DB, request: Request):
    auth_svc.change_password(db, user, body.current_password, body.new_password)
    audit.record(db, user.id, "user.password_change", entity_type="user", entity_id=user.id, request=request)
    db.commit()
    return Message(message="Password updated. Other sessions have been signed out.")


@router.post("/me/google", response_model=UserOut)
def link_google(body: GoogleLoginIn, user: CurrentUser, db: DB, request: Request):
    auth_svc.link_google(db, user, google_auth.verify_id_token(body.credential))
    audit.record(db, user.id, "user.google_link", entity_type="user", entity_id=user.id, request=request)
    db.commit()
    return user


@router.delete("/me/google", response_model=UserOut)
def unlink_google(user: CurrentUser, db: DB, request: Request):
    auth_svc.unlink_google(db, user)
    audit.record(db, user.id, "user.google_unlink", entity_type="user", entity_id=user.id, request=request)
    db.commit()
    return user
