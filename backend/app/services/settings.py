"""Account settings sections with defaults. Each section is one JSON document in account_settings.
Defaults mirror the controls observed in the reference (see docs/reference/page-inventory.md)."""

import time
from copy import deepcopy

from sqlalchemy import event, select
from sqlalchemy.orm import Session

from app.core.errors import NotFound
from app.models import AccountSetting

DEFAULTS: dict[str, dict] = {
    "routing": {"mode": "broadcast", "chat_limit_enabled": False, "chat_limit_scope": "account", "max_chats": 3, "reassign_after_s": 0, "auto_idle": False},
    "widget.appearance": {"title": "Chat with us", "theme_color": "#1d6fb0", "position": "br", "badge_enabled": False, "badge_layout": "image_right", "badge_text": "Chat with us", "badge_bg_same_as_theme": True, "badge_bg_color": "#1d6fb0", "badge_image": None, "concierge_name": "Live Chat", "concierge_byline": "We're Online", "concierge_avatar": None, "show_avatars": True},
    "widget.forms": {"visitor_profile_enabled": True, "allow_phone": False, "prechat_enabled": False, "prechat_greeting": "", "require_identity": False, "require_phone": False, "require_question": False, "department_select": True, "offline_enabled": True, "offline_greeting": "Sorry, we aren't online at the moment. Leave a message and we'll get back to you.", "offline_require_phone": False, "messenger_enabled": False, "messenger_id": ""},
    "widget.settings": {"sounds": True, "ratings_enabled": True},
    "widget.security": {"blocked_countries_enabled": False, "blocked_countries": [], "allowed_domains_enabled": False, "allowed_domains": [], "auth_enabled": False, "shared_secret": None},
    "account.email_piping": {"enabled": False, "address": ""},
    "account.chat_tags": {"allow_create_in_chat": True},
    # mode "default": PDF/PNG/JPEG/GIF/TXT only. "extended": plus extra_types, after the admin accepts the risk.
    "account.file_sending": {"enabled": True, "mode": "default", "extra_types": [], "risk_ack": False},
    # Chat→ticket behaviour (applies when the tickets module creates tickets from chats)
    "account.ticketing": {"auto_create": "manual", "transcript_visibility": "public", "assignment": "first", "offline_auto_create": "manual", "offline_transcript_visibility": "public", "offline_assignment": "first"},
    "account.sla": {"chat_reply_sla": False},
    "account.operating_hours": {"enabled": False, "type": "account", "display": False, "schedule": {d: [["09:00", "17:00"]] for d in ["mon", "tue", "wed", "thu", "fri"]} | {"sat": [], "sun": []}, "departments": {}},
    "account.security": {"cc_redaction": False, "mfa_required": False, "session_days": 14},
    "account.visitor_list": {"high_load": False},
    "account.retention": {"chat_days": 0, "ticket_days": 0},
}


# Read-through cache. Hot widget paths (session start, chat start, every message) read several
# sections per request; without the cache that's ~10 identical SELECTs per visitor request.
# Writes invalidate this worker immediately and other workers through the event bus (see
# `invalidation_listener`); the TTL bounds staleness if an invalidation is ever missed.
CACHE_TTL_S = 10.0
_cache: dict[tuple[str, str], tuple[float, dict]] = {}
INVALIDATE_TOPIC = "internal:settings"


def _load(db: Session, account_id: str, section: str) -> dict:
    row = db.scalar(select(AccountSetting).where(AccountSetting.account_id == account_id, AccountSetting.section == section))
    data = deepcopy(DEFAULTS[section])
    if row:
        data.update(row.data or {})
    return data


def get_section(db: Session, account_id: str, section: str) -> dict:
    if section not in DEFAULTS:
        raise NotFound(f"Unknown settings section '{section}'")
    key = (account_id, section)
    hit = _cache.get(key)
    now = time.monotonic()
    if hit and hit[0] > now:
        return deepcopy(hit[1])
    data = _load(db, account_id, section)
    _cache[key] = (now + CACHE_TTL_S, data)
    return deepcopy(data)


def invalidate(account_id: str | None = None, section: str | None = None) -> None:
    if account_id is None:
        _cache.clear()
    else:
        _cache.pop((account_id, section), None)


async def invalidation_listener() -> None:
    """Runs in every API worker: drops cache entries other workers changed."""
    import asyncio

    from app.core.events import broker

    q: asyncio.Queue = asyncio.Queue(maxsize=1000)
    broker.subscribe(INVALIDATE_TOPIC, q)
    try:
        while True:
            evt = await q.get()
            d = evt.get("data") or {}
            if evt.get("type") == "_overflow" or not d.get("account_id"):
                invalidate()
            else:
                invalidate(d["account_id"], d.get("section"))
    finally:
        broker.unsubscribe(INVALIDATE_TOPIC, q)


def put_section(db: Session, account_id: str, section: str, values: dict, *, reset: bool = False) -> tuple[dict, dict]:
    """Merge (or reset) a section. Only known keys are accepted. Returns (new_data, changes)."""
    if section not in DEFAULTS:
        raise NotFound(f"Unknown settings section '{section}'")
    current = _load(db, account_id, section)
    new = deepcopy(DEFAULTS[section]) if reset else dict(current)
    for k, v in values.items():
        if k in DEFAULTS[section]:
            new[k] = v
    changes = {k: [current.get(k), new.get(k)] for k in new if current.get(k) != new.get(k)}
    row = db.scalar(select(AccountSetting).where(AccountSetting.account_id == account_id, AccountSetting.section == section))
    if row is None:
        row = AccountSetting(account_id=account_id, section=section, data=new)
        db.add(row)
    else:
        row.data = new
    db.flush()
    invalidate(account_id, section)

    @event.listens_for(db, "after_commit", once=True)
    def _after_commit(_session) -> None:
        from app.core.events import publish_sync

        invalidate(account_id, section)  # a concurrent reader may have re-cached the pre-commit value
        publish_sync(INVALIDATE_TOPIC, "settings.invalidate", {"account_id": account_id, "section": section})

    return new, changes
