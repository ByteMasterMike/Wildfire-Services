"""Load FireCastRL-derived US ignitions into wildfire.us_ignitions."""

from __future__ import annotations

import csv
from pathlib import Path

import psycopg

from db.loaders.config import Settings
from db.loaders.extract_us_ignitions import COVARIATES, OUT as DEFAULT_EXTRACTED, extract
from db.loaders.util import parse_date, print_counts, print_step, table_count, truncate
from shared.db import REPO_ROOT

DDL = REPO_ROOT / "db" / "schema_us_ignitions.sql"


def ensure_table(conn: psycopg.Connection) -> None:
    sql = DDL.read_text(encoding="utf-8")
    with conn.cursor() as cur:
        cur.execute(sql)
    print(f"  ensured table DDL: {DDL}")


def load(
    conn: psycopg.Connection,
    settings: Settings,
    *,
    extracted_path: Path | None = None,
    reextract: bool = True,
) -> int:
    path = extracted_path or DEFAULT_EXTRACTED
    print_step(f"us_ignitions ← {path}")
    ensure_table(conn)

    if reextract or not path.is_file():
        extract(out=path)
    else:
        print(f"  using existing extract: {path}")

    with path.open(newline="", encoding="utf-8") as f:
        raw = list(csv.DictReader(f))
    print_counts("read_extracted", rows=len(raw))

    cov_cols = ", ".join(COVARIATES)
    cov_placeholders = ", ".join(["%s"] * len(COVARIATES))
    rows = []
    for r in raw:
        event_date = parse_date(r["event_date"])
        assert event_date is not None
        rows.append(
            (
                event_date,
                int(r["year"]),
                float(r["latitude"]),
                float(r["longitude"]),
                *[float(r[c]) for c in COVARIATES],
                float(r["longitude"]),
                float(r["latitude"]),
            )
        )

    with conn.transaction():
        truncate(conn, "wildfire.us_ignitions")
        with conn.cursor() as cur:
            cur.executemany(
                f"""
                INSERT INTO wildfire.us_ignitions
                  (event_date, year, latitude, longitude, {cov_cols}, geom)
                VALUES (
                  %s, %s, %s, %s, {cov_placeholders},
                  ST_SetSRID(ST_MakePoint(%s, %s), 4326)
                )
                """,
                rows,
            )
        inserted = len(rows)

    final = table_count(conn, "wildfire.us_ignitions")
    print_counts("loaded", inserted=inserted, table_count=final)
    print(
        "  note: all-cause IRWIN-derived sample (FireCastRL); "
        "not utility-attributed; not comparable to cpuc_ignitions."
    )
    return final
