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

Requests turned away as not found (404) or malformed (422) leave a
"refused" line too: another account's record answers 404 exactly like one
that doesn't exist (so its existence isn't given away), which used to mean
someone guessing record ids left no trace at all (test ATK-047).

One source — an account, or an address when there's no account — refused
ALERT_AFTER times within ALERT_WINDOW seconds also gets one
"security_alert=repeated_refusals" line at ERROR level, so a run of guesses
or probes stands out from the odd stale link or mistyped request. Counted
per server process, which is the whole API (see test_rate_limits).
"""
import logging
import re
import sys
import time
from collections import deque

from starlette.requests import Request

from app.core.rate_limit import client_ip

logger = logging.getLogger("app.security")

DENIED_STATUSES = frozenset({401, 403, 429})
REFUSED_STATUSES = frozenset({404, 422})

_FALLBACK_REASON = {
    401: "missing_token", 403: "forbidden", 429: "rate_limited",
    404: "not_found", 422: "invalid_request",
}

ALERT_AFTER = 20
ALERT_WINDOW = 300.0
# Sources being counted. Cleared if it ever grows this large, like the
# session cache: a flood of distinct addresses mustn't eat the memory.
_MAX_SOURCES = 10_000
_recent: dict[str, deque[float]] = {}
_alerted_until: dict[str, float] = {}

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


def _count_and_maybe_alert(source: str) -> None:
    now = time.monotonic()
    if len(_recent) >= _MAX_SOURCES and source not in _recent:
        _recent.clear()
        _alerted_until.clear()
    times = _recent.setdefault(source, deque())
    times.append(now)
    while times and times[0] <= now - ALERT_WINDOW:
        times.popleft()
    if len(times) >= ALERT_AFTER and _alerted_until.get(source, 0.0) <= now:
        _alerted_until[source] = now + ALERT_WINDOW
        logger.error(
            "security_alert=repeated_refusals source=%s count=%d window=%ds",
            source, len(times), int(ALERT_WINDOW),
        )


def reset_alerts() -> None:
    _recent.clear()
    _alerted_until.clear()


def log_if_denied(request: Request, status_code: int) -> None:
    if status_code in DENIED_STATUSES:
        kind, level = "denied", logging.WARNING
    elif status_code in REFUSED_STATUSES:
        kind, level = "refused", logging.INFO
    else:
        return
    reason = getattr(request.state, "denial_reason", None) or _FALLBACK_REASON[status_code]
    user = _clean(
        getattr(request.state, "denial_user", None) or getattr(request.state, "user_id", None) or "-"
    )
    ip = _clean(client_ip(request))
    logger.log(
        level,
        "security_event=%s status=%d method=%s path=%s ip=%s user=%s reason=%s",
        kind,
        status_code,
        _clean(request.method),
        _clean(request.url.path),
        ip,
        user,
        _clean(reason),
    )
    _count_and_maybe_alert(f"user:{user}" if user != "-" else f"ip:{ip}")
