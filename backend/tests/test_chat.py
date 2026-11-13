"""Chat lifecycle: visitor session → request → accept (race-safe) → messages → transfer → end → history."""

from tests.conftest import invite_and_login


def visitor(client, sub="acme", url="https://shop.example.com/pricing"):
    r = client.post(f"/api/v1/widget/{sub}/session", json={"url": url, "title": "Pricing", "referrer": "https://www.google.com/search?q=chat+tool"})
    assert r.status_code == 200, r.text
    d = r.json()
    return {"X-Visitor-Token": d["visitor_token"]}, d


def online(client, h):
    assert client.put("/api/v1/users/me/presence", headers=h, json={"status": "online"}).status_code == 200


def test_widget_session_and_live_visitors(client, owner):
    vh, d = visitor(client)
    assert d["config"]["online"] is False  # nobody online yet
    online(client, owner)
    live = client.get("/api/v1/visitors", headers=owner).json()
    assert live["total"] == 1
    v = live["items"][0]
    assert v["search_engine"] == "Google" and v["search_terms"] == "chat tool"
    assert v["group"] == "Browsing"
    grouped = client.get("/api/v1/visitors?group_by=search_term", headers=owner).json()
    assert grouped["items"][0]["group"] == "chat tool"


def test_full_chat_lifecycle(client, owner):
    online(client, owner)
    vh, _ = visitor(client)
    r = client.post("/api/v1/widget/chats", headers=vh, json={"name": "Maya", "email": "maya@example.com", "message": "Hi, I need help"})
    assert r.status_code == 201, r.text
    chat_id = r.json()["id"]
    assert r.json()["state"] == "incoming"
    queue = client.get("/api/v1/chats", headers=owner).json()
    assert [c["id"] for c in queue] == [chat_id] and queue[0]["visitor_name"] == "Maya"

    assert client.post(f"/api/v1/chats/{chat_id}/accept", headers=owner).json()["state"] == "active"
    m = client.post(f"/api/v1/chats/{chat_id}/messages", headers=owner, json={"body": "Hello Maya!", "client_id": "c1"}).json()
    again = client.post(f"/api/v1/chats/{chat_id}/messages", headers=owner, json={"body": "Hello Maya!", "client_id": "c1"}).json()
    assert m["id"] == again["id"]  # idempotent retry
    client.post(f"/api/v1/chats/{chat_id}/messages", headers=owner, json={"body": "internal only", "kind": "note"})
    client.post(f"/api/v1/widget/chats/{chat_id}/messages", headers=vh, json={"body": "Thanks"})

    msgs = client.get(f"/api/v1/widget/chats/{chat_id}/messages", headers=vh).json()
    assert "internal only" not in [x["body"] for x in msgs]  # notes hidden from visitor
    seqs = [x["seq"] for x in client.get(f"/api/v1/chats/{chat_id}/messages", headers=owner).json()]
    assert seqs == sorted(seqs) and len(set(seqs)) == len(seqs)
    after = client.get(f"/api/v1/chats/{chat_id}/messages?after_seq={seqs[-2]}", headers=owner).json()
    assert len(after) == 1  # reconnect catch-up

    assert client.patch(f"/api/v1/chats/{chat_id}", headers=owner, json={"tags": ["Pricing", "lead"]}).json()["tags"] == ["pricing", "lead"]
    assert client.post(f"/api/v1/chats/{chat_id}/end", headers=owner).json()["outcome"] == "completed"
    assert client.post(f"/api/v1/widget/chats/{chat_id}/rating", headers=vh, json={"rating": "good", "comment": "great"}).status_code == 200

    hist = client.get("/api/v1/chats/history?rating=good&served=completed&tags=pricing", headers=owner).json()
    assert hist["total"] == 1 and hist["items"][0]["agent_name"]
    assert client.get("/api/v1/chats/history?q=Thanks", headers=owner).json()["total"] == 1
    assert client.get("/api/v1/chats/history?rating=bad", headers=owner).json()["total"] == 0
    t = client.get(f"/api/v1/chats/{chat_id}/transcript", headers=owner)
    assert "Hello Maya!" in t.text and "internal only" not in t.text


