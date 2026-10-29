"""The Terms and Privacy Policy versions a feature needs the user to have
agreed to, checked on the server.

The in-app prompt (PolicyUpdatePrompt) asks for agreement after a policy
change, but only in the browser: a click before it appears, a prompt whose
check failed to load, or a direct API call all get past it. That is fine for
everything the app does today, which every user agreed to. A feature that a
later policy change brings in, and that needs consent first (a new use of
people's data, say), must not rely on the prompt alone:

    @router.post("/share", dependencies=[Depends(require_agreement(terms="2027-01-10"))])

refuses with 403 and code "policy_update_required" until the user's recorded
agreement is at least that version; the web app then shows the prompt.
Versions are ISO dates, so they compare as strings.
"""
import uuid

from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.db.models import PolicyAcceptance
from app.db.session import get_db

# The current versions. Must equal apps/web/lib/legal-versions.ts — a test
# fails the build when they differ.
TERMS_VERSION = "2026-09-19"
PRIVACY_VERSION = "2026-09-19"

POLICY_UPDATE_REQUIRED = "policy_update_required"


def require_agreement(terms: str | None = None, privacy: str | None = None):
    """A dependency that lets the request through only when the user has
    agreed to at least these versions (None = no requirement on that one)."""
    for name, since, current in (("terms", terms, TERMS_VERSION), ("privacy", privacy, PRIVACY_VERSION)):
        if since is not None and since > current:
            # A feature can't ask for agreement to a version nobody can give yet.
            raise ValueError(f"{name} version {since!r} is newer than the current {current!r}")

    async def check(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> None:
        row = await db.get(PolicyAcceptance, uuid.UUID(user["sub"]))
        agreed = row is not None and (terms is None or row.terms_version >= terms) and (
            privacy is None or row.privacy_version >= privacy
        )
        if not agreed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": POLICY_UPDATE_REQUIRED,
                    "message": "Agree to the updated Terms and Privacy Policy to use this.",
                },
            )

    return check
