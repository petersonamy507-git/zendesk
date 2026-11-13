# Feature parity matrix

Updated 2026-11-13 (after the screenshot comparison, see `reference/screenshot-comparison.md`). Columns follow the spec. **Reference Verified** means observed in the account (see `reference/`);
**D** = documented only; **P** = our proposal. "Tests" counts automated tests that exercise the feature; "Visual parity" is
**Not measured** everywhere: no automated screenshot comparison exists yet, so no parity claim is made. A row is only
marked ✓ when the feature works end to end and has passing tests; otherwise it says what is missing.

Legend: ✓ done and tested · ◐ partial · ✗ not started

| Module | Feature | Reference Verified | Frontend | Backend | Database | Tests | Visual Parity | Notes |
|---|---|---|---|---|---|---|---|---|
| Shell | Sidebar, status menu, header, avatar menu, requests pill | Verified | ✓ | ✓ | ✓ | ◐ | Not measured | Layout metrics from the reference. UI smoke-tested manually in a browser |
| Auth | Register, login, logout, refresh rotation + reuse detection, lockout | P/D | ✓ | ✓ | ✓ | ✓ | n/a | 7 API tests |
| Auth | Forgot/reset password, invite accept, email verification | P/D | ✓ | ✓ | ✓ | ✓ (reset) | n/a | Emails go to the log/outbox until SMTP is configured |
| Auth | TOTP two-factor | D | ✓ | ✓ | ✓ | ✓ | n/a | |
| Auth | RBAC + tenant isolation | D | ✓ | ✓ | ✓ | ✓ | n/a | Cross-tenant test on departments/agents. Other modules get the same guard via `Repo` |
| Home | Cards, website analytics chart (hour/day/week/month), activity feed, setup checklist | Verified | ✓ | ✓ | ✓ | ◐ | Not measured | Chart computed from stored rows. No dedicated test for bucket math yet |
| Visitors | Live list, group-by (9), search, List/Visual with 7-status legend, Simulate visitor, high-load mode | Verified (controls, legend, empty state) | ✓ | ✓ | ✓ | ✓ | Not measured | Populated list was never observed in the reference |
| Visitors | Start chat from list | D | ✓ | ✓ | ✓ | ◐ | n/a | |
| Chat | Request → route → accept (race-safe) → messages → transfer → end | D (no live chat seen) | ✓ | ✓ | ✓ | ✓ | Not measured | Concurrency tested on MySQL 8.0 with parallel threads: one winner per contested chat, gap-free message order, idempotent retries (found and fixed 2 real races). Not load-tested |
| Chat | Realtime (WS), typing, reconnect catch-up, idempotent sends | D | ✓ | ✓ | ✓ | ✓ | n/a | In-process broker verified. **Redis broker is implemented but untested: Redis isn't installed on this machine** |
| Chat | Notes, attachments, tags, shortcuts autocomplete, ratings | Verified (config) / D (usage) | ✓ | ✓ | ✓ | ✓ | Not measured | |
| Widget | Launcher, pre-chat, offline form, chat, ratings, file upload, WS + polling fallback | Verified (settings) | ✓ | ✓ | ✓ | ◐ | n/a | Verified manually in a browser. No automated widget tests |
| History | Filters, search, pager, transcript, user info, tags, download, bulk delete | Verified | ✓ | ✓ | ✓ | ✓ | Not measured | |
| Banned | List, add IP, ban from profile, unban | Verified | ✓ | ✓ | ✓ | ✓ | Not measured | |
| Triggers | Builder (38 conditions, 10 actions), once-per-visitor, delay timers, developer JSON | Verified | ✓ | ✓ | ✓ | ✓ | Not measured | Delay timers use in-process timers (lost on restart). Celery migration pending |
| Shortcuts | CRUD, visibility, options, tags, placeholders | Verified | ✓ | ✓ | ✓ | ✓ | Not measured | |
| Agents / Departments | CRUD, plan limits, roles, department membership, bulk chat limit / role / skills | Verified (list, bulk dialogs) | ✓ | ✓ | ✓ | ✓ | Not measured | Add-agent form fields come from docs (the reference hit its plan limit) |
| Roles | System + custom roles, permission editor | Verified (gated) / D | ✓ | ✓ | ✓ | ✓ | n/a | |
| Routing | Broadcast / assigned, chat limits, skills tab | Verified | ✓ | ✓ | ✓ | ✓ | Not measured | Skills routing: skills are stored, but matching them is **not implemented** |
| Widget settings | Appearance with live preview, forms, settings, security (domains, countries, secret) | Verified | ✓ | ✓ | ✓ | ◐ | Not measured | Domain/country toggles and offline phone are tested. HMAC visitor auth and the preview pane are **not tested** |
| Personal | Profile, sounds (tone + volume), idle timeout + alert, email reports, Labs docked panel, password, 2FA, sessions | Verified | ✓ | ✓ | ✓ | ◐ | Not measured | Preference validation tested. Email reports are stored only (no sender job). Docked panel and idle alert are manually smoke-tested only |
| Account | Operating hours, timezone, chat tags, file-types mode, security (card redaction), visitor list, support integration, live-chat SLA, audit log | Verified | ✓ | ✓ | ✓ | ✓/◐ | Not measured | File types, redaction, high-load tested. Support-integration and SLA settings are stored but **have no effect until Tickets exist**. Email piping not delivered. Department schedules not built |
| Analytics / Monitor | Total + served/missed + wait-time chart, KPI strip, agent table, CSV export, saved reports, realtime monitor | Verified (layout of the gated preview only) / D | ✓ | ✓ | ✓ | ✗ | Not measured | Metric math has no tests yet |
| Privacy | Visitor export and erasure | D | ✗ (API only) | ✓ | ✓ | ✗ | n/a | |
| Tickets | CRUD, statuses, views, replies/notes, merge, bulk | Not accessible | ✗ | ✗ | ◐ (tables) | ✗ | n/a | Schema exists. No API or UI yet |
| Views / Macros / Ticket triggers / Automations / SLA | | Not accessible | ✗ | ✗ | ◐ (tables) | ✗ | n/a | The shared rule engine and ConditionBuilder already exist |
| Customers / Organizations | | Not accessible | ✗ | ✗ | ◐ (tables) | ✗ | n/a | |
| Knowledge base / Help Center | | Not accessible | ✗ | ✗ | ◐ (tables) | ✗ | n/a | |
| Channels (email, social, voice) | | Not accessible | ✗ | ✗ | ◐ (table) | ✗ | n/a | **No external channel is functional** |
| Run / network | One-click start/stop/setup scripts, own origin (`parley.localhost`), opt-in LAN mode, public widget CORS, trusted-proxy client IPs, plain-HTTP-safe browser code | n/a | ✓ | ✓ | n/a | ✓ (12 backend + 4 frontend) | n/a | Setup verified from a clean copy of the repo (fresh venv, `npm ci`, new DB + `.env`, migrations, real chat). **LAN mode is untested across machines**: no listener was opened and the firewall was not changed. HTTPS/TLS not set up |
| Infra | Alembic migrations (2), Docker/nginx config, Celery app | n/a | n/a | ◐ | ✓ | ◐ | n/a | Migrations verified on **MySQL 8.0.44** (up, down, re-up, drift check clean) and SQLite. **MySQL 8.4 itself is untested** (the local server is 8.0). Docker files and Celery are untested by decision / missing Redis |

## Test status (2026-11-13)
- Backend: 53 pytest tests pass on **real MySQL 8.0.44** (`TEST_DB=mysql pytest`, ~16 s), including 3 parallel-thread concurrency tests (repeated 6× with no flakes). 50 pass on in-memory SQLite (the 3 concurrency tests skip there).
- Frontend: 16 Vitest tests pass, `tsc` clean, production build succeeds.
- Playwright E2E, visual regression and WebSocket-under-Redis tests: not written.

## Overall
Chat platform core (everything observable in the reference account) is implemented and manually smoke-tested.
The Support/ticketing, customer, knowledge, automation and channel areas listed as ✗ are not started. **This is not 100% complete.**
