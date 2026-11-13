"""Create the MySQL databases and a least-privilege application user, then write backend/.env.

Run by scripts/setup.ps1. The MySQL admin password is read from the MYSQL_ADMIN_PASSWORD environment variable
(never a command-line argument), is used for this one session, and is not stored anywhere.

Safety rules (it exits instead of guessing):
  * never overwrites an existing backend/.env
  * never touches an existing MySQL user, or a database that already contains tables
  * the app user only gets privileges on its own two databases (<db> and <db>_test)
"""

import argparse
import os
import re
import secrets
import sys
from pathlib import Path

import pymysql

IDENT = re.compile(r"^[A-Za-z0-9_]{1,32}$")


def die(code: int, message: str) -> None:
    print(f"ERROR: {message}")
    sys.exit(code)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=3306)
    ap.add_argument("--admin-user", default="root")
    ap.add_argument("--db", default="helpdesk")
    ap.add_argument("--app-user", default="helpdesk")
    ap.add_argument("--env-file", required=True)
    ap.add_argument("--env-example", required=True)
    a = ap.parse_args()

    for label, value in (("database name", a.db), ("app user", a.app_user)):
        if not IDENT.match(value):
            die(2, f"The {label} may only contain letters, digits and underscores (max 32): {value!r}")
    password = os.environ.get("MYSQL_ADMIN_PASSWORD")
    if password is None:
        die(2, "MYSQL_ADMIN_PASSWORD is not set.")
    env_file, example = Path(a.env_file), Path(a.env_example)
    if env_file.exists():
        die(3, f"{env_file} already exists; leaving the database setup alone. Delete that file to start over.")

    test_db = f"{a.db}_test"
    local = a.host in ("127.0.0.1", "localhost", "::1")
    account_host = "localhost" if local else "%"

    try:
        admin = pymysql.connect(host=a.host, port=a.port, user=a.admin_user, password=password, connect_timeout=8, autocommit=True)
    except pymysql.err.OperationalError as e:
        die(4, f"Could not log in to MySQL at {a.host}:{a.port} as '{a.admin_user}': {e.args[1] if len(e.args) > 1 else e}")
    cur = admin.cursor()
    cur.execute("SELECT VERSION()")
    version = cur.fetchone()[0]
    if int(version.split(".")[0]) < 8:
        die(5, f"MySQL {version} is too old; MySQL 8.0 or newer is required.")

    cur.execute("SELECT COUNT(*) FROM mysql.user WHERE user = %s", (a.app_user,))
    if cur.fetchone()[0]:
        die(6, f"A MySQL user named '{a.app_user}' already exists. Choose another name with -DbUser, or drop that user first.")
    for name in (a.db, test_db):
        cur.execute("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = %s", (name,))
        if cur.fetchone()[0]:
            die(7, f"Database '{name}' already contains tables; refusing to reuse it. Choose another name with -DbName.")

    app_password = secrets.token_urlsafe(24)  # letters, digits, '_' and '-': safe inside a URL
    for name in (a.db, test_db):
        cur.execute(f"CREATE DATABASE IF NOT EXISTS `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci")
    cur.execute("CREATE USER %s@%s IDENTIFIED BY %s", (a.app_user, account_host, app_password))
    for name in (a.db, test_db):
        cur.execute(f"GRANT ALL PRIVILEGES ON `{name}`.* TO %s@%s", (a.app_user, account_host))
    admin.close()

    try:  # prove the new login works over TCP, exactly as the app will use it
        app = pymysql.connect(host=a.host, port=a.port, user=a.app_user, password=app_password, database=a.db, connect_timeout=8)
        app.close()
    except pymysql.err.OperationalError as e:
        die(8, f"Created the user but could not log in with it: {e}")

    base = f"mysql+pymysql://{a.app_user}:{app_password}@{a.host}:{a.port}"
    values = {"DATABASE_URL": f"{base}/{a.db}", "TEST_DATABASE_URL": f"{base}/{test_db}", "JWT_SECRET": secrets.token_urlsafe(48)}
    lines = example.read_text(encoding="utf-8").splitlines() if example.exists() else []
    seen = set()
    out = []
    for line in lines:
        key = line.split("=", 1)[0].strip()
        if key in values and not line.lstrip().startswith("#"):
            out.append(f"{key}={values[key]}")
            seen.add(key)
        else:
            out.append(line)
    for key, value in values.items():
        if key not in seen:
            out.append(f"{key}={value}")
    env_file.write_text("\n".join(out) + "\n", encoding="utf-8")

    print(f"MySQL {version}: created databases '{a.db}' and '{test_db}' and user '{a.app_user}'@'{account_host}'.")
    print(f"Wrote {env_file} (contains the app user's generated password; it is git-ignored).")


if __name__ == "__main__":
    main()
