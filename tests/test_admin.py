from .conftest import API, h, make_user


def test_admin_endpoints_forbidden_for_users(client, user):
    for path in ("/admin/users", "/admin/audit-logs", "/admin/stats"):
        r = client.get(f"{API}{path}", headers=h(user))
        assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden"


def test_admin_lists_users_and_audit_logs(client, admin, user):
    users = client.get(f"{API}/admin/users", headers=h(admin)).json()
    assert users["total"] == 2
    logs = client.get(f"{API}/admin/audit-logs", params={"action": "auth.login"}, headers=h(admin)).json()
    assert logs["total"] >= 2 and all(e["action"].startswith("auth.login") for e in logs["items"])
    assert client.get(f"{API}/admin/stats", headers=h(admin)).json()["users"] == 2


def test_failed_login_is_audited(client, admin, user):
    client.post(f"{API}/auth/login", json={"email": user["_email"], "password": "wrong1234"})
    logs = client.get(f"{API}/admin/audit-logs", params={"action": "auth.login_failed"}, headers=h(admin)).json()
    assert logs["total"] == 1 and logs["items"][0]["details"]["email"] == user["_email"]


def test_admin_can_deactivate_user_and_revoke_sessions(client, admin):
    target = make_user(client)
    r = client.patch(f"{API}/admin/users/{target['_id']}", json={"is_active": False}, headers=h(admin))
    assert r.status_code == 200 and r.json()["is_active"] is False
    assert client.get(f"{API}/users/me", headers=h(target)).status_code == 401
    assert client.post(f"{API}/auth/refresh", json={"refresh_token": target["_refresh"]}).status_code == 401
    r = client.post(f"{API}/auth/login", json={"email": target["_email"], "password": "password123"})
    assert r.status_code == 403


def test_admin_cannot_modify_self_and_role_is_validated(client, admin):
    assert client.patch(f"{API}/admin/users/{admin['_id']}", json={"role": "user"}, headers=h(admin)).status_code == 403
    other = make_user(client)
    assert client.patch(f"{API}/admin/users/{other['_id']}", json={"role": "superuser"}, headers=h(admin)).status_code == 422
    r = client.patch(f"{API}/admin/users/{other['_id']}", json={"role": "admin"}, headers=h(admin))
    assert r.json()["role"] == "admin"
    # Role is read from the database on every request, so promotion takes effect immediately.
    assert client.get(f"{API}/admin/stats", headers=h(other)).status_code == 200
