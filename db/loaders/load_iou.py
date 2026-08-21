"""Load IOU territory polygons."""

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
    path = settings.dataset_demo_data_dir / "iou_territories.geojson"
    print_step(f"iou_territories ← {path}")
    data = load_geojson(path)
    features = data["features"]
    print_counts("read", features=len(features))

    rows = []
    for feat in features:
        props = feat["properties"]
        geom = as_multi_polygon_geojson(feat["geometry"])
        rows.append(
            (
                props["utility"],
                props["utility_name"],
                json.dumps(geom),
            )
        )

    with conn.transaction():
        truncate(conn, "wildfire.iou_territories")
        with conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO wildfire.iou_territories (utility, utility_name, geom)
                VALUES (
                  %s, %s,
                  ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)
                )
                """,
                rows,
            )
        inserted = len(rows)

    final = table_count(conn, "wildfire.iou_territories")
    print_counts("loaded", inserted=inserted, table_count=final)
    return final
