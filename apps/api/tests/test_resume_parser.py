"""Parser behaviour around multiple roles at one employer (promotion /
internal transfer). The prose rule has been in PARSE_SYSTEM for a while but
resumes still came back with the earlier role dropped — a concrete worked
example in the prompt makes the fast model follow it far more reliably.
"""
import json

import pytest
from unittest.mock import AsyncMock, MagicMock

from app.services.resume_parser import parse_resume_text, PARSE_SYSTEM


def _provider_returning(payload: dict) -> MagicMock:
    provider = MagicMock()
    provider.complete = AsyncMock(return_value=json.dumps(payload))
    return provider


def test_parse_system_prompt_carries_a_worked_multi_role_example():
    # A named company that appears at least twice inside a single worked
    # example block — proof the prompt shows (not just tells) how a promotion
    # becomes two separate entries.
    assert "Example" in PARSE_SYSTEM
    assert PARSE_SYSTEM.count("Northwind") >= 2


@pytest.mark.asyncio
async def test_two_roles_at_one_company_survive_as_separate_entries():
    payload = {
        "contact": {"name": "Jane Doe", "email": "jane@example.com"},
        "experience": [
            {
                "company": "Acme Corp", "title": "Senior Software Engineer",
                "start": "Jan 2023", "end": "Present",
                "bullets": ["Led the payments platform rewrite."],
            },
            {
                "company": "Acme Corp", "title": "Software Engineer",
                "start": "Jun 2020", "end": "Dec 2022",
                "bullets": ["Built the original checkout service."],
            },
        ],
        "education": [],
        "skills": ["Python"],
    }
    result = await parse_resume_text("<resume text>", _provider_returning(payload))

    exp = result["experience"]
    assert len(exp) == 2
    assert [e["title"] for e in exp] == ["Senior Software Engineer", "Software Engineer"]
    assert [e["company"] for e in exp] == ["Acme Corp", "Acme Corp"]
    # Each role keeps only its own bullets — no cross-contamination or merge.
    assert exp[0]["bullets"] == ["Led the payments platform rewrite."]
    assert exp[1]["bullets"] == ["Built the original checkout service."]
