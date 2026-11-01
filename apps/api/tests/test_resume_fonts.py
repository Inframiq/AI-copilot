"""The Studio draws with the very fonts the PDF embeds.

apps/api/fonts holds the faces WeasyPrint embeds; apps/web/public/fonts/resume
serves the same files to the Studio, registered by apps/web/lib/resume-fonts.ts
under the same family names. If the two drift, the document on screen breaks
its lines differently from the PDF (and the page count with them).
"""
import hashlib
import re
from pathlib import Path

from app.services.pdf import BUNDLED_FONTS, FONT_STACKS, FONTS_DIR

ROOT = Path(__file__).resolve().parents[3]
WEB_FONTS = ROOT / "apps/web/public/fonts/resume"
WEB_MODULE = ROOT / "apps/web/lib/resume-fonts.ts"
FACES = ("Regular", "Bold", "Italic", "BoldItalic")


def _digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_every_bundled_face_exists_with_its_licence():
    for prefix in BUNDLED_FONTS.values():
        for face in FACES:
            assert (FONTS_DIR / f"{prefix}-{face}.ttf").is_file(), f"{prefix}-{face}"
    licences = {p.name for p in FONTS_DIR.glob("OFL-*.txt")}
    assert licences == {"OFL-Lato.txt", "OFL-Gelasio.txt", "OFL-Liberation.txt"}


def test_the_web_serves_the_same_font_files():
    for prefix in BUNDLED_FONTS.values():
        for face in FACES:
            name = f"{prefix}-{face}.ttf"
            assert _digest(FONTS_DIR / name) == _digest(WEB_FONTS / name), name


def test_the_web_registers_the_same_families_and_stacks():
    source = WEB_MODULE.read_text(encoding="utf-8")
    for key, stack in FONT_STACKS.items():
        assert f"{key}: '{stack}'," in source, key
    for family, prefix in BUNDLED_FONTS.items():
        assert f'"{family}": "{prefix}",' in source, family


def test_every_stack_leads_with_a_bundled_family_and_ends_generic():
    for key, stack in FONT_STACKS.items():
        lead = re.match(r'"([^"]+)"', stack).group(1)
        assert lead in BUNDLED_FONTS, key
        assert stack.endswith(("sans-serif", "serif")), key


def test_the_bundled_fonts_carry_no_ligatures_or_kerning():
    """build.py drops liga/clig/dlig — "fi" in "financial" stays two glyphs
    whatever the CSS says — and kern: Lato's bold "Te" pair was read by a
    parser as a word break ("T echnology")."""
    from fontTools.ttLib import TTFont

    for path in FONTS_DIR.glob("*.ttf"):
        font = TTFont(path)
        if "GSUB" not in font:
            continue
        tags = {r.FeatureTag for r in font["GSUB"].table.FeatureList.FeatureRecord}
        assert not tags & {"liga", "clig", "dlig"}, (path.name, tags)
        if "GPOS" in font:
            pos = {r.FeatureTag for r in font["GPOS"].table.FeatureList.FeatureRecord}
            assert "kern" not in pos, (path.name, pos)
        assert "kern" not in font, path.name
