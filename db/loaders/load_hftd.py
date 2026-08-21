"""Load HFTD Tier 2/3 polygons."""

from __future__ import annotations

import json

import psycopg

from db.loaders.config import Settings
from db.loaders.util import (
    as_multi_polygon_geojson,
    load_geojson,
    print_counts,
    print_step,
    table_count,
    truncate,
)


def load(conn: psycopg.Connection, settings: Settings) -> int:
    path = settings.dataset_demo_data_dir / "hftd.geojson"
    print_step(f"hftd_tiers ← {path}")
    print("  NOTE: no CPZ data in dataset_demo (known gap); loading HFTD tiers only.")
    data = load_geojson(path)
    features = data["features"]
    print_counts("read", features=len(features))

    rows = []
    for feat in features:
        props = feat["properties"]
        geom = as_multi_polygon_geojson(feat["geometry"])
        rows.append(
            (
                props["HFTD"],
                props.get("OBJECTID"),
                props.get("Shape__Length") or props.get("Shape_Leng"),
                props.get("Shape__Area"),
                json.dumps(geom),
            )
        )

    with conn.transaction():
        truncate(conn, "wildfire.hftd_tiers")
        with conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO wildfire.hftd_tiers
                  (tier, objectid, shape_length, shape_area, geom)
                VALUES (
                  %s, %s, %s, %s,
                  ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)
                )
                """,
                rows,
            )
        inserted = len(rows)

    final = table_count(conn, "wildfire.hftd_tiers")
    print_counts("loaded", inserted=inserted, table_count=final)
    return final
