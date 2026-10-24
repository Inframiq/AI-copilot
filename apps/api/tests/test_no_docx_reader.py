"""Uploads are PDF-only, and nothing in the app reads Word files. The DOCX
reader that once did was unreachable but kept python-docx and its XML parser
installed, a document parser with no caller (the XXE and zip-bomb surface the
hardening playbook warns about). This keeps it gone."""
import pathlib

API = pathlib.Path(__file__).resolve().parents[1]


def test_python_docx_is_not_a_dependency():
    for req in ("requirements.txt", "requirements-dev.txt"):
        text = (API / req).read_text(encoding="utf-8").lower()
        assert "python-docx" not in text, req


def test_no_app_code_imports_docx():
    offenders = [
        str(p.relative_to(API))
        for p in (API / "app").rglob("*.py")
        if any(line.strip().startswith(("import docx", "from docx"))
               for line in p.read_text(encoding="utf-8").splitlines())
    ]
    assert offenders == []
