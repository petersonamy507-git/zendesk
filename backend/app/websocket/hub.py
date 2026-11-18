"""Agent WebSocket endpoint.

Protocol (JSON frames):
  client → {"op": "subscribe", "topic": "chat:<id>"}     (authorized per topic)
  client → {"op": "unsubscribe", "topic": ...}
  client → {"op": "typing", "chat_id": ..., "typing": bool}
  client → {"op": "ping"}
  server → {"id", "topic", "seq", "type", "ts", "data"}  (events; clients dedupe by id and
           detect gaps by seq, then re-fetch via REST — MySQL is the source of truth)
  server → {"type": "pong"} / {"type": "error", "message"}

On connect the agent is auto-subscribed to `account:<account_id>` and `user:<user_id>`.
Auth: access token in the `token` query parameter (browsers can't set WS headers).
"""

import asyncio
import contextlib
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from starlette.concurrency import run_in_threadpool

from app.api.deps import principal_from_token
from app.core.db import SessionLocal
from app.core.errors import AppError
from app.core.events import OVERFLOW, broker

log = logging.getLogger(__name__)
router = APIRouter()


def _authorize_topic(principal, topic: str) -> bool:
    kind, _, ident = topic.partition(":")
    if kind == "account":
        return ident == principal.account_id
    if kind == "user":
        return ident == principal.id
    if kind == "chat":
        from app.models import Chat

        with SessionLocal() as db:
            chat = db.get(Chat, ident)
            if not chat or chat.account_id != principal.account_id:
                return False
            return principal.can("chats.view_all") or principal.can("chats.serve")
    return False


def _load_principal(token: str):
    with SessionLocal() as db:
        principal = principal_from_token(db, token)
        principal.user.display_name, principal.user.name  # noqa: B018 - load before detaching (used for typing events)
        db.expunge_all()
        return principal


@router.websocket("/api/v1/ws")
async def agent_socket(ws: WebSocket, token: str = ""):
    try:
        # Blocking DB work runs in the threadpool: on the event loop it would stall every other
        # socket of this worker while a reconnect storm (e.g. after a deploy) authenticates.
        principal = await run_in_threadpool(_load_principal, token)
    except AppError:
        await ws.close(code=4401)
        return
    await ws.accept()
    q: asyncio.Queue = asyncio.Queue(maxsize=1000)
    topics = {f"account:{principal.account_id}", f"user:{principal.id}"}
    for t in topics:
        broker.subscribe(t, q)
    conn_key = f"agent:{principal.id}"
    await broker.set_presence(conn_key, {"account_id": principal.account_id, "connected": True})
    await broker.publish(f"account:{principal.account_id}", "agent.connected", {"user_id": principal.id})

    async def pump():
        while True:
            evt = await q.get()
            if evt is OVERFLOW:  # too slow to keep up: disconnect; the client reconnects and re-fetches
                await ws.close(code=1013)
                return
            await ws.send_text(evt.raw)  # serialized once per event, not once per socket

    sender = asyncio.create_task(pump())
    try:
        while True:
            msg = await ws.receive_json()
            op = msg.get("op")
            if op == "ping":
                await broker.set_presence(conn_key, {"account_id": principal.account_id, "connected": True})
                await ws.send_json({"type": "pong"})
            elif op == "subscribe":
                topic = str(msg.get("topic", ""))
                if await run_in_threadpool(_authorize_topic, principal, topic):
                    topics.add(topic)
                    broker.subscribe(topic, q)
                    await ws.send_json({"type": "subscribed", "topic": topic})
                else:
                    await ws.send_json({"type": "error", "message": f"Not allowed: {topic}"})
            elif op == "unsubscribe":
                topic = str(msg.get("topic", ""))
                topics.discard(topic)
                broker.unsubscribe(topic, q)
            elif op == "typing":
                chat_id = str(msg.get("chat_id", ""))
                if f"chat:{chat_id}" in topics:
                    name = principal.user.display_name or principal.user.name
                    await broker.publish(f"chat:{chat_id}", "chat.typing", {"chat_id": chat_id, "sender_type": "agent", "sender_id": principal.id, "name": name, "typing": bool(msg.get("typing"))})
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001
        log.exception("agent socket error")
    finally:
        sender.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await sender
        for t in topics:
            broker.unsubscribe(t, q)
        await broker.del_presence(conn_key)
        await broker.publish(f"account:{principal.account_id}", "agent.disconnected", {"user_id": principal.id})
