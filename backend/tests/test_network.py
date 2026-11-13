"""Network-facing behaviour: trusted-proxy client IPs and the public CORS layer for the visitor widget."""

import pytest

from app.core import netutil
from app.core.config import get_settings
from app.core.netutil import resolve_client_ip
from tests.test_chat import visitor


@pytest.fixture
def proxies(monkeypatch):
    """Set TRUSTED_PROXIES for one test (and clear the cached networks before and after)."""

    def set_(*items):
        monkeypatch.setattr(get_settings(), "trusted_proxies", list(items))
        netutil.trusted_networks.cache_clear()

    set_("127.0.0.1", "::1")
    yield set_
    netutil.trusted_networks.cache_clear()


# ------------------------------------------------------------------ client IP
def test_forwarded_for_is_ignored_from_untrusted_peers(proxies):
    # a visitor connecting directly can't pick their own IP (ban / rate-limit evasion)
    assert resolve_client_ip("198.51.100.5", "6.6.6.6") == "198.51.100.5"


def test_forwarded_for_is_used_behind_a_trusted_proxy(proxies):
    assert resolve_client_ip("127.0.0.1", "203.0.113.9") == "203.0.113.9"
    assert resolve_client_ip("::1", "203.0.113.9") == "203.0.113.9"
    assert resolve_client_ip("::ffff:127.0.0.1", "203.0.113.9") == "203.0.113.9"  # IPv4-mapped loopback


def test_client_supplied_left_entries_are_ignored(proxies):
    # the proxy appends the address it actually saw; anything to its left was sent by the client
    assert resolve_client_ip("127.0.0.1", "6.6.6.6, 203.0.113.9") == "203.0.113.9"


def test_a_lan_client_behind_the_dev_proxy_cannot_spoof_its_address(proxies):
    # another PC on the network (192.168.1.50) reaches the API through the loopback dev proxy and sends a fake header
    assert resolve_client_ip("127.0.0.1", "6.6.6.6, 192.168.1.50") == "192.168.1.50"


def test_several_trusted_hops_with_cidr(proxies):
    proxies("127.0.0.1", "10.0.0.0/8")
    assert resolve_client_ip("10.0.0.2", "203.0.113.9, 10.0.0.1") == "203.0.113.9"
    assert resolve_client_ip("10.0.0.2", None) == "10.0.0.2"


def test_malformed_header_falls_back_to_the_peer(proxies):
    assert resolve_client_ip("127.0.0.1", "not-an-ip") == "127.0.0.1"
    assert resolve_client_ip("127.0.0.1", " , ") == "127.0.0.1"
    assert resolve_client_ip(None, "203.0.113.9") is None


def test_visitor_ip_cannot_be_spoofed_over_http(client, owner):
    # the TestClient peer is not a trusted proxy, so the header must be ignored
    r = client.post("/api/v1/widget/acme/session", json={}, headers={"x-forwarded-for": "6.6.6.6"})
    assert r.status_code == 200
    vid = r.json()["visitor"]["id"]
    assert client.get(f"/api/v1/visitors/{vid}", headers=owner).json()["ip"] != "6.6.6.6"


# ------------------------------------------------------------------ widget CORS
FOREIGN = "https://shop.example.com"


def test_widget_preflight_from_any_website_is_allowed_without_credentials(client):
    r = client.options(
        "/api/v1/widget/acme/session",
        headers={"origin": FOREIGN, "access-control-request-method": "POST", "access-control-request-headers": "content-type, x-visitor-token"},
    )
    assert r.status_code == 204
    assert r.headers["access-control-allow-origin"] == FOREIGN
    assert "x-visitor-token" in r.headers["access-control-allow-headers"]
    assert "access-control-allow-credentials" not in r.headers  # visitors authenticate by header, never by cookie


def test_widget_response_has_exactly_one_allow_origin(client, owner):
    r = client.post("/api/v1/widget/acme/session", json={}, headers={"origin": FOREIGN})
    assert r.status_code == 200
    assert r.headers.get_list("access-control-allow-origin") == [FOREIGN]
    # also for the app's own (credentialed) origin: the strict layer must not add a second value
    r = client.post("/api/v1/widget/acme/session", json={}, headers={"origin": "http://localhost:5643"})
    assert r.headers.get_list("access-control-allow-origin") == ["http://localhost:5643"]
    assert "access-control-allow-credentials" not in r.headers


def test_agent_api_is_not_open_to_foreign_origins(client, owner):
    r = client.get("/api/v1/users/me", headers={**owner, "origin": FOREIGN})
    assert "access-control-allow-origin" not in r.headers
    pre = client.options("/api/v1/users/me", headers={"origin": FOREIGN, "access-control-request-method": "GET", "access-control-request-headers": "authorization"})
    assert "access-control-allow-origin" not in pre.headers
    # the app's own origin keeps working with credentials
    ok = client.get("/api/v1/users/me", headers={**owner, "origin": "http://localhost:5643"})
    assert ok.headers["access-control-allow-origin"] == "http://localhost:5643"
    assert ok.headers["access-control-allow-credentials"] == "true"


def test_file_upload_preflight_never_allows_the_agent_authorization_header(client):
    r = client.options("/api/v1/files", headers={"origin": FOREIGN, "access-control-request-method": "POST", "access-control-request-headers": "x-visitor-token"})
    assert r.status_code == 204
    assert "authorization" not in r.headers["access-control-allow-headers"].lower()


def test_parley_localhost_origin_is_allowed_for_the_app(client, owner):
    ok = client.get("/api/v1/users/me", headers={**owner, "origin": "http://parley.localhost:5643"})
    assert ok.headers["access-control-allow-origin"] == "http://parley.localhost:5643"


def test_widget_still_works_end_to_end_from_a_foreign_origin(client, owner):
    vh, _ = visitor(client)
    h = {**vh, "origin": FOREIGN}
    r = client.post("/api/v1/widget/chats", headers=h, json={"message": "hello from another site"})
    assert r.status_code == 201 and r.headers["access-control-allow-origin"] == FOREIGN
