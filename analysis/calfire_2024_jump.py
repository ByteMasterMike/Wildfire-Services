"""Warehouse + source-CSV diagnostics for the CAL FIRE 2023→2024 count jump.

Does not modify warehouse data. Run from repo root:
  $env:PYTHONPATH='.'
  $env:PYTHONIOENCODING='utf-8'
  python analysis/calfire_2024_jump.py
"""

from __future__ import annotations

import csv
import json
import subprocess
from collections import Counter
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

from shared.db import connect, get_settings

OUT = Path(__file__).resolve().with_name("calfire_2024_jump_results.json")
DEMO = Path(r"C:\AI Coding Projects\dataset_demo")
CSV_PATH = "assets/data/calfire_incidents.csv"
DEFAULT_SQL = "incident_type IN ('Wildfire', 'Fire') AND date_only_created IS NOT NULL"


def json_default(obj):
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, (date, datetime)):
        return obj.isoformat()
    raise TypeError(type(obj))


def fetchall(cur, sql, params=None):
    cur.execute(sql, params or ())
    cols = [d.name for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def fetchone(cur, sql, params=None):
    cur.execute(sql, params or ())
    cols = [d.name for d in cur.description]
    row = cur.fetchone()
    return dict(zip(cols, row)) if row else None


def year_from_created(value: str | None) -> int | None:
    if not value or value.startswith("1970-01-01"):
        return None
    try:
        return int(value[:4])
    except ValueError:
        return None


def csv_year_counts(text: str) -> dict:
    reader = csv.DictReader(text.splitlines())
    years = Counter()
    types = Counter()
    n = 0
    for row in reader:
        n += 1
        y = year_from_created(row.get("incident_dateonly_created") or row.get("incident_date_created"))
        years[y] += 1
        types[row.get("incident_type") or "NULL"] += 1
    return {
        "rows": n,
        "by_year": {str(k): v for k, v in sorted(years.items(), key=lambda kv: (kv[0] is None, kv[0] or 0))},
        "by_type": dict(types),
        "y2023": years.get(2023, 0),
        "y2024": years.get(2024, 0),
    }


def git_show_csv(sha: str) -> str:
    return subprocess.check_output(
        ["git", "show", f"{sha}:{CSV_PATH}"],
        cwd=DEMO,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def main() -> None:
    settings = get_settings()
    out: dict = {
        "queried_at": datetime.now().isoformat(timespec="seconds"),
        "target": settings.safe_target,
        "csv_path": str(settings.dataset_demo_data_dir / "calfire_incidents.csv"),
    }

    with connect() as conn:
        with conn.cursor() as cur:
            out["table_count"] = fetchone(cur, "SELECT count(*) AS n FROM wildfire.calfire_incidents")["n"]
            out["by_year"] = fetchall(
                cur,
                f"""
                SELECT EXTRACT(YEAR FROM date_only_created)::int AS year,
                       count(*) AS all_dated,
                       count(*) FILTER (WHERE incident_type IN ('Wildfire','Fire')) AS default_wf,
                       count(*) FILTER (WHERE incident_type IS NULL) AS untyped,
                       count(*) FILTER (WHERE incident_type IS NOT NULL
                                        AND incident_type NOT IN ('Wildfire','Fire')) AS other_type,
                       count(*) FILTER (WHERE is_calfire_incident IS TRUE) AS calfire_true,
                       count(*) FILTER (WHERE is_calfire_incident IS FALSE) AS calfire_false,
                       count(*) FILTER (WHERE is_calfire_incident IS NULL) AS calfire_null
                FROM wildfire.calfire_incidents
                WHERE date_only_created IS NOT NULL
                GROUP BY 1
                ORDER BY 1
                """,
            )
            out["undated"] = fetchone(
                cur, "SELECT count(*) AS n FROM wildfire.calfire_incidents WHERE date_only_created IS NULL"
            )["n"]
            out["acres"] = fetchall(
                cur,
                f"""
                SELECT EXTRACT(YEAR FROM date_only_created)::int AS year,
                       count(*) AS n,
                       count(acres_burned) AS n_acres,
                       count(*) FILTER (WHERE acres_burned IS NULL) AS acres_null,
                       count(*) FILTER (WHERE acres_burned < 10) AS under_10,
                       count(*) FILTER (WHERE acres_burned < 100) AS under_100,
                       count(*) FILTER (WHERE acres_burned >= 1000) AS ge_1000,
                       percentile_cont(0.10) WITHIN GROUP (ORDER BY acres_burned) AS p10,
                       percentile_cont(0.25) WITHIN GROUP (ORDER BY acres_burned) AS p25,
                       percentile_cont(0.50) WITHIN GROUP (ORDER BY acres_burned) AS median,
                       percentile_cont(0.75) WITHIN GROUP (ORDER BY acres_burned) AS p75,
                       percentile_cont(0.90) WITHIN GROUP (ORDER BY acres_burned) AS p90,
                       avg(acres_burned) AS mean,
                       sum(acres_burned) AS sum_acres
                FROM wildfire.calfire_incidents
                WHERE {DEFAULT_SQL}
                GROUP BY 1
                ORDER BY 1
                """,
            )
            out["acres_2023_vs_2024"] = fetchall(
                cur,
                f"""
                SELECT EXTRACT(YEAR FROM date_only_created)::int AS year,
                       min(acres_burned) FILTER (WHERE acres_burned > 0) AS min_positive,
                       max(acres_burned) AS max_acres
                FROM wildfire.calfire_incidents
                WHERE {DEFAULT_SQL}
                  AND EXTRACT(YEAR FROM date_only_created) IN (2023, 2024)
                GROUP BY 1
                ORDER BY 1
                """,
            )
            out["monthly_default"] = fetchall(
                cur,
                f"""
                SELECT EXTRACT(YEAR FROM date_only_created)::int AS year,
                       EXTRACT(MONTH FROM date_only_created)::int AS month,
                       count(*) AS n
                FROM wildfire.calfire_incidents
                WHERE {DEFAULT_SQL}
                  AND EXTRACT(YEAR FROM date_only_created) IN (2022, 2023, 2024, 2025)
                GROUP BY 1, 2
                ORDER BY 1, 2
                """,
            )
            out["last_update"] = fetchall(
                cur,
                f"""
                SELECT EXTRACT(YEAR FROM date_only_created)::int AS year,
                       count(*) AS n,
                       count(date_last_update) AS n_update,
                       min(date_last_update) AS earliest_update,
                       max(date_last_update) AS latest_update,
                       percentile_cont(0.50) WITHIN GROUP (
                         ORDER BY EXTRACT(EPOCH FROM (date_last_update - date_created)) / 86400.0
                       ) AS median_lag_days,
                       count(*) FILTER (WHERE date_last_update IS NOT NULL
                         AND EXTRACT(YEAR FROM date_last_update) > EXTRACT(YEAR FROM date_only_created)
                       ) AS updated_after_create_year,
                       count(*) FILTER (WHERE date_last_update >= TIMESTAMP '2024-01-01'
                         AND EXTRACT(YEAR FROM date_only_created) = 2023) AS y2023_touched_in_2024_or_later
                FROM wildfire.calfire_incidents
                WHERE {DEFAULT_SQL}
                GROUP BY 1
                ORDER BY 1
                """,
            )
            out["y2023_update_year"] = fetchall(
                cur,
                f"""
                SELECT EXTRACT(YEAR FROM date_last_update)::int AS update_year, count(*) AS n
                FROM wildfire.calfire_incidents
                WHERE {DEFAULT_SQL}
                  AND EXTRACT(YEAR FROM date_only_created) = 2023
                GROUP BY 1
                ORDER BY 1
                """,
            )
            out["types_2023_2024"] = fetchall(
                cur,
                """
                SELECT EXTRACT(YEAR FROM date_only_created)::int AS year,
                       COALESCE(incident_type, 'NULL') AS incident_type,
                       count(*) AS n
                FROM wildfire.calfire_incidents
                WHERE date_only_created IS NOT NULL
                  AND EXTRACT(YEAR FROM date_only_created) IN (2023, 2024)
                GROUP BY 1, 2
                ORDER BY 1, 2
                """,
            )
            out["share_under_10_default"] = fetchall(
                cur,
                f"""
                SELECT EXTRACT(YEAR FROM date_only_created)::int AS year,
                       round(100.0 * count(*) FILTER (WHERE acres_burned < 10)
                             / NULLIF(count(acres_burned), 0), 1) AS pct_under_10,
                       round(100.0 * count(*) FILTER (WHERE acres_burned < 100)
                             / NULLIF(count(acres_burned), 0), 1) AS pct_under_100
                FROM wildfire.calfire_incidents
                WHERE {DEFAULT_SQL}
                  AND EXTRACT(YEAR FROM date_only_created) BETWEEN 2019 AND 2026
                GROUP BY 1
                ORDER BY 1
                """,
            )

    csv_file = settings.dataset_demo_data_dir / "calfire_incidents.csv"
    out["current_csv"] = csv_year_counts(csv_file.read_text(encoding="utf-8"))

    shas = subprocess.check_output(
        ["git", "log", "--format=%h %ad %s", "--date=short", "--", CSV_PATH],
        cwd=DEMO,
        text=True,
        encoding="utf-8",
    ).strip().splitlines()
    snapshots = []
    for line in shas:
        sha, rest = line.split(" ", 1)
        snap = csv_year_counts(git_show_csv(sha))
        snap["sha"] = sha
        snap["git"] = rest
        snapshots.append(snap)
    out["csv_git_snapshots"] = snapshots

    OUT.write_text(json.dumps(out, indent=2, default=json_default) + "\n", encoding="utf-8")
    print(f"wrote {OUT}")
    print(f"table_count={out['table_count']} csv_rows={out['current_csv']['rows']}")
    for row in out["by_year"]:
        if row["year"] in (2022, 2023, 2024, 2025):
            print(
                f"  {row['year']}: default={row['default_wf']} all_dated={row['all_dated']} "
                f"untyped={row['untyped']} other={row['other_type']}"
            )


if __name__ == "__main__":
    main()
