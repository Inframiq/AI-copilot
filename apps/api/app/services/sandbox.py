"""Open untrusted files (uploaded PDFs, profile photos) in a throwaway process.

The parsers are where a hostile file would attack: pypdf for résumés,
Pillow's C decoders for photos. Run inside the API, a working exploit would
hold the database URL, the service-role key and the OpenAI key. Run here, it
gets sandbox_worker.py: a fresh interpreter with an empty environment, as
the "nobody" user when the API runs as root, capped in memory and CPU,
unable to write files or start processes — and killed outright on timeout,
which a thread never could be (security review M5). Its answer is size-capped
before the API reads it.

Synchronous on purpose: callers already run in worker threads (upload
parsing via asyncio.to_thread, photo inlining inside the render thread).
"""
import base64
import hashlib
import json
import logging
import os
import subprocess
import sys
import threading
from collections import OrderedDict
from pathlib import Path

logger = logging.getLogger(__name__)

_WORKER = str(Path(__file__).with_name("sandbox_worker.py"))
_MAX_OUTPUT_BYTES = 2 * 1024 * 1024
# Few at once: each is a whole interpreter, and a burst of uploads must not
# be able to exhaust the machine's memory.
_SLOTS = threading.BoundedSemaphore(3)
_WAIT_FOR_SLOT_SECONDS = 20
_NOBODY = 65534


class SandboxError(Exception):
    """The file couldn't be processed."""


class SandboxRejected(SandboxError):
    """Refused, with a reason fit to show the uploader."""


class SandboxTimeout(SandboxError):
    pass


class SandboxBusy(SandboxError):
    pass


def _env() -> dict[str, str]:
    """Just enough to start Python — none of the API's secrets."""
    keep = ("SYSTEMROOT", "WINDIR", "TEMP", "TMP") if os.name == "nt" else ()
    env = {k: os.environ[k] for k in keep if k in os.environ}
    env["PATH"] = os.environ.get("PATH", "") if os.name == "nt" else "/usr/local/bin:/usr/bin:/bin"
    env["LANG"] = "C.UTF-8"
    return env


def _identity() -> dict:
    """Run as nobody when we can — a root API can; a non-root one stays itself."""
    if os.name != "nt" and hasattr(os, "geteuid") and os.geteuid() == 0:
        return {"user": _NOBODY, "group": _NOBODY, "extra_groups": []}
    return {}


def run(job: str, data: bytes, timeout: float) -> dict:
    """Run *job* ("pdf" or "image") on *data* in the worker; its JSON answer.

    Raises SandboxRejected (a reason for the uploader), SandboxTimeout,
    SandboxBusy, or SandboxError for anything else.
    """
    if not _SLOTS.acquire(timeout=_WAIT_FOR_SLOT_SECONDS):
        raise SandboxBusy("Too many files are being processed right now.")
    try:
        return _run(job, data, timeout)
    finally:
        _SLOTS.release()


def _run(job: str, data: bytes, timeout: float) -> dict:
    proc = subprocess.Popen(
        [sys.executable, "-I", _WORKER, job],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        env=_env(), cwd=os.path.dirname(_WORKER), close_fds=True,
        start_new_session=os.name != "nt",
        **_identity(),
    )
    out: list[bytes] = []

    def feed() -> None:
        try:
            proc.stdin.write(data)
            proc.stdin.close()
        except OSError:  # the worker quit early; its exit says why
            pass

    def drain() -> None:
        # Bounded: a runaway worker can't fill the API's memory.
        out.append(proc.stdout.read(_MAX_OUTPUT_BYTES + 1))

    feeder = threading.Thread(target=feed, daemon=True)
    reader = threading.Thread(target=drain, daemon=True)
    feeder.start()
    reader.start()
    reader.join(timeout)
    timed_out = reader.is_alive()
    if timed_out or proc.poll() is None:
        try:
            proc.wait(timeout=0 if timed_out else 2)
        except subprocess.TimeoutExpired:
            pass
    if proc.poll() is None:
        proc.kill()
        proc.wait()
    reader.join(1)
    feeder.join(1)
    if timed_out:
        raise SandboxTimeout(f"{job} took longer than {timeout:g}s")
    raw = out[0] if out else b""
    if len(raw) > _MAX_OUTPUT_BYTES:
        raise SandboxError(f"{job} answer too large")
    try:
        result = json.loads(raw)
    except ValueError:
        raise SandboxError(f"{job} worker exited {proc.returncode} with no answer") from None
    if not isinstance(result, dict):
        raise SandboxError(f"{job} worker gave a malformed answer")
    if "rejected" in result:
        raise SandboxRejected(str(result["rejected"]))
    if "error" in result:
        raise SandboxError(f"{job} worker: {result['error']}")
    return result


