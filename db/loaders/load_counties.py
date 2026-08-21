"""Load California county polygons from Census TIGER cartographic boundaries."""

from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

import httpx
import psycopg
import shapefile

from db.loaders.config import Settings
from db.loaders.util import (
    as_multi_polygon_geojson,
    print_counts,
    print_step,
    table_count,
    truncate,
)
from shared.db import REPO_ROOT

# National 1:500,000 cartographic boundary shapefile (TIGER-derived).
# California-only extracts are not published at this resolution on the FTP.
CENSUS_COUNTY_ZIPS = (
    "https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_county_500k.zip",
    "https://www2.census.gov/geo/tiger/GENZ2022/shp/cb_2022_us_county_500k.zip",
)
CACHE_DIR = REPO_ROOT / "data" / "boundaries"
CACHE_ZIP = CACHE_DIR / "cb_2023_us_county_500k.zip"
CA_STATEFP = "06"


def _download_zip(dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    last_error: Exception | None = None
    headers = {"User-Agent": "Mozilla/5.0 (compatible; WildfireServices/1.0)"}
    for url in CENSUS_COUNTY_ZIPS:
        try:
            with httpx.Client(timeout=120.0, follow_redirects=True, headers=headers) as client:
                response = client.get(url)
                response.raise_for_status()
            dest.write_bytes(response.content)
            print(f"  downloaded {url} ({len(response.content):,} bytes)")
            return
        except (httpx.HTTPError, OSError) as exc:
            last_error = exc
            print(f"  download failed {url}: {exc}")
    raise RuntimeError(
        f"Could not download Census county polygons. Last error: {last_error}. "
        f"Place cb_2023_us_county_500k.zip at {dest} and re-run the loader."
    )


def _shape_to_geojson(shape) -> dict:
    """Convert a pyshp polygon to GeoJSON Polygon / MultiPolygon."""
    geo = getattr(shape, "__geo_interface__", None)
    if isinstance(geo, dict) and geo.get("type") in {"Polygon", "MultiPolygon"}:
        return geo
    parts = list(shape.parts) + [len(shape.points)]
    rings = []
    for start, end in zip(parts, parts[1:]):
        ring = [list(pt[:2]) for pt in shape.points[start:end]]
        if ring and ring[0] != ring[-1]:
            ring.append(ring[0])
        if len(ring) >= 4:
            rings.append(ring)
    if not rings:
        raise ValueError("shapefile record has no usable rings")
    if len(rings) == 1:
        return {"type": "Polygon", "coordinates": rings}
    return {"type": "Polygon", "coordinates": rings}


def _records_from_zip(zip_path: Path) -> list[tuple[str, str, str, str]]:
    with zipfile.ZipFile(zip_path) as archive:
        names = {Path(item).name.lower(): item for item in archive.namelist()}
        try:
            shp_name = next(n for key, n in names.items() if key.endswith(".shp"))
            dbf_name = next(n for key, n in names.items() if key.endswith(".dbf"))
            shx_name = next(n for key, n in names.items() if key.endswith(".shx"))
        except StopIteration as exc:
            raise RuntimeError(
                f"{zip_path} is not a shapefile zip (missing .shp/.dbf/.shx)"
            ) from exc
        reader = shapefile.Reader(
            shp=io.BytesIO(archive.read(shp_name)),
            dbf=io.BytesIO(archive.read(dbf_name)),
            shx=io.BytesIO(archive.read(shx_name)),
        )
        fields = [item[0] for item in reader.fields[1:]]
        rows: list[tuple[str, str, str, str]] = []
        for sr in reader.shapeRecords():
            props = dict(zip(fields, sr.record))
            name = str(props.get("NAME") or "").strip()
            geoid = str(props.get("GEOID") or "").strip()
            statefp = str(props.get("STATEFP") or "").strip()
            if statefp != CA_STATEFP:
                continue
            if not name or not geoid:
                continue
            geom = as_multi_polygon_geojson(_shape_to_geojson(sr.shape))
            rows.append((geoid, name, statefp, json.dumps(geom)))
        reader.close()
    return rows


def load(conn: psycopg.Connection, settings: Settings) -> int:
    del settings  # polygons are not in dataset_demo
    print_step(f"counties ← Census TIGER {CENSUS_COUNTY_ZIPS[0]}")
    if not CACHE_ZIP.exists() or CACHE_ZIP.stat().st_size == 0:
        print("  downloading California county cartographic boundaries (once, then cached)")
        _download_zip(CACHE_ZIP)
    else:
        print(f"  using cached zip {CACHE_ZIP}")

    rows = _records_from_zip(CACHE_ZIP)
    print_counts("read", features=len(rows))
    if len(rows) < 50:
        raise RuntimeError(
            f"Expected ~58 California counties, got {len(rows)} from {CACHE_ZIP}"
        )

    with conn.transaction():
        truncate(conn, "wildfire.counties")
        with conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO wildfire.counties (geoid, name, statefp, geom)
                VALUES (
                  %s, %s, %s,
                  ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))
                )
                """,
                rows,
            )
        inserted = len(rows)

    final = table_count(conn, "wildfire.counties")
    print_counts("loaded", inserted=inserted, table_count=final)
    return final
