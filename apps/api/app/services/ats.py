from dataclasses import dataclass

@dataclass
class DeltaResult:
    matched: list[str]
    missing: list[str]
    ats_score: int

def compute_delta(jd_skills: list[str], resume_text: str) -> DeltaResult:
    """Case-insensitive keyword match of JD skills against resume plain text."""
    resume_lower = resume_text.lower()
    matched = []
    missing = []
    for skill in jd_skills:
        if skill.lower() in resume_lower:
            matched.append(skill)
        else:
            missing.append(skill)
    total = len(jd_skills)
    score = round((len(matched) / total) * 100) if total > 0 else 0
    return DeltaResult(matched=matched, missing=missing, ats_score=score)
