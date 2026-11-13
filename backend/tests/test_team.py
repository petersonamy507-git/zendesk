from tests.conftest import invite_and_login


def _me(client, h):
    return client.get("/api/v1/users/me", headers=h).json()


def test_department_crud_and_limit(client, owner):
    me = _me(client, owner)["user"]
    r = client.post("/api/v1/departments", headers=owner, json={"name": "Sales", "description": "Pre-sales", "agent_ids": [me["id"]]})
    assert r.status_code == 201
    d = r.json()
    assert d["agent_ids"] == [me["id"]]
    assert client.post("/api/v1/departments", headers=owner, json={"name": "NoAgents", "agent_ids": []}).status_code == 422
    r = client.patch(f"/api/v1/departments/{d['id']}", headers=owner, json={"enabled": False})
    assert r.json()["enabled"] is False
    lst = client.get("/api/v1/departments?q=sal", headers=owner).json()
    assert lst["total"] == 1 and lst["enabled_count"] == 0
    assert client.delete(f"/api/v1/departments/{d['id']}", headers=owner).status_code == 200


def test_agent_invite_update_and_plan_limit(client, owner):
    from app.core.db import SessionLocal
    from app.models import Account

    agent_h, _ = invite_and_login(client, owner, "bob@acme.io")
    agents = client.get("/api/v1/agents", headers=owner).json()
    assert agents["total"] == 2
    bob = next(a for a in agents["items"] if a["email"] == "bob@acme.io")
    r = client.patch(f"/api/v1/agents/{bob['id']}", headers=owner, json={"chat_limit": 4, "display_name": "Bobby"})
    assert r.json()["chat_limit"] == 4
    with SessionLocal() as db:
        db.query(Account).update({"max_agents": 2})
        db.commit()
    roles = client.get("/api/v1/roles", headers=owner).json()
    agent_role = next(r["id"] for r in roles if r["key"] == "agent")
    r = client.post("/api/v1/agents", headers=owner, json={"email": "c@acme.io", "name": "C", "role_id": agent_role})
    assert r.status_code == 409 and r.json()["error"]["code"] == "plan_limit"
    # deactivated agent loses access
    client.patch(f"/api/v1/agents/{bob['id']}", headers=owner, json={"enabled": False})
    assert client.get("/api/v1/users/me", headers=agent_h).status_code == 401


def test_settings_sections_persist_and_reset(client, owner):
    r = client.put("/api/v1/settings/routing", headers=owner, json={"mode": "assigned", "max_chats": 5, "bogus": 1})
    assert r.json()["mode"] == "assigned" and "bogus" not in r.json()
    assert client.get("/api/v1/settings/routing", headers=owner).json()["max_chats"] == 5
    assert client.post("/api/v1/settings/routing/reset", headers=owner).json()["mode"] == "broadcast"
    assert client.get("/api/v1/settings/nope", headers=owner).status_code == 404


def test_custom_role(client, owner):
    r = client.post("/api/v1/roles", headers=owner, json={"name": "Reviewer", "permissions": ["reports.view", "chats.view_all"]})
    assert r.status_code == 201
    assert client.post("/api/v1/roles", headers=owner, json={"name": "Bad", "permissions": ["root"]}).status_code == 400


def test_presence_and_activity(client, owner):
    assert client.put("/api/v1/users/me/presence", headers=owner, json={"status": "online"}).status_code == 200
    me = _me(client, owner)
    assert me["user"]["presence"] == "online"
    feed = client.get("/api/v1/users/me/activity", headers=owner).json()
    assert feed[0]["message"] == "You are now Online"

