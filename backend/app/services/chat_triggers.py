"""Chat triggers (Settings › Triggers): event → conditions (all/any) → actions.

Execution rules
* Events: widget_loaded, chat_requested, message_sent (visitor messages only).
* `fire_once_per_visitor` uses trigger_executions as the idempotency record.
* Delay conditions (still_on_site / still_on_page, seconds, max 3600) and the `wait` action are
  scheduled with a timer and re-evaluated against fresh DB state when they fire.
  (Single-process timer in dev; in production this hands off to a Celery countdown task.)
* Recursion guard: messages sent by triggers never raise message_sent events.
"""

import logging
import threading
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import SessionLocal
from app.core.errors import AppError
from app.core.events import publish_sync
from app.core.security import utcnow
from app.models import BannedVisitor, Chat, ChatMessage, Department, Trigger, TriggerExecution, Visitor, VisitorEvent, VisitorSession
from app.services import rules

log = logging.getLogger(__name__)

EVENTS = {"widget_loaded": "When a visitor has loaded the chat widget", "chat_requested": "When a visitor requests a chat", "message_sent": "When a chat message is sent"}

FIELDS = {
    "hour_of_day": "Hour of day", "day_of_week": "Day of week", "still_on_site": "Still on site", "still_on_page": "Still on page",
    "visitor_ip": "Visitor IP", "visitor_host": "Visitor host name", "visitor_city": "Visitor city", "visitor_region": "Visitor region",
    "visitor_country_code": "Visitor country code", "visitor_country_name": "Visitor country name", "visitor_previous_chats": "Visitor previous chats",
    "visitor_previous_visits": "Visitor previous visits", "visitor_page_url": "Visitor page URL", "visitor_page_title": "Visitor page title",
    "visitor_page_count": "Visitor page count", "previous_page": "Previous page", "visitor_name": "Visitor name", "visitor_triggered": "Visitor triggered",
    "visitor_email": "Visitor email", "visitor_referrer": "Visitor referrer", "visitor_search_engine": "Visitor search engine",
    "visitor_search_terms": "Visitor search terms", "visitor_tag": "Visitor tag", "visitor_department": "Visitor department",
    "visitor_user_agent": "Visitor user agent", "visitor_browser": "Visitor browser", "visitor_platform": "Visitor platform",
    "account_status": "Account status", "department_status": "Department status", "visitor_status": "Visitor status",
    "visitor_is_chatting": "Visitor is chatting", "visitor_requesting_chat": "Visitor requesting chat", "visitor_served": "Visitor served",
    "department": "Department", "sender": "Sender", "sender_type": "Sender type", "message": "Message", "queue_size": "Queue size (account)",
}
DELAY_FIELDS = {"still_on_site", "still_on_page"}

ACTIONS = {
    "send_message": "Send message to visitor", "set_triggered": "Set triggered (shown on dashboard)", "wait": "Wait",
    "set_name": "Set name of visitor", "block_visitor": "Block visitor", "add_tag": "Add tag", "remove_tag": "Remove tag",
    "set_department": "Set visitor department", "replace_note": "Replace note (shows on dashboard)", "append_note": "Append note (shows on dashboard)",
}


def validate(event: str, match: str, conditions: list[dict], actions: list[dict]) -> None:
    if event not in EVENTS:
        raise AppError("Unknown trigger event")
    if match not in ("all", "any"):
        raise AppError("match must be 'all' or 'any'")
    try:
        rules.validate_conditions(conditions, set(FIELDS))
    except rules.RuleError as e:
        raise AppError(str(e)) from e
    for c in conditions:
        if c["field"] in DELAY_FIELDS and not (0 < int(c.get("value") or 0) <= 3600):
            raise AppError("Delay must be between 1 and 3600 seconds")
    if not actions:
        raise AppError("Add at least one action")
    for a in actions:
        if a.get("type") not in ACTIONS:
            raise AppError(f"Unknown action: {a.get('type')}")


def _account_status(db: Session, account_id: str) -> str:
    from app.models import User

    rows = set(db.scalars(select(User.presence).where(User.account_id == account_id, User.is_agent.is_(True), User.enabled.is_(True), User.deleted_at.is_(None))))
    return "online" if "online" in rows else "away" if "away" in rows else "offline"


