"""What an ATS reads out of our own exported PDF, and what it would miss.

The ATS reference's export checks (its Part B and section 11): render the
résumé exactly as it will download, pull the text back out the way a parser
does, and compare it with the résumé it came from. Deterministic — no model
calls, so it costs no credits and the same résumé always gives the same
findings.

Text comes out with pypdf in content-stream order, which is what "copy all
the text from the PDF and paste it into Notepad" gives — the reference's own
quick test. The guard tests (tests/test_ats_readability.py) additionally run
every template through pdfminer's layout analysis, the other way parsers
read a page.

Only our own render is read here, never an upload: an uploaded file goes
through app.services.sandbox, and this module must not be pointed at one.
"""
import io
import re
from dataclasses import asdict, dataclass

from app.services.pdf import TEMPLATES_REQUIRING_PHOTO, display_url
from app.services.plain_text import plain_deep
from app.services.resume_dates import is_present, is_standard_date, tidy_resume_dates
from app.services.rich_text import strip_inline_tags

# Section → the headings a parser recognises for it (the reference's
# "use one of these" column). Every template prints one of these; the check
# confirms it reached the text on a line of its own.
APPROVED_HEADINGS: dict[str, set[str]] = {
    "summary": {"summary", "professional summary"},
    "objective": {"objective"},
    "experience": {"experience", "work experience", "internships"},
    "projects": {"projects", "technical projects"},
    "education": {"education"},
    "skills": {"skills", "technical skills"},
    "certifications": {"certifications"},
    "awards": {"awards"},
    "achievements": {"achievements"},
    "leadership": {"leadership"},
    "volunteer": {"volunteer experience"},
    "languages": {"languages"},
    "interests": {"interests"},
}

# Characters that mean the text did not come out clean: the replacement
# character (a glyph with no Unicode mapping), ligature code points, and the
# private-use area icon fonts draw from.
_BROKEN_CHARS = re.compile("[�ﬀ-ﬆ-]")

_WORD = re.compile(r"[A-Za-z0-9][A-Za-z0-9+#.'/-]*[A-Za-z0-9+#]|[A-Za-z0-9]")

# The reference asks for at least 98% of the résumé's words in the extracted
# text.
MIN_WORD_COVERAGE = 0.98

# Email and phone belong to the lines just under the name. Three lines
# allows for a headline and a contact line that wraps.
CONTACT_WITHIN_LINES = 3

# A job's title, company and dates must sit within two lines of each other.
MAX_ENTRY_SPREAD = 2

_FILLER = re.compile(r"\b(responsible for|duties included|tasked with|worked on various)\b", re.I)
_BARE_GRADE = re.compile(r"^\s*\d+(\.\d+)?\s*$")


@dataclass
class Finding:
    """One thing the check found. level "error" means an ATS would lose or
    misread information; "warning" is a writing or format point the
    reference flags that costs nothing to fix."""
    id: str
    level: str
    message: str
    field: str | None = None

    def to_dict(self) -> dict:
        return {k: v for k, v in asdict(self).items() if v is not None}


def extract_text(pdf_bytes: bytes) -> str:
    """The PDF's text, page after page, in content-stream order."""
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(pdf_bytes))
    return "\n".join((page.extract_text() or "") for page in reader.pages)


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "")).strip().lower()


def _lines(text: str) -> list[str]:
    return [line.strip() for line in text.splitlines() if line.strip()]


def _words(text: str) -> list[str]:
    return [w.lower() for w in _WORD.findall(text or "")]


def _rendered_content(content: dict) -> dict:
    """The résumé as the renderer prints it — plain text, dates tidied — so
    the comparison is against what was put on the page."""
    return tidy_resume_dates(plain_deep(content or {}))


def _content_words(content: dict) -> list[str]:
    """Every word the résumé asks to be printed."""
    parts: list[str] = []
    contact = content.get("contact") or {}
    for key in ("name", "email", "phone", "location"):
        parts.append(str(contact.get(key) or ""))
    for key in ("linkedin", "github", "website"):
        if contact.get(key):
            parts.append(display_url(str(contact[key])))
    parts.append(str(content.get("summary") or content.get("objective") or ""))
    for exp in content.get("experience") or []:
        if not isinstance(exp, dict):
            continue
        parts += [str(exp.get(k) or "") for k in ("title", "company", "location", "start", "end")]
        parts += [str(b) for b in exp.get("bullets") or []]
    for proj in content.get("projects") or []:
        if not isinstance(proj, dict):
            continue
        parts += [str(proj.get(k) or "") for k in ("name", "tech_stack", "start", "end")]
        for key in ("link", "live_link"):
            if proj.get(key):
                parts.append(display_url(str(proj[key])))
        parts += [str(b) for b in proj.get("bullets") or []]
    for edu in content.get("education") or []:
        if isinstance(edu, dict):
            parts += [str(edu.get(k) or "") for k in ("degree", "institution", "year", "gpa", "honors")]
    skills = content.get("skills")
    if isinstance(skills, dict):
        for category, items in skills.items():
            parts.append(str(category))
            parts += [str(i) for i in items or []]
    else:
        parts += [str(s) for s in skills or []]
    for key in ("certifications", "awards", "achievements", "leadership", "volunteer", "interests"):
        parts += [str(i) for i in content.get(key) or []]
    for lang in content.get("languages") or []:
        if isinstance(lang, dict):
            parts += [str(lang.get("name") or ""), str(lang.get("level") or "")]
    return _words(" ".join(strip_inline_tags(p) for p in parts))


