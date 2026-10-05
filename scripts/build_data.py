#!/usr/bin/env python3
"""Build data/planets.json, the one file the explorer loads.

Default source is the NASA Exoplanet Archive "Planetary Systems Composite
Parameters" table (pscomppars): one row per confirmed planet, best values
merged across papers. The GitHub Action in .github/workflows/refresh-data.yml
runs this weekly and commits the result, so the site itself stays static.

    python3 scripts/build_data.py                    # NASA, live (needs network)
    python3 scripts/build_data.py --source nasa --input pscomppars.csv
    python3 scripts/build_data.py --source oec  --input open_exoplanet_catalogue.txt

The OEC path (Open Exoplanet Catalogue, github.com/OpenExoplanetCatalogue/oec_tables)
is a fallback for when the archive cannot be reached. Standard library only.
"""
import argparse
import csv
import io
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "planets.json"

TAP = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync"
OEC_URL = ("https://raw.githubusercontent.com/OpenExoplanetCatalogue/oec_tables/"
           "master/comma_separated/open_exoplanet_catalogue.txt")

# Output schema. Units are fixed here and in app/fields.js; keep the two in step.
FIELDS = [
    ("name", "str"),       # planet name
    ("host", "str"),       # host star name
    ("status", "str"),     # confirmed | controversial | retracted
    ("method", "str"),     # discovery method
    ("year", "int"),       # discovery year
    ("facility", "str"),   # discovery facility
    ("np", "int"),         # planets in system
    ("ns", "int"),         # stars in system
    ("per", 6),            # orbital period [days]
    ("a", 5),              # semi-major axis [AU]
    ("e", 3),              # eccentricity
    ("inc", 2),            # inclination [deg]
    ("rade", 3),           # radius [Earth radii]
    ("rade_est", "int"),   # 1 if the archive's radius is itself a mass-radius estimate
    ("masse", 4),          # mass [Earth masses]
    ("massprov", "str"),   # Mass | Msini | M-R relationship ...
    ("insol", 4),          # insolation [Earth flux]
    ("teq", 0),            # equilibrium temperature [K]
    ("st_spt", "str"),     # spectral type
    ("st_teff", 0),        # stellar effective temperature [K]
    ("st_rad", 3),         # stellar radius [Solar radii]
    ("st_mass", 3),        # stellar mass [Solar masses]
    ("st_lum", 3),         # stellar luminosity log10(L/Lsun)
    ("st_met", 2),         # metallicity [dex]
    ("st_age", 2),         # stellar age [Gyr]
    ("ra", 5),             # right ascension [deg]
    ("dec", 5),            # declination [deg]
    ("dist", 3),           # distance [pc]
    ("vmag", 2),           # V magnitude
    ("updated", "str"),    # last update of the row (YYYY-MM-DD)
]

NASA_COLUMNS = [
    "pl_name", "hostname", "pl_controv_flag", "discoverymethod", "disc_year",
    "disc_facility", "sy_pnum", "sy_snum", "pl_orbper", "pl_orbsmax", "pl_orbeccen",
    "pl_orbincl", "pl_rade", "pl_rade_reflink", "pl_bmasse", "pl_bmassprov",
    "pl_insol", "pl_eqt", "st_spectype", "st_teff", "st_rad", "st_mass", "st_lum",
    "st_met", "st_age", "ra", "dec", "sy_dist", "sy_vmag", "rowupdate",
]

MJ_ME = 317.828   # Jupiter mass in Earth masses
RJ_RE = 11.209    # Jupiter radius in Earth radii


def num(v):
    if v is None:
        return None
    v = str(v).strip()
    if v == "" or v.lower() in ("nan", "null", "none"):
        return None
    try:
        return float(v)
    except ValueError:
        return None


