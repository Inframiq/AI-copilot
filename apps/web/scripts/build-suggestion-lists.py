"""Builds the city and college suggestion lists from public datasets.

    python -I scripts/build-suggestion-lists.py <download dir>

<download dir> holds, as downloaded:
  - cities15000.txt, countryInfo.txt   https://download.geonames.org/export/dump/
    (cities15000.zip unzipped: every place with 15,000+ people)
  - world_universities_and_domains.json, LICENSE.txt
    https://github.com/Hipo/university-domains-list (MIT)
  - All Universities AISHE Dashboard.xlsx, All Colleges AISHE Dashboard.xlsx
    AISHE, Ministry of Education, Government of India, as published on AIKosh
    (aikosh.indiaai.gov.in, "All Universities/Colleges as per AISHE
    Dashboard"; sign-in needed to download). Open Government License – India.

Writes lib/suggest/data/cities.json and colleges.json, each
{"source", "license", "names"}: the notices travel with the data. Cities are
"Name, Country", largest first, so a short query finds the big city first.
Colleges are universities first (India's from AISHE, then the world's), then
India's colleges; an institution in both lists keeps AISHE's name.
Skills, job titles, degrees, languages and certifications are kept by hand
in the same folder.
"""
import json
import pathlib
import re
import sys
import unicodedata
import xml.etree.ElementTree as ET
import zipfile

OUT = pathlib.Path(__file__).resolve().parents[1] / "lib" / "suggest" / "data"


def countries(path: pathlib.Path) -> dict[str, str]:
    out = {}
    for line in path.read_text("utf8").splitlines():
        if line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) > 4:
            out[parts[0]] = parts[4].strip()
    return out


def cities(src: pathlib.Path) -> list[str]:
    names = countries(src / "countryInfo.txt")
    rows = []
    for line in (src / "cities15000.txt").read_text("utf8").splitlines():
        p = line.split("\t")
        # 1 name, 8 country code, 14 population
        rows.append((int(p[14] or 0), f"{p[1].strip()}, {names.get(p[8], p[8])}"))
    seen, out = set(), []
    for _pop, name in sorted(rows, key=lambda r: -r[0]):
        if name not in seen:
            seen.add(name)
            out.append(name)
    return out


# ── AISHE ────────────────────────────────────────────────────────────────────

_XLSX = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def xlsx_rows(path: pathlib.Path) -> list[dict[str, str]]:
    """The first sheet's rows keyed by its header row — standard library
    only, so the script needs nothing installed."""
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).iter(f"{_XLSX}si"):
            shared.append("".join(t.text or "" for t in si.iter(f"{_XLSX}t")))
    rows = []
    for row in ET.fromstring(z.read("xl/worksheets/sheet1.xml")).iter(f"{_XLSX}row"):
        cells = {}
        for c in row.iter(f"{_XLSX}c"):
            col = re.match(r"[A-Z]+", c.get("r")).group(0)
            v = c.find(f"{_XLSX}v")
            if c.get("t") == "s" and v is not None:
                cells[col] = shared[int(v.text)]
            elif c.get("t") == "inlineStr":
                cells[col] = "".join(t.text or "" for t in c.iter(f"{_XLSX}t"))
            else:
                cells[col] = v.text if v is not None and v.text else ""
        rows.append(cells)
    header, *body = rows
    return [{header[k].strip(): (r.get(k) or "").strip() for k in header} for r in body]


# Kept in capitals when a name is title-cased: acronyms with vowels the
# no-vowel rule below doesn't catch.
ACRONYMS = {
    "IIT", "IIIT", "IIM", "AIIMS", "ITI", "JNTU", "JNTUK", "JNTUH", "JNTUA", "BITS", "VIT", "KIIT",
    "GITAM", "PES", "KLE", "MIT", "DAV", "SNDT", "ICFAI", "NIIT", "ANITS", "MVGR", "BVRIT", "GVP",
    "SVKM", "NMIMS", "AMU", "BHU", "JNU", "IGNOU", "LNM", "IISER", "IISC", "NIFT", "NID", "TKR",
    "SRKR", "VNR", "CMR", "GMR", "MLR", "MRCET", "SVU", "RVR", "VVIT", "KITS", "MGIT", "CBIT",
}
# Lowercase inside a title-cased name.
SMALL = {"of", "and", "for", "the", "in", "at", "on", "to", "by", "a", "an", "&"}
# Honorifics read as words, though they have no vowels.
WORDS = {"DR", "SMT", "SHRI", "SHREE", "SRI", "ST", "MR", "MRS", "PVT", "LTD"}


def _title(name: str) -> str:
    out = []
    for i, tok in enumerate(name.split(" ")):
        letters = re.sub(r"[^A-Z]", "", tok)
        if not letters:
            out.append(tok)
        elif tok.startswith("(") and len(letters) <= 6:
            out.append(tok)  # "(GITAM)", "(A)"
        elif letters in ACRONYMS or (letters not in WORDS and len(letters) <= 5 and not re.search("[AEIOUY]", letters)):
            out.append(tok)  # "SRM", "VNR"
        elif i > 0 and tok.lower() in SMALL:
            out.append(tok.lower())
        else:
            # "B.ED" → "B.Ed"; after an apostrophe stays lower: "Women's".
            out.append(re.sub(r"(?<!['’])[A-Za-z]+", lambda m: m.group(0).capitalize(), tok.lower()))
    return " ".join(out)


