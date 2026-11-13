from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field

from app.schemas.common import Schema

Presence = Literal["online", "away", "invisible"]


class RoleOut(Schema):
    id: str
    key: str
    name: str


class UserOut(Schema):
    id: str
    email: str
    name: str
    display_name: str | None
    tagline: str | None
    avatar_url: str | None
    role: RoleOut
    enabled: bool
    presence: str
    chat_limit: int | None
    skills: list
    mfa_enabled: bool
    email_verified_at: datetime | None
    last_login_at: datetime | None
    created_at: datetime


class MeOut(BaseModel):
    user: UserOut
    account: dict
    permissions: list[str]
    preferences: dict


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)
    subdomain: str | None = None
    otp: str | None = None


class RegisterIn(BaseModel):
    company: str = Field(min_length=2, max_length=120)
    subdomain: str = Field(pattern=r"^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$")
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str = Field(min_length=10, max_length=256)


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class EmailIn(BaseModel):
    email: EmailStr


class ResetIn(BaseModel):
    token: str
    password: str = Field(min_length=10, max_length=256)


SKILL_MAX = 5

class AcceptInviteIn(ResetIn):
    name: str | None = None


class TokenIn(BaseModel):
    token: str


class ProfileIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    display_name: str | None = Field(default=None, max_length=120)
    tagline: str | None = Field(default=None, max_length=255)
    avatar_url: str | None = Field(default=None, max_length=140_000, pattern=r"^data:image/(png|jpeg|gif);base64,[A-Za-z0-9+/=]+$")


class PasswordChangeIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=10, max_length=256)


class PresenceIn(BaseModel):
    status: Presence


class MfaVerifyIn(BaseModel):
    code: str = Field(min_length=6, max_length=6)


class SessionOut(Schema):
    id: str
    ip: str | None
    user_agent: str | None
    created_at: datetime
    last_used_at: datetime | None
    expires_at: datetime
