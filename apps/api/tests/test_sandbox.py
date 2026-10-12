"""Untrusted files are opened only in the sandbox (security review M5 and the
malware review that came with it).

These run the real worker process: what matters is what a file opened there
can reach and that the process really dies, which a mock can't show.
"""
import io
import os
import subprocess
import sys
import threading

import pytest

from app.services import sandbox
from app.services.pdf_text import find_active_content
from tests.images import ONE_PIXEL_PNG


def _refusal(pdf: bytes) -> str:
    with pytest.raises(sandbox.SandboxRejected) as exc:
        sandbox.extract_pdf_text(pdf)
    return str(exc.value)


# ── What a file opened there can reach ───────────────────────────────────────

def test_the_worker_sees_none_of_the_apis_secrets(monkeypatch):
    for secret in ("DATABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "OPENAI_API_KEY", "SUPABASE_JWT_SECRET"):
        monkeypatch.setenv(secret, "s3cret")
    seen = sandbox.run("inspect", b"", 10)["env"]
    assert not {"DATABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "OPENAI_API_KEY", "SUPABASE_JWT_SECRET"} & set(seen)
    assert set(seen) <= {"PATH", "LANG", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "LC_CTYPE", "__CF_USER_TEXT_ENCODING"}


@pytest.mark.skipif(os.name == "nt", reason="resource limits are POSIX-only; Windows is dev only")
def test_the_worker_is_locked_down():
    report = sandbox.run("inspect", b"", 10)
    limits = report["limits"]
    assert limits["RLIMIT_AS"] <= 1024 ** 3
    assert limits["RLIMIT_CPU"] <= 30
    assert limits["RLIMIT_FSIZE"] == 0
    assert limits["RLIMIT_NPROC"] == 0
    if os.geteuid() == 0:  # a root API runs it as nobody
        assert report["uid"] == 65534


def test_it_runs_isolated_from_the_app():
    # -I: no PYTHON* variables, no user site-packages, no current directory
    # on the import path — the worker imports only what it adds itself.
    seen = {}
    real = subprocess.Popen

    def spy(cmd, *a, **kw):
        seen["cmd"] = cmd
        return real(cmd, *a, **kw)

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(sandbox.subprocess, "Popen", spy)
        sandbox.run("inspect", b"", 10)
    assert seen["cmd"][:2] == [sys.executable, "-I"]


# ── It stops ─────────────────────────────────────────────────────────────────

def test_a_job_over_its_time_is_killed_not_just_abandoned():
    procs = []
    real = subprocess.Popen

    def keep(*a, **kw):
        p = real(*a, **kw)
        procs.append(p)
        return p

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(sandbox.subprocess, "Popen", keep)
        with pytest.raises(sandbox.SandboxTimeout):
            sandbox.run("pdf", sandbox._probe_pdf(), 0.001)
    assert procs and procs[0].poll() is not None  # gone, not still parsing


def test_a_runaway_answer_is_cut_off(monkeypatch):
    import shutil
    import tempfile
    from pathlib import Path

    # Its own folder, readable by "nobody" (whom a root test run drops to);
    # pytest's tmp_path sits under a folder only its owner can enter.
    folder = Path(tempfile.mkdtemp())
    try:
        folder.chmod(0o755)
        flood = folder / "flood.py"
        flood.write_text("import sys\nsys.stdout.write('x' * (8 * 1024 * 1024))\n")
        flood.chmod(0o644)
        monkeypatch.setattr(sandbox, "_WORKER", str(flood))
        with pytest.raises(sandbox.SandboxError, match="too large"):
            sandbox.run("pdf", b"", 10)
    finally:
        shutil.rmtree(folder, ignore_errors=True)


def test_only_a_few_run_at_once(monkeypatch):
    monkeypatch.setattr(sandbox, "_SLOTS", threading.BoundedSemaphore(1))
    monkeypatch.setattr(sandbox, "_WAIT_FOR_SLOT_SECONDS", 0.01)
    sandbox._SLOTS.acquire()
    try:
        with pytest.raises(sandbox.SandboxBusy):
            sandbox.run("inspect", b"", 10)
    finally:
        sandbox._SLOTS.release()


# ── PDFs ─────────────────────────────────────────────────────────────────────

def test_a_plain_pdf_is_read():
    assert "sandbox ok" in sandbox.extract_pdf_text(sandbox._probe_pdf())
    assert sandbox.self_check() is True


@pytest.mark.parametrize("catalog, page, expect", [
    (b"/OpenAction<</S/JavaScript/JS(app.alert(1))>>", b"", "a script"),
    # Escaped names are decoded by the parser; a byte search would miss this.
    (b"/OpenAction<</S/J#61vaScript/JS(app.alert(1))>>", b"", "a script"),
    (b"/Names<</JavaScript<</Names[(x)<</S/JavaScript/JS(app.alert(1))>>]>>>>", b"", "a script"),
    (b"/Names<</EmbeddedFiles<</Names[]>>>>", b"", "an embedded file"),
    (b"/AA<</WC<</S/JavaScript/JS(1)>>>>", b"", "runs when the file opens"),
    (b"/AcroForm<</Fields[]/XFA[]>>", b"", "an XFA form"),
    (b"", b"/AA<</O<</S/JavaScript/JS(1)>>>>", "runs when a page opens"),
    (b"", b"/Annots[<</Type/Annot/Subtype/Link/Rect[0 0 10 10]/A<</S/Launch/F(cmd.exe)>>>>]", "launches a program"),
    (b"", b"/Annots[<</Type/Annot/Subtype/Link/Rect[0 0 10 10]/A<</S/URI/URI(javascript:alert(1))>>>>]", "isn't a web address"),
    (b"", b"/Annots[<</Type/Annot/Subtype/Link/Rect[0 0 10 10]/A<</S/URI/URI(https://a.example)/Next<</S/JavaScript/JS(1)>>>>>>]", "a script"),
    (b"", b"/Annots[<</Type/Annot/Subtype/FileAttachment/Rect[0 0 10 10]>>]", "an attached file"),
    (b"", b"/Annots[<</Type/Annot/Subtype/RichMedia/Rect[0 0 10 10]>>]", "embedded media"),
])
def test_a_pdf_that_can_run_something_is_refused(catalog, page, expect):
    message = _refusal(sandbox._probe_pdf(catalog, page))
    assert expect in message
    assert "Export it again" in message


def test_ordinary_links_and_open_at_page_are_fine():
    pdf = sandbox._probe_pdf(
        b"/OpenAction[3 0 R/Fit]",
        b"/Annots[<</Type/Annot/Subtype/Link/Rect[0 0 10 10]/A<</S/URI/URI(https://github.com/x)>>>>"
        b"<</Type/Annot/Subtype/Link/Rect[0 0 10 10]/A<</S/URI/URI(mailto:a@b.co)>>>>]",
    )
    text = sandbox.extract_pdf_text(pdf)
    assert "https://github.com/x" in text


def test_a_password_protected_pdf_is_refused():
    import pypdf

    writer = pypdf.PdfWriter(clone_from=pypdf.PdfReader(io.BytesIO(sandbox._probe_pdf())))
    writer.encrypt("pw")
    buf = io.BytesIO()
    writer.write(buf)
    assert "password" in _refusal(buf.getvalue())


def test_a_broken_pdf_is_an_error_not_a_crash():
    with pytest.raises(sandbox.SandboxError):
        sandbox.extract_pdf_text(b"%PDF-1.4 this is not a pdf")


def _pdf_with_catalog_in_an_object_stream(catalog_extra: bytes) -> bytes:
    """A PDF 1.5 whose catalog is compressed inside an object stream, so
    nothing in it is visible in the raw bytes."""
    import struct
    import zlib

    catalog = b"<</Type/Catalog/Pages 2 0 R" + catalog_extra + b">>"
    pages = b"<</Type/Pages/Kids[3 0 R]/Count 1>>"
    header = b"1 0 2 %d " % (len(catalog) + 1)
    objstm = zlib.compress(header + catalog + b" " + pages)
    plain = [
        b"<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 50]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
        b"<</Length 39>>stream\nBT /F1 12 Tf 10 20 Td (sandbox ok) Tj ET\nendstream",
        b"<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
        b"<</Type/ObjStm/N 2/First %d/Filter/FlateDecode/Length %d>>stream\n" % (len(header), len(objstm))
        + objstm + b"\nendstream",
    ]
    out = bytearray(b"%PDF-1.5\n")
    offsets = {}
    for n, body in enumerate(plain, 3):
        offsets[n] = len(out)
        out += b"%d 0 obj" % n + body + b"endobj\n"
    offsets[7] = len(out)
    rows = [(0, 0, 65535), (2, 6, 0), (2, 6, 1)] + [(1, offsets[n], 0) for n in (3, 4, 5, 6, 7)]
    xref = b"".join(struct.pack(">BIH", *r) for r in rows)
    out += (b"7 0 obj<</Type/XRef/Size 8/Root 1 0 R/W[1 4 2]/Length %d>>stream\n" % len(xref)
            + xref + b"\nendstream endobj\nstartxref\n%d\n%%%%EOF" % offsets[7])
    return bytes(out)


def test_finding_active_content_reads_objects_not_bytes():
    import pypdf

    pdf = _pdf_with_catalog_in_an_object_stream(b"/OpenAction<</S/JavaScript/JS(app.alert(1))>>")
    assert b"JavaScript" not in pdf  # a byte search would pass this file
    assert "sandbox ok" in pypdf.PdfReader(io.BytesIO(pdf)).pages[0].extract_text()
    assert "a script" in find_active_content(pypdf.PdfReader(io.BytesIO(pdf)))
    assert "a script" in _refusal(pdf)


# ── Photos ───────────────────────────────────────────────────────────────────

def test_a_photo_comes_back_freshly_encoded():
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (3000, 1500), (200, 10, 10)).save(buf, "JPEG")
    cleaned, mime = sandbox.clean_image(buf.getvalue())
    assert mime == "image/jpeg"
    assert Image.open(io.BytesIO(cleaned)).size == (1200, 600)  # printed small; no need for more


def test_a_photo_that_is_not_one_is_refused():
    assert sandbox.clean_image(b"\x89PNG\r\n\x1a\n<html>not a png</html>") is None
    assert sandbox.clean_image(b"GIF89a" + b"\x00" * 50) is None


def test_a_decompression_bomb_is_refused():
    from PIL import Image

    buf = io.BytesIO()
    # 10000x10000 of one colour: a few KB on disk, 100 megapixels decoded.
    Image.new("1", (10_000, 10_000)).save(buf, "PNG")
    assert len(buf.getvalue()) < 200_000
    assert sandbox.clean_image(buf.getvalue()) is None


def test_each_photo_is_cleaned_once(monkeypatch):
    calls = []
    real = sandbox.run

    def counting(job, data, timeout):
        calls.append(job)
        return real(job, data, timeout)

    monkeypatch.setattr(sandbox, "run", counting)
    monkeypatch.setattr(sandbox, "_clean_images", type(sandbox._clean_images)())
    first = sandbox.clean_image(ONE_PIXEL_PNG)
    assert sandbox.clean_image(ONE_PIXEL_PNG) == first
    assert calls == ["image"]
