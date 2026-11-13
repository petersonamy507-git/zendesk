# Action inventory

Each action maps to an API operation. **V/D/P** as elsewhere. "Safe" means we exercised the control
in the reference without persisting anything.

| Area | Control | Reference behavior | API | Status |
|---|---|---|---|---|
| Shell | Status menu → Online/Away/Invisible | Changes presence; the activity feed logs "You are now X" | `PUT /api/v1/agents/me/status` + WS `presence.updated` | V (opened, not changed) |
| Shell | Requests pill | Opens the incoming queue | `GET /api/v1/chats?state=incoming` | V (seen) |
| Shell | Avatar › Leave session | Signs out | `POST /api/v1/auth/logout` | V (seen) |
| Shell | Avatar › Check connection | Connectivity test | `GET /api/v1/health` | V (seen) |
| Shell | Avatar › Keyboard shortcuts | Shortcut help dialog | client only | V (seen) |
| Home | Hourly/Daily/Weekly/Monthly | Re-buckets the website analytics chart | `GET /api/v1/reports/website?bucket=` | V (safe) |
| Visitors | List/Visual toggle | Changes the view | client | V (safe) |
| Visitors | Group by | 9 options (see below) | `GET /api/v1/visitors?group_by=` | V |
| Visitors | Search | Filters visitors | query param | V |
| Visitors | Simulate visitor | Creates a test visitor | `POST /api/v1/visitors/simulate` | V (seen) |
| Visitors | Click visitor → Serve / Start chat | Opens chat | `POST /api/v1/chats/{id}/accept` | D |
| History | Filter popover › Search | Applies filters | `GET /api/v1/chats/history?...` | V (safe) |
| History | Clear search | Resets filters | client | V |
| History | Row click | Opens the transcript split panel | `GET /api/v1/chats/{id}` | V (safe) |
| History | Pager prev/next | Pages | `page=` | V |
| History | Download transcript | Downloads a text file | `GET /api/v1/chats/{id}/transcript` | V (seen) |
| History | Edit tags (pencil) | Edit chat tags | `PATCH /api/v1/chats/{id}` | V (seen) |
| History | Checkbox selection | Bulk delete (D) | `POST /api/v1/chats/bulk-delete` | V (checkbox) |
| User info | Name/email/phone/notes inline edit | Saves the visitor profile | `PATCH /api/v1/visitors/{id}` | V (seen) |
| User info | Ban visitor | Adds to the banned list | `POST /api/v1/banned` | V (seen) |
| Agents | Add agent | Plan-limit modal | `POST /api/v1/agents` (limit → 409) | V (safe) |
| Agents | Filter department | Filters the list | `department_id=` | V |
| Agents | Row click → edit | Edit agent | `PATCH /api/v1/agents/{id}` | D |
| Departments | Add department → Create | Name, description, agents, enabled | `POST /api/v1/departments` | V (form, cancelled) |
| Routing | Broadcast/Assigned, chat limit, apply to, max | Save/Revert/Reset | `PUT /api/v1/routing/settings` | V (not saved) |
| Shortcuts | Add shortcut → Create | name, availability, message, options, tags | `POST /api/v1/shortcuts` | V (form, cancelled) |
| Shortcuts | Insert placeholder | Inserts `{{visitor.name}}` and similar | client | V (seen) |
| Banned | Add visitor / Filters | Manage bans | `POST/DELETE /api/v1/banned` | V |
| Triggers | Add trigger / edit / enable toggle | Builder | `POST/PATCH /api/v1/triggers` | V (opened, not saved) |
| Widget | All tabs | Save/Revert/Reset to defaults | `PUT /api/v1/widget/settings` | V (not saved) |
| Widget security | Regenerate secret | New shared secret | `POST /api/v1/widget/secret/regenerate` | V (not clicked) |
| Personal | Profile, sounds, idle, reports | Save/Revert | `PUT /api/v1/users/me/preferences` | V (not saved) |
| Account | Every tab | Save/Revert | `PUT /api/v1/accounts/current/settings/{section}` | V (not saved) |

## Enumerations captured

- **Visitor group-by:** Activity, Page title, Page URL, Country, Serving agent, Department, Browser, Search engine, Search term
- **Trigger events:** When a visitor has loaded the chat widget; When a visitor requests a chat; When a chat message is sent
- **Trigger match:** Check all of the following conditions; Check any of the following conditions
- **Trigger condition fields (38):** Hour of day, Day of week, Still on site, Still on page, Visitor IP, Visitor host name, Visitor city, Visitor region, Visitor country code, Visitor country name, Visitor previous chats, Visitor previous visits, Visitor page URL, Visitor page title, Visitor page count, Previous page, Visitor name, Visitor triggered, Visitor email, Visitor referrer, Visitor search engine, Visitor search terms, Visitor tag, Visitor department, Visitor user agent, Visitor browser, Visitor platform, Account status, Department status, Visitor status, Visitor is chatting, Visitor requesting chat, Visitor served, Department, Sender, Sender type, Message, Queue size (account)
- **Trigger actions (10):** Send message to visitor, Set triggered (shown on dashboard), Wait, Set name of visitor, Block visitor, Add tag, Remove tag, Set visitor department, Replace note, Append note
- **History chat-served:** Completed, Dropped, Missed, Unresponsive · **Rating:** Good, Bad · **Search scope:** All, Chat, Offline msg
- **Presence:** Online, Away, Invisible · **Idle status:** Away, Invisible
- **Dashboard languages:** 30 locales (we ship English and design for i18n)
