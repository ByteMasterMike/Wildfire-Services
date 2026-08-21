"""Assign wildfire.us_ignitions to US states via Census-style state polygons.

Downloads a small public GeoJSON once (cached under data/north_america/),
spatial-joins points in Python (shapely), prints 2024 + overall breakdowns.
"""

from __future__ import annotations

import json
import urllib.request
from collections import Counter
from pathlib import Path

from shapely.geometry import Point, shape
from shapely.strtree import STRtree

from shared.db import connect, get_settings

HERE = Path(__file__).resolve().parent
STATES_GEOJSON = HERE / "_us_states.geojson"
STATES_URL = (
    "https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json"
)

# Census Bureau regions
STATE_TO_REGION = {
    "Connecticut": "Northeast",
    "Maine": "Northeast",
    "Massachusetts": "Northeast",
    "New Hampshire": "Northeast",
    "Rhode Island": "Northeast",
    "Vermont": "Northeast",
    "New Jersey": "Northeast",
    "New York": "Northeast",
    "Pennsylvania": "Northeast",
    "Illinois": "Midwest",
    "Indiana": "Midwest",
    "Michigan": "Midwest",
    "Ohio": "Midwest",
    "Wisconsin": "Midwest",
    "Iowa": "Midwest",
    "Kansas": "Midwest",
    "Minnesota": "Midwest",
    "Missouri": "Midwest",
    "Nebraska": "Midwest",
    "North Dakota": "Midwest",
    "South Dakota": "Midwest",
    "Delaware": "South",
    "Florida": "South",
    "Georgia": "South",
    "Maryland": "South",
    "North Carolina": "South",
    "South Carolina": "South",
    "Virginia": "South",
    "District of Columbia": "South",
    "West Virginia": "South",
    "Alabama": "South",
    "Kentucky": "South",
    "Mississippi": "South",
    "Tennessee": "South",
    "Arkansas": "South",
    "Louisiana": "South",
    "Oklahoma": "South",
    "Texas": "South",
    "Arizona": "West",
    "Colorado": "West",
    "Idaho": "West",
    "Montana": "West",
    "Nevada": "West",
    "New Mexico": "West",
    "Utah": "West",
    "Wyoming": "West",
    "Alaska": "West",
    "California": "West",
    "Hawaii": "West",
    "Oregon": "West",
    "Washington": "West",
}


def ensure_states() -> list[tuple[str, object]]:
    if not STATES_GEOJSON.is_file():
        print(f"downloading {STATES_URL}")
        urllib.request.urlretrieve(STATES_URL, STATES_GEOJSON)
    fc = json.loads(STATES_GEOJSON.read_text(encoding="utf-8"))
    out = []
    for feat in fc["features"]:
        name = feat["properties"].get("name") or feat["properties"].get("NAME")
        geom = shape(feat["geometry"])
        if name and geom and not geom.is_empty:
            out.append((str(name), geom))
    print(f"loaded {len(out)} state/territory polygons from {STATES_GEOJSON.name}")
    return out


def assign_state(lon: float, lat: float, geoms: list, names: list[str], tree: STRtree) -> str:
    pt = Point(lon, lat)
    for idx in tree.query(pt):
        if geoms[idx].covers(pt):
            return names[idx]
    # nearest within ~50km for coastal/border slivers
    nearest = tree.nearest(pt)
    dist = geoms[nearest].distance(pt)  # degrees ~ rough
    if dist < 0.5:
        return names[nearest]
    return "UNASSIGNED"


def pct(n: int, total: int) -> float:
    return 100.0 * n / total if total else 0.0


def print_breakdown(title: str, by_state: Counter, total: int) -> dict:
    print(f"\n=== {title} (n={total:,}) ===")
    ranked = by_state.most_common()
    for name, n in ranked[:15]:
        print(f"  {name:28s} {n:6,}  ({pct(n, total):5.1f}%)")
    if len(ranked) > 15:
        rest = sum(n for _, n in ranked[15:])
        print(f"  {'(remaining)':28s} {rest:6,}  ({pct(rest, total):5.1f}%)")

    by_region: Counter = Counter()
    for name, n in by_state.items():
        by_region[STATE_TO_REGION.get(name, "Other/unassigned")] += n
    print("  -- by Census region --")
    for name, n in by_region.most_common():
        print(f"  {name:28s} {n:6,}  ({pct(n, total):5.1f}%)")

    ca = by_state.get("California", 0)
    return {
        "total": total,
        "california": ca,
        "california_share": round(pct(ca, total), 2),
        "top_states": [{"state": s, "n": n, "pct": round(pct(n, total), 2)} for s, n in ranked[:10]],
        "by_region": {
            r: {"n": n, "pct": round(pct(n, total), 2)} for r, n in by_region.most_common()
        },
        "unassigned": by_state.get("UNASSIGNED", 0),
    }


def main() -> None:
    states = ensure_states()
    names = [n for n, _ in states]
    geoms = [g for _, g in states]
    tree = STRtree(geoms)

    conn = connect(get_settings())
    cur = conn.cursor()
    cur.execute("SELECT year, longitude, latitude FROM wildfire.us_ignitions")
    rows = cur.fetchall()
    conn.close()
    print(f"points: {len(rows):,}")

    overall: Counter = Counter()
    y2024: Counter = Counter()
    for year, lon, lat in rows:
        st = assign_state(float(lon), float(lat), geoms, names, tree)
        overall[st] += 1
        if int(year) == 2024:
            y2024[st] += 1

    summary = {
        "method": "point-in-polygon vs PublicaMundi us-states.geojson (Census-derived)",
        "overall": print_breakdown("Overall", overall, sum(overall.values())),
        "year_2024": print_breakdown("2024", y2024, sum(y2024.values())),
    }
    out = HERE / "_us_ignitions_state_breakdown.json"
    out.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"\nwrote {out}")
    print(
        f"\nVERDICT 2024: CA {summary['year_2024']['california']:,} / "
        f"{summary['year_2024']['total']:,} = {summary['year_2024']['california_share']}%"
    )
    print(
        f"VERDICT overall: CA {summary['overall']['california']:,} / "
        f"{summary['overall']['total']:,} = {summary['overall']['california_share']}%"
    )


if __name__ == "__main__":
    main()
