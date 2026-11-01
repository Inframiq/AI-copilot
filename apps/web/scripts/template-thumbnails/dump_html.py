"""Write each template's HTML with the sample résumé the gallery shows."""
import sys
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, ".")
from app.services import pdf as P

OUT = Path(sys.argv[1])
FONTS = Path("../web/public/fonts/resume").resolve().as_uri()
SAMPLE = {
    "contact": {"name": "Ada Lovelace", "email": "ada@example.com", "phone": "+1 (555) 010-0100",
                "location": "London, UK", "linkedin": "linkedin.com/in/adalovelace",
                "github": "github.com/adalovelace"},
    "summary": "Staff engineer with ten years building compilers and developer tooling. Led a team of six and cut median build time by 40%.",
    "experience": [
        {"title": "Staff Engineer", "company": "Analytical Engine Co", "start": "2020", "end": None,
         "bullets": ["Designed the first compiler backend, cutting build times 40%.",
                     "Led a team of six across three time zones.",
                     "Drove the migration of 200+ services onto the new toolchain."]},
        {"title": "Senior Engineer", "company": "Babbage Ltd", "start": "2016", "end": "2020",
         "bullets": ["Shipped the analytical engine SDK to 10,000 developers.",
                     "Reduced p99 latency from 800ms to 120ms."]},
    ],
    "projects": [{"name": "Difference Engine", "bullets": ["3.2k stars; used in production by four companies."]}],
    "education": [{"degree": "BSc Computer Science", "institution": "University of London", "year": "2014", "gpa": "3.9/4.0"}],
    "skills": ["Python", "C++", "Rust", "Node.js", "Distributed Systems", "Compilers", "Kubernetes"],
    "languages": [{"name": "English", "level": "Native"}, {"name": "French", "level": "Professional"}],
    "certifications": ["AWS Solutions Architect - Professional"],
}
# The Student / fresher set is shown with a student's résumé.
STUDENT = {
    "contact": {"name": "Ada Lovelace", "email": "ada@example.com", "phone": "+91 98765 43210",
                "location": "Hyderabad, India", "linkedin": "linkedin.com/in/adalovelace",
                "github": "github.com/adalovelace"},
    "objective": "Final-year Computer Science student seeking a backend engineering internship.",
    "education": [{"degree": "Bachelor of Technology (B.Tech), Computer Science", "institution": "JNTU Hyderabad",
                   "year": "Expected May 2027", "gpa": "8.7/10"}],
    "experience": [{"title": "Software Engineering Intern", "company": "Analytical Engine Co", "start": "May 2026", "end": "Jul 2026",
                    "bullets": ["Built a caching layer that cut API response time by 35%.",
                                "Wrote integration tests for 12 payment endpoints."]}],
    "projects": [{"name": "Campus Marketplace", "link": "github.com/adalovelace/market", "tech_stack": "React, FastAPI, PostgreSQL",
                  "bullets": ["Listings app used by 400+ students; real-time chat over WebSockets."]}],
    "skills": ["Python", "Java", "SQL", "React", "FastAPI", "Git"],
    "coursework": ["Data Structures", "Operating Systems", "DBMS", "Computer Networks"],
    "leadership": ["President, Coding Club - ran weekly sessions for 60 students"],
    "awards": ["Smart India Hackathon 2025, finalist"],
}
# Designs drawn for a serif are shown in the font the Builder starts them in
# (startingFontFor in apps/web/lib/resume-templates.ts — keep in step).
STARTING_FONT = {"student_collegiate": "classic_serif", "ats_corporate": "serif"}
# A neutral grey square for the photo templates' portrait.
# Encoded here rather than pasted as base64: the secrets scan reads a long
# base64 literal as a possible key.
_SQUARE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="#9aa4b0"/></svg>'
PHOTO = "data:image/svg+xml;base64," + __import__("base64").b64encode(_SQUARE.encode()).decode()
for tid in sorted(P.ALLOWED_TEMPLATES):
    base = STUDENT if P.TEMPLATE_SETS[tid] == "student" else SAMPLE
    content = {**base, "contact": {**base["contact"], "photo_url": PHOTO}} if tid in P.TEMPLATES_REQUIRING_PHOTO else base
    with patch.object(P, "_sanitize_resume_content", lambda c: (c, P.PHOTO_EMBEDDED if c["contact"].get("photo_url") else P.PHOTO_NONE)):
        html = P.render_resume_html(content, tid, font_choice=STARTING_FONT.get(tid, "sans"))
    faces = "\n".join(
        f'@font-face {{ font-family: "{fam}"; font-weight: {w}; font-style: {s}; src: url("{FONTS}/{pre}-{suf}.ttf"); }}'
        for fam, pre in P.BUNDLED_FONTS.items()
        for suf, w, s in (("Regular", 400, "normal"), ("Bold", 700, "normal"), ("Italic", 400, "italic"), ("BoldItalic", 700, "italic"))
    )
    # A browser ignores @page: give the body the page's margin so the
    # screenshot looks like the printed page.
    margin = __import__("re").search(r"@page \{[^}]*margin: ([0-9.]+in)", html).group(1)
    html = html.replace("</head>", f"<style>{faces}\nhtml {{ background: #fff; }} body {{ padding: {margin}; width: 8.27in; box-sizing: border-box; }}</style></head>", 1)
    (OUT / f"{tid}.html").write_text(html, encoding="utf-8")
    print(tid)
