"""Visitor WebSocket: receives agent messages/typing for the visitor's own chats and sends
visitor typing. Subscribes to `visitor:<id>` and `chat:<id>` for the visitor's open chats."""

import asyncio
import contextlib

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from app.core.db import SessionLocal
from app.core.errors import AppError
from app.core.events import broker
from app.models import Chat

router = APIRouter()


@router.websocket("/api/v1/widget/ws")
async def visitor_socket(ws: WebSocket, token: str = ""):
    from app.api.v1.widget import visitor_from_token

    try:
        with SessionLocal() as db:
            ctx = visitor_from_token(db, token)
            vid, acc = ctx.visitor.id, ctx.visitor.account_id
            chat_ids = list(db.scalars(select(Chat.id).where(Chat.visitor_id == vid, Chat.state.in_(["proactive", "incoming", "active"]))))
    except AppError:
        await ws.close(code=4401)
        return
    await ws.accept()
    q: asyncio.Queue = asyncio.Queue(maxsize=500)
    topics = {f"visitor:{vid}", *[f"chat:{c}" for c in chat_ids]}
    for t in topics:
        broker.subscribe(t, q)

    async def pump():
        while True:
            evt = await q.get()
            if evt["type"] == "chat.message" and evt["data"].get("kind") == "note":
                continue  # internal notes never reach visitors
            if evt["type"] == "chat.typing" and evt["data"].get("sender_type") == "visitor":
                continue
            if evt["type"] in ("chat.incoming", "chat.accepted", "chat.updated", "chat.transferred", "chat.ended"):
                d = evt["data"]
                evt = {**evt, "data": {"id": d.get("id"), "state": d.get("state"), "assignee_id": d.get("assignee_id")}}
            await ws.send_json(evt)

    sender = asyncio.create_task(pump())
    try:
        while True:
            msg = await ws.receive_json()
            op = msg.get("op")
            if op == "ping":
                await ws.send_json({"type": "pong"})
            elif op == "watch":  # after creating a chat, start receiving its events
                cid = str(msg.get("chat_id", ""))
                with SessionLocal() as db:
                    c = db.get(Chat, cid)
                    ok = c is not None and c.visitor_id == vid
                if ok and f"chat:{cid}" not in topics:
                    topics.add(f"chat:{cid}")
                    broker.subscribe(f"chat:{cid}", q)
            elif op == "typing":
                cid = str(msg.get("chat_id", ""))
                if f"chat:{cid}" in topics:
                    await broker.publish(f"chat:{cid}", "chat.typing", {"chat_id": cid, "sender_type": "visitor", "sender_id": vid, "typing": bool(msg.get("typing")), "text": str(msg.get("text", ""))[:200]})
                    await broker.publish(f"account:{acc}", "chat.typing", {"chat_id": cid, "sender_type": "visitor", "typing": bool(msg.get("typing"))})
    except WebSocketDisconnect:
        pass
    finally:
        sender.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await sender
        for t in topics:
            broker.unsubscribe(t, q)
