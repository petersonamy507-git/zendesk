"""Chat lifecycle: request → route → accept → messages → transfer → end → transcript.

Concurrency rules
* Accepting a chat is a single conditional UPDATE (state='incoming' and unclaimed/offered to me);
  rowcount==0 means another agent won the race -> 409. No two agents can claim one chat.
* Message ordering: each message takes `seq = chats.message_count + 1` while holding a row lock
  on the chat (SELECT ... FOR UPDATE), so seq is gap-free and unique per chat.
* Messages carry an optional client_id (unique per chat) so retried sends are idempotent.
"""

import re

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.errors import AppError, Conflict, Forbidden, NotFound
from app.core.events import publish_sync
from app.core.security import utcnow
from app.models import Chat, ChatMessage, ChatParticipant, ChatTransfer, Department, DepartmentMember, User, Visitor
from app.services import audit, settings as settings_svc

CARD_REDACT = re.compile(r"\b\d(?:[ -]?\d){12,18}\b")


def _luhn(digits: str) -> bool:
    total, flip = 0, False
    for ch in reversed(digits):
        d = int(ch)
        if flip:
            d = d * 2 - 9 if d * 2 > 9 else d * 2
        total += d
        flip = not flip
    return total % 10 == 0


def redact_cards(text: str) -> str:
    """Replace all but the last 4 digits of card-like numbers (Luhn-valid) with block characters."""

    def sub(m: re.Match) -> str:
        digits = re.sub(r"\D", "", m.group())
        if not _luhn(digits):
            return m.group()
        keep_from = len(digits) - 4
        out, seen = [], 0
        for ch in m.group():
            if ch.isdigit():
                out.append("█" if seen < keep_from else ch)
                seen += 1
            else:
                out.append(ch)
        return "".join(out)

    return CARD_REDACT.sub(sub, text)


# ---------------------------------------------------------------- serializers
def message_out(m: ChatMessage) -> dict:
    return {
        "id": m.id,
        "chat_id": m.chat_id,
        "seq": m.seq,
        "client_id": m.client_id,
        "sender_type": m.sender_type,
        "sender_id": m.sender_id,
        "sender_name": m.sender_name,
        "kind": m.kind,
        "body": m.body,
        "options": m.options,
        "attachment_id": m.attachment_id,
        "created_at": m.created_at.isoformat() + "Z",
        "delivered_at": m.delivered_at.isoformat() + "Z" if m.delivered_at else None,
        "read_at": m.read_at.isoformat() + "Z" if m.read_at else None,
    }


def chat_out(c: Chat, visitor: Visitor | None = None) -> dict:
    return {
        "id": c.id,
        "kind": c.kind,
        "state": c.state,
        "outcome": c.outcome,
        "visitor_id": c.visitor_id,
        "visitor_name": (visitor.name or f"Visitor {visitor.display_id.lstrip('#')}") if visitor else None,
        "visitor_display_id": visitor.display_id if visitor else None,
        "visitor_email": visitor.email if visitor else None,
        "department_id": c.department_id,
        "assignee_id": c.assignee_id,
        "participant_ids": [p.user_id for p in c.participants if p.left_at is None],
        "initiated_by": c.initiated_by,
        "question": c.question,
        "started_at": c.started_at.isoformat() + "Z",
        "accepted_at": c.accepted_at.isoformat() + "Z" if c.accepted_at else None,
        "ended_at": c.ended_at.isoformat() + "Z" if c.ended_at else None,
        "rating": c.rating,
        "rating_comment": c.rating_comment,
        "tags": c.tags or [],
        "message_count": c.message_count,
        "preview": c.preview,
        "unread": c.unread,
        "triggered": c.triggered,
        "ticket_id": c.ticket_id,
    }


def _visitor(db: Session, c: Chat) -> Visitor | None:
    return db.get(Visitor, c.visitor_id)


def broadcast_chat(db: Session, c: Chat, type_: str) -> None:
    payload = chat_out(c, _visitor(db, c))
    publish_sync(f"account:{c.account_id}", type_, payload)
    publish_sync(f"chat:{c.id}", type_, payload)


