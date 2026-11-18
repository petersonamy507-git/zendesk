# Parley — customer support & live chat platform

Original product (own name, code and assets) modelled on the structure of a legacy live-chat agent dashboard.
Reference audit: `docs/reference/`. Progress and gaps: `docs/feature-parity-matrix.md`.

| Part | Stack |
|---|---|
| `frontend/` | Vite, React, TypeScript, Tailwind, React Router, TanStack Query/Table, Zustand, RHF + Zod, Recharts, TipTap, Sonner |
| `backend/` | FastAPI, SQLAlchemy 2, Alembic, Pydantic v2, JWT + rotating refresh cookies, Argon2, WebSockets, Celery |
| `widget/` | Dependency-free TypeScript, Shadow DOM, builds to `frontend/public/widget/parley-widget.js` |
| Database | MySQL (InnoDB, utf8mb4). Developed and tested on **8.0.44**; 8.4 LTS is the target but not yet exercised. SQLite is used **only** by the fast unit-test profile |
| Realtime | WebSockets + Redis pub/sub when `REDIS_URL` is set; in-process broker otherwise (single worker) |

## Run it (Windows)

**Prerequisites:** Python 3.12+, Node.js 20+, MySQL 8 running locally.

| What | Command (from the project folder) |
|---|---|
| **First time on a PC** (packages, widget build, MySQL database + `.env`, migrations) | `setup.bat` (or `powershell -ExecutionPolicy Bypass -File scripts\setup.ps1`) |
| **Start** | `start.bat` (or `powershell -ExecutionPolicy Bypass -File scripts\dev.ps1`), then **Ctrl+C** to stop |
| Start in the background | `powershell -ExecutionPolicy Bypass -File scripts\dev.ps1 -Detach` |
| **Stop** | `stop.bat` (or `scripts\stop-dev.ps1`) |
| Preview what `start` would do, without doing it | `scripts\dev.ps1 -DryRun` |

Then open **http://localhost:5643** (also **http://parley.localhost:5643**: the same app with its own cookie jar, so it never
mixes with other apps running on `localhost`). Register a workspace, set your status to **Online**, and chat from
`http://localhost:5643/widget/demo.html?ws=<your workspace address>`.

### Ports
| Port | Used for | Exposed to |
|---|---|---|
| **5643** | web app (and the `/api` proxy, WebSockets included) | this PC (or the network with `-Lan`) |
| **8643** | API | this PC only, always |

They are deliberately unusual so they don't collide with other dev servers (5173, 5181, 8000, 8010...). The scripts never touch a
program that isn't Parley's and refuse to start on a taken port instead of drifting onto it. To use other ports:
`scripts\dev.ps1 -UiPort 5650 -ApiPort 8650`.

### Using it from another PC
* **Run the project on a second PC:** copy the folder (without `node_modules`, `backend\.venv`, `backend\.env`) or clone it, then run
  `setup.bat` and `start.bat` there. `setup.ps1` installs the exact tested package versions (`backend\requirements.lock`, `package-lock.json`),
  asks for the MySQL admin password once (never stored), creates a database plus a least-privilege user, and writes `backend\.env`.
* **Open the app from another PC on your network:** `scripts\dev.ps1 -Lan` (or `start.bat -Lan`). It prints the address, for example
  `http://192.168.1.20:5643`. Only the web port is opened; the API stays on the host PC. Windows Firewall normally blocks inbound
  connections: run this **once** in an *Administrator* PowerShell (private networks only) if the other PC cannot connect:
  `New-NetFirewallRule -DisplayName "Parley dev web (5643)" -Direction Inbound -Protocol TCP -LocalPort 5643 -Action Allow -Profile Private`.
  Anyone on that network can then open the app and register a workspace, so use it on trusted networks only.
* **Embed the chat widget on any other site** (including another dev server): add
  `<script src="http://<parley address>:5643/widget/parley-widget.js" data-workspace="<workspace address>" data-api="http://<parley address>:5643" async></script>`
  (the Settings › Widget › Getting started page shows the exact snippet). The widget endpoints accept any website; the workspace's
  *Allowed domains* setting can restrict them.

