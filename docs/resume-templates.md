# Résumé templates

How the PDF templates are built, the two sets they come in, what makes a
template ATS-readable here, and the steps to add one. Written 2026-11-01,
after the ATS-reference build and the template research round.

## The two sets

Every template belongs to one gallery tab (`TEMPLATE_SETS` in
`apps/api/app/services/pdf.py`, `RESUME_TEMPLATES` in
`apps/web/lib/resume-templates.ts`):

| Set | Default section order | Sections that must print |
|---|---|---|
| **Student / fresher** | Objective, Education, Experience (headed *Internships* when every role is one), Projects, Skills, Coursework, Leadership, Awards, … | Objective, Education with CGPA and its scale, Internships, Projects, Skills, Coursework, Leadership, Awards |
| **Working professional** | Summary, Experience (with a role's client projects), Projects, Education, Skills, Certifications, … — or the template's own order | Summary, Experience with client projects, Skills, Certifications, Education |

A résumé's own `section_order` always wins over the set's.

A **student twin** (`student_clean`, …) is a professional design drawn in the
student order: it renders from its twin's file (`TEMPLATE_FILES`), because
the sections come from the shared blocks and only their order differs.

## How a template is built

```
templates/
  _blocks.html        every section, written once; the contact line
  _base_style.html    the CSS every template needs (newer templates include it)
  _job_projects.html  a role's projects/clients
  <id>.html           one template: its <style>, its header, a style table
```

A template owns only its look: its CSS, its header or masthead, and a style
table `S` passed to `blocks.sections(S)` — separators, date style, class
names its CSS targets, headings it renames, its default order. See the top
of `_blocks.html` for every key. The sections themselves (which fields
print, in what order, the Studio's `data-field` paths, the ATS rules) live
in `_blocks.html`, so a fix lands in every template.

## What makes a template ATS-readable here

Each rule below was found by rendering and extracting text, and each is
enforced by `apps/api/tests/test_ats_readability.py` across every template,
both extractors (pypdf in content order, pdfminer by layout), and the style
edges a user can reach (text size ±1, line spacing 1.0–1.6, paragraph
spacing 0–24, every font, A4 and Letter):

- **One column, plain inline text.** Anything that pushes text visually —
  `float`, flex `justify-content`, a right-aligned table cell — makes
  WeasyPrint write it out of order; dates landed at the end of the text.
  A heading's trailing rule is an empty `::after` box beside the text
  (Campus Placement), never the text pushed.
- **Nothing centred but a short masthead.** A centred heading was read after
  its own section, and a centred name over a contact line long enough to
  wrap was read after the contact line (pdfminer).
- **No wide letter-spacing** (≤ 0.06em): "S U M M A RY" is not a heading.
- **No opacity on text**: semi-transparent text is drawn last.
- **Room under the name** (`h1` margin ≥ 6px): a tight gap under a large
  name ran it into the email in content order.
- **List markers inside** (`list-style-position: inside`): markers drawn
  outside were written after the whole page as stray "•".
- **Contact items never wrap** (`.contact-item { white-space: nowrap }`).
- **Standard headings only** — `ats_check.APPROVED_HEADINGS`.
- **Accent colour ≥ 4.5:1 on white** (`MIN_ACCENT_CONTRAST`), so headings
  never become hidden text; a lighter one falls back to the template's own.
- **Fonts** are the bundled ones (`apps/api/fonts`, rebuilt by `build.py`):
  no ligatures and no kerning — a kerned "Te" in Lato bold was read as
  "T echnology".

## Adding a template

1. **Design.** Decide the set and what makes it different from the ones in
   that tab — a heading treatment, a masthead, a default order (Impact is
   the hybrid order), a font it is drawn for. Keep to the rules above.
2. **Write `templates/<id>.html`.** Start from `student_placement.html` or
   `ats_impact.html`: `{% include "_base_style.html" %}` inside `<style>`,
   then the template's own rules; the header with
   `blocks.contact_line(sep)`; then `blocks.sections(S)`. Set
   `page_margin` (≥ 0.5in) before the include. Name ≥ 18pt via
   `heading_size(x, 18)`; body sizes via `body_size(...)`.
3. **Register it.**
   - `pdf.py`: `TEMPLATE_SETS` (and `TEMPLATE_FILES` for a twin),
     `TEMPLATE_DEFAULT_ACCENT` (check `contrast_on_white(...) >= 4.5`).
   - `schemas/resume.py`: `ValidTemplateId`.
   - `apps/web/lib/resume-templates.ts`: an entry with `set`, `label`,
     `description`, and `font` if it is drawn for a serif.
   - `tests/test_pdf.py`: `TEMPLATE_DEFAULT_ACCENT_LOWER`.
4. **Sample page preview.** Add the id to `STARTING_FONT` in
   `apps/web/scripts/template-thumbnails/dump_html.py` if it has a starting
   font, then rebuild the thumbnails (README there) and look at it.
5. **Tests.** Run the API suite. The guard tests pick the template up by
   id: readability in both extractors at every style edge, every section of
   its set printed, headings before content, the Studio's field paths,
   gallery and API in step. Nothing to add unless the design brings a new
   behaviour worth pinning (as Impact's order is).
6. **Look in the app.** The Builder's tab and the Studio gallery, at phone
   and laptop widths, then an export through the ATS view.

## Research behind the 2026-11-01 designs

Four designs were added, two per set, each grounded in what the sources
agree on (one column, reverse-chronological, plain text, standard
headings) rather than any one vendor's claims:

- **Campus Collegiate** (student): the university career-centre résumé —
  chronological, Education near the top, a serif. University career
  centres publish templates in this form (Howard University's undergraduate
  guide is chronological with Education first; Saint Mary's University of
  Minnesota offers a "Classic Collegiate" undergraduate template).
- **Campus Placement** (student): the dense one-pager Indian campus drives
  expect — one page, Education first with the CGPA *and its scale*
  ("CGPA: 8.2/10"), projects and internships weighted, relevant coursework
  when it adds value (guidance from naukri.com campus, monster.com India
  and others; their CGPA cut-offs vary and are not used here).
- **Corporate** (professional): traditional reverse-chronological, the
  format the sources call the most widely accepted for experienced
  candidates, set in serif.
- **Impact** (professional): the hybrid — summary and key achievements
  before the reverse-chronological history — which the sources recommend
  for senior candidates with a steady record. Still one column: the hybrid
  is an order, not a layout.

Not added: multi-column, photo-led and infographic designs (the reference
and every source agree they break parsing), and functional/skills-only
résumés (the sources say parsers struggle with them).