def nasa_rows(text):
    for r in csv.DictReader(io.StringIO(text)):
        reflink = r.get("pl_rade_reflink") or ""
        yield {
            "name": r.get("pl_name"),
            "host": r.get("hostname"),
            "status": "controversial" if r.get("pl_controv_flag") == "1" else "confirmed",
            "method": r.get("discoverymethod"),
            "year": num(r.get("disc_year")),
            "facility": r.get("disc_facility"),
            "np": num(r.get("sy_pnum")),
            "ns": num(r.get("sy_snum")),
            "per": num(r.get("pl_orbper")),
            "a": num(r.get("pl_orbsmax")),
            "e": num(r.get("pl_orbeccen")),
            "inc": num(r.get("pl_orbincl")),
            "rade": num(r.get("pl_rade")),
            "rade_est": 1 if "calculated" in reflink.lower() else 0,
            "masse": num(r.get("pl_bmasse")),
            "massprov": r.get("pl_bmassprov"),
            "insol": num(r.get("pl_insol")),
            "teq": num(r.get("pl_eqt")),
            "st_spt": r.get("st_spectype"),
            "st_teff": num(r.get("st_teff")),
            "st_rad": num(r.get("st_rad")),
            "st_mass": num(r.get("st_mass")),
            "st_lum": num(r.get("st_lum")),
            "st_met": num(r.get("st_met")),
            "st_age": num(r.get("st_age")),
            "ra": num(r.get("ra")),
            "dec": num(r.get("dec")),
            "dist": num(r.get("sy_dist")),
            "vmag": num(r.get("sy_vmag")),
            "updated": (r.get("rowupdate") or "")[:10],
        }


OEC_METHOD = {
    "transit": "Transit", "RV": "Radial Velocity", "imaging": "Imaging",
    "microlensing": "Microlensing", "timing": "Pulsar Timing",
}


def sexagesimal(v, hours):
    parts = (v or "").replace(":", " ").split()
    if not parts:
        return None
    sign = -1 if parts[0].startswith("-") else 1
    vals = [abs(float(p)) for p in parts] + [0, 0]
    deg = vals[0] + vals[1] / 60 + vals[2] / 3600
    return sign * deg * (15 if hours else 1)


def oec_rows(text):
    for r in csv.DictReader(io.StringIO(text)):
        lists = r.get("list") or ""
        if "Retracted" in lists:
            status = "retracted"
        elif "Controversial" in lists:
            status = "controversial"
        elif "Confirmed" in lists:
            status = "confirmed"
        else:
            continue  # Kepler objects of interest, solar system, etc.
        mass, rad = num(r["mass"]), num(r["radius"])
        upd = r.get("lastupdate") or ""
        m = re.match(r"(\d\d)/(\d\d)/(\d\d)", upd)
        yield {
            "name": r["name"],
            "host": re.sub(r"\s+[a-z]$", "", r["name"]),
            "status": status,
            "method": OEC_METHOD.get(r["discoverymethod"], r["discoverymethod"] or ""),
            "year": num(r["discoveryyear"]),
            "facility": "",
            "np": None,
            "ns": None,
            "per": num(r["period"]),
            "a": num(r["semimajoraxis"]),
            "e": num(r["eccentricity"]),
            "inc": num(r["inclination"]),
            "rade": rad * RJ_RE if rad is not None else None,
            "rade_est": 0,
            "masse": mass * MJ_ME if mass is not None else None,
            "massprov": "Msini" if r["discoverymethod"] == "RV" and r["inclination"] == "" else "Mass",
            "insol": None,
            "teq": num(r["temperature"]),
            "st_spt": "",
            "st_teff": num(r["hoststar_temperature"]),
            "st_rad": num(r["hoststar_radius"]),
            "st_mass": num(r["hoststar_mass"]),
            "st_lum": None,
            "st_met": num(r["hoststar_metallicity"]),
            "st_age": num(r["hoststar_age"]),
            "ra": sexagesimal(r["system_rightascension"], True),
            "dec": sexagesimal(r["system_declination"], False),
            "dist": num(r["system_distance"]),
            "vmag": None,
            "updated": f"20{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else "",
        }