def _sections_present(content: dict) -> list[str]:
    present = []
    if content.get("summary"):
        present.append("summary")
    elif content.get("objective"):
        present.append("objective")
    for key in ("experience", "projects", "education", "skills", "certifications", "awards",
                "achievements", "leadership", "volunteer", "languages", "interests"):
        if content.get(key):
            present.append(key)
    return present


def _first_item(content: dict, section: str) -> str:
    """A distinctive piece of text from the start of *section* — what must
    come out after its heading."""
    value = content.get(section)
    if section in ("summary", "objective"):
        return " ".join(strip_inline_tags(str(value or "")).split()[:6])
    if section == "skills":
        items = [i for items in value.values() for i in items] if isinstance(value, dict) else list(value or [])
        return str(items[0]) if items else ""
    first = (value or [None])[0]
    if isinstance(first, dict):
        for key in ("title", "name", "degree"):
            if first.get(key):
                return str(first[key])
        return ""
    return " ".join(strip_inline_tags(str(first or "")).split()[:6])


def _line_of(lines_norm: list[str], needle: str, start: int = 0) -> int | None:
    needle = _norm(needle)
    if not needle:
        return None
    for i in range(start, len(lines_norm)):
        if needle in lines_norm[i]:
            return i
    return None


def check_text(content: dict, text: str, template_id: str | None = None) -> list[Finding]:
    """Findings for *text* — the text pulled out of *content*'s PDF."""
    content = _rendered_content(content)
    findings: list[Finding] = []
    lines = _lines(text)
    lines_norm = [_norm(line) for line in lines]
    flat = _norm(text)
    contact = content.get("contact") or {}

    # ── Can it be read ──────────────────────────────────────────────────────
    name = str(contact.get("name") or "").strip()
    if not name:
        findings.append(Finding("name-missing", "error", "Add your name. It is the first thing a parser reads.", "contact.name"))
    elif not lines or _norm(name) not in lines_norm[0]:
        findings.append(Finding("name-not-first", "error", "The name is not the first line of the extracted text.", "contact.name"))
    elif re.search(r"\b(resume|résumé|cv|curriculum vitae)\b", name, re.I):
        findings.append(Finding("name-has-resume", "warning", 'Keep the name line to the name alone, without "Resume" or "CV".', "contact.name"))

    for key, label in (("email", "email"), ("phone", "phone number")):
        value = str(contact.get(key) or "").strip()
        if not value:
            findings.append(Finding(f"{key}-missing", "error", f"Add a {label} to the contact line.", f"contact.{key}"))
        elif key == "email" and _norm(value) not in flat:
            findings.append(Finding("email-unreadable", "error", "The email did not come out in the extracted text.", "contact.email"))
        elif key == "phone" and re.sub(r"\D", "", value) not in re.sub(r"\D", "", text):
            findings.append(Finding("phone-unreadable", "error", "The phone number did not come out in the extracted text.", "contact.phone"))

    # The contact block is read as the lines straight after the name; one
    # that lands anywhere else is not treated as contact details.
    for key in ("email", "phone"):
        value = str(contact.get(key) or "").strip()
        probe = _norm(value) if key == "email" else re.sub(r"\D", "", value)
        if not probe:
            continue
        hits = [i for i, line in enumerate(lines_norm)
                if probe in (line if key == "email" else re.sub(r"\D", "", line))]
        if hits and hits[0] > CONTACT_WITHIN_LINES:
            findings.append(Finding(
                "contact-not-at-top", "error",
                f"The {key} came out far from the name, not in the contact lines at the top.",
                f"contact.{key}",
            ))

    links = [(f"contact.{k}", contact.get(k)) for k in ("linkedin", "github", "website")]
    for i, proj in enumerate(content.get("projects") or []):
        if isinstance(proj, dict):
            links += [(f"projects.{i}.{k}", proj.get(k)) for k in ("link", "live_link")]
    for field, url in links:
        if url and _norm(display_url(str(url))) not in flat.replace(" ", "") and _norm(display_url(str(url))) not in flat:
            findings.append(Finding("link-unreadable", "error", f"The link {display_url(str(url))} did not come out in the extracted text.", field))

    for section in _sections_present(content):
        at = next((i for i, line in enumerate(lines_norm) if line in APPROVED_HEADINGS[section]), None)
        if at is None:
            findings.append(Finding("heading-unreadable", "error", f"The {section} heading did not come out on a line of its own.", section))
            continue
        # Out of order when the section's first item came out only above its
        # heading. (Above *and* below is the same words elsewhere — a project
        # named "Ledger" and a bullet about a ledger.)
        first = _first_item(content, section)
        if first and _line_of(lines_norm, first) is not None and _line_of(lines_norm, first, at + 1) is None:
            findings.append(Finding(
                "heading-out-of-order", "error",
                f"The {section} heading came out after its own content, so the parser files that content under the section before it.",
                section,
            ))

    if _BROKEN_CHARS.search(text):
        findings.append(Finding("broken-characters", "error", "Some characters came out broken (ligatures, icon glyphs or unmapped characters)."))

    wanted = _content_words(content)
    if wanted:
        got = set(_words(text))
        missing = [w for w in wanted if w not in got]
        coverage = 1 - len(missing) / len(wanted)
        if coverage < MIN_WORD_COVERAGE:
            sample = ", ".join(dict.fromkeys(missing))[:120]
            findings.append(Finding(
                "words-missing", "error",
                f"{round(coverage * 100)}% of the résumé's words came out in the extracted text (at least 98% is the bar). Missing: {sample}",
            ))

    # ── Jobs ────────────────────────────────────────────────────────────────
    # A job without a title reaches the ATS as a company and dates alone, and
    # the title is what recruiters search and the match tools weigh.
    for i, job in enumerate(content.get("experience") or []):
        if not isinstance(job, dict):
            continue
        if not str(job.get("title") or "").strip():
            findings.append(Finding(
                "title-missing", "error",
                f"Add the job title for {str(job.get('company') or 'this job').strip()}.",
                f"experience.{i}.title",
            ))
        if not [b for b in job.get("bullets") or [] if strip_inline_tags(str(b)).strip()]:
            findings.append(Finding(
                "no-points", "warning",
                f"{str(job.get('company') or 'This job').strip()} has no points: add what was done there, with a number where possible.",
                f"experience.{i}.bullets",
            ))

    # ── Dates ───────────────────────────────────────────────────────────────
    for section in ("experience", "projects"):
        for i, entry in enumerate(content.get(section) or []):
            if not isinstance(entry, dict):
                continue
            start, end = entry.get("start"), entry.get("end")
            if section == "experience" and not str(start or "").strip():
                findings.append(Finding("date-missing", "error", "Add a start date: a job without one is left out of total experience.", f"{section}.{i}.start"))
            for key, value in (("start", start), ("end", end)):
                if value and not is_standard_date(value):
                    findings.append(Finding(
                        "date-unreadable", "error",
                        f'"{value}" is not a date a parser can read. Use a month and year, like Jun 2025, or "Present".',
                        f"{section}.{i}.{key}",
                    ))
    for i, edu in enumerate(content.get("education") or []):
        year = str((edu or {}).get("year") or "") if isinstance(edu, dict) else ""
        if re.search(r"\b(spring|summer|fall|autumn|winter|q[1-4])\b|'\d{2}\b", year, re.I):
            findings.append(Finding("date-unreadable", "warning", f'"{year}": write it as a month and year, like May 2026.', f"education.{i}.year"))
        elif year and is_present(year):
            findings.append(Finding("date-unreadable", "warning", 'For a degree in progress, write "Expected" with the month and year.', f"education.{i}.year"))

    # A job's title, company and dates must read as one entry.
    cursor = 0
    for i, job in enumerate(content.get("experience") or []):
        if not isinstance(job, dict):
            continue
        at_title = _line_of(lines_norm, str(job.get("title") or ""), cursor)
        if at_title is None:
            continue
        window = range(max(0, at_title - MAX_ENTRY_SPREAD), at_title + MAX_ENTRY_SPREAD + 1)
        for key in ("company", "start"):
            value = _norm(str(job.get(key) or ""))
            if value and not any(j < len(lines_norm) and value in lines_norm[j] for j in window):
                findings.append(Finding(
                    "entry-split", "error",
                    f"The {key} of \"{job.get('title')}\" came out away from its title.",
                    f"experience.{i}.{key}",
                ))
        cursor = at_title + 1

    # ── Format ──────────────────────────────────────────────────────────────
    if template_id in TEMPLATES_REQUIRING_PHOTO:
        findings.append(Finding(
            "photo-template", "warning",
            "This template has a photo. For job portals, use a template without one.",
        ))

    # ── Writing ─────────────────────────────────────────────────────────────
    for section in ("experience", "projects"):
        for i, entry in enumerate(content.get(section) or []):
            for j, bullet in enumerate((entry or {}).get("bullets") or [] if isinstance(entry, dict) else []):
                match = _FILLER.search(strip_inline_tags(str(bullet)))
                if match:
                    findings.append(Finding(
                        "filler", "warning",
                        f'Lead with what was done, not "{match.group(1)}".',
                        f"{section}.{i}.bullets.{j}",
                    ))
    for i, edu in enumerate(content.get("education") or []):
        gpa = str((edu or {}).get("gpa") or "") if isinstance(edu, dict) else ""
        if gpa and _BARE_GRADE.match(gpa):
            findings.append(Finding("gpa-scale", "warning", f"Give the grade with its scale, like {gpa.strip()}/10.", f"education.{i}.gpa"))

    return findings


