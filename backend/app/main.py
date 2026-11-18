import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.errors import install_error_handlers
from app.core.events import broker
from app.core.logging import configure_logging
from app.middleware.widget_cors import WidgetCORSMiddleware

configure_logging()
log = logging.getLogger("app")


@asynccontextmanager
async def lifespan(_: FastAPI):
    import asyncio

    import anyio.to_thread

    from app.services.settings import invalidation_listener

    # Sync endpoints run on this threadpool; size it below the DB pool (see config.db_pool_size).
    anyio.to_thread.current_default_thread_limiter().total_tokens = get_settings().threadpool_size
    await broker.start()
    settings_listener = asyncio.create_task(invalidation_listener())
    sweeper = None
    if get_settings().run_inprocess_workers:
        from app.workers.sweeper import run_forever

        sweeper = asyncio.create_task(run_forever())
    yield
    if sweeper:
        sweeper.cancel()
    settings_listener.cancel()
    await broker.stop()


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(title=f"{s.app_name} API", version="1.0.0", lifespan=lifespan, openapi_url="/api/v1/openapi.json", docs_url="/api/docs", redoc_url=None)
    # Strict, credentialed CORS for the agent API (the web app's own origins only)
    app.add_middleware(CORSMiddleware, allow_origins=s.cors_origins, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
    # Public CORS for the visitor-widget endpoints only (added last = outermost, so it answers their preflights first)
    app.add_middleware(WidgetCORSMiddleware)
    install_error_handlers(app)

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
        start = time.perf_counter()
        response = await call_next(request)
        response.headers["x-request-id"] = rid
        response.headers["x-content-type-options"] = "nosniff"
        response.headers["referrer-policy"] = "strict-origin-when-cross-origin"
        response.headers["x-frame-options"] = "DENY" if not request.url.path.startswith("/widget") else "SAMEORIGIN"
        log.info("request", extra={"rid": rid, "method": request.method, "path": request.url.path, "status": response.status_code, "ms": round((time.perf_counter() - start) * 1000, 1)})
        return response

    from app.api.v1.router import api_router
    from app.websocket.hub import router as ws_router
    from app.websocket.widget_ws import router as widget_ws_router

    app.include_router(api_router, prefix="/api/v1")
    app.include_router(ws_router)
    app.include_router(widget_ws_router)

    @app.get("/api/v1/health", tags=["system"])
    def health():
        return {"status": "ok", "realtime": "redis" if s.redis_url else "in-process"}

    return app


app = create_app()
