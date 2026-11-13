from collections.abc import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings


class Base(DeclarativeBase):
    pass


def _make_engine(url: str) -> Engine:
    s = get_settings()
    if url.startswith("sqlite"):
        # Used only by the fast unit-test profile; production and integration tests use MySQL.
        from sqlalchemy.pool import StaticPool

        kwargs = {"poolclass": StaticPool} if url in ("sqlite://", "sqlite:///:memory:") else {}  # shared conn only for in-memory tests
        eng = create_engine(url, connect_args={"check_same_thread": False}, echo=s.db_echo, **kwargs)

        @event.listens_for(eng, "connect")
        def _fk_on(dbapi_conn, _):  # pragma: no cover - sqlite only
            dbapi_conn.execute("PRAGMA foreign_keys=ON")

        return eng
    return create_engine(
        url,
        pool_size=s.db_pool_size,
        max_overflow=s.db_max_overflow,
        pool_pre_ping=True,
        pool_recycle=1800,
        echo=s.db_echo,
        connect_args={"charset": "utf8mb4"},
    )


engine = _make_engine(get_settings().database_url)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
