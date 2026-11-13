"""Outbound email adapter. Uses SMTP when configured; otherwise writes to the log and an
in-memory outbox (used by tests and local dev). It never reports a send as delivered when it was not."""

import logging
import smtplib
from email.message import EmailMessage

from app.core.config import get_settings

log = logging.getLogger("mailer")
outbox: list[dict] = []


def send_mail(*, to: str, subject: str, body: str, headers: dict | None = None) -> bool:
    s = get_settings()
    outbox.append({"to": to, "subject": subject, "body": body, "headers": headers or {}})
    if not s.smtp_host:
        log.info("SMTP not configured; email to %s queued locally: %s", to, subject)
        return False
    msg = EmailMessage()
    msg["From"] = s.mail_from
    msg["To"] = to
    msg["Subject"] = subject
    for k, v in (headers or {}).items():
        msg[k] = v
    msg.set_content(body)
    with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=15) as smtp:
        smtp.starttls()
        if s.smtp_user:
            smtp.login(s.smtp_user, s.smtp_password)
        smtp.send_message(msg)
    return True