def check_pdf(content: dict, pdf_bytes: bytes, template_id: str | None = None) -> tuple[str, list[Finding]]:
    """(extracted text, findings) for *content* rendered as *pdf_bytes*."""
    text = extract_text(pdf_bytes)
    return text, check_text(content, text, template_id)


# ── Against a job post ──────────────────────────────────────────────────────
# The ATS reference's tailoring rules that can be checked without a model:
#   3. each important skill in two places — the Skills list and a bullet
#      that shows it in use;
#   4. a title the candidate hasn't held mentioned once in the Summary;
#   6. no keyword repeated over and over.
# Read from the job's stored analysis (JobDescription.parsed["agent1"]), so
# this runs no model and costs nothing.

# More uses than this of one job term reads as stuffing. The reference names
# no number; five keeps a term that genuinely recurs across roles (a
# language used in three jobs, plus Skills and Summary) out of the flag.
MAX_TERM_USES = 5


def _evidence_texts(content: dict) -> list[str]:
    """Where a skill can be shown in use: the summary and every bullet."""
    texts = [str(content.get("summary") or content.get("objective") or "")]
    for section in ("experience", "projects"):
        for entry in content.get(section) or []:
            if not isinstance(entry, dict):
                continue
            texts += [str(b) for b in entry.get("bullets") or []]
            for proj in entry.get("projects") or []:
                if isinstance(proj, dict):
                    texts += [str(b) for b in proj.get("bullets") or []]
    return [strip_inline_tags(t) for t in texts]