# ---------------------------------------------------------------- messages
def add_message(db: Session, chat: Chat, *, sender_type: str, sender_id: str | None, sender_name: str | None, body: str | None, kind: str = "text", options: list | None = None, attachment_id: str | None = None, client_id: str | None = None, publish: bool = True) -> ChatMessage:
    db.flush()  # autoflush is off: persist pending changes before the refreshing lock read below
    # Lock the chat row and *refresh* it. `populate_existing` is essential: without it the ORM keeps
    # attribute values (e.g. message_count) loaded before the lock, and concurrent senders get duplicate seq.
    locked = db.scalar(select(Chat).where(Chat.id == chat.id).with_for_update().execution_options(populate_existing=True))
    assert locked is not None
    if client_id:
        # Idempotent retry. Checked *after* taking the chat lock so concurrent retries are serialized by it,
        # and with a locking read so it sees rows committed after this transaction's snapshot (REPEATABLE READ).
        existing = db.scalar(select(ChatMessage).where(ChatMessage.chat_id == chat.id, ChatMessage.client_id == client_id).with_for_update())
        if existing:
            return existing
    if body and sender_type == "visitor" and settings_svc.get_section(db, chat.account_id, "account.security").get("cc_redaction"):
        body = redact_cards(body)
    locked.message_count += 1
    now = utcnow()
    m = ChatMessage(account_id=chat.account_id, chat_id=chat.id, seq=locked.message_count, client_id=client_id, sender_type=sender_type, sender_id=sender_id, sender_name=sender_name, kind=kind, body=body, options=options, attachment_id=attachment_id, created_at=now, delivered_at=now)
    db.add(m)
    if kind in ("text", "file", "options") and body:
        locked.preview = body[:255]
    if sender_type == "visitor":
        locked.unread = True
    if sender_type == "agent" and kind != "note" and locked.first_response_at is None:
        locked.first_response_at = now
    db.flush()
    if publish:
        evt = message_out(m)
        db.commit()
        publish_sync(f"chat:{chat.id}", "chat.message", evt)
        if sender_type == "visitor":
            publish_sync(f"account:{chat.account_id}", "chat.activity", {"chat_id": chat.id, "preview": locked.preview, "seq": m.seq})
    return m


def system_event(db: Session, chat: Chat, text: str) -> ChatMessage:
    return add_message(db, chat, sender_type="system", sender_id=None, sender_name=None, body=text, kind="event")


def messages_after(db: Session, chat_id: str, after_seq: int = 0, *, include_notes: bool = True, limit: int = 500) -> list[ChatMessage]:
    stmt = select(ChatMessage).where(ChatMessage.chat_id == chat_id, ChatMessage.seq > after_seq)
    if not include_notes:
        stmt = stmt.where(ChatMessage.kind != "note")
    return list(db.scalars(stmt.order_by(ChatMessage.seq).limit(limit)))


# ---------------------------------------------------------------- lifecycle
def active_chat_count(db: Session, user_id: str) -> int:
    return db.scalar(select(func.count()).select_from(Chat).where(Chat.assignee_id == user_id, Chat.state == "active")) or 0


def agent_limit(db: Session, user: User) -> int | None:
    r = settings_svc.get_section(db, user.account_id, "routing")
    if not r["chat_limit_enabled"]:
        return None
    if r["chat_limit_scope"] == "agent" and user.chat_limit:
        return user.chat_limit
    return int(r["max_chats"])


