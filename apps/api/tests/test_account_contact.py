"""Every résumé carries the account's own name, email and phone
(services/account_contact.py) — so one account can't make résumés for
other people. The routes are checked against a real Postgres, where the
career profile is read."""
import inspect
import io
import time
import uuid
from unittest.mock import AsyncMock, patch

import jwt as pyjwt
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import settings
from app.core.rate_limit import limiter
from app.db.models import Resume
from app.db.session import get_db
from app.main import app
from app.routers import resumes as resumes_router
from app.services import account_contact
from app.services.account_contact import Account, looks_like_someone_else, onto, same_person_name

USER = uuid.UUID("00000000-0000-0000-0000-0000000000ac")
ACCOUNT = {"name": "Asha Rao", "email": "asha@account.com", "phone": "+91 98765 43210"}
SOMEONE = {"name": "Ravi Kumar", "email": "ravi@else.com", "phone": "+1 555 010 0100", "location": "Pune"}


# ── the rule ────────────────────────────────────────────────────────────────

def test_onto_puts_the_accounts_details_and_keeps_the_rest():
    content = {"contact": dict(SOMEONE), "skills": ["Python"]}
    out = onto(content, Account(**ACCOUNT))
    assert out == {"contact": {**ACCOUNT, "location": "Pune"}, "skills": ["Python"]}
    assert content["contact"] == SOMEONE  # not changed in place


def test_onto_leaves_what_the_account_has_no_value_for():
    out = onto({"contact": dict(SOMEONE)}, Account(email="asha@account.com"))
    assert out["contact"] == {**SOMEONE, "email": "asha@account.com"}
    same = {"contact": dict(SOMEONE)}
    assert onto(same, Account()) is same


@pytest.mark.parametrize("a, b", [
    ("Jane Smith", "Jane Smith"), ("J. Smith", "Jane Smith"), ("Smith Jane", "Jane Smith"),
    ("JANE SMITH", "Jane  Smith"), ("Bharath K", "Bharath Kundrapu"), ("Jane A. Smith", "Jane Smith"),
    ("José García", "Jose Garcia"), ("", "Jane Smith"),
])
def test_one_persons_name_written_another_way(a, b):
    assert same_person_name(a, b)


@pytest.mark.parametrize("a, b", [("Ravi Kumar", "Jane Smith"), ("Jane Doe", "Jane Smith"), ("R. Smith", "Jane Smith")])
def test_another_persons_name(a, b):
    assert not same_person_name(a, b)


def test_an_upload_in_another_name_looks_like_someone_elses():
    other = looks_like_someone_else({"contact": {"name": "Ravi Kumar"}}, Account(name="Asha Rao"))
    assert (other.reason, other.printed_name) == ("name", "Ravi Kumar")
    assert looks_like_someone_else({"contact": {"name": "A. Rao"}}, Account(name="Asha Rao")) is None


def test_an_upload_sharing_no_employer_or_school_looks_like_someone_elses():
    account = Account(name="Asha Rao", companies=("Infosys Ltd",), schools=("JNTU Hyderabad",))
    theirs = {"contact": {"name": "Asha Rao"}, "experience": [{"company": "Zomato"}], "education": [{"institution": "IIT Delhi"}]}
    assert looks_like_someone_else(theirs, account).reason == "history"
    mine = {**theirs, "experience": [{"company": "Zomato"}, {"company": "Infosys Limited"}]}
    assert looks_like_someone_else(mine, account) is None
    # Nothing to compare on one side: no warning.
    assert looks_like_someone_else({"contact": {"name": "Asha Rao"}}, account) is None
    assert looks_like_someone_else(theirs, Account(name="Asha Rao")) is None


def test_every_route_that_stores_or_renders_a_resume_puts_the_accounts_details():
    """A route added later that stores or renders résumé content must apply
    the account's details too."""
    module = inspect.getsource(resumes_router)
    for name, fn in inspect.getmembers(resumes_router, inspect.iscoroutinefunction):
        if inspect.getmodule(fn) is not resumes_router or not name.isidentifier():
            continue
        src = inspect.getsource(fn)
        stores = (".content = " in src or "content=" in src.replace("content=content", "")
                  or "Resume(" in src or "setattr(" in src)
        renders = "generate_pdf_with_meta" in src or "render_resume_html_with_meta" in src
        if (stores or renders) and not name.startswith("_"):
            assert "account_contact" in src or "_as_the_accounts" in src, name
    assert module.count("account_contact.onto(") + module.count("_as_the_accounts(") >= 9


