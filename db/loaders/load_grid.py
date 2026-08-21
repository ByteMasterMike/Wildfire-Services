"""Load 824-cell risk grid polygons + centroids."""

from __future__ import annotations

import csv
import json

import psycopg

from db.loaders.config import Settings
from db.loaders.util import print_counts, print_step, table_count, truncate


def _row_col_lookup(settings: Settings) -> dict[int, tuple[int, int]]:
    """Optional row/col from dataset_demo weather_anim grid_cells.json."""
    path = settings.dataset_demo_data_dir / "weather_anim" / "grid_cells.json"
    if not path.exists():
        return {}
    with path.open(encoding="utf-8") as f:
        data = json.load(f)
    out: dict[int, tuple[int, int]] = {}
    for cell in data.get("cells", []):
        out[int(cell["id"])] = (int(cell["row"]), int(cell["col"]))
    return out


def _cell_polygon(lon: float, lat: float, spacing: float) -> dict:
    """SW-corner (lon, lat) -> 0.24° polygon ring."""
    return {
        "type": "Polygon",
        "coordinates": [
            [
                [lon, lat],
                [lon + spacing, lat],
                [lon + spacing, lat + spacing],
                [lon, lat + spacing],
                [lon, lat],
            ]
        ],
    }


def load(conn: psycopg.Connection, settings: Settings) -> int:
    path = settings.risk_forecasting_data_dir / "grid_cells.csv"
    print_step(f"grid_cells ← {path}")
    if not path.exists():
        raise FileNotFoundError(f"missing risk grid: {path}")

    spacing = settings.grid_cell_spacing_deg
    rowcol = _row_col_lookup(settings)

    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        raw = list(reader)
    print_counts("read", rows=len(raw), spacing_deg=spacing)

    rows = []
    for r in raw:
        cell_id = int(r["cell_id"])
        lat = float(r["lat"])
        lon = float(r["lon"])
        rc = rowcol.get(cell_id)
        row_i = rc[0] if rc else None
        col_i = rc[1] if rc else None
        poly = _cell_polygon(lon, lat, spacing)
        rows.append((cell_id, row_i, col_i, lat, lon, json.dumps(poly)))

    with conn.transaction():
        truncate(conn, "wildfire.grid_cells")
        with conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO wildfire.grid_cells
                  (cell_id, row, col, lat, lon, geom, centroid)
                VALUES (
                  %s, %s, %s, %s, %s,
                  ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326),
                  ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))
                )
                """,
                [(a, b, c, d, e, g, g) for (a, b, c, d, e, g) in rows],
            )
        inserted = len(rows)

    final = table_count(conn, "wildfire.grid_cells")
    print_counts("loaded", inserted=inserted, table_count=final)
    return final
