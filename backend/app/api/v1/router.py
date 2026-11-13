from fastapi import APIRouter

from app.api.v1 import admin, auth, chat_admin, chats, files, reports, team, users, visitors, widget

api_router = APIRouter()
for module in (auth, users, team, chats, visitors, chat_admin, widget, files, reports, admin):
    api_router.include_router(module.router)