def test_accept_race_only_one_agent_wins(client, owner):
    agent_h, _ = invite_and_login(client, owner, "amy@acme.io")
    online(client, owner)
    online(client, agent_h)
    vh, _ = visitor(client)
    chat_id = client.post("/api/v1/widget/chats", headers=vh, json={"message": "hello"}).json()["id"]
    r1 = client.post(f"/api/v1/chats/{chat_id}/accept", headers=owner)
    r2 = client.post(f"/api/v1/chats/{chat_id}/accept", headers=agent_h)
    assert r1.status_code == 200
    assert r2.status_code == 409 and r2.json()["error"]["code"] == "already_claimed"


def test_chat_limit_and_assigned_routing(client, owner):
    agent_h, login = invite_and_login(client, owner, "amy@acme.io")
    client.put("/api/v1/settings/routing", headers=owner, json={"mode": "assigned", "chat_limit_enabled": True, "max_chats": 1})
    online(client, agent_h)
    vh1, _ = visitor(client)
    c1 = client.post("/api/v1/widget/chats", headers=vh1, json={"message": "one"}).json()["id"]
    amy = client.get("/api/v1/users/me", headers=agent_h).json()["user"]["id"]
    assert client.get(f"/api/v1/chats/{c1}", headers=owner).json()["assignee_id"] == amy  # offered to Amy
    assert client.post(f"/api/v1/chats/{c1}/accept", headers=owner).status_code == 409  # not offered to owner
    assert client.post(f"/api/v1/chats/{c1}/accept", headers=agent_h).status_code == 200
    vh2, _ = visitor(client)
    c2 = client.post("/api/v1/widget/chats", headers=vh2, json={"message": "two"}).json()["id"]
    assert client.get(f"/api/v1/chats/{c2}", headers=owner).json()["assignee_id"] is None  # Amy is at her limit
    client.post(f"/api/v1/chats/{c1}/end", headers=agent_h)
    assert client.get(f"/api/v1/chats/{c2}", headers=owner).json()["assignee_id"] == amy  # drained to Amy


def test_transfer_to_agent(client, owner):
    agent_h, _ = invite_and_login(client, owner, "amy@acme.io")
    online(client, owner)
    online(client, agent_h)
    amy = client.get("/api/v1/users/me", headers=agent_h).json()["user"]["id"]
    vh, _ = visitor(client)
    cid = client.post("/api/v1/widget/chats", headers=vh, json={"message": "help"}).json()["id"]
    client.post(f"/api/v1/chats/{cid}/accept", headers=owner)
    r = client.post(f"/api/v1/chats/{cid}/transfer", headers=owner, json={"to_user_id": amy})
    assert r.status_code == 200 and r.json()["assignee_id"] == amy
    assert client.post(f"/api/v1/chats/{cid}/messages", headers=agent_h, json={"body": "Hi, Amy here"}).status_code == 201


def test_ban_blocks_widget(client, owner):
    online(client, owner)
    vh, d = visitor(client)
    assert client.post(f"/api/v1/visitors/{d['visitor']['id']}/ban", headers=owner, json={"reason": "spam"}).status_code == 200
    assert client.post("/api/v1/widget/heartbeat", headers=vh, json={}).status_code == 403
    banned = client.get("/api/v1/banned", headers=owner).json()
    assert banned["total"] == 1 and banned["items"][0]["reason"] == "spam"


def test_offline_message_lands_in_history(client, owner):
    vh, _ = visitor(client)
    r = client.post("/api/v1/widget/offline-message", headers=vh, json={"name": "Robert", "email": "rob@example.com", "message": "Call me back"})
    assert r.status_code == 201
    h = client.get("/api/v1/chats/history?scope=offline", headers=owner).json()
    assert h["total"] == 1 and h["items"][0]["visitor_name"] == "Robert"


