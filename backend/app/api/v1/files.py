"""File uploads (chat attachments, avatars, ticket/article attachments).

Validation: size limit, extension allow-list (Account › File sending for visitors), content
sniffing for images, randomized storage keys. Storage: local disk under UPLOAD_DIR; an
S3-compatible backend is used when S3_* settings are provided (see app/services/storage.py)."""

import hashlib
from typing import Annotated

from fastapi import APIRouter, Depends, Header, UploadFile
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import DB, get_principal
from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import AppError, NotFound, Unauthorized
from app.core.security import new_opaque_token, utcnow
from app.models import Chat, ChatMessage, FileObject
from app.services import settings as settings_svc
from app.services import storage

router = APIRouter(prefix="/files", tags=["files"])

DEFAULT_AGENT_TYPES = {"png", "jpg", "jpeg", "gif", "webp", "pdf", "txt", "csv", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "zip"}
VISITOR_DEFAULT_TYPES = {"pdf", "png", "jpg", "jpeg", "gif", "txt"}
MAGIC = {"png": b"\x89PNG", "jpg": b"\xff\xd8\xff", "jpeg": b"\xff\xd8\xff", "gif": b"GIF8", "pdf": b"%PDF"}
CTYPES = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp", "pdf": "application/pdf", "txt": "text/plain", "csv": "text/csv", "zip": "application/zip"}


def _who(db: Session, authorization: str | None, x_visitor_token: str | None):
    if authorization and authorization.lower().startswith("bearer "):
        p = get_principal(db, authorization)
        return "user", p.id, p.account_id
    if x_visitor_token:
        from app.api.v1.widget import visitor_from_token

        ctx = visitor_from_token(db, x_visitor_token)
        return "visitor", ctx.visitor.id, ctx.visitor.account_id
    raise Unauthorized("Not authenticated")


@router.post("", status_code=201)
async def upload(file: UploadFile, db: Annotated[Session, Depends(get_db)], authorization: Annotated[str | None, Header()] = None, x_visitor_token: Annotated[str | None, Header()] = None):
    kind, who_id, account_id = _who(db, authorization, x_visitor_token)
    name = (file.filename or "file").replace("\\", "/").split("/")[-1][:200]
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if kind == "visitor":
        fs = settings_svc.get_section(db, account_id, "account.file_sending")
        if not fs["enabled"]:
            raise AppError("File sending is disabled", code="files_disabled")
        allowed = set(VISITOR_DEFAULT_TYPES)
        if fs["mode"] == "extended" and fs["risk_ack"]:  # admin accepted the risk for extra extensions
            allowed |= {t.strip().lower().lstrip(".") for t in fs["extra_types"] if t.strip()}
    else:
        allowed = DEFAULT_AGENT_TYPES
    if ext not in allowed:
        raise AppError(f"File type .{ext or '?'} is not allowed", code="file_type")
    data = await file.read(get_settings().max_upload_mb * 1024 * 1024 + 1)
    if len(data) > get_settings().max_upload_mb * 1024 * 1024:
        raise AppError(f"File exceeds {get_settings().max_upload_mb} MB", code="file_too_large")
    if not data:
        raise AppError("File is empty")
    if ext in MAGIC and not data.startswith(MAGIC[ext]):
        raise AppError("File content does not match its extension", code="file_mismatch")
    key = f"{account_id}/{new_opaque_token()[:24]}.{ext}"
    storage.put(key, data)
    obj = FileObject(account_id=account_id, storage_key=key, filename=name, content_type=CTYPES.get(ext, "application/octet-stream"), size=len(data), sha256=hashlib.sha256(data).hexdigest(), uploaded_by_type=kind, uploaded_by_id=who_id, created_at=utcnow())
    db.add(obj)
    db.commit()
    return {"id": obj.id, "filename": obj.filename, "content_type": obj.content_type, "size": obj.size}


@router.get("/{file_id}")
def download(file_id: str, db: DB, authorization: Annotated[str | None, Header()] = None, x_visitor_token: Annotated[str | None, Header()] = None, token: str | None = None):
    # `token` query param lets <img>/<a> tags load files (access token or visitor token).
    if token and not authorization and not x_visitor_token:
        if token.count(".") == 2:
            try:
                kind, who_id, account_id = _who(db, f"Bearer {token}", None)
            except Exception:  # noqa: BLE001
                kind, who_id, account_id = _who(db, None, token)
        else:
            raise Unauthorized("Not authenticated")
    else:
        kind, who_id, account_id = _who(db, authorization, x_visitor_token)
    obj = db.get(FileObject, file_id)
    if not obj or obj.account_id != account_id:
        raise NotFound("File not found")
    if kind == "visitor" and not (obj.uploaded_by_type == "visitor" and obj.uploaded_by_id == who_id):
        # visitors may only read files attached to their own chats
        ok = db.scalar(select(ChatMessage.id).join(Chat, Chat.id == ChatMessage.chat_id).where(ChatMessage.attachment_id == obj.id, Chat.visitor_id == who_id).limit(1))
        if not ok:
            raise NotFound("File not found")
    disp = "inline" if obj.content_type.startswith("image/") or obj.content_type == "application/pdf" else "attachment"
    return Response(storage.get(obj.storage_key), media_type=obj.content_type, headers={"Content-Disposition": f'{disp}; filename="{obj.filename}"', "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"})
