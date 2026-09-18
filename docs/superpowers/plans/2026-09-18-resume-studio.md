# Resume Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A full-page Resume Studio where the document is the interface — an Edit tab with truly inline editing and a Preview tab showing the real PDF.

**Architecture:** `services/pdf.py::_render_html` already returns the complete HTML string, separately from the WeasyPrint step. Exposing it through a new endpoint gives the browser a document that is *by construction* what will export — no second React copy of the templates to drift. The templates gain `data-field` attributes so a DOM edit maps back to `resume_content`, which is written through `resume-store`'s existing `updateContent` and therefore autosaves like any other edit.

**Tech Stack:** FastAPI + Jinja2 + WeasyPrint (backend), Next.js App Router, React 19, Zustand, Vitest + pytest.

**Spec:** `docs/superpowers/specs/2026-09-18-resume-builder-redesign-design.md`

## Global Constraints

- Do not change `generate_pdf`, `upload_pdf`, `get_signed_url`, or any existing route's behaviour. The new endpoint is additive.
- `data-field` values are dot paths against `ResumeContent`: `summary`, `contact.email`, `experience.0.bullets.2`, `education.1.institution`. Array indices are zero-based.
- Template edits are **additive attributes only**. WeasyPrint ignores unknown attributes, so PDF output must be byte-identical. `apps/api/tests/test_pdf_ats_text_order.py` and the other `test_pdf_*` files must stay green — this repo's standing rule is that template layout changes need render-and-extract testing with short content, not visual inspection.
- Backend tests run `cd apps/api && .venv/bin/python -m pytest tests/ -q`. Web tests run `cd apps/web && npx vitest run && npx tsc --noEmit`; `tsc` shows pre-existing `.next/` and `@vercel/*` errors only.
- Never inject caller-supplied HTML. The endpoint renders through the templates or not at all.

---

### Task 1: The HTML render endpoint

**Files:**
- Modify: `apps/api/app/services/pdf.py` (export the existing private renderer)
- Modify: `apps/api/app/routers/resumes.py` (add the route)
- Test: `apps/api/tests/test_resume_html.py`

**Interfaces:**
- Produces: `POST /resumes/{resume_id}/html` → `{"html": str}`. Same auth, ownership check and `PdfGenerateRequest` body as `POST /resumes/{resume_id}/pdf`.

- [ ] **Step 1: Write the failing test**

```python
"""POST /resumes/{id}/html — the document the Studio edits inline.

Returns the same HTML string generate_pdf feeds to WeasyPrint, so what the
user edits is by construction what exports. No second template path.
"""
import uuid
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.db.session import get_db
from app.db.models import Resume
from tests.test_jd_and_tailor_endpoints import make_auth_header, make_mock_db, TEST_USER_ID


def _resume():
    return Resume(
        id=uuid.uuid4(), user_id=uuid.UUID(TEST_USER_ID), title="R",
        content={"contact": {"name": "Jane"}, "experience": [], "education": [], "skills": []},
        template_id="ats_clean",
    )


async def _post(body=None, resume=None):
    override, session = make_mock_db()
    row = MagicMock(); row.scalar_one_or_none.return_value = resume or _resume()
    session.execute = AsyncMock(return_value=row)
    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            return await c.post(
                f"/resumes/{(resume or _resume()).id}/html",
                json=body or {}, headers=make_auth_header(),
            )
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_returns_rendered_html():
    r = await _post()
    assert r.status_code == 200
    assert "<html" in r.json()["html"].lower()


@pytest.mark.asyncio
async def test_the_html_contains_the_resume_content():
    r = await _post()
    assert "Jane" in r.json()["html"]


@pytest.mark.asyncio
async def test_a_content_override_is_rendered_instead_of_the_saved_resume():
    body = {"content": {"contact": {"name": "Override Name"}, "experience": [],
                        "education": [], "skills": []}}
    r = await _post(body)
    assert "Override Name" in r.json()["html"]


@pytest.mark.asyncio
async def test_it_rejects_an_unknown_template():
    r = await _post({"template_id": "not_a_template"})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_it_404s_for_a_resume_the_caller_does_not_own():
    override, session = make_mock_db()
    row = MagicMock(); row.scalar_one_or_none.return_value = None
    session.execute = AsyncMock(return_value=row)
    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            r = await c.post(f"/resumes/{uuid.uuid4()}/html", json={}, headers=make_auth_header())
        assert r.status_code == 404
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_it_requires_auth():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post(f"/resumes/{uuid.uuid4()}/html", json={})
    assert r.status_code in (401, 403)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && .venv/bin/python -m pytest tests/test_resume_html.py -q`
