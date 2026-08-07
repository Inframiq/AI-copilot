import re
from dataclasses import dataclass

@dataclass
class DeltaResult:
    matched: list[str]
    missing: list[str]
    ats_score: int

def compute_delta(jd_skills: list[str], resume_text: str) -> DeltaResult:
    """Case-insensitive, word-boundary keyword match of JD skills against resume plain text.

    Matches require no alphanumeric character directly adjacent on either side,
    rather than relying on \b: plain \b breaks on skills that themselves end in
    a non-word character (e.g. "C++", "C#"), and plain substring matching would
    report false positives like "Java" matching inside "JavaScript".
    """
    matched = []
    missing = []
    for skill in jd_skills:
        pattern = r"(?<![A-Za-z0-9])" + re.escape(skill.strip()) + r"(?![A-Za-z0-9])"
        if re.search(pattern, resume_text, re.IGNORECASE):
            matched.append(skill)
        else:
            missing.append(skill)
    total = len(jd_skills)
    score = round((len(matched) / total) * 100) if total > 0 else 0
    return DeltaResult(matched=matched, missing=missing, ats_score=score)
