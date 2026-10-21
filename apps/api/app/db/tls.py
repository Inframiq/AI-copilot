"""How the API reaches its database: over TLS, with the server's certificate
checked, whenever the database is Supabase's.

asyncpg's default is sslmode "prefer": it asks for TLS but carries on in
plain text if the answer is no, and it never checks who answered. Supabase's
pooler also takes plain-text logins (test INF-003), so a connection could be
downgraded or intercepted on the way from Render to Singapore without either
end noticing. Supabase signs its database certificates with its own root CA,
not a public one, so the system trust store can't verify them: the root ships
here (supabase-root-2021.crt, the certificate the dashboard's Database
settings offer for download; valid to April 2031).

A local database (tests, a Postgres on this machine) is left as it was.
"""
from __future__ import annotations

import pathlib
import ssl

from sqlalchemy.engine import make_url

SUPABASE_ROOT_CA = pathlib.Path(__file__).with_name("supabase-root-2021.crt")

_SUPABASE_DOMAINS = ("supabase.com", "supabase.co")


def _is_supabase(host: str) -> bool:
    host = host.lower().rstrip(".")
    return any(host == d or host.endswith("." + d) for d in _SUPABASE_DOMAINS)


def connect_args(url: str) -> dict:
    """create_async_engine(url, connect_args=connect_args(url))."""
    host = make_url(url).host or ""
    if not _is_supabase(host):
        return {}
    context = ssl.create_default_context(cafile=str(SUPABASE_ROOT_CA))
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    return {"ssl": context}