Expected: FAIL — 404 on every route test (the route does not exist).

- [ ] **Step 3: Write minimal implementation**

In `apps/api/app/services/pdf.py`, add a public alias below `_render_html`:

```python
def render_resume_html(
    resume_content: dict,
    template_id: str,
    line_spacing: float = 1.25,
    paragraph_spacing: int = 12,
    font_choice: str = "sans",
    accent_color: str | None = None,
) -> str:
    """The exact HTML generate_pdf hands to WeasyPrint.

    Public wrapper over _render_html so the Studio can edit the same document
    that will be exported. Keeping it a wrapper rather than renaming the
    private one leaves generate_pdf and count_pdf_pages untouched.
    """
    return _render_html(
        resume_content, template_id, line_spacing, paragraph_spacing,
        font_choice, accent_color,
    )
```

In `apps/api/app/routers/resumes.py`, add after `generate_resume_pdf` (import `render_resume_html` alongside the existing `pdf` imports at line 14):

```python
@router.post("/{resume_id}/html")
@limiter.limit("30/minute")
async def render_resume_html_endpoint(
    request: Request,
    resume_id: uuid.UUID,
    body: PdfGenerateRequest | None = None,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """The document the Studio edits in place.

    Same template path as the PDF, so what the user edits is what exports.
    Unlike the PDF route this persists nothing and uploads nothing — it is a
    pure render, which is why its rate limit is looser.
    """
    result = await db.execute(
        select(Resume).where(Resume.id == resume_id, Resume.user_id == uuid.UUID(user["sub"]))
    )
    resume = result.scalar_one_or_none()
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")

    template_id = (body.template_id if body else None) or resume.template_id
    if template_id not in _VALID_TEMPLATES:
        raise HTTPException(status_code=400, detail="Invalid template_id.")

    content = (body.content if body and body.content is not None else resume.content) or {}
    try:
        html = await asyncio.to_thread(
            render_resume_html,
            content,
            template_id,
            (body.line_spacing if body else None) or resume.line_spacing,
            (body.paragraph_spacing if body else None) or resume.paragraph_spacing,
            (body.font_choice if body else None) or resume.font_choice,
            (body.accent_color if body else None) or resume.accent_color,
        )
    except PhotoRequiredError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"html": html}
```

Note: `test_it_rejects_an_unknown_template` expects 422 because `PdfGenerateRequest.template_id` is a `Literal`, so Pydantic rejects it before the handler runs. The explicit 400 covers a template that passes the Literal but is missing from `_VALID_TEMPLATES`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && .venv/bin/python -m pytest tests/test_resume_html.py -q`
Expected: PASS (6 tests)

- [ ] **Step 5: Run the full backend suite**

Run: `cd apps/api && .venv/bin/python -m pytest tests/ -q`
Expected: 657 passed. If any `test_pdf_*` fails, stop — the wrapper changed rendering, which it must not.

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/services/pdf.py apps/api/app/routers/resumes.py apps/api/tests/test_resume_html.py
git commit -m "feat(studio): expose the rendered resume HTML"
```

---

### Task 2: Field paths

Pure read/write against `ResumeContent` by dot path. Built before the templates are annotated so the path format is settled first.

**Files:**
- Create: `apps/web/lib/field-path.ts`
- Test: `apps/web/__tests__/field-path.test.ts`

**Interfaces:**
- Produces: `readField(content, path): string | undefined` and `writeField(content, path, value): ResumeContent` — immutable, returns a new object.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { readField, writeField } from "../lib/field-path";
import type { ResumeContent } from "@career-copilot/types";

const CONTENT = {
  contact: { name: "Jane", email: "jane@example.com" },
  summary: "A summary.",
  experience: [
    { company: "Acme", title: "Engineer", start: "2020", bullets: ["First", "Second"] },
  ],
  education: [{ institution: "State", degree: "BS", year: "2019" }],
  skills: ["Python", "Go"],
} as unknown as ResumeContent;

describe("readField", () => {
  it("reads a top-level string", () => {
    expect(readField(CONTENT, "summary")).toBe("A summary.");
  });
  it("reads a nested object field", () => {
    expect(readField(CONTENT, "contact.email")).toBe("jane@example.com");
  });
  it("reads an array element", () => {
    expect(readField(CONTENT, "skills.1")).toBe("Go");
  });
  it("reads a nested array element", () => {
    expect(readField(CONTENT, "experience.0.bullets.1")).toBe("Second");
  });
  it("returns undefined for a path that does not exist", () => {
    expect(readField(CONTENT, "experience.9.bullets.0")).toBeUndefined();
  });
  it("returns undefined for a malformed path", () => {
    expect(readField(CONTENT, "")).toBeUndefined();
  });
});

