# Navigation map

The reference uses hash routing under `/chat/agent`. Our app uses React Router paths (see `page-inventory.md`).

```
Shell
├── Sidebar (200px, teal #03363d; expanded group #012c32; active item #56777a)
│   ├── Logo
│   ├── Status menu ─ Online | Away | Invisible
│   ├── Home ................................ #home
│   ├── Visitors ............................ #visitors/visitor_list/<group_by>   [List | Visual]
│   ├── History ............................. #history  → transcript split panel [Transcript | User info]
│   ├── Analytics ........................... #analytics   (plan-gated)
│   ├── Monitor ............................. #monitor     (plan-gated)
│   ├── Settings ▾
│   │   ├── Agents .......................... #agents          → Add agent (plan limit modal)
│   │   ├── Departments ..................... #departments     → Add department form
│   │   ├── Roles ........................... #roles           (plan-gated)
│   │   ├── Routing ......................... #routing/settings | #routing/skills
│   │   ├── Shortcuts ....................... #shortcuts       → Add shortcut form
│   │   ├── Banned .......................... #banned          → Add visitor
│   │   ├── Triggers ........................ #triggers        → #triggers/view/<slug>, Add trigger
│   │   ├── Goals ........................... #goals           (plan-gated)
│   │   ├── Widget .......................... #widget/{getting_started|appearance|forms|settings|widget_security}
│   │   ├── Personal ........................ #personal/{profile|sounds_&_notifications|idle_timeout|email_reports|labs}
│   │   └── Account ......................... #account/{subscription|apps|api_&_sdks|email_piping|chat_tags|file_sending|operating_hours|timezone|security|visitor_list}
│   ├── Team ▾ → View all
│   └── Footer: "N requests" pill (incoming queue)
└── Header (50px, white, 1px bottom border)
    ├── Breadcrumb / page title (left)
    ├── Product switcher (not reproduced)
    └── Avatar menu → View profile · Get help · Help center · Keyboard shortcuts · Check connection · Download debug report · Privacy policy · Leave session
```

Home card links: Manage widget → `#widget`, View visitors list → `#visitors/visitor_list`, View analytics → `#analytics`,
Manage triggers → `#triggers`.

## Our additions (Documented or Proposed, outside the observed Chat-only account)

```
├── Chats (live serving workspace, multi-tab)   D
├── Tickets / Views                              D/P  (Support workspace not accessible in the reference)
├── Customers / Organizations                    D/P
├── Knowledge base (admin) and /help (public)    D/P
├── Macros / Automations / SLA                   D/P
└── Admin: Audit log, Channels, Integrations     P
```
