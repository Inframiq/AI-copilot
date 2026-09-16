"""Shared Supabase service-role client for admin-only lookups — every auth
user's email/name lives in Supabase auth, not this app's own database, so
GET /admin/users and GET /feedback both need this to attach who's who."""
from supabase import create_client
from app.core.config import settings

_sb_client = None


def get_supabase_admin():
    global _sb_client
    if _sb_client is None:
        _sb_client = create_client(settings.supabase_url, settings.supabase_service_role_key)
    return _sb_client


def extract_name(auth_user) -> str | None:
    """Google OAuth populates user_metadata.full_name/name on sign-up; not
    every account will have one (email/password sign-up, or an older account
    from before this was captured)."""
    meta = auth_user.user_metadata or {}
    return meta.get("full_name") or meta.get("name") or None


def list_all_auth_users() -> list:
    """Every Supabase auth user, paginated through in full — the admin
    dashboard's user list is small enough that this is only ever a couple
    of round trips per call."""
    users = []
    page = 1
    while True:
        batch = get_supabase_admin().auth.admin.list_users(page=page, per_page=200)
        if not batch:
            break
        users.extend(batch)
        if len(batch) < 200:
            break
        page += 1
    return users
