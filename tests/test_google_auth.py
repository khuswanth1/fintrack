import time
from types import SimpleNamespace

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app.core.config import settings
from app.services import google_auth

from .conftest import API, h, make_user

CLIENT_ID = "test-client.apps.googleusercontent.com"
_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture(autouse=True)
def google_enabled(monkeypatch):
    monkeypatch.setattr(settings, "google_client_id", CLIENT_ID)
    # Stand in for Google's JWKS endpoint: our test key plays the role of Google's signing key.
    monkeypatch.setattr(google_auth._jwks, "get_signing_key_from_jwt",
                        lambda token: SimpleNamespace(key=_key.public_key()))


def google_token(sub="google-123", email="alice@gmail.com", **overrides):
    now = int(time.time())
    claims = {"iss": "https://accounts.google.com", "aud": CLIENT_ID, "sub": sub, "email": email,
              "email_verified": True, "name": "Alice Example", "iat": now, "exp": now + 600, **overrides}
    return jwt.encode(claims, _key, algorithm="RS256", headers={"kid": "test"})


def google_login(client, token):
    return client.post(f"{API}/auth/google", json={"credential": token})


def bearer(r):
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_providers_reports_google_configuration(client, monkeypatch):
    assert client.get(f"{API}/auth/providers").json()["google"] == {"enabled": True, "client_id": CLIENT_ID}
    monkeypatch.setattr(settings, "google_client_id", "")
    assert client.get(f"{API}/auth/providers").json()["google"]["enabled"] is False
    r = google_login(client, google_token())
    assert r.status_code == 404 and r.json()["error"]["code"] == "google_not_configured"


def test_google_sign_up_then_sign_in(client):
    r = google_login(client, google_token())
    assert r.status_code == 200, r.text
    assert r.json()["is_new_user"] is True
    me = client.get(f"{API}/users/me", headers=bearer(r)).json()
    assert me["email"] == "alice@gmail.com" and me["full_name"] == "Alice Example"
    assert me["google_linked"] is True and me["has_password"] is False
    assert client.get(f"{API}/categories", headers=bearer(r)).json(), "default categories are created"

    again = google_login(client, google_token())
    assert again.json()["is_new_user"] is False
    assert client.get(f"{API}/users/me", headers=bearer(again)).json()["id"] == me["id"]


def test_google_sub_wins_even_if_email_changes(client):
    first = google_login(client, google_token(email="old@gmail.com"))
    second = google_login(client, google_token(email="new@gmail.com"))
    assert second.json()["is_new_user"] is False
    assert (client.get(f"{API}/users/me", headers=bearer(first)).json()["id"]
            == client.get(f"{API}/users/me", headers=bearer(second)).json()["id"])


def test_google_links_existing_password_account(client):
    u = make_user(client)
    r = google_login(client, google_token(email=u["_email"].upper()))
    assert r.status_code == 200 and r.json()["is_new_user"] is False
    me = client.get(f"{API}/users/me", headers=bearer(r)).json()
    assert me["id"] == u["_id"] and me["google_linked"] and me["has_password"]
    # Password login keeps working after linking.
    assert client.post(f"{API}/auth/login", json={"email": u["_email"], "password": "password123"}).status_code == 200


def test_email_linked_to_other_google_account_is_rejected(client):
    google_login(client, google_token(sub="one", email="shared@gmail.com"))
    r = google_login(client, google_token(sub="two", email="shared@gmail.com"))
    assert r.status_code == 409


@pytest.mark.parametrize("overrides", [
    {"aud": "someone-elses-client"},
    {"iss": "https://evil.example.com"},
    {"email_verified": False},
    {"exp": int(time.time()) - 3600},
])
def test_invalid_google_tokens_are_rejected(client, overrides):
    r = google_login(client, google_token(**overrides))
    assert r.status_code == 401, r.text


def test_forged_signature_is_rejected(client):
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    now = int(time.time())
    forged = jwt.encode({"iss": "accounts.google.com", "aud": CLIENT_ID, "sub": "x", "email": "x@gmail.com",
                         "email_verified": True, "iat": now, "exp": now + 600}, other, algorithm="RS256")
    assert google_login(client, forged).status_code == 401


def test_google_only_account_password_lifecycle(client):
    r = google_login(client, google_token())
    auth = bearer(r)
    # No password yet: password login is impossible, even with an empty-looking guess.
    assert client.post(f"{API}/auth/login", json={"email": "alice@gmail.com", "password": "x"}).status_code == 401
    # Can't disconnect Google without a fallback sign-in method.
    assert client.delete(f"{API}/users/me/google", headers=auth).status_code == 409
    # Setting a first password needs no current password.
    assert client.post(f"{API}/users/me/password", headers=auth, json={"new_password": "newpass123"}).status_code == 200
    login = client.post(f"{API}/auth/login", json={"email": "alice@gmail.com", "password": "newpass123"})
    assert login.status_code == 200
    auth = bearer(login)
    # Now a current password is required to change it.
    r = client.post(f"{API}/users/me/password", headers=auth, json={"new_password": "another123"})
    assert r.status_code == 401
    r = client.delete(f"{API}/users/me/google", headers=auth)
    assert r.status_code == 200 and r.json()["google_linked"] is False


def test_password_user_change_still_requires_current_password(client, user):
    r = client.post(f"{API}/users/me/password", headers=h(user), json={"new_password": "newpass123"})
    assert r.status_code == 401


def test_signed_in_user_can_link_google(client, user):
    r = client.post(f"{API}/users/me/google", headers=h(user), json={"credential": google_token(email="work@gmail.com")})
    assert r.status_code == 200 and r.json()["google_linked"] is True
    # The linked Google account now signs into the same FinTrack account.
    login = google_login(client, google_token(email="work@gmail.com"))
    assert client.get(f"{API}/users/me", headers=bearer(login)).json()["id"] == user["_id"]
    # ...and cannot be linked to anyone else.
    other = make_user(client)
    r = client.post(f"{API}/users/me/google", headers=h(other), json={"credential": google_token(email="work@gmail.com")})
    assert r.status_code == 409