### Run by hand instead of the scripts
```
:: terminal 1 - API
cd backend
.venv\Scripts\activate
alembic upgrade head
uvicorn app.main:app --host 127.0.0.1 --port 8643

:: terminal 2 - web app (proxies /api to 8643)
cd frontend
npm run dev
```
For many simultaneous chat users run several API workers. That needs Redis (`REDIS_URL=redis://127.0.0.1:6379/0` in
`backend/.env`) so events, presence, rate limits and the sweeper are shared across workers:
`uvicorn app.main:app --host 127.0.0.1 --port 8643 --workers 4`. Keep `THREADPOOL_SIZE` small (default 16; 8 measured better
with several workers) and below `DB_POOL_SIZE + DB_MAX_OVERFLOW`, and make sure MySQL's `max_connections` covers
workers × pool. See `backend/loadtest/README.md` to measure.

Manual database setup instead of `setup.bat`: create a database and user in MySQL, `copy backend\.env.example backend\.env`, edit `DATABASE_URL`
and `JWT_SECRET`. Environment variables for the web app: `UI_PORT`, `API_PORT`, `UI_HOST` (`0.0.0.0` = reachable from the network),
`UI_ALLOWED_HOSTS` (extra host names, comma separated).

## Tests
```
cd backend && .venv\Scripts\pytest                        # fast: in-memory SQLite (concurrency tests skip)
cd backend && set TEST_DB=mysql && .venv\Scripts\pytest   # real MySQL via TEST_DATABASE_URL in backend\.env
cd frontend && npm test && npm run typecheck
```
The MySQL profile drops and recreates tables, so it refuses to run unless the database name ends in `_test`.

### Migration notes (MySQL)
- Never emit `op.drop_index` before dropping a table in a downgrade: MySQL refuses (error 1553) while a foreign key relies on the index. Drop the table instead.
- Use `op.batch_alter_table(...)` for constraint changes so the chain stays runnable on SQLite as well.
- After editing models run `alembic revision --autogenerate`, review it, then `alembic check` (must report no changes).

## Architecture notes
- **Reusable UI**: `frontend/src/components/ui` (primitives) → `layout` → `domain` → `features/*`. One `DataTable`,
  `ResourceListPage`, `ConditionBuilder`, `useSettingsSection` etc. serve every screen.
- **Backend layering**: thin routers (`api/v1`) → services (`services/`) → tenant-scoped repositories (`repositories/base.py`).
- **Tenant isolation**: every tenant table has an indexed `account_id`; `Repo` always filters by it.
- **Concurrency**: chat acceptance is one conditional `UPDATE`; message order uses a refreshed `SELECT … FOR UPDATE` + per-chat `seq` (unique in the database).
- **Network safety**: the agent API only answers its own origins with credentials; the public widget endpoints answer any website without credentials
  (visitors authenticate with a header token, never a cookie). Client IPs come from `X-Forwarded-For` only when the direct peer is in `TRUSTED_PROXIES`,
  so visitors cannot spoof their address to dodge bans or rate limits. List proxies there, never client networks.
- **Plain-HTTP safe**: the app and widget avoid APIs that browsers restrict to HTTPS/localhost (`crypto.randomUUID`, async clipboard) so they work when opened by IP address on a LAN.
- **Audit**: state changes write immutable `audit_logs` rows.

## Production
`docker-compose.yml` + `infrastructure/` describe MySQL 8.4, Redis, API, Celery worker and nginx. They have **not been run**
(Docker was deferred). Set `MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD`, `JWT_SECRET`, `PUBLIC_URL`, and terminate TLS in front of nginx.

## Known limitations
See the parity matrix. In short: tickets, customers, knowledge base, help center, macros/SLA/automations and external
channels are not built yet; Redis, MySQL 8.4 and Docker have not been exercised.