def build_context(db: Session, v: Visitor, s: VisitorSession | None, chat: Chat | None, message: ChatMessage | None) -> dict:
    now = datetime.now(UTC)
    prev = None
    if s:
        urls = db.scalars(select(VisitorEvent.url).where(VisitorEvent.session_id == s.id).order_by(VisitorEvent.created_at.desc()).limit(2)).all()
        prev = urls[1] if len(urls) > 1 else None
    dept = db.get(Department, s.department_id) if s and s.department_id else None
    queue = db.scalar(select(func.count()).select_from(Chat).where(Chat.account_id == v.account_id, Chat.state == "incoming")) or 0
    status = _account_status(db, v.account_id)
    return {
        "hour_of_day": now.hour, "day_of_week": now.strftime("%a").lower(),
        "still_on_site": True, "still_on_page": True,
        "visitor_ip": s.ip if s else None, "visitor_host": None,
        "visitor_city": s.city if s else None, "visitor_region": s.region if s else None,
        "visitor_country_code": s.country_code if s else None, "visitor_country_name": s.country_name if s else None,
        "visitor_previous_chats": max(0, v.chats_count - (1 if chat else 0)), "visitor_previous_visits": max(0, v.visits_count - 1),
        "visitor_page_url": s.current_url if s else None, "visitor_page_title": s.current_title if s else None,
        "visitor_page_count": s.page_count if s else 0, "previous_page": prev,
        "visitor_name": v.name, "visitor_triggered": bool(s and s.triggered), "visitor_email": v.email,
        "visitor_referrer": s.referrer if s else None, "visitor_search_engine": s.search_engine if s else None,
        "visitor_search_terms": s.search_terms if s else None, "visitor_tag": v.tags or [],
        "visitor_department": dept.name if dept else None, "visitor_user_agent": s.user_agent if s else None,
        "visitor_browser": s.browser if s else None, "visitor_platform": s.platform if s else None,
        "account_status": status, "department_status": ("online" if dept and status == "online" else "offline") if dept else status,
        "visitor_status": "online" if s and s.ended_at is None else "offline",
        "visitor_is_chatting": bool(chat and chat.state == "active"), "visitor_requesting_chat": bool(chat and chat.state == "incoming"),
        "visitor_served": bool(chat and chat.state == "active"),
        "department": dept.name if dept else None,
        "sender": message.sender_name if message else None, "sender_type": message.sender_type if message else None,
        "message": message.body if message else None, "queue_size": queue,
    }


def fire(db: Session, event: str, *, visitor: Visitor, session: VisitorSession | None, chat: Chat | None = None, message: ChatMessage | None = None) -> None:
    if message is not None and message.sender_type != "visitor":
        return  # recursion guard
    triggers = db.scalars(select(Trigger).where(Trigger.account_id == visitor.account_id, Trigger.enabled.is_(True), Trigger.event == event).order_by(Trigger.position, Trigger.created_at)).all()
    if not triggers:
        return
    ctx = build_context(db, visitor, session, chat, message)
    for t in triggers:
        if t.fire_once_per_visitor and db.scalar(select(TriggerExecution.id).where(TriggerExecution.trigger_id == t.id, TriggerExecution.visitor_id == visitor.id, TriggerExecution.status == "ok").limit(1)):
            continue
        delay = max([int(c.get("value") or 0) for c in t.conditions if c.get("field") in DELAY_FIELDS] or [0])
        immediate = [c for c in t.conditions if c.get("field") not in DELAY_FIELDS]
        if delay:
            # pre-check non-delay conditions only for "all"; re-check everything when the timer fires
            if t.match == "all" and not rules.matches(ctx, all_conditions=immediate):
                continue
            _schedule(delay, _delayed_fire, t.id, visitor.id, session.id if session else None, chat.id if chat else None, session.current_url if session else None)
            continue
        if _match(t, ctx):
            execute(db, t, visitor=visitor, session=session, chat=chat, actions=t.actions)


def _match(t: Trigger, ctx: dict) -> bool:
    conds = [c for c in t.conditions if c.get("field") not in DELAY_FIELDS]
    if not conds:
        return True
    return rules.matches(ctx, all_conditions=conds) if t.match == "all" else rules.matches(ctx, any_conditions=conds)


def _schedule(seconds: float, fn, *args) -> None:
    timer = threading.Timer(seconds, fn, args=args)
    timer.daemon = True
    timer.start()


