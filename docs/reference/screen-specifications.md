# Screen specifications

Viewport baseline 1920×889. All screens share the shell: sidebar 200px, header 50px, content padding 30px.
Every screen lists its components (ours), data, API and entities.

## Home (`/home`) — V
- **Layout:** content column (flex 1, max ≈ 1010px) plus right rail 350px with a 1px left border.
- **Components:** `PageHeader` (greeting 18/700 with a 2px underline), `Card`×4 link cards (icon, title 14/600, description, footer link),
  `SegmentedControl` (Hourly/Daily/Weekly/Monthly), `ReportChart` (page views, total visits, unique visitors, chats; legend checkboxes),
  right rail: `UpdatesFeed`, `PromoCard`, `ActivityFeed`.
- **API:** `GET /reports/website?bucket=`, `GET /activity`. **Entities:** visitor_sessions, visitor_events, chat_sessions, activity_events.

## Visitors (`/visitors`) — V
- **Toolbar:** List/Visual segmented control, "Total: N"; collapse-all, group-by `Select`, `SearchInput`.
- **Body:** grouped `DataTable` or a visual map. **Empty state:** "No active visitors" + "Simulate visitor".
- **Realtime:** WS `visitor.*`. **API:** `GET /visitors`, `POST /visitors/simulate`.

## Chat panel (`/chats/:id`) — D
- Chat tabs strip, `ChatConversation` (messages, system events, typing indicator), `ChatMessageComposer`
  (shortcut autocomplete on `/`, attachments, Enter to send), right `VisitorDetails`.
- **Actions:** Transfer, Ban, Tags, End chat (confirm). **API:** messages, accept, transfer, end. **WS:** chat.message, chat.typing.

## History (`/history`) — V
- **Toolbar:** filter popover, `SearchInput`, Clear search; "N unread"; `Pagination`.
- **Table:** selection, Name, Agent, Time, Rating, Messages (count `Badge` + preview).
- **Split panel:** `RightContextPanel` with Transcript | User info tabs, download and close buttons.

## Settings list pages (Agents, Departments, Shortcuts, Banned, Triggers) — V
- **Shared pattern:** toolbar [search 170px, primary "Add X", count label, optional filter] → `DataTable` (checkbox, 36px rows) → empty-state sentence.
- One `ResourceListPage` configuration powers all five pages.

## Settings form pages — V
- Back-chevron title; form column (≈ 520px, label column 110px) plus a `QuickTips` rail (≈ 200px).
- **Footer:** Save/Create (primary), Revert/Cancel, Reset to defaults (right).
- Sub-tabs as a `SegmentedControl`. Gated features show a `Notice` banner.

## Trigger editor — V
- Status, Name, Description, Fire once per visitor; Visual|Developer tabs; event `Select`; all/any `Select`.
- `ConditionBuilder` / `ActionBuilder` rows: grey background, field/operator/value, −/+ buttons, helper text.
