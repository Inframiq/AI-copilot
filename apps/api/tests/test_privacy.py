"""What the app keeps about a user, and what it lets go of."""
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.db.session import get_db
from app.main import app
from tests.images import ONE_PIXEL_PNG
from tests.test_routers import make_auth_header, make_mock_db


@pytest.mark.asyncio
async def test_policy_acceptance_reads_back_as_nulls_before_any_agreement():
    override, session = make_mock_db()
    session.get = AsyncMock(return_value=None)
    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get("/me/policy-acceptance", headers=make_auth_header())
        assert r.status_code == 200
        assert r.json() == {"terms_version": None, "privacy_version": None, "accepted_at": None}
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_policy_acceptance_reads_back_the_versions_agreed_to():
    from app.db.models import PolicyAcceptance

    override, session = make_mock_db()
    session.get = AsyncMock(return_value=PolicyAcceptance(
        terms_version="2026-09-19", privacy_version="2026-09-19",
        accepted_at=datetime(2026, 9, 19, tzinfo=timezone.utc),
    ))
    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get("/me/policy-acceptance", headers=make_auth_header())
        assert r.json()["terms_version"] == "2026-09-19"
        assert r.json()["privacy_version"] == "2026-09-19"
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_deleting_an_account_deletes_its_feedback_too():
    override, session = make_mock_db()
    empty = MagicMock()
    empty.all.return_value = []
    empty.scalars.return_value.all.return_value = []
    session.execute = AsyncMock(return_value=empty)
    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.me._supabase", return_value=MagicMock()):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                r = await client.delete("/me", headers=make_auth_header())
        assert r.status_code == 204
        deleted_from = {
            getattr(getattr(call.args[0], "table", None), "name", None)
            for call in session.execute.call_args_list
        }
        assert "feedback" in deleted_from
        assert "policy_acceptances" in deleted_from
    finally:
        app.dependency_overrides.pop(get_db, None)


# ---------------------------------------------------------------------------
# Photos live in a private bucket. The server reads them with the service
# key, so it has to decide for itself whose photo a résumé may show.
# ---------------------------------------------------------------------------

HOST = "https://test-project.supabase.co"
ME = "00000000-0000-0000-0000-000000000001"


@pytest.fixture
def our_host():
    with patch("app.services.pdf.settings") as mock_settings:
        mock_settings.supabase_url = HOST
        yield


def _with_photo(url):
    return {"contact": {"name": "Jane", "photo_url": url}}


def test_avatar_path_reads_public_and_signed_urls_alike(our_host):
    from app.services.pdf import avatar_path

    assert avatar_path(f"{HOST}/storage/v1/object/public/avatars/{ME}/profile.png") == f"{ME}/profile.png"
    assert avatar_path(f"{HOST}/storage/v1/object/sign/avatars/{ME}/r.jpg?token=abc") == f"{ME}/r.jpg"


def test_avatar_path_refuses_anything_else(our_host):
    from app.services.pdf import avatar_path

    assert avatar_path("https://evil.example/storage/v1/object/public/avatars/x/p.png") is None
    assert avatar_path(f"http://test-project.supabase.co/storage/v1/object/public/avatars/{ME}/p.png") is None
    assert avatar_path(f"{HOST}/storage/v1/object/public/resumes/{ME}/cv.pdf") is None
    assert avatar_path(f"{HOST}/storage/v1/object/public/avatars/{ME}/../other/p.png") is None
    assert avatar_path(f"{HOST}/storage/v1/object/public/avatars/{ME}/%2e%2e/other/p.png") is None
    assert avatar_path(None) is None


def test_a_resume_keeps_its_owners_photo(our_host):
    from app.services.pdf import photo_owned_by

    content = _with_photo(f"{HOST}/storage/v1/object/public/avatars/{ME}/profile.png")
    assert photo_owned_by(content, ME) is content


def test_a_resume_cannot_borrow_someone_elses_photo(our_host):
    from app.services.pdf import photo_owned_by

    theirs = _with_photo(f"{HOST}/storage/v1/object/public/avatars/someone-else/profile.png")
    assert photo_owned_by(theirs, ME)["contact"]["photo_url"] is None
    elsewhere = _with_photo("https://evil.example/p.png")
    assert photo_owned_by(elsewhere, ME)["contact"]["photo_url"] is None


