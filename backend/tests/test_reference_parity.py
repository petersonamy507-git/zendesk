"""Behaviours added after comparing the app with the reference screenshots."""

from tests.conftest import invite_and_login
from tests.test_chat import online, visitor


def _me(client, h):
    return client.get("/api/v1/users/me", headers=h).json()


def test_bulk_agent_actions(client, owner):
    a_h, _ = invite_and_login(client, owner, "amy@acme.io")
    b_h, _ = invite_and_login(client, owner, "bob@acme.io")
    ids = [x["id"] for x in client.get("/api/v1/agents", headers=owner).json()["items"] if x["email"] != "owner@acme.io"]
    assert client.post("/api/v1/agents/bulk", headers=owner, json={"ids": ids, "chat_limit": 4}).status_code == 200
    assert {x["chat_limit"] for x in client.get("/api/v1/agents", headers=owner).json()["items"] if x["id"] in ids} == {4}
    # limit range 1-20, skills max 5
    assert client.post("/api/v1/agents/bulk", headers=owner, json={"ids": ids, "chat_limit": 21}).status_code == 422
    assert client.post("/api/v1/agents/bulk", headers=owner, json={"ids": ids, "skills": list("abcdef")}).status_code == 422
    assert client.post("/api/v1/agents/bulk", headers=owner, json={"ids": ids, "skills": ["Spanish", "Billing"]}).status_code == 200
    admin_role = next(r["id"] for r in client.get("/api/v1/roles", headers=owner).json() if r["key"] == "admin")
    assert client.post("/api/v1/agents/bulk", headers=owner, json={"ids": ids, "role_id": admin_role}).status_code == 200
    assert all(x["role"]["key"] == "admin" for x in client.get("/api/v1/agents", headers=owner).json()["items"] if x["id"] in ids)
    assert client.post("/api/v1/agents/bulk", headers=owner, json={"ids": ids}).status_code == 400  # nothing to apply
    # agents can't bulk-edit
    c_h, _ = invite_and_login(client, owner, "cy@acme.io")
    assert client.post("/api/v1/agents/bulk", headers=c_h, json={"ids": ids, "chat_limit": 2}).status_code == 403


def test_bulk_agent_actions_are_tenant_scoped(client, owner):
    from tests.conftest import register

    other = register(client, sub="globex", email="owner@globex.io")
    mine = _me(client, owner)["user"]["id"]
    assert client.post("/api/v1/agents/bulk", headers=other, json={"ids": [mine], "chat_limit": 2}).status_code == 404


def test_file_types_default_and_extended(client, owner):
    vh, _ = visitor(client)
    up = lambda n: client.post("/api/v1/files", headers=vh, files={"file": (n, b"hello", "application/octet-stream")}).status_code  # noqa: E731
    assert up("a.txt") == 201
    assert up("a.docx") == 400  # outside the default PDF/PNG/JPEG/GIF/TXT set
    client.put("/api/v1/settings/account.file_sending", headers=owner, json={"mode": "extended", "extra_types": [".docx"], "risk_ack": False})
    assert up("a.docx") == 400  # risk not acknowledged
    client.put("/api/v1/settings/account.file_sending", headers=owner, json={"mode": "extended", "extra_types": [".docx", "svg"], "risk_ack": True})
    assert up("a.docx") == 201
    client.put("/api/v1/settings/account.file_sending", headers=owner, json={"enabled": False})
    assert up("a.txt") == 400


def test_credit_card_redaction_uses_block_characters(client, owner):
    online(client, owner)
    client.put("/api/v1/settings/account.security", headers=owner, json={"cc_redaction": True})
    vh, _ = visitor(client)
    cid = client.post("/api/v1/widget/chats", headers=vh, json={"message": "my card is 4111 1111 1111 1111 ok"}).json()["id"]
    body = client.get(f"/api/v1/chats/{cid}", headers=owner).json()["messages"][-1]["body"]
    assert body == "my card is ████ ████ ████ 1111 ok"
    # non-card numbers (fail the Luhn check) are left alone
    from app.services.chat import redact_cards

    assert redact_cards("order 1234 5678 9012 3456 shipped") == "order 1234 5678 9012 3456 shipped"
    assert redact_cards("pay 4111-1111-1111-1111.") == "pay ████-████-████-1111."


