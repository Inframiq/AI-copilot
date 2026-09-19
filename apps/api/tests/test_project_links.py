"""A project can carry two links, typically "GitHub" and "Live". The parser
used to keep one and drop the other, and sometimes filed the word "GitHub"
as the URL itself."""
import json

import pytest
from unittest.mock import AsyncMock, MagicMock

from app.services.resume_parser import PARSE_SYSTEM, _Link, _append_link_hints, parse_resume_text


def _provider_returning(payload: dict) -> MagicMock:
    provider = MagicMock()
    provider.complete = AsyncMock(return_value=json.dumps(payload))
    return provider


def test_parse_system_prompt_has_a_live_link_beside_the_repo_link():
    assert '"live_link"' in PARSE_SYSTEM
    assert "Never drop a project's second link" in PARSE_SYSTEM


def test_link_hints_carry_the_anchor_text_and_its_line():
    text = _append_link_hints("body", [
        _Link("https://github.com/j/o", "GitHub", "OdTect | GitHub | Live"),
        _Link("https://odtect.app", "Live", "OdTect | GitHub | Live"),
        _Link("https://odtect.app", "Live", "OdTect | GitHub | Live"),
    ])
    assert '- "GitHub" -> https://github.com/j/o (on the line: "OdTect | GitHub | Live")' in text
    assert '- "Live" -> https://odtect.app' in text
    assert text.count("https://odtect.app") == 1


@pytest.mark.asyncio
async def test_an_anchor_word_filed_as_a_url_becomes_the_label():
    provider = _provider_returning({
        "contact": {"name": "Jane"},
        "experience": [], "education": [], "skills": [],
        "projects": [
            {"name": "Disk Monitor", "link": "GitHub", "live_link": None, "bullets": []},
            {"name": "OdTect", "link": "https://github.com/j/o", "link_label": "GitHub",
             "live_link": "odtect.app", "live_link_label": "Live", "bullets": []},
        ],
    })
    data = await parse_resume_text("resume text", provider)
    disk, odtect = data["projects"]
    assert disk["link"] is None and disk["link_label"] == "GitHub"
    assert odtect["link"] == "https://github.com/j/o"
    assert odtect["live_link"] == "odtect.app" and odtect["live_link_label"] == "Live"
