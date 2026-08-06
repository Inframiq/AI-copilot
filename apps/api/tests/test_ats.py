import pytest
from app.services.ats import compute_delta, DeltaResult

def test_compute_delta_all_matched():
    jd_skills = ["Python", "FastAPI", "PostgreSQL"]
    resume_text = "Experienced with Python, FastAPI, and PostgreSQL databases."
    result = compute_delta(jd_skills, resume_text)
    assert isinstance(result, DeltaResult)
    assert set(result.matched) == {"Python", "FastAPI", "PostgreSQL"}
    assert result.missing == []
    assert result.ats_score == 100

def test_compute_delta_none_matched():
    jd_skills = ["Kubernetes", "Rust", "Terraform"]
    resume_text = "Expert in Python and JavaScript development."
    result = compute_delta(jd_skills, resume_text)
    assert result.matched == []
    assert set(result.missing) == {"Kubernetes", "Rust", "Terraform"}
    assert result.ats_score == 0

def test_compute_delta_partial_match():
    jd_skills = ["Python", "AWS", "Docker"]
    resume_text = "Python developer with Docker experience."
    result = compute_delta(jd_skills, resume_text)
    assert "Python" in result.matched
    assert "Docker" in result.matched
    assert "AWS" in result.missing
    assert result.ats_score == pytest.approx(66, abs=2)

def test_ats_score_is_0_to_100():
    result = compute_delta(["X", "Y"], "nothing relevant")
    assert 0 <= result.ats_score <= 100
