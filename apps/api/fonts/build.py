"""Rebuild the résumé fonts in this folder from their upstream releases.

    python fonts/build.py <dir with the upstream .ttf files>

Not run by the app or the deploy — the output .ttf files are committed. This
script is the record of how they were made, so they can be rebuilt the same
way.

Why the fonts are bundled at all: the render host installs no font packages
(see Dockerfile / nixpacks.toml), so "Arial" or "Georgia" in a stack never
resolves there and the PDF used whatever fallback fontconfig had. Text an ATS
reads out of a PDF depends on the font that was actually embedded, so it has
to be a known one.

What is done to each face:
  - Gelasio ships as a variable font; it is pinned to static 400 and 700
    instances, because a résumé needs exactly regular and bold.
  - Subset to Latin script plus the punctuation and symbols the templates and
    typed résumé text use. Anything outside falls through the CSS stack.
  - Kerning is removed too: a large kern pair read as a word break.
  - Ligature substitutions (liga, clig, dlig) are removed, so "fi" in
    "financial" is always two glyphs. Some parsers can't map a ligature
    glyph back to its letters and lose the word. The templates also turn
    ligatures off in CSS; this makes it true whatever the CSS says.

Upstream sources (all SIL Open Font License 1.1, see the OFL-*.txt files):
  Liberation Sans / Serif 2.1.5  github.com/liberationfonts/liberation-fonts
  Lato 2.015                      github.com/google/fonts  ofl/lato
  Gelasio                         github.com/google/fonts  ofl/gelasio
"""
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

OUT = Path(__file__).parent

UNICODES = [
    *range(0x0020, 0x007F),   # ASCII
    *range(0x00A0, 0x0250),   # Latin-1, Latin Extended-A/B
    *range(0x0300, 0x0370),   # combining marks
    *range(0x1E00, 0x1F00),   # Latin Extended Additional
    *range(0x2000, 0x2070),   # general punctuation: dashes, bullets, quotes
    *range(0x20A0, 0x20D0),   # currency, ₹ included
    0x2122, 0x2190, 0x2192, 0x2212, 0x25CF,
]

# (output file, source file, wght instance for a variable font or None)
FACES = [
    ("LiberationSans-Regular.ttf", "LiberationSans-Regular.ttf", None),
    ("LiberationSans-Bold.ttf", "LiberationSans-Bold.ttf", None),
    ("LiberationSans-Italic.ttf", "LiberationSans-Italic.ttf", None),
    ("LiberationSans-BoldItalic.ttf", "LiberationSans-BoldItalic.ttf", None),
    ("LiberationSerif-Regular.ttf", "LiberationSerif-Regular.ttf", None),
    ("LiberationSerif-Bold.ttf", "LiberationSerif-Bold.ttf", None),
    ("LiberationSerif-Italic.ttf", "LiberationSerif-Italic.ttf", None),
    ("LiberationSerif-BoldItalic.ttf", "LiberationSerif-BoldItalic.ttf", None),
    ("Lato-Regular.ttf", "Lato-Regular.ttf", None),
    ("Lato-Bold.ttf", "Lato-Bold.ttf", None),
    ("Lato-Italic.ttf", "Lato-Italic.ttf", None),
    ("Lato-BoldItalic.ttf", "Lato-BoldItalic.ttf", None),
    ("Gelasio-Regular.ttf", "Gelasio-VF.ttf", 400),
    ("Gelasio-Bold.ttf", "Gelasio-VF.ttf", 700),
    ("Gelasio-Italic.ttf", "Gelasio-Italic-VF.ttf", 400),
    ("Gelasio-BoldItalic.ttf", "Gelasio-Italic-VF.ttf", 700),
]


def build(src: Path) -> None:
    options = subset.Options()
    # No liga/clig/dlig (see above) and no kern: Lato's bold pulls "Te" so
    # tight that a parser reading the PDF took the adjustment for a space —
    # "T echnology". Unkerned, every word comes out whole in every font.
    options.layout_features = ["mark", "mkmk", "ccmp", "locl"]
    options.legacy_kern = False
    options.name_IDs = ["*"]       # keep the licence and family names
    options.notdef_outline = True
    options.hinting = False     # print output; hinting only bloats the file
    for out_name, src_name, wght in FACES:
        font = TTFont(src / src_name)
        if wght is not None:
            font = instancer.instantiateVariableFont(font, {"wght": wght}, updateFontNames=True)
        subsetter = subset.Subsetter(options)
        subsetter.populate(unicodes=UNICODES)
        subsetter.subset(font)
        font.save(OUT / out_name)
        print(out_name, (OUT / out_name).stat().st_size)


if __name__ == "__main__":
    build(Path(sys.argv[1]))