def test_trigger_sends_message_on_chat_request(client, owner):
    t = client.post("/api/v1/triggers", headers=owner, json={
        "name": "First Reply", "event": "chat_requested", "match": "all",
        "conditions": [{"field": "visitor_page_url", "operator": "contains", "value": "pricing"}],
        "actions": [{"type": "send_message", "name": "Support Bot", "value": "Thanks! An agent will be with you shortly."}, {"type": "add_tag", "value": "pricing-lead"}],
    })
    assert t.status_code == 201, t.text
    vh, d = visitor(client)
    cid = client.post("/api/v1/widget/chats", headers=vh, json={"message": "hi"}).json()["id"]
    bodies = [m["body"] for m in client.get(f"/api/v1/widget/chats/{cid}/messages", headers=vh).json()]
    assert "Thanks! An agent will be with you shortly." in bodies
    v = client.get(f"/api/v1/visitors/{d['visitor']['id']}", headers=owner).json()
    assert "pricing-lead" in v["tags"]
    # fire once per visitor
    client.post(f"/api/v1/widget/chats/{cid}/end", headers=vh)
    cid2 = client.post("/api/v1/widget/chats", headers=vh, json={"message": "again"}).json()["id"]
    bodies2 = [m["body"] for m in client.get(f"/api/v1/widget/chats/{cid2}/messages", headers=vh).json()]
    assert "Thanks! An agent will be with you shortly." not in bodies2


def test_trigger_validation(client, owner):
    bad = client.post("/api/v1/triggers", headers=owner, json={"name": "x", "event": "nope", "actions": [{"type": "wait", "value": 1}]})
    assert bad.status_code == 400
    bad = client.post("/api/v1/triggers", headers=owner, json={"name": "x", "event": "chat_requested", "conditions": [{"field": "bogus", "operator": "eq", "value": 1}], "actions": [{"type": "wait", "value": 1}]})
    assert bad.status_code == 400


def test_shortcuts_visibility(client, owner):
    agent_h, _ = invite_and_login(client, owner, "amy@acme.io")
    assert client.post("/api/v1/shortcuts", headers=owner, json={"name": "hi", "message": "Hello {{visitor.name}}", "options": ["Sales", "Support"], "tags": ["Greeting"]}).status_code == 201
    assert client.post("/api/v1/shortcuts", headers=agent_h, json={"name": "shared", "message": "x"}).status_code == 403
    assert client.post("/api/v1/shortcuts", headers=agent_h, json={"name": "mine", "message": "x", "availability": "personal"}).status_code == 201
    mine = client.get("/api/v1/shortcuts", headers=agent_h).json()
    assert {s["name"] for s in mine["items"]} == {"hi", "mine"}
    assert {s["name"] for s in client.get("/api/v1/shortcuts", headers=owner).json()["items"]} == {"hi"}


def test_file_upload_validation(client, owner):
    vh, _ = visitor(client)
    ok = client.post("/api/v1/files", headers=vh, files={"file": ("a.txt", b"hello", "text/plain")})
    assert ok.status_code == 201
    bad = client.post("/api/v1/files", headers=vh, files={"file": ("a.exe", b"MZ", "application/octet-stream")})
    assert bad.status_code == 400
    fake = client.post("/api/v1/files", headers=vh, files={"file": ("a.png", b"not a png", "image/png")})
    assert fake.json()["error"]["code"] == "file_mismatch"
    fid = ok.json()["id"]
    assert client.get(f"/api/v1/files/{fid}", headers=owner).content == b"hello"


def test_websocket_delivers_messages(client, owner):
    online(client, owner)
    vh, _ = visitor(client)
    cid = client.post("/api/v1/widget/chats", headers=vh, json={"message": "hi"}).json()["id"]
    token = owner["Authorization"].split()[1]
    with client.websocket_connect(f"/api/v1/ws?token={token}") as ws:
        ws.send_json({"op": "subscribe", "topic": f"chat:{cid}"})
        assert _wait_for(ws, "subscribed")
        client.post(f"/api/v1/widget/chats/{cid}/messages", headers=vh, json={"body": "ping from visitor"})
        seen = []
        for _ in range(10):
            evt = ws.receive_json()
            seen.append(evt)
            if evt.get("type") == "chat.message":
                break
        msg = next(e for e in seen if e.get("type") == "chat.message")
        assert msg["data"]["body"] == "ping from visitor" and msg["seq"] >= 1 and msg["id"]


def test_websocket_rejects_bad_token_and_foreign_topic(client, owner):
    import pytest
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/api/v1/ws?token=garbage") as ws:
            ws.receive_json()
    token = owner["Authorization"].split()[1]
    with client.websocket_connect(f"/api/v1/ws?token={token}") as ws:
        ws.send_json({"op": "subscribe", "topic": "account:someone-else"})
        assert _wait_for(ws, "error")


def _wait_for(ws, type_, limit=10):
    for _ in range(limit):
        if ws.receive_json().get("type") == type_:
            return True
    return False
