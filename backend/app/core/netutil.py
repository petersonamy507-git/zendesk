"""Client IP resolution that does not trust spoofable headers.

`X-Forwarded-For` is only honoured when the *direct* peer is a trusted reverse proxy (the Vite dev proxy,
nginx, a load balancer: configure with `TRUSTED_PROXIES`). Then the real client is the right-most entry that
is not itself a trusted proxy, i.e. the address the first trusted proxy actually saw. Anything a client puts at
the left of the header is ignored. A direct connection from an untrusted peer always uses the socket address.
"""

import ipaddress
import logging
from functools import lru_cache

from app.core.config import get_settings

log = logging.getLogger(__name__)


@lru_cache
def trusted_networks() -> tuple:
    nets = []
    for item in get_settings().trusted_proxies:
        try:
            nets.append(ipaddress.ip_network(item.strip(), strict=False))
        except ValueError:
            log.warning("Ignoring invalid TRUSTED_PROXIES entry: %r", item)
    return tuple(nets)


def _as_ip(addr: str | None):
    if not addr:
        return None
    try:
        ip = ipaddress.ip_address(addr.strip().strip("[]"))
    except ValueError:
        return None
    return ip.ipv4_mapped or ip if isinstance(ip, ipaddress.IPv6Address) else ip


def is_trusted_proxy(addr: str | None) -> bool:
    ip = _as_ip(addr)
    return ip is not None and any(ip in n for n in trusted_networks())


def resolve_client_ip(peer: str | None, forwarded_for: str | None) -> str | None:
    if not forwarded_for or not is_trusted_proxy(peer):
        return peer
    hops = [h.strip() for h in forwarded_for.split(",") if h.strip()]
    for hop in reversed(hops):
        if _as_ip(hop) is not None and not is_trusted_proxy(hop):
            return hop
    return peer