# ── the routes, on a real Postgres ──────────────────────────────────────────

def auth(email="asha@account.com"):
    payload = {"sub": str(USER), "email": email, "aud": "authenticated", "exp": int(time.time()) + 3600}
    return {"Authorization": f"Bearer {pyjwt.encode(payload, settings.supabase_jwt_secret, algorithm='HS256')}"}


@pytest.fixture
async def Session(pg_uri):
    engine = create_async_engine(pg_uri)
    from app.db.session import Base
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Base.metadata.create_all(c, checkfirst=True))
        await conn.execute(text("CREATE TABLE IF NOT EXISTS career_profiles (user_id uuid primary key, master_resume_id uuid)"))
        for column in ("contact", "experience", "education"):
            await conn.execute(text(f"ALTER TABLE career_profiles ADD COLUMN IF NOT EXISTS {column} jsonb"))
        await conn.execute(text("TRUNCATE career_profiles, job_descriptions, resumes, tailoring_sessions, resume_deletion_log CASCADE"))
    Session = async_sessionmaker(engine, expire_on_commit=False)

    async def real_db():
        async with Session() as s:
            yield s

    app.dependency_overrides[get_db] = real_db
    limiter.reset()
    yield Session
    app.dependency_overrides.pop(get_db, None)
    await engine.dispose()


async def _profile(Session, contact, experience=None):
    async with Session() as s:
        await s.execute(
            text("INSERT INTO career_profiles (user_id, contact, experience, education) "
                 "VALUES (:u, CAST(:c AS jsonb), CAST(:e AS jsonb), '[]'::jsonb)"),
            {"u": str(USER), "c": __import__("json").dumps(contact), "e": __import__("json").dumps(experience or [])},
        )
        await s.commit()


async def _stored(Session, rid):
    async with Session() as s:
        return (await s.execute(select(Resume.content).where(Resume.id == uuid.UUID(rid)))).scalar_one()


async def _call(method, path, **kw):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        return await c.request(method, path, headers=auth(), **kw)


@pytest.mark.real_account
async def test_create_and_update_store_the_accounts_details(Session):
    await _profile(Session, ACCOUNT)
    r = await _call("POST", "/resumes", json={"title": "R", "content": {"contact": SOMEONE}})
    assert r.status_code == 201, r.text
    assert r.json()["content"]["contact"] == {**ACCOUNT, "location": "Pune"}
    rid = r.json()["id"]
    r = await _call("PATCH", f"/resumes/{rid}", json={"content": {"contact": {**SOMEONE, "location": "Delhi"}}})
    assert r.status_code == 200, r.text
    assert (await _stored(Session, rid))["contact"] == {**ACCOUNT, "location": "Delhi"}


@pytest.mark.real_account
async def test_a_profile_without_a_name_or_phone_leaves_the_resumes_but_never_the_email(Session):
    await _profile(Session, {"name": "", "email": "asha@account.com"})
    r = await _call("POST", "/resumes", json={"title": "R", "content": {"contact": SOMEONE}})
    assert r.json()["content"]["contact"] == {**SOMEONE, "email": "asha@account.com"}


@pytest.mark.real_account
async def test_renders_print_the_accounts_details_even_for_an_old_row_or_a_preview(Session):
    await _profile(Session, ACCOUNT)
    async with Session() as s:
        old = Resume(user_id=USER, title="Old", content={"contact": SOMEONE}, template_id="ats_clean")
        s.add(old)
        await s.commit()
    r = await _call("POST", f"/resumes/{old.id}/html")
    assert r.status_code == 200, r.text
    assert "Asha Rao" in r.json()["html"] and "Ravi Kumar" not in r.json()["html"]
    assert "ravi@else.com" not in r.json()["html"]
    r = await _call("POST", f"/resumes/{old.id}/html", json={"content": {"contact": {"name": "Preview Person"}}})
    assert "Asha Rao" in r.json()["html"] and "Preview Person" not in r.json()["html"]

    printed = []

    def fake_pdf(content, *args):
        printed.append(content["contact"])
        return b"%PDF", {"page_count": 1, "page_fill": 1.0, "underfilled": False}

    with patch.object(resumes_router, "generate_pdf_with_meta", fake_pdf), \
         patch.object(resumes_router, "_persist_pdf_to_storage", AsyncMock()), \
         patch.object(resumes_router, "check_pdf", lambda *a: ("", [])):
        for path, body in ((f"/resumes/{old.id}/pdf", None), (f"/resumes/{old.id}/pdf", {"content": {"contact": SOMEONE}}),
                           (f"/resumes/{old.id}/ats-check", {"content": {"contact": SOMEONE}})):
            r = await _call("POST", path, json=body)
            assert r.status_code == 200, (path, r.text)
    assert printed == [{**ACCOUNT, "location": "Pune"}] * 3