describe("writeField", () => {
  it("writes a top-level string", () => {
    expect(writeField(CONTENT, "summary", "New").summary).toBe("New");
  });
  it("writes a nested object field", () => {
    expect(writeField(CONTENT, "contact.email", "new@x.com").contact.email).toBe("new@x.com");
  });
  it("writes a nested array element", () => {
    const out = writeField(CONTENT, "experience.0.bullets.1", "Rewritten");
    expect(out.experience[0].bullets[1]).toBe("Rewritten");
  });
  it("does not mutate the input", () => {
    writeField(CONTENT, "summary", "New");
    expect(CONTENT.summary).toBe("A summary.");
  });
  it("leaves siblings untouched", () => {
    const out = writeField(CONTENT, "experience.0.bullets.0", "Changed");
    expect(out.experience[0].bullets[1]).toBe("Second");
    expect(out.contact.name).toBe("Jane");
  });
  it("returns the content unchanged for a path that does not exist", () => {
    // A stale data-field from an older render must never corrupt the resume.
    const out = writeField(CONTENT, "experience.9.bullets.0", "Nope");
    expect(out).toEqual(CONTENT);
  });
  it("returns the content unchanged for a malformed path", () => {
    expect(writeField(CONTENT, "", "Nope")).toEqual(CONTENT);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run __tests__/field-path.test.ts`
Expected: FAIL — cannot resolve `../lib/field-path`

- [ ] **Step 3: Write minimal implementation**

```ts
import type { ResumeContent } from "@career-copilot/types";

/**
 * Dot paths from the rendered document back to the résumé model.
 *
 * The templates carry `data-field="experience.0.bullets.2"` on editable text;
 * these turn that string into a read or an immutable write. A path that no
 * longer resolves — a stale attribute from an earlier render — is ignored
 * rather than creating structure, so an edit can never corrupt the résumé.
 */
type Node = Record<string, unknown> | unknown[];

function segments(path: string): string[] {
  return path.split(".").filter(Boolean);
}

function get(node: unknown, key: string): unknown {
  if (Array.isArray(node)) {
    const i = Number(key);
    return Number.isInteger(i) ? node[i] : undefined;
  }
  if (node && typeof node === "object") return (node as Record<string, unknown>)[key];
  return undefined;
}

export function readField(content: ResumeContent, path: string): string | undefined {
  const keys = segments(path);
  if (keys.length === 0) return undefined;
  let node: unknown = content;
  for (const key of keys) {
    node = get(node, key);
    if (node === undefined || node === null) return undefined;
  }
  return typeof node === "string" ? node : undefined;
}

export function writeField(
  content: ResumeContent,
  path: string,
  value: string,
): ResumeContent {
  const keys = segments(path);
  if (keys.length === 0) return content;

  // Walk first and bail before copying anything if the path is stale.
  let probe: unknown = content;
  for (const key of keys.slice(0, -1)) {
    probe = get(probe, key);
    if (probe === undefined || probe === null) return content;
  }
  const last = keys[keys.length - 1];
  if (get(probe, last) === undefined) return content;

  const clone = (node: Node): Node => (Array.isArray(node) ? [...node] : { ...node });

  const root = clone(content as unknown as Node);
  let cursor: Node = root;
  for (const key of keys.slice(0, -1)) {
    const next = clone(get(cursor, key) as Node);
    (cursor as Record<string, unknown>)[key] = next;
    cursor = next;
  }
  (cursor as Record<string, unknown>)[last] = value;
  return root as unknown as ResumeContent;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run __tests__/field-path.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/field-path.ts apps/web/__tests__/field-path.test.ts
git commit -m "feat(studio): map document field paths to resume content"
```

---

### Task 3: Annotate ats_clean

One template first, with a test proving the PDF is unchanged. The remaining four follow the same pattern in Task 4.

**Files:**
- Modify: `apps/api/templates/ats_clean.html`
- Test: `apps/api/tests/test_template_field_paths.py`

**Interfaces:**
- Produces: `data-field` attributes on editable text in `ats_clean`, matching Task 2's path format.

- [ ] **Step 1: Write the failing test**

```python
"""Editable regions in the rendered document carry the field they came from.

The Studio edits the rendered HTML in place, so each text node has to say
which part of resume_content produced it. Attributes only — WeasyPrint
ignores unknown ones, so the PDF must be unaffected.
"""
import re
import pytest
from app.services.pdf import render_resume_html

CONTENT = {
    "contact": {"name": "Jane Doe", "email": "jane@example.com"},
    "summary": "Backend engineer.",
    "experience": [
        {"company": "Acme", "title": "Engineer", "start": "2020", "end": "Present",
         "bullets": ["Built the thing.", "Shipped the other thing."]},
    ],
    "education": [{"institution": "State", "degree": "BS", "year": "2019"}],
    "skills": ["Python"],
}


def _html():
    return render_resume_html(CONTENT, "ats_clean")


def test_the_summary_is_addressable():
    assert 'data-field="summary"' in _html()


def test_each_experience_bullet_is_addressable_by_index():
    html = _html()
    assert 'data-field="experience.0.bullets.0"' in html
    assert 'data-field="experience.0.bullets.1"' in html


def test_experience_headline_fields_are_addressable():
    html = _html()
    assert 'data-field="experience.0.company"' in html
    assert 'data-field="experience.0.title"' in html


def test_every_data_field_uses_the_dot_path_format():
    # Guards against a stray "experience[0]" creeping in, which field-path.ts
    # would silently fail to resolve.
    for path in re.findall(r'data-field="([^"]+)"', _html()):
        assert re.fullmatch(r"[A-Za-z_]+(\.[A-Za-z_0-9]+)*", path), path


def test_annotating_does_not_change_the_rendered_text():
    # The whole point: attributes are invisible to WeasyPrint, so the document
    # a user sees and exports is unchanged.
    text = re.sub(r"<[^>]+>", " ", _html())
    assert "Built the thing." in text
    assert "Jane Doe" in text
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && .venv/bin/python -m pytest tests/test_template_field_paths.py -q`
Expected: FAIL on the first three — no `data-field` attributes exist yet.

- [ ] **Step 3: Annotate the template**

In `apps/api/templates/ats_clean.html`, add `data-field` to the editable text nodes. The bullets table is at lines 81/86/98 (`{% for b in job.bullets %}`). Add `loop.index0` paths:

```jinja
<table class="bullets">{% for b in job.bullets %}<tr><td class="bdot">&#8226;</td><td class="btxt" data-field="experience.{{ jloop.index0 }}.bullets.{{ loop.index0 }}">{{ b | highlight(skills) }}</td></tr>{% endfor %}</table>
```

The outer experience loop must be named so the inner one can reference it — change `{% for job in experience %}` to `{% for job in experience %}{% set jloop = loop %}` immediately inside the loop body, then use `jloop.index0` as above. Apply the same treatment to:
- the summary paragraph → `data-field="summary"`
- each job's company and title spans → `experience.N.company`, `experience.N.title`
- each education entry's institution and degree → `education.N.institution`, `education.N.degree`

Leave the contact block, skills line and dates unannotated for now — Task 6 only enables inline editing for summary, experience bullets and headline fields.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && .venv/bin/python -m pytest tests/test_template_field_paths.py -q`
Expected: PASS (5 tests)

- [ ] **Step 5: Prove the PDF is unchanged**

Run: `cd apps/api && .venv/bin/python -m pytest tests/test_pdf.py tests/test_pdf_ats_text_order.py tests/test_pdf_multi_role.py tests/test_pdf_spacing.py tests/test_pdf_highlight.py tests/test_pdf_page_margins.py -q`
Expected: all pass. A failure here means the annotation changed layout — revert and re-do it as pure attributes.

- [ ] **Step 6: Commit**

```bash
git add apps/api/templates/ats_clean.html apps/api/tests/test_template_field_paths.py
git commit -m "feat(studio): make ats_clean's text addressable by field path"
```

---

### Task 4: Annotate the remaining four templates

**Files:**
- Modify: `apps/api/templates/ats_modern.html`, `ats_sidebar.html`, `ats_professional.html`, `ats_minimal.html`
- Modify: `apps/api/tests/test_template_field_paths.py`

- [ ] **Step 1: Parametrise the existing test over every template**

Replace `_html()` and the individual tests' bodies so each runs for all five:

```python
TEMPLATES = ["ats_clean", "ats_modern", "ats_sidebar", "ats_professional", "ats_minimal"]


@pytest.mark.parametrize("template_id", TEMPLATES)
def test_the_summary_is_addressable(template_id):
    assert 'data-field="summary"' in render_resume_html(CONTENT, template_id)


@pytest.mark.parametrize("template_id", TEMPLATES)
def test_each_experience_bullet_is_addressable_by_index(template_id):
    html = render_resume_html(CONTENT, template_id)
    assert 'data-field="experience.0.bullets.0"' in html
    assert 'data-field="experience.0.bullets.1"' in html
```

Apply `@pytest.mark.parametrize("template_id", TEMPLATES)` to the other three tests the same way, replacing `_html()` with `render_resume_html(CONTENT, template_id)`.

Note: `ats_sidebar` and `ats_professional` require a photo. If `render_resume_html` raises `PhotoRequiredError` for them with this CONTENT, add `"photo_url": "https://example.com/p.png"` to `CONTENT["contact"]` — `_sanitize_resume_content` strips remote URLs during render, so no network call occurs.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && .venv/bin/python -m pytest tests/test_template_field_paths.py -q`
Expected: FAIL for the four unannotated templates; `ats_clean` passes.

- [ ] **Step 3: Annotate each template**

Apply exactly the pattern from Task 3 Step 3 to each of the four files: summary paragraph, experience bullets with `jloop.index0`/`loop.index0`, job company and title, education institution and degree.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && .venv/bin/python -m pytest tests/test_template_field_paths.py -q`
Expected: PASS (25 tests — 5 tests × 5 templates)

- [ ] **Step 5: Prove every PDF is unchanged**

Run: `cd apps/api && .venv/bin/python -m pytest tests/ -q`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/templates apps/api/tests/test_template_field_paths.py
git commit -m "feat(studio): make every template's text addressable by field path"
```

---

### Task 5: The HTML client call

**Files:**
- Modify: `apps/web/lib/api-client.ts`
- Test: `apps/web/__tests__/api-client.test.ts` (append)

**Interfaces:**
- Produces: `apiClient.renderResumeHtml(resumeId, opts?) => Promise<{ html: string }>`

- [ ] **Step 1: Write the failing test**

Append to the existing describe block in `apps/web/__tests__/api-client.test.ts`:

```ts
it("renders resume HTML through the resume's own route", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true, status: 200, json: async () => ({ html: "<html></html>" }),
  });
  vi.stubGlobal("fetch", fetchMock);
  await apiClient.renderResumeHtml("r1", { content: { skills: [] } as never });
  const [url, init] = fetchMock.mock.calls[0];
  expect(String(url)).toContain("/resumes/r1/html");
  expect(init.method).toBe("POST");
  vi.unstubAllGlobals();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run __tests__/api-client.test.ts -t "renders resume HTML"`
Expected: FAIL — `apiClient.renderResumeHtml is not a function`

- [ ] **Step 3: Write minimal implementation**

Add beside `generatePdf` in `apps/web/lib/api-client.ts`:

```ts
  /** The rendered document the Studio edits in place. Same template path as
   * generatePdf, so what is edited is what exports. Renders only — persists
   * nothing. */
  renderResumeHtml: (
    resumeId: string,
    opts?: {
      content?: ResumeContent;
      template_id?: string;
      line_spacing?: number;
      paragraph_spacing?: number;
      font_choice?: string;
      accent_color?: string | null;
    },
  ): Promise<{ html: string }> =>
    request<{ html: string }>("POST", `/resumes/${resumeId}/html`, opts ?? {}),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run __tests__/api-client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/api-client.ts apps/web/__tests__/api-client.test.ts
git commit -m "feat(studio): add the resume HTML client call"
```

---

### Task 6: ResumeCanvas — the document, inline-editable

**Files:**
- Create: `apps/web/components/studio/ResumeCanvas.tsx`
- Test: `apps/web/__tests__/components/ResumeCanvas.test.tsx`

**Interfaces:**
- Consumes: `readField`/`writeField` from Task 2; `useResumeStore().content` and `updateContent`.
- Produces: `ResumeCanvas({ html, editable, onEdit })`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { ResumeCanvas } from "../../components/studio/ResumeCanvas";

const HTML = `<div><p data-field="summary">Old summary.</p>
<span data-field="experience.0.bullets.0">Old bullet.</span></div>`;

function fields(container: HTMLElement) {
  const host = container.querySelector("[data-canvas]") as HTMLElement;
  return (host.shadowRoot ?? host).querySelectorAll("[data-field]");
}

describe("ResumeCanvas", () => {
  it("renders the document", () => {
    const { container } = render(<ResumeCanvas html={HTML} editable={false} onEdit={() => {}} />);
    expect(fields(container).length).toBe(2);
  });

  it("marks annotated regions editable in edit mode", () => {
    const { container } = render(<ResumeCanvas html={HTML} editable onEdit={() => {}} />);
    expect((fields(container)[0] as HTMLElement).isContentEditable).toBe(true);
  });

  it("leaves them read-only in preview mode", () => {
    const { container } = render(<ResumeCanvas html={HTML} editable={false} onEdit={() => {}} />);
    expect((fields(container)[0] as HTMLElement).isContentEditable).toBe(false);
  });

  it("reports an edit with its field path and new text", () => {
    const onEdit = vi.fn();
    const { container } = render(<ResumeCanvas html={HTML} editable onEdit={onEdit} />);
    const node = fields(container)[0] as HTMLElement;
    node.textContent = "New summary.";
    fireEvent.blur(node);
    expect(onEdit).toHaveBeenCalledWith("summary", "New summary.");
  });

  it("reports the indexed path for a bullet", () => {
    const onEdit = vi.fn();
    const { container } = render(<ResumeCanvas html={HTML} editable onEdit={onEdit} />);
    const node = fields(container)[1] as HTMLElement;
    node.textContent = "New bullet.";
    fireEvent.blur(node);
    expect(onEdit).toHaveBeenCalledWith("experience.0.bullets.0", "New bullet.");
  });

  it("does not report an edit when the text is unchanged", () => {
    const onEdit = vi.fn();
    const { container } = render(<ResumeCanvas html={HTML} editable onEdit={onEdit} />);
    fireEvent.blur(fields(container)[0] as HTMLElement);
    expect(onEdit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run __tests__/components/ResumeCanvas.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```tsx
"use client";
import { useEffect, useRef } from "react";

/**
 * The résumé document, rendered from the server's own template output.
 *
 * Mounted in a shadow root: the document carries its own <style> including
 * @page rules, which would otherwise leak into the app. The HTML is our
 * template output with every user value already escaped server-side, so it
 * is not an injection sink — but it must never be caller-supplied markup.
 *
 * Editing is reported on blur rather than on every keystroke: a keystroke
 * write would re-render the document under the caret.
 */
export function ResumeCanvas({
  html,
  editable,
  onEdit,
}: {
  html: string;
  editable: boolean;
  onEdit: (path: string, value: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<ShadowRoot | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!rootRef.current) {
      rootRef.current = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    }
    rootRef.current.innerHTML = html;
  }, [html]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const nodes = Array.from(root.querySelectorAll<HTMLElement>("[data-field]"));
    const cleanups: Array<() => void> = [];

    for (const node of nodes) {
      node.contentEditable = editable ? "true" : "false";
      if (!editable) continue;
      const original = node.textContent ?? "";
      const onBlur = () => {
        const next = node.textContent ?? "";
        if (next === original) return;
        onEdit(node.dataset.field ?? "", next);
      };
      node.addEventListener("blur", onBlur);
      cleanups.push(() => node.removeEventListener("blur", onBlur));
    }
    return () => cleanups.forEach((fn) => fn());
  }, [html, editable, onEdit]);

  return <div data-canvas ref={hostRef} className="mx-auto w-full max-w-[8.5in]" />;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run __tests__/components/ResumeCanvas.test.tsx`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/studio/ResumeCanvas.tsx apps/web/__tests__/components/ResumeCanvas.test.tsx
git commit -m "feat(studio): render the resume document with inline editing"
```

---

### Task 7: StudioHeader

**Files:**
- Create: `apps/web/components/studio/StudioHeader.tsx`
- Test: `apps/web/__tests__/components/StudioHeader.test.tsx`

**Interfaces:**
- Produces: `StudioHeader({ title, mode, onMode, onBack, onExport, isExporting })` where `mode: "edit" | "preview"`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StudioHeader } from "../../components/studio/StudioHeader";

const props = {
  title: "Jane's Resume", mode: "edit" as const, onMode: () => {},
  onBack: () => {}, onExport: () => {}, isExporting: false,
};

describe("StudioHeader", () => {
  it("offers a way back to the builder", () => {
    render(<StudioHeader {...props} />);
    expect(screen.getByRole("button", { name: /back to builder/i })).toBeTruthy();
  });

  it("shows the resume title", () => {
    render(<StudioHeader {...props} />);
    expect(screen.getByText("Jane's Resume")).toBeTruthy();
  });

  it("marks the active tab", () => {
    render(<StudioHeader {...props} mode="preview" />);
    expect(screen.getByRole("tab", { name: /preview/i }).getAttribute("aria-selected")).toBe("true");
  });

  it("switches tabs", () => {
    const onMode = vi.fn();
    render(<StudioHeader {...props} onMode={onMode} />);
    fireEvent.click(screen.getByRole("tab", { name: /preview/i }));
    expect(onMode).toHaveBeenCalledWith("preview");
  });

  it("exports", () => {
    const onExport = vi.fn();
    render(<StudioHeader {...props} onExport={onExport} />);
    fireEvent.click(screen.getByRole("button", { name: /export pdf/i }));
    expect(onExport).toHaveBeenCalled();
  });

  it("disables export while one is in flight", () => {
    render(<StudioHeader {...props} isExporting />);
    expect(screen.getByRole("button", { name: /export/i }).hasAttribute("disabled")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run __tests__/components/StudioHeader.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```tsx
"use client";
import { ArrowLeft, DownloadSimple, CircleNotch } from "@phosphor-icons/react";

export type StudioMode = "edit" | "preview";

/** Minimal chrome: back, the two modes, export. The document is the interface,
 * so nothing else competes with it for attention. */
export function StudioHeader({
  title,
  mode,
  onMode,
  onBack,
  onExport,
  isExporting,
}: {
  title: string;
  mode: StudioMode;
  onMode: (m: StudioMode) => void;
  onBack: () => void;
  onExport: () => void;
  isExporting: boolean;
}) {
  return (
    <header className="flex shrink-0 items-center gap-lg border-b border-outline-variant/30 bg-surface px-lg py-sm">
      <button
        type="button"
        onClick={onBack}
        className="flex shrink-0 items-center gap-xs text-label-md text-on-surface-variant transition-colors hover:text-on-surface"
      >
        <ArrowLeft size={16} />
        Back to Builder
      </button>

      <h1 className="truncate text-label-md font-semibold text-on-surface">{title}</h1>

      <div role="tablist" className="ml-auto flex items-center gap-xs rounded-full bg-surface-container-low p-0.5">
        {(["edit", "preview"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => onMode(m)}
            className={`rounded-full px-md py-xs text-label-sm capitalize transition-colors ${
              mode === m ? "bg-surface text-on-surface shadow-sm" : "text-on-surface-variant"
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onExport}
        disabled={isExporting}
        className="flex shrink-0 items-center gap-xs rounded-xl bg-primary px-md py-sm text-label-md text-on-primary shadow-md transition-shadow hover:shadow-lg disabled:opacity-50"
      >
        {isExporting ? <CircleNotch size={16} className="animate-spin" /> : <DownloadSimple size={16} />}
        Export PDF
      </button>
    </header>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run __tests__/components/StudioHeader.test.tsx`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/studio/StudioHeader.tsx apps/web/__tests__/components/StudioHeader.test.tsx
git commit -m "feat(studio): add the studio header with edit and preview modes"
```

---

### Task 8: The Studio route

**Files:**
- Create: `apps/web/app/(builder)/studio/[resumeId]/preview/page.tsx`
- Test: `apps/web/__tests__/studio-preview-page.test.tsx`

**Interfaces:**
- Consumes: `apiClient.renderResumeHtml` (Task 5), `ResumeCanvas` (Task 6), `StudioHeader` (Task 7), `writeField` (Task 2).

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/api-client", () => ({
  apiClient: {
    renderResumeHtml: vi.fn(async () => ({
      html: '<p data-field="summary">Old summary.</p>',
    })),
    generatePdf: vi.fn(async () => ({ signed_url: "u", underfilled: false })),
  },
}));

import StudioPreviewPage from "../app/(builder)/studio/[resumeId]/preview/page";
import { useResumeStore } from "../stores/resume-store";
import { apiClient } from "../lib/api-client";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <StudioPreviewPage params={Promise.resolve({ resumeId: "r1" })} />
    </QueryClientProvider>,
  );
}

describe("Studio preview page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useResumeStore.getState().resetStore();
    useResumeStore.setState({
      resumeId: "r1",
      content: { contact: {}, summary: "Old summary.", experience: [], education: [], skills: [] },
    } as never);
  });

  it("renders the document", async () => {
    renderPage();
    await waitFor(() => expect(apiClient.renderResumeHtml).toHaveBeenCalled());
  });

  it("goes back to the builder", async () => {
    renderPage();
    await waitFor(() => screen.getByRole("button", { name: /back to builder/i }));
    fireEvent.click(screen.getByRole("button", { name: /back to builder/i }));
    expect(push).toHaveBeenCalledWith("/studio/r1");
  });

  it("writes an inline edit back to the store", async () => {
    const { container } = renderPage();
    await waitFor(() => expect(apiClient.renderResumeHtml).toHaveBeenCalled());
    const host = container.querySelector("[data-canvas]") as HTMLElement;
    const node = host.shadowRoot!.querySelector("[data-field]") as HTMLElement;
    node.textContent = "New summary.";
    fireEvent.blur(node);
    await waitFor(() =>
      expect(useResumeStore.getState().content?.summary).toBe("New summary."),
    );
  });

  it("exports through the existing PDF path", async () => {
    renderPage();
    await waitFor(() => screen.getByRole("button", { name: /export pdf/i }));
    fireEvent.click(screen.getByRole("button", { name: /export pdf/i }));
    await waitFor(() => expect(apiClient.generatePdf).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run __tests__/studio-preview-page.test.tsx`
Expected: FAIL — cannot resolve the page module

- [ ] **Step 3: Write minimal implementation**

```tsx
"use client";
import { use, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/api-client";
import { useResumeStore } from "@/stores/resume-store";
import { writeField } from "@/lib/field-path";
import { ResumeCanvas } from "@/components/studio/ResumeCanvas";
import { StudioHeader, type StudioMode } from "@/components/studio/StudioHeader";

export default function StudioPreviewPage({
  params,
}: {
  params: Promise<{ resumeId: string }>;
}) {
  const { resumeId } = use(params);
  const router = useRouter();
  const content = useResumeStore((s) => s.content);
  const templateId = useResumeStore((s) => s.templateId);
  const updateContent = useResumeStore((s) => s.updateContent);
  const [mode, setMode] = useState<StudioMode>("edit");
  const [isExporting, setIsExporting] = useState(false);

  // Re-renders whenever the content changes, so an inline edit is reflected
  // in the document it was made on.
  const { data } = useQuery({
    queryKey: ["resumeHtml", resumeId, templateId, content],
    queryFn: () => apiClient.renderResumeHtml(resumeId, { content: content ?? undefined }),
    enabled: !!content,
  });

  async function handleExport() {
    setIsExporting(true);
    try {
      await apiClient.generatePdf(resumeId, templateId);
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <StudioHeader
        title="Resume"
        mode={mode}
        onMode={setMode}
        onBack={() => router.push(`/studio/${resumeId}`)}
        onExport={handleExport}
        isExporting={isExporting}
      />
      <div className="flex-1 overflow-y-auto bg-surface-container-low p-xl">
        <ResumeCanvas
          html={data?.html ?? ""}
          editable={mode === "edit"}
          onEdit={(path, value) => {
            if (!content) return;
            updateContent(writeField(content, path, value));
          }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run __tests__/studio-preview-page.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Run everything**

Run: `cd apps/web && npx vitest run && npx tsc --noEmit && cd ../api && .venv/bin/python -m pytest tests/ -q`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(builder)/studio/[resumeId]/preview" apps/web/__tests__/studio-preview-page.test.tsx
git commit -m "feat(studio): add the full-page resume studio route"
```

---

## Self-Review

**Spec coverage.** §11 preview is a separate experience → Task 8's own route. §12 document as hero, minimal chrome → Tasks 6, 7. §13 direct editing → Tasks 2, 3, 4, 6. §14 controls → Task 7 (zoom and template gallery are follow-on; the merged `TemplateGallery`/`TypePopover`/`SpacingPopover` drop into `StudioHeader` without new logic). §15 export reuses `generatePdf` → Task 8. §21 round trip without losing state → both routes read the same stores; Task 8 asserts the back navigation.

**Not covered, deliberately:** §13's hover affordances and §16's polish pass. Both are judgement work better done once the thing renders — they are the phase-6 pass, not a testable task.

**Placeholder scan:** none; every step carries runnable code or an exact command.

**Type consistency:** `readField`/`writeField` defined in Task 2 and consumed in Tasks 6 and 8. `render_resume_html` defined in Task 1 and consumed in Tasks 3 and 4. `StudioMode` defined in Task 7 and consumed in Task 8. `renderResumeHtml` defined in Task 5, consumed in Task 8.

**Known risks carried from the spec:**
1. The query key in Task 8 includes `content`, so every keystroke-committed edit re-renders the document server-side. If that proves slow, debounce it — do not move to client-side rendering, which would reintroduce the template drift this design exists to avoid.
2. Contenteditable on template markup will fight rich paste. Task 6 reads `textContent`, which strips markup, but a paste of multi-line text will produce `<div>`s inside the node; the `textContent` read flattens them. Acceptable for a first pass.
3. Annotating five templates is the step most likely to break PDF output. Tasks 3 and 4 both end by running the full `test_pdf_*` suite for exactly that reason.
