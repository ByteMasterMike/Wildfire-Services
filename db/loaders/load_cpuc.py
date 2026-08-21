"""Load CPUC ignition CSVs into two separate tables."""

from __future__ import annotations

import csv

import psycopg

from db.loaders.config import Settings
from db.loaders.util import (
    blank_to_none,
    parse_date,
    parse_time_hhmm,
    print_counts,
    print_step,
    table_count,
    truncate,
)


def load_combined(conn: psycopg.Connection, settings: Settings) -> int:
    path = settings.dataset_demo_data_dir / "cpuc_fire_incidents_combined.csv"
    print_step(f"cpuc_ignitions ← {path}")
    with path.open(newline="", encoding="utf-8") as f:
        raw = list(csv.DictReader(f))
    print_counts("read", rows=len(raw))

    rows = []
    for r in raw:
        rows.append(
            (
                r["utility"].strip(),
                parse_date(r["date"]),
                int(r["year"]),
                blank_to_none(r.get("source_file")),
                float(r["lon"]),
                float(r["lat"]),
            )
        )

    with conn.transaction():
        truncate(conn, "wildfire.cpuc_ignitions")
        with conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO wildfire.cpuc_ignitions
                  (utility, event_date, year, source_file, geom)
                VALUES (
                  %s, %s, %s, %s,
                  ST_SetSRID(ST_MakePoint(%s, %s), 4326)
                )
                """,
                rows,
            )
        inserted = len(rows)

    tagged, untagged = tag_counties(conn)
    print_counts(
        "county point-in-polygon",
        resolved=tagged,
        outside_all_polygons=untagged,
        total=inserted,
    )

    final = table_count(conn, "wildfire.cpuc_ignitions")
    print_counts("loaded", inserted=inserted, table_count=final)
    return final


def load_with_time(conn: psycopg.Connection, settings: Settings) -> int:
    path = settings.dataset_demo_data_dir / "cpuc_ignitions.csv"
    print_step(f"cpuc_ignitions_with_time ← {path}")
    with path.open(newline="", encoding="utf-8") as f:
        raw = list(csv.DictReader(f))
    print_counts("read", rows=len(raw))

    rows = []
    for r in raw:
        rows.append(
            (
                parse_date(r["date"]),
                parse_time_hhmm(r.get("time")),
                int(r["year"]),
                blank_to_none(r.get("name")),
                float(r["lon"]),
                float(r["lat"]),
            )
        )

    with conn.transaction():
        truncate(conn, "wildfire.cpuc_ignitions_with_time")
        with conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO wildfire.cpuc_ignitions_with_time
                  (event_date, event_time, year, label, geom)
                VALUES (
                  %s, %s, %s, %s,
                  ST_SetSRID(ST_MakePoint(%s, %s), 4326)
                )
                """,
                rows,
            )
        inserted = len(rows)

    final = table_count(conn, "wildfire.cpuc_ignitions_with_time")
    print_counts("loaded", inserted=inserted, table_count=final)
    print(
        "  note: membership differs from cpuc_ignitions by ~180 rows each way; "
        "tables are intentionally not reconciled."
    )
    return final


def tag_counties(conn: psycopg.Connection) -> tuple[int, int]:
    """Populate cpuc_ignitions.county from wildfire.counties via ST_Covers.

    Runs on every combined-table reload. Points that miss every polygon stay NULL.
    """
    county_n = table_count(conn, "wildfire.counties")
    if county_n == 0:
        raise RuntimeError(
            "wildfire.counties is empty; load county polygons before tagging CPUC points"
        )
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE wildfire.cpuc_ignitions i
            SET county = s.name
            FROM (
              SELECT DISTINCT ON (i2.id) i2.id, c.name
              FROM wildfire.cpuc_ignitions i2
              JOIN wildfire.counties c ON ST_Covers(c.geom, i2.geom)
              ORDER BY i2.id, c.geoid
            ) s
            WHERE i.id = s.id
            """
        )
        cur.execute(
            """
            SELECT
              count(*) FILTER (WHERE county IS NOT NULL) AS tagged,
              count(*) FILTER (WHERE county IS NULL) AS untagged
            FROM wildfire.cpuc_ignitions
            """
        )
        row = cur.fetchone()
    return int(row[0]), int(row[1])