@pytest.mark.real_account
async def test_an_upload_takes_the_accounts_details_and_says_whose_it_looked_like(Session):
    await _profile(Session, ACCOUNT, experience=[{"company": "Infosys"}])
    read = {"contact": dict(SOMEONE), "experience": [{"company": "Zomato", "title": "SDE", "bullets": []}], "unplaced": []}
    with patch.object(resumes_router, "spend_credits", AsyncMock()), \
         patch.object(resumes_router, "_pdf_text", AsyncMock(return_value="text")), \
         patch.object(resumes_router, "_read_with_model", AsyncMock(side_effect=lambda _t: {**read, "contact": dict(SOMEONE)})), \
         patch.object(resumes_router, "_store_original", lambda *a: "resumes/x/original.pdf"):
        pdf = {"file": ("r.pdf", io.BytesIO(b"%PDF-1.4 x"), "application/pdf")}
        r = await _call("POST", "/resumes/read-upload", files=pdf)
        assert r.status_code == 200, r.text
        assert r.json()["content"]["contact"] == {**ACCOUNT, "location": "Pune"}
        assert r.json()["other_person"] == {"reason": "name", "printed_name": "Ravi Kumar"}
        assert r.json()["title"] == "Asha Rao's Resume"

        pdf = {"file": ("r.pdf", io.BytesIO(b"%PDF-1.4 x"), "application/pdf")}
        r = await _call("POST", "/resumes/parse-upload", files=pdf)
        assert r.status_code == 201, r.text
        assert (await _stored(Session, r.json()["id"]))["contact"] == {**ACCOUNT, "location": "Pune"}
        assert r.json()["other_person"]["reason"] == "name"

        pdf = {"file": ("r.pdf", io.BytesIO(b"%PDF-1.4 x"), "application/pdf")}
        r = await _call("POST", "/resumes/save-upload", files=pdf,
                        data={"content": __import__("json").dumps({"contact": SOMEONE})})
        assert r.status_code == 201, r.text
        assert (await _stored(Session, r.json()["id"]))["contact"] == {**ACCOUNT, "location": "Pune"}


@pytest.mark.real_account
async def test_load_reads_the_profile_and_the_sign_in_email(Session):
    await _profile(Session, {**ACCOUNT, "email": "old@work.com"}, experience=[{"company": "Infosys"}, {"company": ""}])
    async with Session() as s:
        got = await account_contact.load(s, {"sub": str(USER), "email": "asha@account.com"})
    assert got == Account(name="Asha Rao", email="asha@account.com", phone="+91 98765 43210", companies=("Infosys",))


@pytest.mark.real_account
async def test_a_cover_letter_is_headed_with_the_accounts_details(Session):
    from app.db.models import CoverLetter, JobDescription
    from app.routers import cover_letters as letters_router

    await _profile(Session, ACCOUNT)
    async with Session() as s:
        old = Resume(user_id=USER, title="Old", content={"contact": SOMEONE}, template_id="ats_clean")
        jd = JobDescription(user_id=USER, title="Analyst", raw_text="Analyst role")
        s.add_all([old, jd])
        await s.flush()
        letter = CoverLetter(user_id=USER, resume_id=old.id, jd_id=jd.id, content="Dear team,")
        s.add(letter)
        await s.commit()
    headed = []
    with patch.object(letters_router, "generate_letter_pdf", lambda contact, *a: headed.append(contact) or b"%PDF"):
        r = await _call("POST", f"/cover-letters/{letter.id}/pdf")
    assert r.status_code == 200, r.text
    assert headed == [{**ACCOUNT, "location": "Pune"}]


def test_a_cover_letter_is_written_from_the_accounts_details():
    from app.routers import cover_letters as letters_router

    src = inspect.getsource(letters_router.generate_cover_letter)
    assert src.index("account_contact.onto(resume_content") > src.index("session_row.tailored_content")
