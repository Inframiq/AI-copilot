"""Odd, oversized or broken input gets a plain refusal, never a crash (test
ATK-029).

Every route that reads a body is sent malformed JSON, the wrong shape, deep
nesting, and in each field the wrong type and a value far past any real use.
The answer must be a 4xx with a short `detail`, and an oversized value must
be refused before the endpoint runs: a fake database stands in, and an
endpoint that reaches it answers 299, so "got through" can't pass for
"refused". NUL characters, which PostgreSQL can't store, are dropped before
any endpoint reads the body."""

import json
import types
import typing
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.responses import JSONResponse
from httpx import ASGITransport, AsyncClient
from pydantic import BaseModel
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Route

from app.core.nul_chars import StripNulCharactersMiddleware
from app.core.rate_limit import limiter
from app.core.security import get_current_user, require_admin
from app.db.session import get_db
from app.main import app
from tests.test_admin_routes_guarded import _flatten

USER = {"sub": str(uuid.uuid4()), "email": "a@example.com"}
SOME_ID = str(uuid.uuid4())
REACHED = 299

# Values a baseline needs that the field's type alone doesn't give.
KNOWN_VALUES = {
    "template_id": "ats_clean",
    "expected_updated_at": datetime(2026, 1, 1, tzinfo=timezone.utc).isoformat(),
}

BIG = 1_000_000  # characters: past every cap (the largest, résumé content, is 200 KB)


class _ReachedTheDatabase(Exception):
    pass


class _FakeSession:
    def __getattr__(self, name):
        raise _ReachedTheDatabase(name)


async def _fake_db():
    yield _FakeSession()


@app.exception_handler(_ReachedTheDatabase)
async def _reached(request, exc):
    return JSONResponse({"reached": True}, status_code=REACHED)


def _model_of(route) -> type[BaseModel] | None:
    ann = route.body_field.field_info.annotation
    args = [a for a in typing.get_args(ann) if a is not type(None)] or [ann]
    return args[0] if isinstance(args[0], type) and issubclass(args[0], BaseModel) else None


def _plain(ann):
    if typing.get_origin(ann) in (typing.Union, types.UnionType):
        return next(a for a in typing.get_args(ann) if a is not type(None))
    return ann


def _valid(name, field):
    if name in KNOWN_VALUES:
        return KNOWN_VALUES[name]
    ann = _plain(field.annotation)
    origin = typing.get_origin(ann) or ann
    if isinstance(ann, type) and issubclass(ann, BaseModel):
        return _baseline(ann)
    if origin is typing.Literal:
        return typing.get_args(ann)[0]
    pattern = next((m.pattern for m in field.metadata if getattr(m, "pattern", None)), None)
    if ann is str and pattern:
        return {"^#": "#112233", "@": "a@example.com"}.get(
            next((k for k in ("^#", "@") if k in pattern), ""), pattern.strip("^$()").split("|")[0]
        )
    if ann in (int, float):
        low = next((getattr(m, "ge", None) for m in field.metadata if getattr(m, "ge", None) is not None), 1)
        return low
    return {str: "x", bool: True, uuid.UUID: SOME_ID, list: [], dict: {}}.get(origin, "x")


def _baseline(model) -> dict:
    return {n: _valid(n, f) for n, f in model.model_fields.items() if f.is_required()}


BODY_ROUTES = [
    (method, path, route, _model_of(route))
    for path, route, _ in _flatten(app.routes)
    for method in sorted(route.methods & {"POST", "PUT", "PATCH"})
    if route.body_field is not None and _model_of(route) is not None
    # A form upload (its model is one FastAPI makes): the file checks are
    # test CODE-002's, the file name is tested at the bottom here.
    and not _model_of(route).__module__.startswith("fastapi")
]


def _url(path):
    import re
    return re.sub(r"\{[^}]+\}", SOME_ID, path)


@pytest.fixture
async def client():
    limiter.reset()
    enabled, limiter.enabled = limiter.enabled, False
    app.dependency_overrides.update({
        get_current_user: lambda: USER, require_admin: lambda: USER, get_db: _fake_db,
    })
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test"
        ) as c:
            yield c
    finally:
        limiter.enabled = enabled
        for dep in (get_current_user, require_admin, get_db):
            app.dependency_overrides.pop(dep, None)


def _route_id(e):
    return f"{e[0]} {e[1]}"


def _assert_plain_refusal(r):
    assert r.status_code in (400, 413, 422), r.text[:300]
    assert "detail" in r.json()
    for internal in ("Traceback", 'File "', "sqlalchemy", "asyncpg", "app/", "app\\"):
        assert internal not in r.text


def test_the_routes_were_found():
    assert len(BODY_ROUTES) >= 20