def create_chat(db: Session, *, visitor: Visitor, session_id: str | None, department_id: str | None, question: str | None, initiated_by: str = "visitor", assignee_id: str | None = None) -> Chat:
    if department_id:
        d = db.get(Department, department_id)
        if not d or d.account_id != visitor.account_id or not d.enabled:
            raise AppError("Unknown department")
    open_chat = db.scalar(select(Chat).where(Chat.visitor_id == visitor.id, Chat.state.in_(["incoming", "active"]), Chat.deleted_at.is_(None)))
    if open_chat:
        return open_chat  # conversation continuity: reuse the open chat
    now = utcnow()
    c = Chat(account_id=visitor.account_id, visitor_id=visitor.id, session_id=session_id, department_id=department_id, question=question, initiated_by=initiated_by, started_at=now, state="active" if assignee_id else "incoming", assignee_id=assignee_id, accepted_at=now if assignee_id else None)
    db.add(c)
    visitor.chats_count += 1
    db.flush()
    if assignee_id:
        db.add(ChatParticipant(chat_id=c.id, user_id=assignee_id, joined_at=now))
    name = visitor.name or f"Visitor {visitor.display_id.lstrip('#')}"
    db.flush()
    add_message(db, c, sender_type="system", sender_id=None, sender_name=None, body=f"{name} has joined.", kind="event", publish=False)
    if question:
        add_message(db, c, sender_type="visitor", sender_id=visitor.id, sender_name=name, body=question, publish=False)
    db.commit()
    from app.services import routing

    routing.route(db, c)
    broadcast_chat(db, c, "chat.incoming" if c.state == "incoming" else "chat.updated")
    return c


def accept(db: Session, chat_id: str, agent: User) -> Chat:
    c = db.get(Chat, chat_id)
    if not c or c.account_id != agent.account_id or c.deleted_at:
        raise NotFound("Chat not found")
    if c.state == "active" and c.assignee_id == agent.id:
        return c
    limit = agent_limit(db, agent)
    if limit is not None and active_chat_count(db, agent.id) >= limit:
        raise Conflict(f"You've reached your chat limit ({limit})", code="chat_limit")
    if c.department_id:
        member = db.scalar(select(DepartmentMember.id).where(DepartmentMember.department_id == c.department_id, DepartmentMember.user_id == agent.id))
        if not member and agent.role.key not in ("owner", "admin"):
            raise Forbidden("This chat is routed to a department you're not in")
    now = utcnow()
    res = db.execute(
        update(Chat)
        .where(Chat.id == chat_id, Chat.state == "incoming", (Chat.assignee_id.is_(None)) | (Chat.assignee_id == agent.id))
        .values(state="active", assignee_id=agent.id, accepted_at=now, version=Chat.version + 1)
        .execution_options(synchronize_session=False)
    )
    if res.rowcount != 1:
        db.rollback()
        raise Conflict("This chat was already accepted by another agent", code="already_claimed")
    db.add(ChatParticipant(chat_id=chat_id, user_id=agent.id, joined_at=now))
    db.commit()
    db.refresh(c)
    system_event(db, c, f"{agent.display_name or agent.name} has joined.")
    audit.record(db, account_id=c.account_id, actor_id=agent.id, action="chat.accepted", entity_type="chat", entity_id=c.id)
    db.commit()
    broadcast_chat(db, c, "chat.accepted")
    return c


def _require_participant(c: Chat, agent: User, *, allow_admin: bool = True) -> None:
    if c.assignee_id == agent.id or any(p.user_id == agent.id and p.left_at is None for p in c.participants):
        return
    if allow_admin and agent.role.key in ("owner", "admin"):
        return
    raise Forbidden("You're not serving this chat")


def agent_send(db: Session, c: Chat, agent: User, *, body: str | None, kind: str, attachment_id: str | None, client_id: str | None, options: list | None = None) -> ChatMessage:
    if c.state != "active":
        raise AppError("This chat is not active", code="chat_not_active")
    _require_participant(c, agent)
    if not body and not attachment_id:
        raise AppError("Message is empty")
    return add_message(db, c, sender_type="agent", sender_id=agent.id, sender_name=agent.display_name or agent.name, body=body, kind=kind, attachment_id=attachment_id, client_id=client_id, options=options)