def _encoded(fmt: str, mode: str = "RGB", **save) -> bytes:
    import io
    from PIL import Image

    buf = io.BytesIO()
    Image.new(mode, (40, 30), (10, 120, 200, 255)[: len(mode)]).save(buf, fmt, **save)
    return buf.getvalue()


def test_only_real_images_become_data_uris():
    # Each photo is decoded and re-encoded in the sandbox; only that fresh
    # copy is inlined for the render.
    from app.services.pdf import _MAX_PHOTO_BYTES, _as_data_uri

    assert _as_data_uri(ONE_PIXEL_PNG).startswith("data:image/png;base64,")  # keeps transparency
    assert _as_data_uri(_encoded("JPEG")).startswith("data:image/jpeg;base64,")
    assert _as_data_uri(_encoded("WEBP")).startswith("data:image/jpeg;base64,")
    # Signatures alone aren't images, whatever they claim.
    assert _as_data_uri(bytes.fromhex("89504e470d0a1a0a") + b"rest") is None
    assert _as_data_uri(bytes.fromhex("ffd8ffe0") + b"<script>") is None
    assert _as_data_uri(b"<svg onload=alert(1)>") is None
    assert _as_data_uri(ONE_PIXEL_PNG + b"x" * _MAX_PHOTO_BYTES) is None
    assert _as_data_uri(None) is None


def test_a_photo_loses_its_location_before_it_is_embedded():
    import base64
    import io
    from PIL import Image
    from app.services.pdf import _as_data_uri

    exif = Image.Exif()
    exif[0x8825] = {2: (51.0, 30.0, 0.0), 4: (0.0, 7.0, 0.0)}  # GPS: somewhere in London
    exif[0x010F] = "PhoneMaker"
    photo = _encoded("JPEG", exif=exif.tobytes())
    assert Image.open(io.BytesIO(photo)).getexif()  # it went in with metadata

    uri = _as_data_uri(photo)
    embedded = Image.open(io.BytesIO(base64.b64decode(uri.split(",", 1)[1])))
    assert not embedded.getexif()


@pytest.mark.asyncio
async def test_the_studio_preview_drops_a_photo_that_isnt_yours(our_host):
    from app.db.models import Resume

    override, session = make_mock_db()
    result = MagicMock()
    result.scalar_one_or_none.return_value = Resume(
        user_id=__import__("uuid").UUID(ME), title="Mine", content={}, template_id="ats_clean",
        line_spacing=1.25, paragraph_spacing=12, font_choice="sans",
        heading_size_delta=0, body_size_delta=0,
    )
    session.execute = AsyncMock(return_value=result)
    rendered = {}

    def fake_render(content, *args, **kwargs):
        rendered["content"] = content
        return "<html></html>", {"photo_placeholder": False}

    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.resumes.render_resume_html_with_meta", fake_render):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                r = await client.post(
                    "/resumes/00000000-0000-0000-0000-0000000000aa/html",
                    json={"content": _with_photo(f"{HOST}/storage/v1/object/public/avatars/someone-else/profile.png")},
                    headers=make_auth_header(),
                )
        assert r.status_code == 200
        assert rendered["content"]["contact"]["photo_url"] is None
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_deleting_an_account_removes_every_photo_in_its_folder():
    override, session = make_mock_db()
    empty = MagicMock()
    empty.all.return_value = []
    session.execute = AsyncMock(return_value=empty)
    storage = MagicMock()
    storage.list.return_value = [{"name": "profile.png"}, {"name": "resume-1.jpg"}]
    sb = MagicMock()
    sb.storage.from_.return_value = storage
    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.me._supabase", return_value=sb):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                r = await client.delete("/me", headers=make_auth_header())
        assert r.status_code == 204
        storage.remove.assert_called_once_with([f"{ME}/profile.png", f"{ME}/resume-1.jpg"])
    finally:
        app.dependency_overrides.pop(get_db, None)
