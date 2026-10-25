"""Drops NUL characters (\\u0000) from JSON request bodies.

PostgreSQL can store neither a NUL in a text column nor a \\u0000 in jsonb,
so one anywhere in a request (a title, a pasted job description, a field
deep inside résumé content) made the save fail with a 500 (test ATK-029).
A NUL is invisible and means nothing in any field here, so it is removed
before any endpoint reads the body rather than refused.
"""
import json

from starlette.types import ASGIApp, Message, Receive, Scope, Send

# How a NUL arrives in JSON. A raw 0x00 byte inside a string isn't valid
# JSON, so the parser already refuses it with a 422.
_ESCAPED_NUL = b"\\u0000"


def _without_nul(value):
    if isinstance(value, str):
        return value.replace("\x00", "")
    if isinstance(value, list):
        return [_without_nul(v) for v in value]
    if isinstance(value, dict):
        return {_without_nul(k): _without_nul(v) for k, v in value.items()}
    return value


def _is_json(scope: Scope) -> bool:
    # FastAPI reads a body with no content type as JSON too.
    content_type = dict(scope.get("headers") or []).get(b"content-type", b"").lower()
    return not content_type or b"json" in content_type


class StripNulCharactersMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not _is_json(scope):
            await self.app(scope, receive, send)
            return

        # The size limit (BodySizeLimitMiddleware) sits outside this one, so
        # what is buffered here is already capped.
        chunks = []
        while True:
            message = await receive()
            if message["type"] != "http.request":
                # The client went away; let the endpoint see that.
                await self.app(scope, _replay([message], receive), send)
                return
            chunks.append(message.get("body", b""))
            if not message.get("more_body", False):
                break
        body = b"".join(chunks)

        if _ESCAPED_NUL in body:
            try:
                parsed = json.loads(body)
            except ValueError:
                pass  # Malformed: the endpoint answers it with a 422.
            else:
                body = json.dumps(_without_nul(parsed), ensure_ascii=False).encode("utf-8")
                headers = [(k, v) for k, v in scope["headers"] if k != b"content-length"]
                scope = {**scope, "headers": [*headers, (b"content-length", str(len(body)).encode())]}

        await self.app(scope, _replay([{"type": "http.request", "body": body, "more_body": False}], receive), send)


def _replay(messages: list[Message], receive: Receive) -> Receive:
    async def replay() -> Message:
        if messages:
            return messages.pop(0)
        return await receive()

    return replay