def check_against_jd(content: dict, jd_analysis) -> list[Finding]:
    """Warnings for *content* against a parsed job post (a JDAnalysis)."""
    from app.services.ats import _exact_pattern, build_resume_text, title_match_verdict

    content = _rendered_content(content)
    findings: list[Finding] = []
    importance = getattr(jd_analysis, "importance", None) or {}
    hard = list(dict.fromkeys(
        list(jd_analysis.exact_technical_tools or []) + list(jd_analysis.methodologies_and_frameworks or [])
    ))
    # "Important" is what the analysis rated high; a JD analysed before
    # ratings existed falls back to its exact tools.
    important = [t for t in hard if importance.get(t.strip().lower()) == "high"] if importance else []
    if not important:
        important = list(jd_analysis.exact_technical_tools or [])

    skills = content.get("skills")
    skill_items = [i for items in skills.values() for i in items] if isinstance(skills, dict) else list(skills or [])
    skills_text = " | ".join(str(s) for s in skill_items)
    evidence = " | ".join(_evidence_texts(content))
    for term in important:
        pattern = _exact_pattern(term)
        if pattern.search(skills_text) and not pattern.search(evidence):
            findings.append(Finding(
                "skill-not-shown", "warning",
                f"{term} is in Skills but no bullet shows it in use. If it is true, add it to one.",
                "skills",
            ))

    titles = [t.strip() for t in (jd_analysis.target_job_titles or []) if t and t.strip()]
    if titles:
        held = [str(content.get("headline") or "")] + [
            str(e.get("title") or "") for e in (content.get("experience") or []) if isinstance(e, dict)
        ]
        summary = strip_inline_tags(str(content.get("summary") or content.get("objective") or ""))
        if title_match_verdict(titles, [t for t in held if t]) == "missing" and not any(
            _exact_pattern(t).search(summary) for t in titles
        ):
            findings.append(Finding(
                "title-not-mentioned", "warning",
                f"The job's title, {titles[0]}, appears nowhere. Mention it once in the Summary.",
                "summary",
            ))

    full_text, _ = build_resume_text(content)
    for term in dict.fromkeys(hard + list(jd_analysis.ats_filter_phrases or [])):
        uses = len(_exact_pattern(term).findall(full_text))
        if uses > MAX_TERM_USES:
            findings.append(Finding(
                "keyword-repeated", "warning",
                f"{term} appears {uses} times. Repeating a keyword reads as stuffing; keep the uses that show real work.",
            ))
    return findings
