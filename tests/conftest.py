import os
import tempfile

# Configure before the app is imported. CI points TEST_DATABASE_URL at a real PostgreSQL service.
_db_file = os.path.join(tempfile.gettempdir(), "fintrack_test.db")
os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL", f"sqlite:///{_db_file}")
os.environ.update({"ENVIRONMENT": "test", "CACHE_BACKEND": "memory", "LLM_API_KEY": "",
                   "RATE_LIMIT_PER_MINUTE": "100000", "AUTH_RATE_LIMIT_PER_MINUTE": "100000",
                   "SECRET_KEY": "test-secret-key-that-is-long-enough-123456",
                   "WEBHOOK_DISPATCH": "inline", "GOOGLE_CLIENT_ID": ""})

import itertools  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.core.cache import cache  # noqa: E402
from app.core.database import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import User  # noqa: E402

API = "/api/v1"
_counter = itertools.count()


@pytest.fixture(autouse=True)
def fresh_db():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    cache.clear()
    yield


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def db():
    with SessionLocal() as s:
        yield s


def make_user(client, role="user", password="password123"):
    email = f"user{next(_counter)}@example.com"
    r = client.post(f"{API}/auth/register", json={"email": email, "password": password, "full_name": "Test User"})
    assert r.status_code == 201, r.text
    if role != "user":
        with SessionLocal() as s:
            u = s.get(User, r.json()["id"])
            u.role = role
            s.commit()
    tokens = client.post(f"{API}/auth/login", json={"email": email, "password": password}).json()
    return {"Authorization": f"Bearer {tokens['access_token']}", "_email": email, "_refresh": tokens["refresh_token"],
            "_id": r.json()["id"]}


def h(user: dict) -> dict:
    return {"Authorization": user["Authorization"]}


@pytest.fixture
def user(client):
    return make_user(client)


@pytest.fixture
def admin(client):
    return make_user(client, role="admin")


def category_id(client, user, name, kind="expense"):
    cats = client.get(f"{API}/categories", headers=h(user)).json()
    return next(c["id"] for c in cats if c["name"] == name and c["kind"] == kind)