@pytest.mark.parametrize("entry", BODY_ROUTES, ids=_route_id)
async def test_a_well_formed_request_reaches_the_endpoint(client, entry):
    """Without this, every refusal below could be the baseline's fault."""
    method, path, _, model = entry
    r = await client.request(method, _url(path), json=_baseline(model))
    assert r.status_code in (REACHED, 202), r.text[:300]


BROKEN_BODIES = {
    "malformed JSON": b'{"title": "x",',
    "a list": b"[1, 2]",
    "a string": b'"text"',
    "a number": b"42",
    "nested 5000 deep": b'{"a":' * 5000 + b"1" + b"}" * 5000,
    "a raw NUL byte": b'{"title": "a\x00b"}',
    "not UTF-8": b'{"title": "\xff\xfe"}',
    "empty": b"",
}


@pytest.mark.parametrize("kind", BROKEN_BODIES)
@pytest.mark.parametrize("entry", BODY_ROUTES, ids=_route_id)
async def test_a_broken_body_gets_a_plain_refusal(client, entry, kind):
    method, path, route, _ = entry
    r = await client.request(
        method, _url(path), content=BROKEN_BODIES[kind], headers={"content-type": "application/json"}
    )
    if kind == "empty" and not route.body_field.field_info.is_required():
        return  # The body is optional on this route, so none is fine.
    _assert_plain_refusal(r)


def _oversized(field):
    origin = typing.get_origin(_plain(field.annotation)) or _plain(field.annotation)
    if origin is str:
        return "A" * BIG
    if origin is list:
        return ["A" * BIG]
    if origin is dict:
        return {"summary": "A" * BIG}
    return None


FIELDS = [
    (method, path, model, name, field)
    for method, path, _, model in BODY_ROUTES
    for name, field in model.model_fields.items()
    if _oversized(field) is not None
]


# Trimmed to size rather than refused: each picked skill is cut to 200
# characters and the list to 20 (TailorRequest._cap_priority_skills).
TRIMMED = {("/ai/tailor", "priority_skills")}


@pytest.mark.parametrize(
    "entry", FIELDS, ids=lambda e: f"{e[0]} {e[1]} {e[3]}"
)
async def test_an_oversized_value_is_refused_before_the_endpoint_runs(client, entry):
    method, path, model, name, field = entry
    body = {**_baseline(model), name: _oversized(field)}
    if (path, name) in TRIMMED:
        trimmed = getattr(model.model_validate(body), name)
        assert len(json.dumps(trimmed)) < 10_000
        return
    r = await client.request(method, _url(path), json=body)
    _assert_plain_refusal(r)


WRONG_TYPES = {"null": None, "a number": 12345, "a list": [1, "a"], "an object": {"a": 1}}


@pytest.mark.parametrize("value", WRONG_TYPES)
@pytest.mark.parametrize("entry", BODY_ROUTES, ids=_route_id)
async def test_a_wrong_type_never_crashes(client, entry, value):
    """Each field in turn. Some types accept these (an optional field takes
    null, a dict field takes an object), so the rule is only: refused
    plainly, or handed to the endpoint — never a 500."""
    method, path, _, model = entry
    for name in model.model_fields:
        body = {**_baseline(model), name: WRONG_TYPES[value]}
        r = await client.request(method, _url(path), json=body)
        assert r.status_code in (REACHED, 202) or r.status_code in (400, 413, 422), (name, r.text[:300])


# --- NUL characters ---------------------------------------------------------

async def _echo(request: Request) -> Response:
    body = await request.body()
    return Response(body, headers={"x-length": request.headers.get("content-length", "")})


_echo_app = StripNulCharactersMiddleware(Starlette(routes=[Route("/", _echo, methods=["POST"])]))


async def _send(content: bytes, content_type: str | None = "application/json"):
    headers = {"content-type": content_type} if content_type else {}
    async with AsyncClient(transport=ASGITransport(app=_echo_app), base_url="http://test") as c:
        return await c.post("/", content=content, headers=headers)


async def test_nul_is_dropped_everywhere_in_a_json_body():
    body = {"title": "a\x00b", "content": {"exp\x00": [{"text": "x\x00y"}], "n": 3}}
    r = await _send(json.dumps(body).encode())
    assert json.loads(r.content) == {"title": "ab", "content": {"exp": [{"text": "xy"}], "n": 3}}
    assert r.headers["x-length"] == str(len(r.content))


async def test_a_body_without_nul_is_passed_on_untouched():
    raw = b'{"title":  "x",   "text": "caf\xc3\xa9 \\u00e9"}'
    assert (await _send(raw)).content == raw


async def test_the_text_backslash_u0000_is_not_a_nul():
    body = {"text": "type \\u0000 to see", "t": "a\x00b"}
    r = await _send(json.dumps(body).encode())
    assert json.loads(r.content) == {"text": "type \\u0000 to see", "t": "ab"}


