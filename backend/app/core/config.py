from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Environment-based configuration. Values come from env vars or backend/.env."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Parley"
    environment: str = "development"
    debug: bool = False

    database_url: str = "mysql+pymysql://helpdesk:helpdesk@127.0.0.1:3306/helpdesk"
    # Per API worker. Keep pool_size + max_overflow above threadpool_size: every sync endpoint holds a
    # pool connection on a threadpool thread, and FastAPI also needs a free thread to run get_db's
    # cleanup. If threads can outnumber connections, threads stuck waiting for a connection can starve
    # the cleanups that would release one, and the worker stalls for pool_timeout at a time.
    db_pool_size: int = 20
    db_max_overflow: int = 30
    db_pool_timeout: int = 10
    threadpool_size: int = 16  # fewer threads = less GIL contention with the event loop serving sockets
    db_echo: bool = False

    # Empty => in-process broker/presence (single worker dev only). Set for multi-worker deployments.
    redis_url: str = ""
    # Run the sweeper/automation loops inside the API process (dev). Production uses Celery beat.
    run_inprocess_workers: bool = True

    jwt_secret: str = Field(default="dev-only-change-me-please-32-bytes-minimum!!")
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 15
    refresh_token_days: int = 14

    # Origins allowed to call the agent API with credentials. The public visitor-widget API is separate:
    # it is callable from any customer website (see WidgetCORSMiddleware).
    cors_origins: list[str] = ["http://parley.localhost:5643", "http://localhost:5643", "http://127.0.0.1:5643"]

    # Reverse proxies whose X-Forwarded-For header is believed (addresses or CIDRs). Loopback covers the Vite dev
    # proxy and a same-host nginx; add your load balancer / docker network in production. List PROXIES ONLY, never
    # client networks (e.g. do not add 192.168.0.0/16 when users connect from it): a client inside a trusted range
    # could then spoof its address.
    trusted_proxies: list[str] = ["127.0.0.1", "::1"]

    upload_dir: str = "storage/uploads"
    max_upload_mb: int = 20
    s3_endpoint: str = ""
    s3_bucket: str = ""
    s3_access_key: str = ""
    s3_secret_key: str = ""

    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    mail_from: str = "support@parley.local"

    login_max_attempts: int = 5
    login_lockout_minutes: int = 15
    frontend_url: str = "http://parley.localhost:5643"  # used in emailed links (invites, password resets)


@lru_cache
def get_settings() -> Settings:
    return Settings()
