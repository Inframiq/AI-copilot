"""Test INF-003: the API reaches Supabase's database only over TLS, with the
server's certificate checked. Supabase's pooler also accepts plain-text
logins, and asyncpg's default ("prefer") would quietly settle for one."""
import ast
import hashlib
import pathlib
import ssl
from datetime import datetime, timedelta, timezone

import pytest

from app.db.tls import SUPABASE_ROOT_CA, connect_args

POOLER = "postgresql+asyncpg://kripax_api.ref@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres"
API_ROOT = pathlib.Path(__file__).parents[1]

# The certificate Supabase's dashboard offers under Database settings → SSL.
ROOT_SHA256 = "807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa"  # pragma: allowlist secret


@pytest.mark.parametrize(
    "url",
    [
        POOLER,
        "postgresql+asyncpg://postgres@db.ghooibyaqtnofeggdjup.supabase.co:5432/postgres",
        "postgresql+asyncpg://postgres@AWS-0-AP-SOUTHEAST-1.POOLER.SUPABASE.COM:6543/postgres",
    ],
)
def test_a_supabase_database_gets_verified_tls(url):
    context = connect_args(url)["ssl"]
    assert isinstance(context, ssl.SSLContext)
    assert context.verify_mode == ssl.CERT_REQUIRED
    assert context.check_hostname is True
    assert context.minimum_version >= ssl.TLSVersion.TLSv1_2


@pytest.mark.parametrize(
    "url",
    [
        "postgresql+asyncpg://postgres@127.0.0.1:5432/postgres",
        "postgresql+asyncpg://postgres@localhost/postgres",
        "postgresql+asyncpg://postgres@notsupabase.com/postgres",
    ],
)
def test_a_local_database_is_left_alone(url):
    assert connect_args(url) == {}


def test_the_context_trusts_only_supabases_root():
    context = connect_args(POOLER)["ssl"]
    roots = context.get_ca_certs()
    assert len(roots) == 1
    subject = dict(pair[0] for pair in roots[0]["subject"])
    assert subject["commonName"] == "Supabase Root 2021 CA"


def test_the_shipped_root_is_supabases_and_not_about_to_expire():
    der = ssl.PEM_cert_to_DER_cert(SUPABASE_ROOT_CA.read_text(encoding="ascii"))
    assert hashlib.sha256(der).hexdigest() == ROOT_SHA256
    not_after = connect_args(POOLER)["ssl"].get_ca_certs()[0]["notAfter"]
    expires = datetime.fromtimestamp(ssl.cert_time_to_seconds(not_after), timezone.utc)
    # Supabase rotates its CA before then; the new root goes in this folder.
    assert expires - datetime.now(timezone.utc) > timedelta(days=180), expires


def test_every_engine_is_built_with_the_tls_settings():
    sources = [*(API_ROOT / "app").rglob("*.py"), API_ROOT / "alembic" / "env.py"]
    calls = 0
    for path in sources:
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if not isinstance(node, ast.Call):
                continue
            name = getattr(node.func, "id", None) or getattr(node.func, "attr", None)
            assert name not in ("connect", "create_engine") or not _is_db_call(node), path.name
            if name == "create_async_engine":
                calls += 1
                kw = {k.arg: k.value for k in node.keywords}
                assert "connect_args" in kw, f"{path.name}:{node.lineno}"
                assert getattr(kw["connect_args"].func, "id", None) == "connect_args"
    assert calls == 3


def _is_db_call(node: ast.Call) -> bool:
    """asyncpg.connect(...) or sqlalchemy's create_engine(...): a connection
    made around the engines, which would skip their TLS settings."""
    owner = getattr(node.func, "value", None)
    return getattr(owner, "id", None) == "asyncpg" or getattr(node.func, "id", None) == "create_engine"


def test_the_root_certificate_ships_in_the_image():
    ignored = (API_ROOT / ".dockerignore").read_text(encoding="utf-8").split()
    assert not any(p in ignored for p in ("*.crt", "app/db/", "app/db/*.crt"))
    assert "COPY . ." in (API_ROOT / "Dockerfile").read_text(encoding="utf-8")


async def _login_sent_in_plain_text(ssl_setting) -> bool:
    """A server that answers the client's TLS request with "no", as a
    downgrading middlebox would. Returns whether the client carried on and
    sent its login (the startup message) in plain text anyway."""
    import asyncio

    import asyncpg

    received = bytearray()

    async def server(reader, writer):
        request = await reader.readexactly(8)
        if request[4:] != (80877103).to_bytes(4, "big"):  # not an SSLRequest
            received.extend(request + await reader.read(1024))
            writer.close()
            return
        writer.write(b"N")
        await writer.drain()
        try:
            received.extend(await asyncio.wait_for(reader.read(1024), 2))
        except asyncio.TimeoutError:
            pass
        writer.close()

    srv = await asyncio.start_server(server, "127.0.0.1", 0)
    port = srv.sockets[0].getsockname()[1]
    try:
        with pytest.raises((ConnectionError, OSError, asyncpg.PostgresError, asyncio.TimeoutError)):
            await asyncpg.connect(
                host="127.0.0.1", port=port, user="kripax_api", password="x",
                database="postgres", ssl=ssl_setting, timeout=5,
            )
    finally:
        srv.close()
        await srv.wait_closed()
    return b"kripax_api" in received


async def test_asyncpgs_default_would_log_in_without_tls():
    """The gap this closes: "prefer" settles for plain text."""
    assert await _login_sent_in_plain_text("prefer") is True


async def test_a_server_that_wont_do_tls_is_refused_not_used_in_plain_text():
    assert await _login_sent_in_plain_text(connect_args(POOLER)["ssl"]) is False
