# Page inventory — reference Chat agent dashboard

Audit date: 2026-11-13. Method: read-only inspection of the authorized, signed-in reference account in Chrome
(`/chat/agent`). No settings were saved and no records were created, edited or deleted. Draft forms were
opened and cancelled. Screenshots live in `screenshots/`. They contain real names and emails, so the
folder is excluded from git.

Legend: **V** = Verified in the reference · **D** = Documented in official product docs only · **P** = Proposed (our design choice)

| # | Page | Reference route | Our route | Status | Screenshot | Notes |
|---|------|-----------------|-----------|--------|-----------|-------|
| 1 | Home dashboard | `#home` | `/home` | V | 01-home.jpg | Greeting, 4 quick-link cards (Widget, Visitors, Analytics, Triggers), "Website analytics" chart with Hourly/Daily/Weekly/Monthly segmented control, right rail with product updates, a tags promo and "Recent website activity" feed |
| 2 | Visitors (list) | `#visitors/visitor_list/<group>` | `/visitors` | V | 02-visitors-list.jpg | List/Visual toggle, collapse-all, Group-by select, search, "Total:" counter, empty state "No active visitors" with a **Simulate visitor** button |
| 3 | Visitors (visual) | `#visitors/visual` | `/visitors?mode=visual` | V (toggle seen) | – | Visual mode exists; layout not captured (no live visitors) |
| 4 | History list | `#history` | `/history` | V | 03-history-list.jpg | Table: checkbox, Name, Agent, Time, Rating, Messages (count badge + first-message preview); "0 unread"; pager "Page 1 of N" |
| 5 | History filter popover | (popover) | `/history` | V | – | Search scope All/Chat/Offline msg; Unread; Keywords; Date range (from/to + time); Chats: at least N messages; Chats served: Completed/Dropped/Missed/Unresponsive; Satisfaction Good/Bad; Tags (contains any); Others: Triggered; Profile: Chat initiated by (Anyone/…), Visitor name; Search / Cancel |
| 6 | History transcript panel | (split panel) | `/history/:chatId` | V | – | Tabs Transcript / User info; download and close icons; Rating, Comment, Tags (edit pencil); system events ("X has joined", "has left") and messages with timestamps |
| 7 | History user info panel | (split panel) | `/history/:chatId?tab=info` | V | – | Avatar, name, email, phone, visitor notes, Past visits / Past chats counters, visitor path, location, browser, platform, device, IP, user agent; **Ban visitor** button (red) |
| 8 | Analytics | `#analytics` | `/analytics` | V (plan-gated) | – | Upsell on Team plan. Feature content: **D** |
| 9 | Monitor | `#monitor` | `/monitor` | V (plan-gated) | – | "Real-time monitoring" upsell. Content: **D** |
| 10 | Settings › Agents | `#agents` | `/settings/agents` | V | 04-settings-agents.jpg | Search, Add agent, "N enabled / N agent", Filter department; columns Display name (with status dot), Name, Email, Role, Enabled |
| 11 | Add agent | modal | `/settings/agents/new` | V | – | Plan limit reached → modal "Account limit reached" + Adjust plan. Form fields: **D** |
| 12 | Settings › Departments | `#departments` | `/settings/departments` | V | 05-settings-departments.jpg | Search, Add department, "N enabled / N departments"; columns Name, Description, Agents, Enabled; empty-state copy |
| 13 | Add department | `#departments` (form) | `/settings/departments/new` | V | 10-department-add.jpg | Department status (Enable checkbox + usage line), Name, Description, Department agents (chip picker), Create department / Cancel, Quick tips rail |
| 14 | Settings › Roles | `#roles` | `/settings/roles` | V (plan-gated) | – | Upsell "Roles and permissions". Content: **D** |
| 15 | Settings › Routing › Settings | `#routing/settings` | `/settings/routing` | V | 06-settings-routing.jpg | Restricted-feature banner, Chat routing card picker Broadcast/Assigned, Chat limit On/Off, Apply to Account/Agent, Maximum chats, Save/Revert/Reset to defaults, Quick tips |
| 16 | Settings › Routing › Skills | `#routing/skills` | `/settings/routing/skills` | V (plan-gated) | – | "Skills-based routing" upsell |
| 17 | Settings › Shortcuts | `#shortcuts` | `/settings/shortcuts` | V | 07-settings-shortcuts.jpg | Search, Add shortcut, "N shortcuts", Filter shortcuts; columns Shortcut (sortable), Message (multi-line, option lists render as radio rows), Available for, Tags |
| 18 | Add shortcut | form | `/settings/shortcuts/new` | V | 11-shortcut-add.jpg | Shortcut, Available for (All agents ▾), Message (+ Insert placeholder), Options (+ add), Tags (chat tag picker), Create shortcut (disabled until valid) / Cancel |
| 19 | Settings › Banned | `#banned` | `/settings/banned` | V | – | Search, Filters ▾, Add visitor, "N entries"; columns Visitor/IP address, Reason, Date created (sorted desc) |
| 20 | Settings › Triggers | `#triggers` | `/settings/triggers` | V | 08-settings-triggers.jpg | Search, Add trigger, "N enabled / N triggers"; columns Name, Description, Enabled |
| 21 | Edit trigger | `#triggers/view/<slug>` | `/settings/triggers/:id` | V | 09-trigger-edit.jpg | Trigger status, name, description, Fire only once per visitor, Visual/Developer tabs, Run trigger (event), Check all/any, condition rows (field/operator/value, −/+), action rows |
| 22 | Settings › Goals | `#goals` | `/settings/goals` | V (plan-gated) | – | "Conversion tracking" upsell |
| 23 | Widget › Getting started | `#widget/getting_started` | `/settings/widget` | V | – | Embed snippet textarea, visitor authentication link |
| 24 | Widget › Appearance | `#widget/appearance` | `/settings/widget/appearance` | V | – | Top title, Theme color, Widget position (Bottom left/right), Chat badge (On/Off; Image right/left/Text only; custom image; background color), Concierge (title, byline, avatar), Message style (Show avatars), Preview |
| 25 | Widget › Forms | `#widget/forms` | `/settings/widget/forms` | V | – | Visitor profile (Allow phone), Pre-chat form (greeting, Require identity / phone / question), Offline form (greeting), Messaging channels |
| 26 | Widget › Settings | `#widget/settings` | `/settings/widget/settings` | V | – | General preferences, Notification sounds, Enable satisfaction ratings |
| 27 | Widget › Security | `#widget/widget_security` | `/settings/widget/security` | V | – | Blocked countries, Allowed domains, Visitor authentication shared secret + Regenerate |
| 28 | Personal › Profile | `#personal/profile` | `/settings/personal` | V | – | Name/email, Display name, Tagline, Avatar upload/remove, Dashboard language (30 locales), Chat limit, Skills, Keyboard shortcuts toggle, Offline message notification |
| 29 | Personal › Sounds & notifications | `#personal/sounds_&_notifications` | `/settings/personal/notifications` | V | – | Notifications for chat request / new messages / status changes / session expiry; sounds per event with repeat (1–10) |
| 30 | Personal › Idle timeout | `#personal/idle_timeout` | `/settings/personal/idle` | V | – | On/Off, Ignore if chatting, Inactivity period (minutes), Idle status Away/Invisible |
| 31 | Personal › Email reports | `#personal/email_reports` | `/settings/personal/reports` | V (partly gated) | – | Daily/weekly analytics email toggles |
| 32 | Personal › Labs | `#personal/labs` | – | V (seen) | – | Experimental toggles. Not implemented: **P** |
| 33 | Account › Subscription | `#account/subscription` | `/settings/account` | V | – | Plan summary: Agents, Concurrent chats, Triggers, Departments, Widget customization limits |
| 34 | Account › Apps / API & SDKs | `#account/apps`, `#account/api_&_sdks` | `/settings/account/api` | V | – | API clients ("Add API client"), Mobile SDK "Add app"; private apps gated |
| 35 | Account › Email piping | `#account/email_piping` | `/settings/account/email` | V | – | On/Off |
| 36 | Account › Chat tags | `#account/chat_tags` | `/settings/account/tags` | V | – | Allow tag creation during chats; predefined tags list |
| 37 | Account › File sending | `#account/file_sending` | `/settings/account/files` | V | – | On/Off, allowed file types |
| 38 | Account › Operating hours | `#account/operating_hours` | `/settings/account/hours` | V | – | On/Off, Account vs Department schedule, per-day ranges, Display operating hours |
| 39 | Account › Timezone | `#account/timezone` | `/settings/account/timezone` | V | – | Timezone select |
| 40 | Account › Security | `#account/security` | `/settings/account/security` | V | – | Authentication options, credit-card redaction toggle |
| 41 | Account › Visitor list | `#account/visitor_list` | `/settings/account/visitor-list` | V | – | High-load dashboard toggle |
| 42 | Status menu | sidebar | (shell) | V | – | Online (green) / Away (amber) / Invisible (grey) |
| 43 | Avatar menu | header | (shell) | V | – | Name + View profile, Get help, Chat help center, Keyboard shortcuts, Check connection, Download debug report, Privacy policy, Leave session |
| 44 | Product switcher | header | – | V | – | Third-party product grid. Not reproduced (trademarked products) |
| 45 | Team › View all | sidebar | `/team` | V (seen) | – | Collapsible "Team" group listing agents |
| 46 | Requests bar | sidebar footer | (shell) | V | – | Pill "0 requests". Opens the incoming chat queue |
| 47 | Support ticket workspace | `/agent/*` | `/tickets` | **Not accessible** | – | Redirects to `/chat/agent`. This account is Chat-only. Ticketing is built from docs and spec: **D/P** |
| 48 | Help Center / Guide | – | `/help` | Not accessible | – | **D/P** |
| 49 | Live chat panel (serving a chat) | – | `/chats/:id` | Not observed | – | Agent was Invisible with 0 requests. Built from docs: **D** |