# ── The two jobs ─────────────────────────────────────────────────────────────

PDF_TIMEOUT_SECONDS = 15
IMAGE_TIMEOUT_SECONDS = 10


def extract_pdf_text(data: bytes) -> str:
    """An uploaded résumé's text. Refuses (SandboxRejected) a PDF that is too
    long, password-protected, or carries scripts, launch actions, embedded
    files or media — see pdf_text.find_active_content."""
    result = run("pdf", data, PDF_TIMEOUT_SECONDS)
    text = result.get("text")
    if not isinstance(text, str):
        raise SandboxError("pdf worker gave no text")
    return text


# Photos render on every preview, so a clean copy is kept by content hash
# rather than re-made each time. None records "not an image we accept".
_clean_images: "OrderedDict[str, tuple[bytes, str] | None]" = OrderedDict()
_clean_images_lock = threading.Lock()
_CLEAN_IMAGE_CACHE = 64


def clean_image(data: bytes) -> tuple[bytes, str] | None:
    """(freshly encoded bytes, mime) for a JPEG/PNG/WebP/GIF photo, or None
    when it isn't one, is too big, or can't be decoded safely. Metadata
    (EXIF, GPS) does not survive."""
    key = hashlib.sha256(data).hexdigest()
    with _clean_images_lock:
        if key in _clean_images:
            _clean_images.move_to_end(key)
            return _clean_images[key]
    try:
        result = run("image", data, IMAGE_TIMEOUT_SECONDS)
        cleaned = (base64.b64decode(result["image"]), str(result["mime"]))
    except SandboxBusy:
        return None  # not remembered: busy says nothing about the image
    except (SandboxError, KeyError, ValueError, TypeError):
        logger.warning("photo refused by the sandbox", exc_info=True)
        cleaned = None
    with _clean_images_lock:
        _clean_images[key] = cleaned
        while len(_clean_images) > _CLEAN_IMAGE_CACHE:
            _clean_images.popitem(last=False)
    return cleaned


# ── Startup check ────────────────────────────────────────────────────────────

def _probe_pdf(catalog_extra: bytes = b"", page_extra: bytes = b"") -> bytes:
    """The smallest valid PDF with one line of text, for the self-check. The
    extras are spliced into the catalog and the page — tests use them to
    plant scripts, launch actions and the like."""
    objects = [
        b"<</Type/Catalog/Pages 2 0 R" + catalog_extra + b">>",
        b"<</Type/Pages/Kids[3 0 R]/Count 1>>",
        b"<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 50]/Contents 4 0 R"
        b"/Resources<</Font<</F1 5 0 R>>>>" + page_extra + b">>",
        b"<</Length 39>>stream\nBT /F1 12 Tf 10 20 Td (sandbox ok) Tj ET\nendstream",
        b"<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for n, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += b"%d 0 obj" % n + body + b"endobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    out += b"".join(b"%010d 00000 n \n" % o for o in offsets)
    out += b"trailer<</Size %d/Root 1 0 R>>\nstartxref\n%d\n%%%%EOF" % (len(objects) + 1, xref)
    return bytes(out)


def self_check() -> bool:
    """Whether the sandbox works here (as nobody, if we're root). Logged at
    startup: if it fails, uploads and photos fail too, and the log says why."""
    try:
        text = extract_pdf_text(_probe_pdf())
        ok = "sandbox ok" in text
    except Exception:
        logger.exception("SANDBOX SELF-CHECK FAILED — résumé uploads and photos will not work")
        return False
    if ok:
        logger.info("sandbox self-check passed (as %s)", "nobody" if _identity() else "the API's own user")
    else:
        logger.error("SANDBOX SELF-CHECK FAILED — the probe PDF's text didn't come back")
    return ok
