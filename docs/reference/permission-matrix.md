# Permission matrix

The reference account has a single Administrator agent, and Roles are plan-gated. Role behavior below
therefore comes from documentation (**D**) and our design (**P**), except where marked **V**.

| Capability | Owner | Admin | Team lead | Agent | Light agent | End user |
|---|---|---|---|---|---|---|
| Change own presence | ✓ | ✓ | ✓ | ✓ | – | – |
| Serve or accept chats | ✓ | ✓ | ✓ | ✓ | – | – |
| View all chat history | ✓ | ✓ (V) | ✓ | own and department (D) | read | own |
| Ban visitor | ✓ | ✓ (V) | ✓ | ✓ (D) | – | – |
| Manage shortcuts (shared) | ✓ | ✓ (V) | ✓ | personal only (D) | – | – |
| Manage triggers | ✓ | ✓ (V) | – | – | – | – |
| Manage agents and departments | ✓ | ✓ (V) | departments only (P) | – | – | – |
| Routing, widget, account settings | ✓ | ✓ (V) | – | – | – | – |
| Roles management | ✓ | ✓ | – | – | – | – |
| Billing / subscription | ✓ | view (V) | – | – | – | – |
| Tickets: create/update | ✓ | ✓ | ✓ | ✓ | private notes only | own requests |
| Knowledge: publish | ✓ | ✓ | ✓ | draft (P) | – | read published |
| Reports | ✓ | ✓ | team | own (P) | – | – |
| Audit log | ✓ | ✓ | – | – | – | – |

The backend enforces this with permission codes (for example `chats.serve`, `settings.manage`) attached
to roles. See `backend/app/core/permissions.py`.
