"""Visitor tracking: identity, visits (sessions), page views, user-agent parsing, ban checks."""

import random
import re
from datetime import timedelta
from urllib.parse import parse_qs, urlparse

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.errors import Forbidden
from app.core.events import publish_sync
from app.core.security import new_opaque_token, utcnow
from app.models import BannedVisitor, Visitor, VisitorEvent, VisitorSession

SESSION_IDLE = timedelta(minutes=30)
LIVE_WINDOW = timedelta(minutes=2)  # heartbeat cutoff for "on site"

SEARCH_ENGINES = {"google": "q", "bing": "q", "duckduckgo": "q", "yahoo": "p", "yandex": "text", "baidu": "wd"}


def parse_user_agent(ua: str | None) -> dict:
    ua = ua or ""
    browser = next((name for pat, name in [(r"Edg/", "Edge"), (r"OPR/|Opera", "Opera"), (r"Firefox/", "Firefox"), (r"Chrome/", "Chrome"), (r"Safari/", "Safari")] if re.search(pat, ua)), "Other")
    platform = next((name for pat, name in [(r"Windows", "Windows"), (r"iPhone|iPad|iPod", "iOS"), (r"Android", "Android"), (r"Mac OS X", "macOS"), (r"Linux", "Linux")] if re.search(pat, ua)), "Other")
    device = "Tablet" if re.search(r"iPad|Tablet", ua) else "Mobile" if re.search(r"Mobi|iPhone|Android", ua) else "Desktop"
    return {"browser": browser, "platform": platform, "device": device}


def parse_referrer(ref: str | None) -> tuple[str | None, str | None]:
    if not ref:
        return None, None
    try:
        u = urlparse(ref)
    except ValueError:
        return None, None
    host = (u.hostname or "").lower()
    for engine, param in SEARCH_ENGINES.items():
        if engine in host:
            terms = parse_qs(u.query).get(param, [None])[0]
            return engine.title() if engine != "duckduckgo" else "DuckDuckGo", terms
    return None, None


def is_banned(db: Session, account_id: str, visitor_id: str | None, ip: str | None) -> bool:
    conds = []
    if visitor_id:
        conds.append(BannedVisitor.visitor_id == visitor_id)
    if ip:
        conds.append(BannedVisitor.ip == ip)
    if not conds:
        return False
    return db.scalar(select(BannedVisitor.id).where(BannedVisitor.account_id == account_id, or_(*conds)).limit(1)) is not None


def get_or_create_visitor(db: Session, account_id: str, visitor_key: str | None, *, simulated: bool = False) -> Visitor:
    v = None
    if visitor_key:
        v = db.scalar(select(Visitor).where(Visitor.account_id == account_id, Visitor.visitor_key == visitor_key))
    if v is None:
        v = Visitor(account_id=account_id, visitor_key=visitor_key or new_opaque_token()[:40], display_id=f"#{random.randint(10_000_000, 99_999_999)}", is_simulated=simulated)
        db.add(v)
        db.flush()
    return v


def touch_session(db: Session, v: Visitor, *, ip: str | None, user_agent: str | None, url: str | None, title: str | None, referrer: str | None, country_code: str | None = None) -> tuple[VisitorSession, bool]:
    """Resume the visitor's open session or start a new visit. Returns (session, is_new)."""
    if is_banned(db, v.account_id, v.id, ip):
        raise Forbidden("Visitor is banned", code="banned")
    now = utcnow()
    s = db.scalar(select(VisitorSession).where(VisitorSession.visitor_id == v.id, VisitorSession.ended_at.is_(None)).order_by(VisitorSession.started_at.desc()))
    is_new = False
    if s is None or now - s.last_seen_at > SESSION_IDLE:
        if s is not None:
            s.ended_at = s.last_seen_at
        engine, terms = parse_referrer(referrer)
        s = VisitorSession(account_id=v.account_id, visitor_id=v.id, started_at=now, last_seen_at=now, ip=ip, user_agent=(user_agent or "")[:512], referrer=(referrer or None) and referrer[:1024], search_engine=engine, search_terms=terms, country_code=country_code, **parse_user_agent(user_agent))
        db.add(s)
        db.flush()
        v.visits_count += 1
        is_new = True
    s.last_seen_at = now
    if url and url != s.current_url:
        s.current_url = url[:1024]
        s.current_title = (title or "")[:255] or None
        s.page_count += 1
        db.add(VisitorEvent(account_id=v.account_id, session_id=s.id, kind="page_view", url=url[:1024], title=(title or "")[:255], created_at=now))
    db.flush()
    return s, is_new


def end_stale_sessions(db: Session) -> int:
    cutoff = utcnow() - LIVE_WINDOW
    stale = db.scalars(select(VisitorSession).where(VisitorSession.ended_at.is_(None), VisitorSession.last_seen_at < cutoff)).all()
    for s in stale:
        s.ended_at = s.last_seen_at
    db.flush()
    for s in stale:
        publish_sync(f"account:{s.account_id}", "visitor.left", {"visitor_id": s.visitor_id, "session_id": s.id})
    return len(stale)


def visitor_snapshot(v: Visitor, s: VisitorSession | None, *, chatting: bool = False, serving: list[str] | None = None) -> dict:
    now = utcnow()
    return {
        "id": v.id,
        "display_id": v.display_id,
        "name": v.name or f"Visitor {v.display_id.lstrip('#')}",
        "email": v.email,
        "phone": v.phone,
        "tags": v.tags,
        "visits": v.visits_count,
        "chats": v.chats_count,
        "simulated": v.is_simulated,
        "session_id": s.id if s else None,
        "online_seconds": int((now - s.started_at).total_seconds()) if s else 0,
        "current_url": s.current_url if s else None,
        "current_title": s.current_title if s else None,
        "page_count": s.page_count if s else 0,
        "country_code": s.country_code if s else None,
        "country_name": s.country_name if s else None,
        "city": s.city if s else None,
        "browser": s.browser if s else None,
        "platform": s.platform if s else None,
        "device": s.device if s else None,
        "referrer": s.referrer if s else None,
        "search_engine": s.search_engine if s else None,
        "search_terms": s.search_terms if s else None,
        "department_id": s.department_id if s else None,
        "triggered": s.triggered if s else False,
        "note": s.dashboard_note if s else None,
        "chatting": chatting,
        "serving_agent_ids": serving or [],
        "last_seen_at": s.last_seen_at.isoformat() + "Z" if s else None,
    }