async def test_a_body_with_no_content_type_is_cleaned_too():
    """FastAPI reads such a body as JSON."""
    r = await _send(json.dumps({"t": "a\x00b"}).encode(), content_type=None)
    assert json.loads(r.content) == {"t": "ab"}


async def test_other_bodies_are_left_alone():
    raw = b'--b\r\nContent-Disposition: form-data; name="t"\r\n\r\n\\u0000\r\n--b--\r\n'
    assert (await _send(raw, "multipart/form-data; boundary=b")).content == raw
    assert (await _send(b'{"t": "\\u0000",', "application/json")).content == b'{"t": "\\u0000",'


async def test_the_size_limit_still_applies_to_json():
    from app.core.body_limit import MAX_BODY_BYTES

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post("/feedback", content=b'{"c": "' + b"A" * MAX_BODY_BYTES + b'"}',
                         headers={"content-type": "application/json"})
    assert r.status_code == 413


@pytest.fixture
async def real_db(pg_uri):
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from app.db.models import Feedback, JobDescription, Resume

    engine = create_async_engine(pg_uri)
    async with engine.begin() as conn:
        for model in (Resume, JobDescription, Feedback):
            await conn.run_sync(lambda c, t=model.__table__: t.create(c, checkfirst=True))
    sessions = async_sessionmaker(engine, expire_on_commit=False)

    async def db():
        async with sessions() as s:
            yield s

    yield db, sessions
    await engine.dispose()


async def test_nul_characters_are_saved_without_them(real_db):
    """Against a real PostgreSQL, which refuses NUL in text and \\u0000 in
    jsonb: each of these was a 500."""
    from sqlalchemy import select
    from app.db.models import Feedback, JobDescription, Resume

    db, sessions = real_db
    limiter.reset()
    app.dependency_overrides.update({get_current_user: lambda: USER, get_db: db})
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            assert (await c.post("/feedback", json={"rating": 5, "comment": "x\x00y"})).status_code == 201
            assert (await c.post("/jd", json={"raw_text": "Need\x00 Python", "title": "a\x00b"})).status_code == 201
            r = await c.post("/resumes", json={"title": "t\x00", "content": {"summary": "a\x00b"}})
            assert r.status_code == 201
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_db, None)

    mine = uuid.UUID(USER["sub"])
    async with sessions() as s:
        assert (await s.scalars(select(Feedback.comment).where(Feedback.user_id == mine))).all() == ["xy"]
        assert (await s.scalars(select(JobDescription.title).where(JobDescription.user_id == mine))).all() == ["ab"]
        resume = (await s.scalars(select(Resume).where(Resume.user_id == mine))).one()
        assert (resume.title, resume.content["summary"]) == ("t", "ab")


# --- the upload's file name -------------------------------------------------

async def test_an_uploaded_file_name_is_stored_without_nul_and_within_the_column(ledger):
    from unittest.mock import MagicMock
    from tests.test_resumes_more import _FAKE_PDF_BYTES, make_auth_header, make_mock_db

    _, session = make_mock_db()
    limiter.reset()

    async def override():
        yield session

    app.dependency_overrides[get_db] = override
    name = "my\x00" + "r" * 400 + ".pdf"
    try:
        with patch("app.routers.resumes._ensure_room_for_a_new_resume", new=AsyncMock()), \
             patch("app.routers.resumes._dedupe_title", new=AsyncMock(side_effect=lambda db, uid, t: t)), \
             patch("app.routers.resumes._supabase", return_value=MagicMock()), \
             patch("app.routers.resumes.sandbox.extract_pdf_text", return_value="text"), \
             patch("app.routers.resumes.parse_resume_text", new=AsyncMock(return_value={"contact": {}})):
            # The mock session gives the saved row no defaults to answer with,
            # so the response itself fails; what was saved is what counts.
            transport = ASGITransport(app=app, raise_app_exceptions=False)
            async with AsyncClient(transport=transport, base_url="http://test") as c:
                # By hand: httpx would send the NUL as "%00", a raw client needn't.
                body = (
                    b'--b\r\nContent-Disposition: form-data; name="template_id"\r\n\r\nats_clean\r\n'
                    b'--b\r\nContent-Disposition: form-data; name="file"; filename="'
                    + name.encode() + b'"\r\nContent-Type: application/pdf\r\n\r\n'
                    + _FAKE_PDF_BYTES + b"\r\n--b--\r\n"
                )
                await c.post(
                    "/resumes/parse-upload", content=body,
                    headers={**make_auth_header(), "content-type": "multipart/form-data; boundary=b"},
                )
    finally:
        app.dependency_overrides.pop(get_db, None)

    saved = session.add.call_args.args[0]
    assert saved.original_file_name.startswith("myrrr") and len(saved.original_file_name) == 255
    assert saved.title == saved.original_file_name