def oec_fill_counts(rows):
    """OEC has no planet count per system; derive it from the rows themselves."""
    by_host = {}
    for r in rows:
        key = (r["host"], round(r["ra"] or 0, 2), round(r["dec"] or 0, 2))
        by_host.setdefault(key, []).append(r)
    for group in by_host.values():
        n = sum(1 for r in group if r["status"] != "retracted")
        for r in group:
            r["np"] = n


def pack(rows):
    out = []
    for r in rows:
        row = []
        for key, kind in FIELDS:
            v = r.get(key)
            if v is None or v == "":
                row.append(None)
            elif kind == "str":
                row.append(str(v))
            elif kind == "int":
                row.append(int(v))
            else:
                v = round(float(v), kind)
                row.append(int(v) if kind == 0 else v)
        out.append(row)
    return out


def fetch(url, timeout=180):
    req = urllib.request.Request(url, headers={"User-Agent": "InterImm exoplanet-explorer"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8")
    except urllib.error.HTTPError as err:
        sys.exit(f"{err} for {url}\n{err.read().decode('utf-8', 'replace')[:2000]}")


def tap(query):
    return fetch(f"{TAP}?{urllib.parse.urlencode({'query': query, 'format': 'csv'})}")


def nasa_download():
    """Ask for the columns we use that the table actually has, so a renamed column costs one field, not the build."""
    have = set(next(csv.reader(io.StringIO(tap("select top 1 * from pscomppars")))))
    cols = [c for c in NASA_COLUMNS if c in have]
    missing = sorted(set(NASA_COLUMNS) - have)
    if missing:
        print(f"pscomppars has no {', '.join(missing)}; those fields stay empty", file=sys.stderr)
    return tap(f"select {','.join(cols)} from pscomppars")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", choices=["nasa", "oec"], default="nasa")
    ap.add_argument("--input", help="read this file instead of downloading")
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args()

    if args.source == "nasa":
        text = Path(args.input).read_text() if args.input else nasa_download()
        rows = list(nasa_rows(text))
        source = {
            "name": "NASA Exoplanet Archive",
            "table": "Planetary Systems Composite Parameters (pscomppars)",
            "url": "https://exoplanetarchive.ipac.caltech.edu/",
            "citation": "This research has made use of the NASA Exoplanet Archive, which is operated by "
                        "the California Institute of Technology, under contract with NASA under the "
                        "Exoplanet Exploration Program.",
        }
    else:
        text = Path(args.input).read_text() if args.input else fetch(OEC_URL)
        rows = list(oec_rows(text))
        oec_fill_counts(rows)
        source = {
            "name": "Open Exoplanet Catalogue",
            "table": "oec_tables, comma_separated",
            "url": "https://github.com/OpenExoplanetCatalogue/oec_tables",
            "citation": "Rein, H. (2012), A proposal for community driven and decentralized astronomical "
                        "databases and the Open Exoplanet Catalogue, arXiv:1211.7121.",
        }

    if len(rows) < 1000:
        sys.exit(f"only {len(rows)} planets parsed; refusing to overwrite {args.out}")

    rows.sort(key=lambda r: r["name"])
    doc = {
        "meta": {
            "source": source,
            "built": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "count": len(rows),
            "units": {
                "per": "day", "a": "AU", "inc": "deg", "rade": "Earth radius", "masse": "Earth mass",
                "insol": "Earth flux", "teq": "K", "st_teff": "K", "st_rad": "Solar radius",
                "st_mass": "Solar mass", "st_lum": "log10(L/Lsun)", "st_met": "dex", "st_age": "Gyr",
                "ra": "deg", "dec": "deg", "dist": "pc",
            },
        },
        "fields": [k for k, _ in FIELDS],
        "rows": pack(rows),
    }
    Path(args.out).write_text(json.dumps(doc, separators=(",", ":"), ensure_ascii=False) + "\n")
    print(f"wrote {len(rows)} planets from {source['name']} to {args.out}")


if __name__ == "__main__":
    main()
