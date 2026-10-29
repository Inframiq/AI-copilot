"""Builds the city and college suggestion lists from public datasets.

    python -I scripts/build-suggestion-lists.py <download dir>

<download dir> holds, as downloaded:
  - cities15000.txt, countryInfo.txt   https://download.geonames.org/export/dump/
    (cities15000.zip unzipped: every place with 15,000+ people)
  - world_universities_and_domains.json, LICENSE.txt
    https://github.com/Hipo/university-domains-list (MIT)

Writes lib/suggest/data/cities.json and colleges.json, each
{"source", "license", "names"}: the notice travels with the data. Cities are
"Name, Country", largest first, so a short query finds the big city first.
Skills, job titles, degrees, languages and certifications are kept by hand
in the same folder.
"""
import json
import pathlib
import sys

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


def colleges(src: pathlib.Path) -> list[str]:
    data = json.loads((src / "world_universities_and_domains.json").read_text("utf8"))
    return sorted({" ".join(u["name"].split()) for u in data if u.get("name", "").strip()}, key=str.casefold)


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
            "source": "university-domains-list by Hipo (github.com/Hipo/university-domains-list)",
            "license": (src / "LICENSE.txt").read_text("utf8").strip(),
            "names": colleges(src),
        },
    }
    for file, body in lists.items():
        (OUT / file).write_text(json.dumps(body, ensure_ascii=False, separators=(",", ":")), "utf8")
        print(file, len(body["names"]))


if __name__ == "__main__":
    main()
