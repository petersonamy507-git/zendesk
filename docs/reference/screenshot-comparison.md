# Comparison: reference screenshots (`E:\zendesk\screenshots`) vs. our app

Reviewed 2026-11-13. The folder has about 130 images (`cap01–cap61`, `zd01–zd55`, `page-*`). Many are duplicates of the same
screen. The folder contains real names, emails and chat content, so it is git-ignored and nothing from it is copied into the app.
Status: ✓ already matched · ➕ gap found and added in this pass · ◐ partially matched · ✗ not built (reason given).

| Screenshots | Reference screen / dialog | Status | What we did / why not |
|---|---|---|---|
| cap01, zd10, zd20 | Home: greeting, 4 link cards, Website analytics (Hourly/Daily/Weekly/Monthly), right rail | ✓ | Metrics match the earlier audit. Our rail shows a setup checklist instead of third-party product news |
| cap02, zd49 | Status dropdown: Online / Away / Invisible | ✓ | |
| cap03, zd21 | Visitors list: List/Visual, Group by, search, Total | ✓ | |
| cap04, zd48 | Visitors **Visual** mode with a 7-status legend (Incoming, Assigned, Clicked, Served, Triggered, Active, Idle) | ➕ | Added statuses to the API (`status`), the legend and colored status badges on tiles, plus tokens `--visitor-*` |
| cap05, cap05b, zd22, zd24 | History list and pager | ✓ | |
| cap06, zd25 | Analytics layout: big total, range + Daily selects, stacked served/missed bars with wait-time line, KPI strip | ➕ | Rebuilt the chat view to this layout from real stored data (range presets, daily/weekly grouping, KPI metric switch) |
| cap07, zd26 | Monitor (real-time tiles) | ◐ ➕ | Added 👍/👎 counts and colored agent-status counts. The reference page itself is a marketing preview, so exact tile layout is not verifiable |
| cap08, cap09, cap53, zd27, zd28 | Agents / Departments lists | ✓ | |
| cap10, cap50, zd29 | Roles (upsell page) | ✓ | We provide a working roles editor (superset) |
| cap11–13, zd30, zd31 | Routing (Broadcast/Assigned, chat limit) and Skills (upsell) | ✓ | Chat limit range now 1–20 as in the reference |
| cap14, cap61, zd32 | Shortcuts list and Add shortcut | ✓ | |
| cap15, zd33 | Banned list | ✓ | |
| cap16, cap59, zd34 | Triggers list and Add trigger | ✓ ➕ | "Fire only once per visitor" now defaults to off, as in the reference |
| cap17, zd35 | Goals / Conversion tracking (upsell) | ✗ | Conversion tracking is a separate paid product. No goals data model exists. Not built |
| cap18, zd37 | Personal › Profile (display name, tagline, avatar 100 KB / 50×50, chat limit, skills ≤ 5, keyboard shortcuts, offline notification) | ➕ | Added the 100 KB avatar rule (stored inline so the public widget can show it), skills ≤ 5, chat limit 1–20, offline-message option |
| cap19 | Sounds & notifications: sound choice + volume per event, repeat, session expiry | ➕ | Four events with five tones and volume sliders, preview on change, tones actually played on incoming chats |
| cap20 | Idle timeout: default 15 min, Away/Invisible radio | ➕ | Default 15 min; radio buttons |
| cap58 | **Idle alert** "Dismiss / Go online" | ➕ | Shown after an automatic status change |
| cap21 | Email reports: Daily, Weekly (Sunday), Monthly | ➕ | Added Monthly and corrected Sunday. **Delivery needs SMTP**; the UI says so |
| cap22 | Personal › **Labs**: "Docked chat panel" | ➕ | Added the tab and a working docked chat panel (accept/jump to chats from any page) |
| cap36 | Personal › Password | ✓ | Ours is stricter (10+ characters with letters and numbers) on purpose |
| cap37 | Personal › link to a support-desk email | ✗ | Specific to the third-party support-desk link |
| cap23 | Account › Subscription rows | ✓ ➕ | Added "Concurrent chats" and "Widget customization" rows |
| cap24 | Account › Apps (marketplace "My Apps") | ✗ | Third-party marketplace. No app platform in our product |
| cap25 | Account › API & SDKs (API clients, mobile SDK apps) | ✗ | No public developer API or mobile SDK exists yet, so credentials would be inert |
| cap26 | Account › Email piping | ◐ | Setting is stored; delivery needs SMTP |
| cap27 | Chat tags: general preference, predefined list grouped by letter, allowed characters | ➕ | Grouped list, tag validation (letters, digits, `_`, `-`), duplicate check |
| cap28 | File sending: default PDF/PNG/JPEG/GIF/TXT vs. extended + risk acknowledgement | ➕ | Implemented and enforced by the upload API (extra types stay blocked until risk is accepted) |
| cap29 | Operating hours | ◐ | Account schedule works. **Department schedules and the slider UI are not built** |
| cap30 | Timezone | ✓ | |
| cap31 | Security: authentication options, credit-card redaction | ◐ ➕ | Redaction now masks with block characters, keeps the last 4 digits, and checks Luhn. "Authentication options › Manage" (SSO) is not built |
| cap32 | Visitor list high-load dashboard | ➕ | Now actually hides browsing visitors, leaving only Incoming and Served |
| cap33 | Account › Support integration (automatic ticket creation, transcript visibility, ticket assignment, offline variants) | ➕ ◐ | Added the tab and stored settings. **Takes effect when the Tickets module exists** (not built) |
| cap34 | Account › SLAs "Reply time SLAs for live chat" | ➕ ◐ | Added the tab and toggle. Same dependency on Tickets/SLA |
| cap35 | Account › Labs | ✗ | Empty in the reference |
| cap38/zd36/zd51 | Widget › Getting started | ✓ | |
| cap39, zd52 | Widget › Appearance: theme color, position, chat badge (4 layouts), badge image/color, concierge, **live preview** | ➕ | Added the live preview pane (chat / pre-chat / offline / badge, desktop/mobile), custom-image badge with gallery + upload (1 MB), badge background color, contrast-aware text |
| cap40, zd53 | Widget › Forms: visitor profile on/off, pre-chat (off by default), offline form with phone + messaging channel | ➕ | Added visitor-profile toggle, offline "require phone" (enforced by the API), Messenger link in the offline view |
| cap41, zd54 | Widget › Settings | ✓ | |
| cap42, zd55 | Widget › security: blocked countries (on/off + select), allowed domains (on/off + add), visitor authentication secret | ➕ | Added the on/off switches (enforced server-side), a country picker, domain validation |
| cap43-add-agent, zd50 | Add agent → account limit modal | ✓ | |
| cap43-plan-upgrade, cap44, cap54, cap55 | Plan downgrade, feature announcement, payment notices | ✗ | Billing/marketing dialogs of the hosted service; we have no billing |
| cap45 | Export conversion data (CSV) | ✗ | Part of Goals (above) |
| cap46, cap47, cap48 | **Bulk actions on Agents**: Set chat limit (1–20), Reassign role, Assign skills (≤ 5) | ➕ | Added all three with a transactional, tenant-scoped, audited bulk API |
| cap49 | Onboarding wizard (Welcome, Complete profile, Integrate Support, Embed widget) | ◐ | Our Home "Get set up" checklist covers the same steps. No modal wizard |
| cap51 | Unlink support-desk account | ✗ | Third-party account link |
| cap52 | **Connection monitor** dialog (server, connection type, uptime, attempts, frames, latency) | ➕ | "Check connection" now shows live realtime diagnostics from our own WebSocket client; added "Download debug report" |
| cap56 | Product switcher tray | ✗ | Lists other vendors' products |
| cap57 | Team panel with "View all" | ✓ | |
| zd23 | "You have signed in from another location" modal | ✗ | The reference enforces one concurrent session. We allow several, with a session list for revocation. **Not built, by design** |
| zd01–zd04, zd11–zd15, teamwork-login | Sign-in pages of the hosted service, expired Support trial | ✗ | Not our UI |
| page-*.png | Duplicates of the above | – | |

## Still open from this comparison
1. Department-level operating hours and the schedule sliders.
2. Authentication options (SSO) under Account › Security.
3. Onboarding wizard modal.
4. Support integration and SLA settings only matter once tickets exist.
5. Visual comparison: layouts were compared by eye, **not** by automated pixel diff.
