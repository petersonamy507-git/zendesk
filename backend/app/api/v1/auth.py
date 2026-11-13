from fastapi import APIRouter, Cookie, Request, Response

from app.api.deps import DB, Current, client_ip
from app.core import ratelimit
from app.core.config import get_settings
from app.core.errors import Unauthorized
from app.schemas.common import Ok
from app.schemas.identity import AcceptInviteIn, EmailIn, LoginIn, RegisterIn, ResetIn, TokenIn, TokenOut
from app.services import auth as svc

router = APIRouter(prefix="/auth", tags=["auth"])
COOKIE = "parley_rt"


def _set_refresh(resp: Response, token: str) -> None:
    s = get_settings()
    resp.set_cookie(
        COOKIE,
        token,
        max_age=s.refresh_token_days * 86400,
        httponly=True,
        secure=s.environment != "development",
        samesite="strict",  # CSRF protection for the cookie-authenticated refresh endpoint
        path="/api/v1/auth",
    )


def _token_out(access: str) -> TokenOut:
    return TokenOut(access_token=access, expires_in=get_settings().access_token_minutes * 60)


@router.post("/register", response_model=TokenOut, status_code=201)
def register(body: RegisterIn, request: Request, response: Response, db: DB):
    ratelimit.hit(f"register:{client_ip(request)}", limit=5, window_s=3600)
    svc.register_account(db, company=body.company, subdomain=body.subdomain, name=body.name, email=body.email, password=body.password)
    db.commit()
    _, access, refresh = svc.login(db, email=body.email, password=body.password, subdomain=body.subdomain, otp=None, ip=client_ip(request), user_agent=request.headers.get("user-agent"))
    db.commit()
    _set_refresh(response, refresh)
    return _token_out(access)


@router.post("/login", response_model=TokenOut)
def login(body: LoginIn, request: Request, response: Response, db: DB):
    ratelimit.hit(f"login:{client_ip(request)}", limit=20, window_s=300)
    _, access, refresh = svc.login(db, email=body.email, password=body.password, subdomain=body.subdomain, otp=body.otp, ip=client_ip(request), user_agent=request.headers.get("user-agent"))
    db.commit()
    _set_refresh(response, refresh)
    return _token_out(access)


@router.post("/refresh", response_model=TokenOut)
def refresh(response: Response, db: DB, parley_rt: str | None = Cookie(default=None)):
    if not parley_rt:
        raise Unauthorized("No session")
    _, access, new_refresh = svc.refresh(db, parley_rt)
    db.commit()
    _set_refresh(response, new_refresh)
    return _token_out(access)


@router.post("/logout", response_model=Ok)
def logout(p: Current, response: Response, db: DB):
    svc.logout(db, p.session_id)
    db.commit()
    response.delete_cookie(COOKIE, path="/api/v1/auth")
    return Ok()


@router.post("/forgot-password", response_model=Ok)
def forgot(body: EmailIn, request: Request, db: DB):
    ratelimit.hit(f"forgot:{client_ip(request)}", limit=5, window_s=900)
    svc.forgot_password(db, body.email)
    db.commit()
    return Ok()  # same response whether or not the email exists


@router.post("/reset-password", response_model=Ok)
def reset(body: ResetIn, db: DB):
    svc.reset_password(db, body.token, body.password)
    db.commit()
    return Ok()


@router.post("/verify-email", response_model=Ok)
def verify_email(body: TokenIn, db: DB):
    from app.core.security import utcnow

    user = svc.consume_token(db, body.token, "verify_email")
    user.email_verified_at = utcnow()
    db.commit()
    return Ok()


@router.post("/accept-invite", response_model=Ok)
def accept_invite(body: AcceptInviteIn, db: DB):
    svc.accept_invite(db, body.token, body.password, body.name)
    db.commit()
    return Ok()
