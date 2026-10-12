"""The throwaway process that opens untrusted files. Run only by app.services.sandbox.

    python -I sandbox_worker.py pdf    < upload.pdf   -> {"text": ...}
    python -I sandbox_worker.py image  < photo        -> {"image": <base64>, "mime": ...}

It starts with an empty environment (no database URL, no keys), loads the
few modules it needs, then — before reading a single byte of the file —
locks itself down: memory, CPU time, no new files, no new processes, few
file handles. A file that exploits the parser takes over this process and
nothing else, and the API kills it on timeout. Answers are one JSON object
on stdout; a refusal the uploader should see is {"rejected": message}.
"""
import base64
import io
import json
import sys
import warnings
from pathlib import Path

MAX_INPUT_BYTES = 12 * 1024 * 1024
MEMORY_BYTES = 1024 * 1024 * 1024
CPU_SECONDS = 20
# A photo is printed a few centimetres wide; this is plenty for that.
MAX_IMAGE_SIDE = 1200
MAX_IMAGE_PIXELS = 40_000_000
IMAGE_FORMATS = ["JPEG", "PNG", "WEBP", "GIF"]


def _load(job: str):
    """Everything the job needs, imported while imports can still open files."""
    if job == "pdf":
        # -I leaves the app off sys.path; add only its root, for pdf_text.
        sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
        import pypdf  # noqa: F401
        import pypdf.filters  # noqa: F401
        from app.services import pdf_text
        return pdf_text
    from PIL import GifImagePlugin, Image, ImageOps, JpegImagePlugin, PngImagePlugin, WebPImagePlugin  # noqa: F401
    return Image, ImageOps


def _lock_down() -> None:
    try:
        import resource
    except ImportError:  # Windows: dev only; the timeout kill still applies
        return
    limits = [
        (resource.RLIMIT_AS, MEMORY_BYTES),
        (resource.RLIMIT_CPU, CPU_SECONDS),
        (resource.RLIMIT_FSIZE, 0),   # write no files (stdout is a pipe, unaffected)
        (resource.RLIMIT_NOFILE, 16),
        (resource.RLIMIT_CORE, 0),
        (resource.RLIMIT_NPROC, 0),   # start no processes or threads
    ]
    for which, value in limits:
        try:
            resource.setrlimit(which, (value, value))
        except (ValueError, OSError):
            pass


def _pdf(pdf_text, data: bytes) -> dict:
    try:
        return {"text": pdf_text.extract_text_from_pdf(data)}
    except pdf_text.PdfRejected as exc:
        return {"rejected": str(exc)}


def _image(Image, ImageOps, data: bytes) -> dict:
    Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
    warnings.simplefilter("error", Image.DecompressionBombWarning)
    img = Image.open(io.BytesIO(data), formats=IMAGE_FORMATS)
    img.load()
    img = ImageOps.exif_transpose(img)
    img.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE))
    out = io.BytesIO()
    # Freshly encoded pixels, nothing carried over: no metadata (EXIF, GPS),
    # no extra chunks, nothing a decoder further on could trip over.
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        img.convert("RGBA").save(out, "PNG")
        mime = "image/png"
    else:
        img.convert("RGB").save(out, "JPEG", quality=90)
        mime = "image/jpeg"
    return {"image": base64.b64encode(out.getvalue()).decode("ascii"), "mime": mime}


def _inspect() -> dict:
    """What a file opened here could reach: the environment, who we run as,
    the limits. For the tests and the startup check — no file involved."""
    import os
    report: dict = {"env": sorted(os.environ)}
    if hasattr(os, "geteuid"):
        report["uid"] = os.geteuid()
    try:
        import resource
        report["limits"] = {
            name: resource.getrlimit(getattr(resource, name))[1]
            for name in ("RLIMIT_AS", "RLIMIT_CPU", "RLIMIT_FSIZE", "RLIMIT_NPROC")
        }
    except ImportError:
        pass
    return report


def main() -> None:
    job = sys.argv[1] if len(sys.argv) > 1 else ""
    if job == "inspect":
        _lock_down()
        sys.stdout.write(json.dumps(_inspect()))
        return
    if job not in ("pdf", "image"):
        sys.exit(2)
    loaded = _load(job)
    _lock_down()
    data = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
    if len(data) > MAX_INPUT_BYTES:
        result = {"rejected": "File is too large."}
    else:
        try:
            result = _pdf(loaded, data) if job == "pdf" else _image(*loaded, data)
        except Exception as exc:  # a broken file, not a crash worth a traceback
            result = {"error": type(exc).__name__}
    sys.stdout.write(json.dumps(result))
    sys.stdout.flush()


if __name__ == "__main__":
    main()