def _delayed_fire(trigger_id: str, visitor_id: str, session_id: str | None, chat_id: str | None, url_at_schedule: str | None) -> None:
    try:
        with SessionLocal() as db:
            t = db.get(Trigger, trigger_id)
            v = db.get(Visitor, visitor_id)
            s = db.get(VisitorSession, session_id) if session_id else None
            if not t or not t.enabled or not v:
                return
            on_site = bool(s and s.ended_at is None)
            on_page = on_site and s.current_url == url_at_schedule
            for c in t.conditions:
                if c.get("field") == "still_on_site" and not on_site:
                    return
                if c.get("field") == "still_on_page" and not on_page:
                    return
            chat = db.get(Chat, chat_id) if chat_id else None
            ctx = build_context(db, v, s, chat, None)
            if _match(t, ctx):
                execute(db, t, visitor=v, session=s, chat=chat, actions=t.actions)
    except Exception:  # noqa: BLE001
        log.exception("delayed trigger failed")


def _delayed_actions(trigger_id: str, visitor_id: str, session_id: str | None, chat_id: str | None, actions: list[dict]) -> None:
    try:
        with SessionLocal() as db:
            t, v = db.get(Trigger, trigger_id), db.get(Visitor, visitor_id)
            if t and v:
                execute(db, t, visitor=v, session=db.get(VisitorSession, session_id) if session_id else None, chat=db.get(Chat, chat_id) if chat_id else None, actions=actions, record=False)
    except Exception:  # noqa: BLE001
        log.exception("trigger wait action failed")


def execute(db: Session, t: Trigger, *, visitor: Visitor, session: VisitorSession | None, chat: Chat | None, actions: list[dict], record: bool = True) -> None:
    from app.services import chat as chat_svc

    status, error = "ok", None
    try:
        for i, a in enumerate(actions):
            kind, value = a.get("type"), a.get("value")
            if kind == "wait":
                _schedule(min(float(value or 0), 3600), _delayed_actions, t.id, visitor.id, session.id if session else None, chat.id if chat else None, actions[i + 1 :])
                break
            if kind == "send_message":
                name = (a.get("name") or "").strip() or "Live Support"
                if chat is None or chat.state in ("ended", "missed"):
                    chat = Chat(account_id=visitor.account_id, visitor_id=visitor.id, session_id=session.id if session else None, state="proactive", initiated_by="trigger", started_at=utcnow(), triggered=True)
                    db.add(chat)
                    db.flush()
                chat_svc.add_message(db, chat, sender_type="trigger", sender_id=t.id, sender_name=name, body=str(value or ""))
                publish_sync(f"visitor:{visitor.id}", "chat.proactive", {"chat_id": chat.id})
            elif kind == "set_triggered":
                if session:
                    session.triggered = bool(value if value is not None else True)
                if chat:
                    chat.triggered = True
            elif kind == "set_name":
                visitor.name = str(value or "")[:120] or visitor.name
            elif kind == "block_visitor":
                db.add(BannedVisitor(account_id=visitor.account_id, visitor_id=visitor.id, ip=session.ip if session else None, label=visitor.name or f"Visitor {visitor.display_id.lstrip('#')}", reason=f"Blocked by trigger: {t.name}", created_at=utcnow()))
            elif kind == "add_tag":
                tags = list(visitor.tags or [])
                for tag in [x.strip() for x in str(value or "").split(",") if x.strip()]:
                    if tag not in tags:
                        tags.append(tag)
                visitor.tags = tags
            elif kind == "remove_tag":
                drop = {x.strip() for x in str(value or "").split(",")}
                visitor.tags = [x for x in (visitor.tags or []) if x not in drop]
            elif kind == "set_department" and session:
                d = db.get(Department, value) if value else None
                if d and d.account_id == visitor.account_id:
                    session.department_id = d.id
            elif kind in ("replace_note", "append_note") and session:
                session.dashboard_note = (str(value or "") if kind == "replace_note" else ((session.dashboard_note or "") + "\n" + str(value or "")).strip())[:500]
        db.commit()
    except Exception as e:  # noqa: BLE001
        db.rollback()
        status, error = "error", str(e)[:500]
        log.exception("trigger %s failed", t.id)
    if record:
        db.add(TriggerExecution(account_id=t.account_id, trigger_id=t.id, visitor_id=visitor.id, chat_id=chat.id if chat else None, status=status, error=error, created_at=utcnow()))
        db.commit()
    publish_sync(f"account:{visitor.account_id}", "visitor.updated", {"visitor_id": visitor.id})

