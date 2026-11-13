# Feature inventory

**V** Verified in the reference · **D** Documented (official docs) · **P** Proposed

## Chat workspace (primary scope)
| Feature | Status | Evidence / notes |
|---|---|---|
| Agent presence Online/Away/Invisible | V | Sidebar status menu |
| Idle timeout → Away/Invisible, ignore if chatting | V | Personal › Idle timeout |
| Incoming request counter ("N requests") | V | Sidebar footer |
| Serving a chat (chat panel, composer, transfer, end chat) | D | No live chat was available during the audit |
| Shortcuts in composer (`/name`, options as quick replies, auto-tags) | V (config) / D (usage) | Shortcuts page, Add shortcut quick tips |
| Visitor list grouped by activity, page title, URL, country, serving agent, department, browser, search engine, search term | V | Group-by select |
| Visual visitor mode | V (toggle) | Layout not captured |
| Simulate visitor | V | Button on the empty state |
| Chat history with advanced filter | V | History popover |
| Transcript: system events, ratings, comment, tags, download | V | Transcript panel |
| Visitor user info: notes, past visits/chats, path, geo, device, IP, UA | V | User info tab |
| Ban visitor; banned list with reason and date | V | User info + Banned page |
| Satisfaction ratings (good/bad + comment) | V | Widget › Settings, History rating column |
| Chat tags (predefined; allow creation during chats) | V | Account › Chat tags |
| File sending (toggle + types) | V | Account › File sending |
| Operating hours (account/department schedules) | V | Account › Operating hours |
| Timezone | V | Account › Timezone |
| Credit-card redaction | V | Account › Security |
| Email piping of transcripts | V | Account › Email piping |
| API clients | V | Account › API & SDKs |

## Routing and teams
| Feature | Status | Notes |
|---|---|---|
| Broadcast vs Assigned routing | V | Customization is plan-restricted in the reference. We implement both |
| Chat limit (account or per agent, max chats) | V | |
| Skills-based routing | V (gated) / D | |
| Departments (name, description, agents, enabled) | V | |
| Agents (display name, name, email, role, enabled, department filter) | V | |
| Roles and permissions | V (gated) / D | |
| Plan limits ("1 of 1 Agent used") | V | We model limits as account settings |

## Automation
| Feature | Status | Notes |
|---|---|---|
| Chat triggers: events (widget loaded, chat requested, message sent) | V | |
| Condition match all/any; 38 condition fields | V | Full list in action-inventory.md |
| Trigger actions: Send message, Set triggered, Wait, Set visitor name, Block visitor, Add/Remove tag, Set department, Replace/Append note | V | |
| Fire once per visitor | V | |
| Developer (code) trigger editor | V (tab) | Not implemented: P |
| Ticket macros, ticket triggers, automations, SLAs | D | Support product not accessible |

## Widget
| Feature | Status |
|---|---|
| Embed snippet | V |
| Appearance: title, theme color, position, badge, concierge, avatars | V |
| Pre-chat form (identity, phone, question, department) | V |
| Offline form | V |
| Visitor authentication (shared secret) | V |
| Allowed domains / blocked countries | V |

## Out of observed scope (built from docs plus the spec)
Tickets, views, customers, organizations, knowledge base, help center, macros, SLA, reports beyond chat,
admin audit log, email channel. All are labelled **D/P** in the parity matrix.