# Where a postal address starts inside a name: "…, Near HDFC Bank, …",
# "…, Tal. Karjat, Dist. Ahmednagar", "Address: …", or a PIN code.
_ADDRESS = re.compile(
    r"(?:,\s*|\s+)(?:address\s*:|near\s|opp\.?\s|behind\s|tal\.|taluka\b|dist\.|district\s*:|p\.\s?o\.|post\s*:|nh-\d)"
    r"|[\s,-]*\b\d{3}\s?\d{3}\b",
    re.IGNORECASE,
)


def _cp1252(c: str) -> str:
    """A Windows-1252 character stored as its raw byte (U+0080–U+009F) as
    the character it stands for: \x92 → ’."""
    return bytes([ord(c)]).decode("cp1252", "replace") if 0x80 <= ord(c) <= 0x9F else c


def tidy_institution(name: str) -> str | None:
    """The name as a résumé would print it: Windows-1252 quotes made proper
    characters, no address or PIN code, no stray quotes or leading code,
    one space between words and ", " between parts, and an ALL-CAPS name in
    title case. A name in mixed case keeps its letters as published. None
    for a name garbled beyond repair ("Sup�rieure")."""
    name = "".join(_cp1252(c) for c in name)
    if "�" in name:
        return None
    name = " ".join(name.split())
    name = re.sub(r"^\d{3,}\s*-\s*", "", name)  # "100002-J.D.M.V.P. …"
    cut = _ADDRESS.search(name)
    if cut and cut.start() > 0:
        name = name[: cut.start()]
    name = name.strip(" \"'.,-")
    name = re.sub(r"\s*,\s*", ", ", name).strip(" ,")
    if name == name.upper() and re.search("[A-Z]", name):
        name = _title(name)
    return name or None


def fold(text: str) -> str:
    """As lib/suggest's fold(): what counts as the same name."""
    text = unicodedata.normalize("NFD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).lower()
    return " ".join(re.sub(r"[^\w+#]+", " ", text).replace("_", " ").split())


def aishe(path: pathlib.Path) -> list[str]:
    """Names from one AISHE file, a name used more than once told apart by
    its district."""
    rows = [(tidy_institution(r["Name"]), r.get("District", "").strip()) for r in xlsx_rows(path) if r.get("Name")]
    rows = [(name, district) for name, district in rows if name]
    count: dict[str, int] = {}
    for name, _ in rows:
        count[fold(name)] = count.get(fold(name), 0) + 1
    out = set()
    for name, district in rows:
        if count[fold(name)] > 1 and district and fold(district) not in fold(name):
            name = f"{name}, {district}"
        out.add(name)
    return sorted(out, key=str.casefold)


def colleges(src: pathlib.Path) -> list[str]:
    indian_unis = aishe(src / "All Universities AISHE Dashboard.xlsx")
    indian_colleges = aishe(src / "All Colleges AISHE Dashboard.xlsx")
    world = json.loads((src / "world_universities_and_domains.json").read_text("utf8"))
    # An Indian university the worldwide list has under a shorter name than
    # AISHE's ("Andhra University" for "Andhra University, Visakhapatnam")
    # is AISHE's alone.
    aishe_short = {fold(n.rsplit(",", 1)[0]) for n in indian_unis + indian_colleges}
    world_names = sorted(
        {
            n for u in world
            if (n := tidy_institution(u.get("name", "")))
            and not (u.get("country") == "India" and fold(n) in aishe_short)
        },
        key=str.casefold,
    )
    seen, out = set(), []
    for name in indian_unis + world_names + indian_colleges:
        key = fold(name)
        if key and key not in seen:
            seen.add(key)
            out.append(name)
    return out


def main() -> None:
    src = pathlib.Path(sys.argv[1])
    OUT.mkdir(parents=True, exist_ok=True)
    lists = {
        "cities.json": {
            "source": "GeoNames (geonames.org), places with 15,000+ people",
            "license": "CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/",
            "names": cities(src),
        },
        "colleges.json": {
            "source": (
                "Indian universities and colleges: AISHE (All India Survey on Higher Education), "
                "Ministry of Education, Government of India, via AIKosh. Other universities: "
                "university-domains-list by Hipo (github.com/Hipo/university-domains-list). "
                "Names tidied: spacing, trailing PIN codes, all-capitals names in title case, "
                "a repeated name followed by its district."
            ),
            "license": (
                "AISHE data: Government Open Data License – India, "
                "https://data.gov.in/government-open-data-license-india\n\n"
                "university-domains-list:\n" + (src / "LICENSE.txt").read_text("utf8").strip()
            ),
            "names": colleges(src),
        },
    }
    for file, body in lists.items():
        (OUT / file).write_text(json.dumps(body, ensure_ascii=False, separators=(",", ":")), "utf8")
        print(file, len(body["names"]))


if __name__ == "__main__":
    main()
