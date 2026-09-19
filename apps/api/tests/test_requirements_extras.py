"""Extras named in requirements.txt have to be extras the package actually has.

`PyJWT[cryptography]==2.13.0` shipped to production for a long time. PyJWT's
only extra is `crypto`; `cryptography` is not one, so pip installed PyJWT on
its own and printed a warning nobody reads. `jwt.algorithms` defines
RSAAlgorithm and ECAlgorithm only behind `if has_crypto`, so
`app/core/security.py`'s import of them raised ImportError and the API could
not boot at all.

It never failed locally: the dev venv has `cryptography` anyway, dragged in by
google-auth and pdfminer.six, which are not in requirements.txt. A clean
install is the only thing that shows it, and the deploy was the clean install.
"""
import re
from importlib.metadata import PackageNotFoundError, metadata
from pathlib import Path

import pytest

REQUIREMENTS = Path(__file__).resolve().parents[1] / "requirements.txt"

_LINE = re.compile(r"^(?P<name>[A-Za-z0-9._-]+)\s*(\[(?P<extras>[^\]]*)\])?")


def _requirements() -> list[tuple[str, list[str]]]:
    out = []
    for raw in REQUIREMENTS.read_text(encoding="utf-8").splitlines():
        line = raw.split("#")[0].strip()
        if not line or line.startswith("-"):
            continue
        m = _LINE.match(line)
        if not m:
            continue
        extras = [e.strip() for e in (m.group("extras") or "").split(",") if e.strip()]
        out.append((m.group("name"), extras))
    return out


WITH_EXTRAS = [(n, e) for n, e in _requirements() if e]


def test_the_file_parses_and_someone_is_using_extras():
    """Guards the guard: if the parse silently returned nothing, the
    parametrised test below would vacuously pass."""
    assert _requirements(), "parsed no requirements at all"
    assert WITH_EXTRAS, "expected at least one requirement to declare an extra"


@pytest.mark.parametrize("name,extras", WITH_EXTRAS, ids=lambda v: v if isinstance(v, str) else "")
def test_declared_extras_exist_on_the_package(name, extras):
    try:
        provided = set(metadata(name).get_all("Provides-Extra") or [])
    except PackageNotFoundError:
        pytest.skip(f"{name} is not installed in this environment")

    unknown = sorted(set(extras) - provided)
    assert not unknown, (
        f"requirements.txt asks for {name}[{','.join(extras)}], but {name} provides "
        f"{sorted(provided) or 'no extras'}. pip ignores an unknown extra with only a "
        f"warning, so the dependency it was meant to pull in is silently absent from "
        f"a clean install."
    )


def test_the_jwt_algorithms_the_token_verifier_needs_are_importable():
    """The concrete thing the bad extra broke: security.py imports these two
    at module scope, so losing them takes the whole API down on startup."""
    from jwt.algorithms import ECAlgorithm, RSAAlgorithm  # noqa: F401

    import app.core.security as security

    assert "RS256" in security._ALLOWED_ALGORITHMS
    assert "ES256" in security._ALLOWED_ALGORITHMS