def test_high_load_dashboard_hides_browsing_visitors(client, owner):
    online(client, owner)
    visitor(client)
    assert client.get("/api/v1/visitors", headers=owner).json()["total"] == 1
    client.put("/api/v1/settings/account.visitor_list", headers=owner, json={"high_load": True})
    assert client.get("/api/v1/visitors", headers=owner).json()["total"] == 0
    vh2, _ = visitor(client)
    client.post("/api/v1/widget/chats", headers=vh2, json={"message": "hi"})
    live = client.get("/api/v1/visitors", headers=owner).json()
    assert live["total"] == 1 and live["items"][0]["status"] in ("incoming", "assigned")


def test_visual_status_values(client, owner):
    online(client, owner)
    vh, _ = visitor(client)
    assert client.get("/api/v1/visitors", headers=owner).json()["items"][0]["status"] == "active"
    cid = client.post("/api/v1/widget/chats", headers=vh, json={"message": "hi"}).json()["id"]
    assert client.get("/api/v1/visitors", headers=owner).json()["items"][0]["status"] == "incoming"
    client.post(f"/api/v1/chats/{cid}/accept", headers=owner)
    assert client.get("/api/v1/visitors", headers=owner).json()["items"][0]["status"] == "served"


def test_widget_security_toggles(client, owner):
    client.put("/api/v1/settings/widget.security", headers=owner, json={"allowed_domains": ["shop.example.com"], "allowed_domains_enabled": False})
    r = client.post("/api/v1/widget/acme/session", json={}, headers={"origin": "https://evil.test"})
    assert r.status_code == 200  # list ignored while the toggle is off
    client.put("/api/v1/settings/widget.security", headers=owner, json={"allowed_domains_enabled": True})
    assert client.post("/api/v1/widget/acme/session", json={}, headers={"origin": "https://evil.test"}).status_code == 403
    assert client.post("/api/v1/widget/acme/session", json={}, headers={"origin": "https://www.shop.example.com"}).status_code == 200
    client.put("/api/v1/settings/widget.security", headers=owner, json={"blocked_countries": ["FR"], "blocked_countries_enabled": True, "allowed_domains_enabled": False})
    assert client.post("/api/v1/widget/acme/session", json={}, headers={"x-country-code": "fr"}).status_code == 403
    assert client.post("/api/v1/widget/acme/session", json={}, headers={"x-country-code": "de"}).status_code == 200


def test_offline_form_requires_phone_when_configured(client, owner):
    vh, _ = visitor(client)
    body = {"name": "Rob", "email": "rob@example.com", "message": "Call me"}
    client.put("/api/v1/settings/widget.forms", headers=owner, json={"offline_require_phone": True})
    r = client.post("/api/v1/widget/offline-message", headers=vh, json=body)
    assert r.status_code == 400 and r.json()["error"]["code"] == "phone_required"
    assert client.post("/api/v1/widget/offline-message", headers=vh, json={**body, "phone": "+1 555 0100"}).status_code == 201
    client.put("/api/v1/settings/widget.forms", headers=owner, json={"offline_enabled": False})
    assert client.post("/api/v1/widget/offline-message", headers=vh, json=body).status_code == 400


def test_phone_ignored_unless_allowed(client, owner):
    online(client, owner)
    vh, d = visitor(client)
    client.post("/api/v1/widget/chats", headers=vh, json={"message": "hi", "phone": "555"})
    assert client.get(f"/api/v1/visitors/{d['visitor']['id']}", headers=owner).json()["phone"] is None


def test_preferences_validation_and_new_defaults(client, owner):
    prefs = _me(client, owner)["preferences"]
    assert prefs["idle_minutes"] == 15 and prefs["email_report_monthly"] is False and prefs["docked_chat_panel"] is False
    ok = client.put("/api/v1/users/me/preferences", headers=owner, json={"sound_incoming_chat": "chime", "volume_incoming_chat": 40, "email_report_monthly": True, "docked_chat_panel": True})
    assert ok.status_code == 200 and ok.json()["preferences"]["volume_incoming_chat"] == 40
    assert client.put("/api/v1/users/me/preferences", headers=owner, json={"volume_incoming_chat": 140}).status_code == 400
    assert client.put("/api/v1/users/me/preferences", headers=owner, json={"sound_incoming_chat": "airhorn"}).status_code == 400
    assert client.put("/api/v1/users/me/preferences", headers=owner, json={"sound_incoming_chat_repeat": 11}).status_code == 400


def test_ticketing_and_sla_sections_persist(client, owner):
    s = client.put("/api/v1/settings/account.ticketing", headers=owner, json={"auto_create": "automatic", "assignment": "last"}).json()
    assert s["auto_create"] == "automatic" and s["assignment"] == "last" and s["transcript_visibility"] == "public"
    assert client.put("/api/v1/settings/account.sla", headers=owner, json={"chat_reply_sla": True}).json()["chat_reply_sla"] is True
