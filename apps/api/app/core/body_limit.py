"""A ceiling on how big any request body may be.

Every endpoint's own limits (10 MB uploads, 200 KB résumé content, capped
text fields) are checked after the body has been read and parsed. Without
this, a single request could make the server read gigabytes into memory
before any of those checks runs.
"""
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

# Just above the 10 MB upload limit, so a legitimate upload plus its
# multipart framing always fits.
MAX_BODY_BYTES = 12 * 1024 * 1024


class _BodyTooLarge(HTTPException):
    """An HTTPException so FastAPI passes it through as a 413 when it's
    raised mid-parse, rather than rewrapping it as a generic 400."""

    def __init__(self) -> None:
        super().__init__(status_code=413, detail="Request body too large.")


class BodySizeLimitMiddleware:
    def __init__(self, app: ASGIApp, max_bytes: int = MAX_BODY_BYTES) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        too_large = JSONResponse({"detail": "Request body too large."}, status_code=413)

        # Refused up front when the client says how big it is...
        declared = dict(scope.get("headers") or []).get(b"content-length")
        if declared is not None and declared.isdigit() and int(declared) > self.max_bytes:
            await too_large(scope, receive, send)
            return

        # ...and counted as it arrives when it doesn't (or lies).
        received = 0
        started = False

        async def counting_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise _BodyTooLarge
            return message

        async def tracking_send(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, counting_receive, tracking_send)
        except _BodyTooLarge:
            if not started:
                await too_large(scope, receive, send)
