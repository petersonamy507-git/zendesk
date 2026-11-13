"""CORS for the embeddable visitor widget.

The widget is loaded on customers' websites (any origin) and authenticates with a visitor token sent in a
header (`X-Visitor-Token`), never with cookies. Reflecting the caller's Origin *without credentials* is
therefore safe on these routes. Per-workspace access control is the "Allowed domains" setting, which the
API enforces from the Origin header. Everything else (the agent API) keeps the strict, credentialed CORS
list from settings (`CORS_ORIGINS`) and is never exposed to arbitrary origins.
"""

from starlette.datastructures import Headers, MutableHeaders
from starlette.responses import Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

# Public widget API + file upload/download (visitor-token authenticated).
PUBLIC_PREFIXES = ("/api/v1/widget/", "/api/v1/files")
ALLOW_METHODS = "GET, POST, PATCH, OPTIONS"
ALLOW_HEADERS = "content-type, x-visitor-token"  # note: no `authorization` – agent tokens are not accepted cross-origin


class WidgetCORSMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope["path"].startswith(PUBLIC_PREFIXES):
            await self.app(scope, receive, send)
            return
        origin = Headers(scope=scope).get("origin")
        if not origin:
            await self.app(scope, receive, send)
            return

        if scope["method"] == "OPTIONS" and "access-control-request-method" in Headers(scope=scope):
            preflight = Response(
                status_code=204,
                headers={
                    "access-control-allow-origin": origin,
                    "access-control-allow-methods": ALLOW_METHODS,
                    "access-control-allow-headers": ALLOW_HEADERS,
                    "access-control-max-age": "600",
                    "vary": "Origin",
                },
            )
            await preflight(scope, receive, send)
            return

        async def send_with_cors(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                # Replace anything the strict app-wide CORS layer added so the browser sees exactly one value
                for name in ("access-control-allow-origin", "access-control-allow-credentials"):
                    if name in headers:
                        del headers[name]
                headers["access-control-allow-origin"] = origin
                headers["access-control-expose-headers"] = "x-request-id"
                headers.add_vary_header("Origin")
            await send(message)

        await self.app(scope, receive, send_with_cors)
