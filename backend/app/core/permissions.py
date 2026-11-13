"""Permission codes and default role grants. Enforced server-side by `require()`."""

ALL_PERMISSIONS: dict[str, str] = {
    "chats.serve": "Accept and serve chats",
    "chats.view_all": "View every chat and transcript",
    "chats.delete": "Delete chat transcripts",
    "visitors.ban": "Ban visitors",
    "visitors.view": "View live visitors",
    "shortcuts.manage": "Manage shared shortcuts",
    "triggers.manage": "Manage chat triggers",
    "agents.manage": "Manage agents",
    "departments.manage": "Manage departments",
    "roles.manage": "Manage roles",
    "settings.manage": "Manage account, widget and routing settings",
    "tickets.view": "View tickets",
    "tickets.edit": "Create and update tickets",
    "tickets.delete": "Delete tickets",
    "tickets.note_only": "Add private notes only",
    "views.manage_shared": "Manage shared views",
    "macros.manage": "Manage shared macros",
    "automations.manage": "Manage ticket triggers, automations and SLAs",
    "customers.manage": "Create and edit customers and organizations",
    "knowledge.edit": "Write knowledge articles",
    "knowledge.publish": "Publish knowledge articles",
    "reports.view": "View reports",
    "reports.view_all": "View reports for all agents",
    "audit.view": "View audit log",
    "billing.manage": "Manage subscription",
}

_agent = [
    "chats.serve", "visitors.ban", "visitors.view", "tickets.view", "tickets.edit",
    "customers.manage", "knowledge.edit", "reports.view",
]
_lead = _agent + ["chats.view_all", "departments.manage", "views.manage_shared", "macros.manage", "knowledge.publish", "reports.view_all"]
_admin = [p for p in ALL_PERMISSIONS if p != "billing.manage"]

SYSTEM_ROLES: dict[str, dict] = {
    "owner": {"name": "Account owner", "permissions": list(ALL_PERMISSIONS)},
    "admin": {"name": "Administrator", "permissions": _admin},
    "lead": {"name": "Team lead", "permissions": _lead},
    "agent": {"name": "Agent", "permissions": _agent},
    "light_agent": {"name": "Light agent", "permissions": ["tickets.view", "tickets.note_only", "reports.view"]},
    "end_user": {"name": "End user", "permissions": []},
}