def transfer(db: Session, c: Chat, agent: User, *, to_user_id: str | None, to_department_id: str | None, note: str | None) -> Chat:
    if c.state not in ("incoming", "active"):
        raise AppError("Only open chats can be transferred")
    _require_participant(c, agent)
    if not to_user_id and not to_department_id:
        raise AppError("Choose an agent or department")
    now = utcnow()
    target = None
    if to_user_id:
        target = db.get(User, to_user_id)
        if not target or target.account_id != c.account_id or not target.enabled or target.deleted_at:
            raise AppError("Unknown agent")
        if target.presence != "online":
            raise AppError("That agent is not online", code="agent_offline")
        lim = agent_limit(db, target)
        if lim is not None and active_chat_count(db, target.id) >= lim:
            raise Conflict("That agent has reached their chat limit", code="chat_limit")
    if to_department_id:
        d = db.get(Department, to_department_id)
        if not d or d.account_id != c.account_id:
            raise AppError("Unknown department")
        c.department_id = d.id
    db.add(ChatTransfer(account_id=c.account_id, chat_id=c.id, from_user_id=agent.id, to_user_id=to_user_id, to_department_id=to_department_id, note=note, created_at=now))
    for p in c.participants:
        if p.user_id == agent.id and p.left_at is None:
            p.left_at = now
    if target:
        c.assignee_id = target.id
        c.state = "active"
        if not any(p.user_id == target.id and p.left_at is None for p in c.participants):
            c.participants.append(ChatParticipant(user_id=target.id, joined_at=now))
    else:
        c.assignee_id = None
        c.state = "incoming"
    db.commit()
    who = (target.display_name or target.name) if target else f"the {d.name} department"
    system_event(db, c, f"Chat transferred to {who}.")
    audit.record(db, account_id=c.account_id, actor_id=agent.id, action="chat.transferred", entity_type="chat", entity_id=c.id, changes={"to_user_id": to_user_id, "to_department_id": to_department_id})
    db.commit()
    if not target:
        from app.services import routing

        routing.route(db, c)
    broadcast_chat(db, c, "chat.transferred")
    if target:
        publish_sync(f"user:{target.id}", "chat.assigned", chat_out(c, _visitor(db, c)))
    return c


def end(db: Session, c: Chat, *, by: str, agent: User | None = None) -> Chat:
    if c.state in ("ended", "missed"):
        return c
    if agent:
        _require_participant(c, agent)
    now = utcnow()
    if c.state == "incoming":
        c.state, c.outcome = "missed", "missed"
    else:
        c.state = "ended"
        has_agent_reply = c.first_response_at is not None
        c.outcome = "completed" if has_agent_reply else "unresponsive"
    c.ended_at = now
    for p in c.participants:
        if p.left_at is None:
            p.left_at = now
    db.commit()
    who = (agent.display_name or agent.name) if agent else "Visitor"
    system_event(db, c, f"{who} ended the chat." if by != "visitor_left" else "Visitor has left.")
    if agent:
        audit.record(db, account_id=c.account_id, actor_id=agent.id, action="chat.ended", entity_type="chat", entity_id=c.id)
    db.commit()
    broadcast_chat(db, c, "chat.ended")
    from app.services import routing

    routing.drain_queue(db, c.account_id)
    return c


def mark_dropped_for_agent(db: Session, agent: User) -> None:
    """Agent went offline while serving: the visitor's chat goes back to the queue (outcome dropped if it ends)."""
    for c in db.scalars(select(Chat).where(Chat.assignee_id == agent.id, Chat.state == "active")):
        c.assignee_id = None
        c.state = "incoming"
        c.outcome = "dropped"
        db.commit()
        system_event(db, c, f"{agent.display_name or agent.name} has left.")
        db.commit()
        from app.services import routing

        routing.route(db, c)
        broadcast_chat(db, c, "chat.updated")


def rate(db: Session, c: Chat, rating: str | None, comment: str | None) -> Chat:
    if not settings_svc.get_section(db, c.account_id, "widget.settings").get("ratings_enabled"):
        raise AppError("Ratings are disabled")
    c.rating = rating
    if comment is not None:
        c.rating_comment = comment[:2000]
    db.commit()
    if rating:
        system_event(db, c, f"Visitor rated the chat {'Good' if rating == 'good' else 'Bad'}.")
        db.commit()
    broadcast_chat(db, c, "chat.updated")
    return c

