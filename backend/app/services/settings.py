"""Account settings sections with defaults. Each section is one JSON document in account_settings.
Defaults mirror the controls observed in the reference (see docs/reference/page-inventory.md)."""

from copy import deepcopy

from sqlalchemy import select
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


def get_section(db: Session, account_id: str, section: str) -> dict:
    if section not in DEFAULTS:
        raise NotFound(f"Unknown settings section '{section}'")
    row = db.scalar(select(AccountSetting).where(AccountSetting.account_id == account_id, AccountSetting.section == section))
    data = deepcopy(DEFAULTS[section])
    if row:
        data.update(row.data or {})
    return data


def put_section(db: Session, account_id: str, section: str, values: dict, *, reset: bool = False) -> tuple[dict, dict]:
    """Merge (or reset) a section. Only known keys are accepted. Returns (new_data, changes)."""
    current = get_section(db, account_id, section)
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
    return new, changes
