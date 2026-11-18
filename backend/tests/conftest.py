"""Test setup. Two profiles:

* default       – in-memory SQLite (fast unit profile)
* MySQL profile – `TEST_DB=mysql pytest` (reads TEST_DATABASE_URL from backend/.env) or an explicit
                  TEST_DATABASE_URL environment variable. This is the real integration run.

Every test starts by dropping and recreating all tables, so the MySQL profile refuses to run
against any database whose name does not end in `_test`."""

import os
import tempfile
from pathlib import Path

from dotenv import dotenv_values
from sqlalchemy.engine import make_url


def _test_database_url() -> str:
    url = os.environ.get("TEST_DATABASE_URL")
    if not url and os.environ.get("TEST_DB") == "mysql":
        url = dotenv_values(Path(__file__).resolve().parents[1] / ".env").get("TEST_DATABASE_URL")
        if not url:
            raise RuntimeError("TEST_DB=mysql needs TEST_DATABASE_URL in backend/.env")
    if not url:
        return "sqlite://"
    if not url.startswith("sqlite") and not (make_url(url).database or "").endswith("_test"):
        raise RuntimeError("Refusing to run tests: the database name must end with '_test' (tables are dropped on every test)")
    return url


os.environ["DATABASE_URL"] = _test_database_url()
os.environ.setdefault("JWT_SECRET", "test-secret-test-secret-test-secret-123")
os.environ["RUN_INPROCESS_WORKERS"] = "false"
# Pin anything environment-specific so a developer's backend/.env can't change test behaviour (or send real email)
os.environ["CORS_ORIGINS"] = '["http://parley.localhost:5643","http://localhost:5643","http://127.0.0.1:5643"]'
os.environ["TRUSTED_PROXIES"] = '["127.0.0.1","::1"]'
os.environ["FRONTEND_URL"] = "http://parley.localhost:5643"
for _name in ("REDIS_URL", "SMTP_HOST", "S3_ENDPOINT", "S3_BUCKET"):
    os.environ[_name] = ""
os.environ["UPLOAD_DIR"] = os.path.join(tempfile.gettempdir(), "parley_test_uploads")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.core import ratelimit  # noqa: E402
from app.core.db import engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Base  # noqa: E402
from app.services import mailer  # noqa: E402
from app.services import settings as settings_svc  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _schema():
    """Build the schema once per session from the current models."""
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield


@pytest.fixture(autouse=True)
def fresh_db(_schema):
    """Empty database for every test. SQLite: rebuild (cheap). MySQL: clear rows (DDL is slow there)."""
    if engine.dialect.name == "mysql":
        with engine.begin() as conn:
            conn.execute(text("SET FOREIGN_KEY_CHECKS=0"))
            try:
                for table in reversed(Base.metadata.sorted_tables):
                    conn.execute(table.delete())
            finally:
                conn.execute(text("SET FOREIGN_KEY_CHECKS=1"))
    else:
        Base.metadata.drop_all(engine)
        Base.metadata.create_all(engine)
    ratelimit.reset()
    settings_svc.invalidate()
    mailer.outbox.clear()
    yield


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def register(client, sub="acme", email="owner@acme.io", password="Password123"):
    r = client.post("/api/v1/auth/register", json={"company": sub.title(), "subdomain": sub, "name": "Owner " + sub, "email": email, "password": password})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture
def owner(client):
    return register(client)


def invite_and_login(client, owner_headers, email, role_key="agent", sub="acme"):
    roles = client.get("/api/v1/roles", headers=owner_headers).json()
    role_id = next(r["id"] for r in roles if r["key"] == role_key)
    r = client.post("/api/v1/agents", headers=owner_headers, json={"email": email, "name": email.split("@")[0], "role_id": role_id})
    assert r.status_code == 201, r.text
    token = mailer.outbox[-1]["body"].split("token=")[1]
    assert client.post("/api/v1/auth/accept-invite", json={"token": token, "password": "Password123"}).status_code == 200
    r = client.post("/api/v1/auth/login", json={"email": email, "password": "Password123", "subdomain": sub})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, r.json()


