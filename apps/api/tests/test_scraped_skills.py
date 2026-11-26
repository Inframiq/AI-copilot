"""A skills list scraped from the résumé's own sentences (the Kaggle /
LiveCareer set closes every résumé with one) came through as 50 skill chips:
"Works", "calculator", "phone", "Maintains files" — a tester's upload of
ACCOUNTANT/12780508. Its plain words are dropped; names and the skills the
app knows stay; a person's own list is never touched."""
import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.resume_parser import (
    SCRAPED_LIST_MIN,
    _known_skills,
    _without_scraped_words,
    parse_resume_text,
)

_BODY = """ACCOUNTANT II
Skills
Superior attention to detail
QuickBooks expert
Work History
Accountant II , 02/2017 to Current
Company Name - City , State
Works with that department manager in preparation of annual budget.
Calculates and posts month end and year-end accruals using Excel.
Maintains knowledge of all Credit Union processes which affect the general ledger, including ATM.
Utilized several mediums such as phone and emails to help customers.
Articulate policies and procedures to members and department staff Maintains files, including filing.
Verifies and totals accounts, using calculator or computer, and prints checks for mailing.
Use office automated systems to input data.
Runs payroll and the accounts payable function in PeopleSoft.
Education
Bachelor of Science Degree : Finance , May 2010
"""

_SCRAPED = (
    "Skills\n"
    "accounts payable, accruals, Articulate, ATM, budget, calculator, Credit, Excel, filing,\n"
    "general ledger, mailing, Maintains files, office, payroll, PeopleSoft, phone, policies,\n"
    "processes, Works, year-end, customers, emails, members, staff, department, checks, computer\n"
)


def test_a_scraped_list_loses_its_plain_words_and_keeps_names():
    text = _BODY + _SCRAPED
    skills = [s.strip() for s in _SCRAPED.split("\n", 1)[1].replace("\n", " ").split(",")]
    assert len(skills) >= SCRAPED_LIST_MIN
    kept = _without_scraped_words(text, ["QuickBooks expert", *skills])
    for junk in ("Works", "Articulate", "calculator", "phone", "mailing", "office", "policies",
                 "Maintains files", "customers", "emails", "computer"):
        assert junk not in kept, junk
    # Names (capitals inside, all capitals, or capitalised mid-sentence),
    # phrases, and the skills the app knows stay.
    for name in ("QuickBooks expert", "ATM", "PeopleSoft", "Excel", "Credit", "general ledger",
                 "accounts payable", "year-end", "payroll", "budget"):
        assert name in kept, name


def test_a_persons_own_list_is_never_touched():
    # Short, or long but written capitalised the way people write skills.
    short = ["calculator", "phone", "Works", "office"]
    text = _BODY + "Skills\n" + ", ".join(short) + "\n"
    assert _without_scraped_words(text, short) == short
    long = [f"Tool{chr(65 + i)}" for i in range(SCRAPED_LIST_MIN)] + ["Works", "Articulate"]
    text = _BODY + "Technical Skills\n" + ", ".join(long) + "\n"
    assert _without_scraped_words(text, long) == long


@pytest.mark.asyncio
async def test_the_upload_drops_them_after_the_left_out_net():
    # The net re-files every line under a skills heading, so the filter has
    # to run after it — the model's own list is clean here, the net's isn't.
    provider = MagicMock()
    provider.complete = AsyncMock(return_value=json.dumps({
        "contact": {"name": "", "email": ""}, "experience": [], "education": [],
        "skills": ["QuickBooks expert", "PeopleSoft"],
    }))
    out = await parse_resume_text(_BODY + _SCRAPED, provider)
    assert "PeopleSoft" in out["skills"] and "ATM" in out["skills"]
    assert not {"Works", "calculator", "phone", "Maintains files"} & set(out["skills"])


def test_the_api_keeps_the_webs_skills_list():
    # The API image is built from apps/api alone, so it carries a copy.
    web = Path(__file__).resolve().parents[2] / "web" / "lib" / "suggest" / "data" / "skills.json"
    api = Path(__file__).resolve().parents[1] / "app" / "services" / "skill_names.json"
    assert json.loads(api.read_text(encoding="utf-8")) == json.loads(web.read_text(encoding="utf-8"))
    assert {"payroll", "sales", "budget", "microsoft excel", "excel"} <= _known_skills()
