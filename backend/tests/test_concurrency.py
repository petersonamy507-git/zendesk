"""Concurrency guarantees. These only mean something on a real database with row locking, so they
run in the MySQL profile (`TEST_DB=mysql pytest`) and are skipped on SQLite."""

import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import select

from app.core.db import SessionLocal, engine
from app.core.errors import AppError
from app.models import Chat, ChatMessage, User
from app.services import chat as chat_svc
from tests.conftest import invite_and_login
from tests.test_chat import online, visitor

pytestmark = pytest.mark.skipif(engine.dialect.name != "mysql", reason="needs MySQL row locking")

AGENTS = 6


def _open_chat(client, owner):
    online(client, owner)
    vh, _ = visitor(client)
    return client.post("/api/v1/widget/chats", headers=vh, json={"message": "hello"}).json()["id"]


def _run_parallel(n, fn):
    """Run fn(i) in n threads released at the same instant; returns results/exceptions in order."""
    barrier = threading.Barrier(n)

    def wrapped(i):
        barrier.wait()
        try:
            return fn(i)
        except Exception as e:  # noqa: BLE001
            return e

    with ThreadPoolExecutor(max_workers=n) as pool:
        return list(pool.map(wrapped, range(n)))


def test_exactly_one_agent_wins_a_contested_chat(client, owner):
    agent_ids = []
    for i in range(AGENTS):
        h, _ = invite_and_login(client, owner, f"agent{i}@acme.io")
        agent_ids.append(client.get("/api/v1/users/me", headers=h).json()["user"]["id"])
    chat_id = _open_chat(client, owner)

    def claim(i):
        with SessionLocal() as db:
            agent = db.get(User, agent_ids[i])
            return chat_svc.accept(db, chat_id, agent).assignee_id

    results = _run_parallel(AGENTS, claim)
    winners = [r for r in results if isinstance(r, str)]
    losers = [r for r in results if isinstance(r, AppError)]
    assert len(winners) == 1, results
    assert len(losers) == AGENTS - 1 and {e.code for e in losers} == {"already_claimed"}
    with SessionLocal() as db:
        chat = db.get(Chat, chat_id)
        assert chat.state == "active" and chat.assignee_id == winners[0]
        assert sum(1 for p in chat.participants if p.left_at is None) == 1  # only the winner joined


def test_concurrent_messages_get_unique_gapless_sequence(client, owner):
    chat_id = _open_chat(client, owner)
    client.post(f"/api/v1/chats/{chat_id}/accept", headers=owner)
    n = 24

    def send(i):
        with SessionLocal() as db:
            chat = db.get(Chat, chat_id)  # loaded before the lock: the stale-instance scenario
            m = chat_svc.add_message(db, chat, sender_type="visitor", sender_id="v", sender_name="V", body=f"m{i}", publish=False)
            db.commit()
            return m.seq

    results = _run_parallel(n, send)
    assert not [r for r in results if isinstance(r, Exception)], results
    with SessionLocal() as db:
        seqs = sorted(db.scalars(select(ChatMessage.seq).where(ChatMessage.chat_id == chat_id)))
        assert seqs == list(range(1, len(seqs) + 1)), "sequence numbers must be unique and gap-free"
        assert db.get(Chat, chat_id).message_count == len(seqs)


def test_retried_send_with_same_client_id_is_stored_once(client, owner):
    chat_id = _open_chat(client, owner)
    client.post(f"/api/v1/chats/{chat_id}/accept", headers=owner)

    def send(_):
        with SessionLocal() as db:
            chat = db.get(Chat, chat_id)
            m = chat_svc.add_message(db, chat, sender_type="visitor", sender_id="v", sender_name="V", body="once", client_id="retry-1", publish=False)
            db.commit()
            return m.id

    results = _run_parallel(8, send)
    assert not [r for r in results if isinstance(r, Exception)], results
    assert len(set(results)) == 1
    with SessionLocal() as db:
        assert db.scalar(select(ChatMessage.id).where(ChatMessage.chat_id == chat_id, ChatMessage.client_id == "retry-1")) == results[0]
        assert len(db.scalars(select(ChatMessage).where(ChatMessage.chat_id == chat_id, ChatMessage.client_id == "retry-1")).all()) == 1
