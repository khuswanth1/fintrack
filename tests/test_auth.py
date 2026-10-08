from app.core.config import settings

from .conftest import API, h, make_user


def test_register_validates_password_and_email(client):
    r = client.post(f"{API}/auth/register", json={"email": "bad", "password": "password123"})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "validation_error"
    r = client.post(f"{API}/auth/register", json={"email": "a@example.com", "password": "onlyletters"})
    assert r.status_code == 422


def test_register_duplicate_email_is_case_insensitive(client):
    assert client.post(f"{API}/auth/register", json={"email": "Dup@Example.com", "password": "password123"}).status_code == 201
    r = client.post(f"{API}/auth/register", json={"email": "dup@example.com", "password": "password123"})
    assert r.status_code == 409


def test_register_creates_default_categories(client, user):
    cats = client.get(f"{API}/categories", headers=h(user)).json()
    assert {"Salary", "Groceries"} <= {c["name"] for c in cats}


def test_login_wrong_password(client, user):
    r = client.post(f"{API}/auth/login", json={"email": user["_email"], "password": "wrong-pass1"})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "invalid_credentials"


def test_protected_route_requires_token(client):
    r = client.get(f"{API}/users/me")
    assert r.status_code == 401
    assert client.get(f"{API}/users/me", headers={"Authorization": "Bearer garbage"}).status_code == 401


def test_refresh_token_cannot_be_used_as_access_token(client, user):
    r = client.get(f"{API}/users/me", headers={"Authorization": f"Bearer {user['_refresh']}"})
    assert r.status_code == 401


def test_refresh_rotation_and_reuse_detection(client, user):
    first = user["_refresh"]
    r = client.post(f"{API}/auth/refresh", json={"refresh_token": first})
    assert r.status_code == 200
    second = r.json()["refresh_token"]
    assert second != first
    # Replaying the rotated token revokes every session, including the new one.
    r = client.post(f"{API}/auth/refresh", json={"refresh_token": first})
    assert r.status_code == 401 and r.json()["error"]["code"] == "token_reused"
    assert client.post(f"{API}/auth/refresh", json={"refresh_token": second}).status_code == 401


def test_refresh_via_httponly_cookie(client):
    u = make_user(client)
    assert settings.refresh_cookie_name in client.cookies
    r = client.post(f"{API}/auth/refresh")
    assert r.status_code == 200, r.text
    assert client.get(f"{API}/users/me", headers={"Authorization": f"Bearer {r.json()['access_token']}"}).json()["email"] == u["_email"]


def test_logout_revokes_refresh_token(client, user):
    assert client.post(f"{API}/auth/logout", json={"refresh_token": user["_refresh"]}).status_code == 204
    assert client.post(f"{API}/auth/refresh", json={"refresh_token": user["_refresh"]}).status_code == 401


def test_profile_update_and_password_change(client, user):
    r = client.patch(f"{API}/users/me", json={"full_name": "New Name", "currency": "EUR"}, headers=h(user))
    assert r.status_code == 200 and r.json()["currency"] == "EUR"
    assert client.patch(f"{API}/users/me", json={"currency": "euro"}, headers=h(user)).status_code == 422
    r = client.post(f"{API}/users/me/password", json={"current_password": "nope12345", "new_password": "newpass123"},
                    headers=h(user))
    assert r.status_code == 401
    r = client.post(f"{API}/users/me/password", json={"current_password": "password123", "new_password": "newpass123"},
                    headers=h(user))
    assert r.status_code == 200
    assert client.post(f"{API}/auth/login", json={"email": user["_email"], "password": "newpass123"}).status_code == 200


def test_auth_rate_limit(client, monkeypatch):
    monkeypatch.setattr(settings, "auth_rate_limit_per_minute", 3)
    codes = [client.post(f"{API}/auth/login", json={"email": "x@example.com", "password": "whatever1"}).status_code
             for _ in range(5)]
    assert codes[:3] == [401, 401, 401] and codes[-1] == 429


def test_security_headers_and_request_id(client):
    r = client.get("/health", headers={"X-Request-ID": "abc123"})
    assert r.headers["X-Request-ID"] == "abc123"
    assert r.headers["X-Content-Type-Options"] == "nosniff"
