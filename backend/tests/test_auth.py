from app.core import totp
from app.services import mailer
from tests.conftest import invite_and_login, register


def test_register_login_me_logout(client):
    h = register(client)
    me = client.get("/api/v1/users/me", headers=h).json()
    assert me["user"]["role"]["key"] == "owner"
    assert "settings.manage" in me["permissions"]
    assert client.post("/api/v1/auth/logout", headers=h).status_code == 200
    assert client.get("/api/v1/users/me", headers=h).status_code == 401  # session revoked


def test_bad_password_and_lockout(client):
    register(client)
    for _ in range(5):
        r = client.post("/api/v1/auth/login", json={"email": "owner@acme.io", "password": "wrong"})
        assert r.status_code == 401
    r = client.post("/api/v1/auth/login", json={"email": "owner@acme.io", "password": "Password123"})
    assert r.status_code == 401 and r.json()["error"]["code"] == "locked"


def test_refresh_rotation_and_reuse_detection(client):
    register(client)
    old = client.cookies.get("parley_rt")
    r = client.post("/api/v1/auth/refresh")
    assert r.status_code == 200
    new = client.cookies.get("parley_rt")
    assert new and new != old
    client.cookies.clear()
    client.cookies.set("parley_rt", old, path="/api/v1/auth")
    assert client.post("/api/v1/auth/refresh").status_code == 401  # reuse → family revoked
    client.cookies.clear()
    client.cookies.set("parley_rt", new, path="/api/v1/auth")
    assert client.post("/api/v1/auth/refresh").status_code == 401


def test_forgot_and_reset_password(client):
    register(client)
    assert client.post("/api/v1/auth/forgot-password", json={"email": "owner@acme.io"}).status_code == 200
    token = mailer.outbox[-1]["body"].split("token=")[1]
    assert client.post("/api/v1/auth/reset-password", json={"token": token, "password": "NewPassword456"}).status_code == 200
    assert client.post("/api/v1/auth/reset-password", json={"token": token, "password": "NewPassword789"}).status_code == 400
    assert client.post("/api/v1/auth/login", json={"email": "owner@acme.io", "password": "NewPassword456"}).status_code == 200


def test_weak_password_rejected(client):
    r = client.post("/api/v1/auth/register", json={"company": "Xco", "subdomain": "xco", "name": "X", "email": "x@x.io", "password": "aaaaaaaaaa"})
    assert r.status_code == 400


def test_mfa_flow(client):
    h = register(client)
    secret = client.post("/api/v1/users/me/mfa/setup", headers=h).json()["secret"]
    assert client.post("/api/v1/users/me/mfa/enable", headers=h, json={"code": totp.now_code(secret)}).status_code == 200
    r = client.post("/api/v1/auth/login", json={"email": "owner@acme.io", "password": "Password123"})
    assert r.json()["error"]["code"] == "mfa_required"
    r = client.post("/api/v1/auth/login", json={"email": "owner@acme.io", "password": "Password123", "otp": totp.now_code(secret)})
    assert r.status_code == 200


def test_agent_permissions_enforced(client, owner):
    agent_h, _ = invite_and_login(client, owner, "amy@acme.io")
    r = client.post("/api/v1/departments", headers=agent_h, json={"name": "Sales", "agent_ids": ["x"]})
    assert r.status_code == 403
    assert client.put("/api/v1/settings/routing", headers=agent_h, json={"mode": "assigned"}).status_code == 403
    assert client.get("/api/v1/settings/routing", headers=agent_h).status_code == 200


def test_cross_tenant_isolation(client, owner):
    other = register(client, sub="globex", email="owner@globex.io")
    me = client.get("/api/v1/users/me", headers=owner).json()["user"]
    dept = client.post("/api/v1/departments", headers=owner, json={"name": "Billing", "agent_ids": [me["id"]]}).json()
    assert client.get(f"/api/v1/departments/{dept['id']}", headers=other).status_code == 404
    assert client.patch(f"/api/v1/agents/{me['id']}", headers=other, json={"name": "pwned"}).status_code == 404
    assert client.get("/api/v1/agents", headers=other).json()["total"] == 1



