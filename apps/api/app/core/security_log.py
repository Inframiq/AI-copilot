"""Security events in the API's log (test INF-004).

Every refused request — no or bad sign-in (401), not allowed (403), too
many requests (429) — leaves one line in the host's log:

    security_event=denied status=401 method=GET path=/resumes ip=203.0.113.9 user=- reason=invalid_token

Never the token, the Authorization header, cookies, the query string or a
request body: a log line is read by whoever can open the dashboard, and a
token in it is a working sign-in. The user is the verified account id when
there is one, never an email. The reason is one of a fixed set of words,
set by the auth checks (note_denial); a refusal they didn't name falls back
to one per status code.
"""
import logging
import re
import sys

from starlette.requests import Request

from app.core.rate_limit import client_ip

logger = logging.getLogger("app.security")

DENIED_STATUSES = frozenset({401, 403, 429})

_FALLBACK_REASON = {401: "missing_token", 403: "forbidden", 429: "rate_limited"}

# Request paths arrive URL-decoded: %0A is a real newline by now, and a
# forged line in the log would read like a genuine event.
_UNPRINTABLE = re.compile(r"[^\x21-\x7e]")
_MAX_FIELD = 200


def configure_logging() -> None:
    """Send the app's own log lines (logger "app" and below) to stdout.

    uvicorn sets up only its own loggers. Without this the app's INFO lines
    (account deleted, résumé deleted, deletion request received, every
    security event) were dropped, and warnings went out through Python's
    bare last-resort handler. The host stamps the time on each line.
    """
    app_logger = logging.getLogger("app")
    if any(getattr(h, "_kripax", False) for h in app_logger.handlers):
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter("%(levelname)s %(name)s: %(message)s"))
    handler._kripax = True
    app_logger.addHandler(handler)
    app_logger.setLevel(logging.INFO)


def note_denial(request: Request, reason: str, user_id: str | None = None) -> None:
    """Called by an auth check just before it refuses: why, and who if known."""
    request.state.denial_reason = reason
    if user_id:
        request.state.denial_user = user_id


def _clean(value: str) -> str:
    return _UNPRINTABLE.sub("?", value)[:_MAX_FIELD] or "-"


def log_if_denied(request: Request, status_code: int) -> None:
    if status_code not in DENIED_STATUSES:
        return
    reason = getattr(request.state, "denial_reason", None) or _FALLBACK_REASON[status_code]
    user = getattr(request.state, "denial_user", None) or "-"
    logger.warning(
        "security_event=denied status=%d method=%s path=%s ip=%s user=%s reason=%s",
        status_code,
        _clean(request.method),
        _clean(request.url.path),
        _clean(client_ip(request)),
        _clean(user),
        _clean(reason),
    )
