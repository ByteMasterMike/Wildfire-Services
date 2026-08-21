"""One-off PostGIS comparison: CPUC vs CAL FIRE vs US ignitions (California).

Queries live warehouse tables via shared.db. Writes JSON results next to this
script. Does not modify warehouse data.

Run from repo root (PowerShell):
  $env:PYTHONPATH='.'
  $env:PYTHONIOENCODING='utf-8'
  python analysis/compare_cpuc_calfire_us.py
"""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

from shared.db import connect, get_settings

OUT = Path(__file__).resolve().with_name("compare_cpuc_calfire_us_results.json")

DISTANCES_M = (1000, 5000, 10000)
TIME_WINDOWS_D = (1, 3, 7)
LOOSE_M = 10000
LOOSE_D = 7
MID_M = 5000
MID_D = 3

# Pre-specified contrasting counties (Census NAME, no "County" suffix).
COUNTIES = [
    "Sacramento",
    "Los Angeles",
    "Butte",
    "Lake",
    "Imperial",
    "San Francisco",
]


def json_default(obj):
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, (date, datetime)):
        return obj.isoformat()
    if isinstance(obj, set):
        return sorted(obj)
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


def scalar(cur, sql, params=None):
    cur.execute(sql, params or ())
    row = cur.fetchone()
    return row[0] if row else None


def pct(n, d):
    return None if not d else round(100.0 * n / d, 2)


def overlap_years(a_years, b_years):
    common = sorted(set(a_years) & set(b_years))
    return common


def main() -> None:
    settings = get_settings()
    conn = connect(settings)
    conn.execute("SET statement_timeout = '15min'")
    cur = conn.cursor()
    results: dict = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "connection": settings.safe_target,
        "filters_legend": {
            "cpuc": (
                "wildfire.cpuc_ignitions; already CA-scoped utility-attributed "
                "ignitions from cpuc_fire_incidents_combined.csv; county via "
                "ST_Covers vs wildfire.counties (Census TIGER CA, STATEFP=06)"
            ),
            "calfire_default": (
                "wildfire.calfire_incidents WHERE incident_type IN "
                "('Wildfire','Fire') (null types excluded)"
            ),
            "calfire_all": "wildfire.calfire_incidents, all incident_type including NULL",
            "calfire_untyped": "wildfire.calfire_incidents WHERE incident_type IS NULL",
            "us_all": "wildfire.us_ignitions (CONUS positives; synthetic controls excluded at extract)",
            "us_ca": (
                "US ignitions with ST_Covers(wildfire.counties.geom, us.geom); "
                "same PIP as CPUC county tagging. No state column on the table."
            ),
            "dates": {
                "cpuc": "event_date",
                "us": "event_date (first Wildfire=Yes day of 75-day sequence)",
                "calfire": "date_only_created (incident_dateonly_created; 1970-01-01 sentinels are NULL)",
            },
        },
    }

    print("=== 0. schema / columns ===")
    results["columns"] = {}
    for table in (
        "cpuc_ignitions",
        "calfire_incidents",
        "us_ignitions",
        "counties",
    ):
        results["columns"][table] = fetchall(
            cur,
            """
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'wildfire' AND table_name = %s
            ORDER BY ordinal_position
            """,
            (table,),
        )

    print("=== 1. cross-checks (known figures) ===")
    cross = {}
    cross["us_total"] = int(scalar(cur, "SELECT count(*) FROM wildfire.us_ignitions"))
    cross["cpuc_total"] = int(scalar(cur, "SELECT count(*) FROM wildfire.cpuc_ignitions"))
    cross["cpuc_county_resolved"] = int(
        scalar(cur, "SELECT count(*) FROM wildfire.cpuc_ignitions WHERE county IS NOT NULL")
    )
    cross["cpuc_county_null"] = int(
        scalar(cur, "SELECT count(*) FROM wildfire.cpuc_ignitions WHERE county IS NULL")
    )
    cross["pge_2024_attribute"] = int(
        scalar(
            cur,
            "SELECT count(*) FROM wildfire.cpuc_ignitions WHERE utility = 'PGE' AND year = 2024",
        )
    )
    cross["pge_2024_spatial"] = int(
        scalar(
            cur,
            """
            SELECT count(*)
            FROM wildfire.cpuc_ignitions i
            JOIN wildfire.iou_territories t
              ON t.utility = 'PGE' AND ST_Within(i.geom, t.geom)
            WHERE i.year = 2024
            """,
        )
    )
    cross["calfire_total"] = int(scalar(cur, "SELECT count(*) FROM wildfire.calfire_incidents"))
    cross["calfire_wildfire_fire"] = int(
        scalar(
            cur,
            """
            SELECT count(*) FROM wildfire.calfire_incidents
            WHERE incident_type IN ('Wildfire', 'Fire')
            """,
        )
    )
    cross["calfire_null_incident_type"] = int(
        scalar(
            cur,
            "SELECT count(*) FROM wildfire.calfire_incidents WHERE incident_type IS NULL",
        )
    )
    cross["calfire_null_utility"] = int(
        scalar(
            cur,
            "SELECT count(*) FROM wildfire.calfire_incidents WHERE utility IS NULL",
        )
    )
    cross["counties_n"] = int(scalar(cur, "SELECT count(*) FROM wildfire.counties"))
    cross["counties_statefp"] = fetchall(
        cur, "SELECT statefp, count(*) AS n FROM wildfire.counties GROUP BY statefp"
    )
    results["cross_checks"] = cross
    print(
        f"  US total={cross['us_total']} (expect ~33457); "
        f"PGE 2024 attr={cross['pge_2024_attribute']} (expect ~532) "
        f"spatial={cross['pge_2024_spatial']} (expect ~536); "
        f"CAL FIRE null type={cross['calfire_null_incident_type']} (expect 1234)"
    )

    print("=== 2. completeness (geom / dates) ===")
    completeness = {
        "cpuc": fetchone(
            cur,
            """
            SELECT
              count(*) AS n,
              count(*) FILTER (WHERE geom IS NULL) AS geom_null,
              count(*) FILTER (WHERE event_date IS NULL) AS date_null,
              min(event_date) AS min_date,
              max(event_date) AS max_date,
              min(year) AS min_year,
              max(year) AS max_year
            FROM wildfire.cpuc_ignitions
            """,
        ),
        "calfire": fetchone(
            cur,
            """
            SELECT
              count(*) AS n,
              count(*) FILTER (WHERE geom IS NULL) AS geom_null,
              count(*) FILTER (WHERE date_only_created IS NULL) AS date_only_created_null,
              count(*) FILTER (WHERE date_created IS NULL) AS date_created_null,
              min(date_only_created) AS min_date_only_created,
              max(date_only_created) AS max_date_only_created,
              min(date_created) AS min_date_created,
              max(date_created) AS max_date_created
            FROM wildfire.calfire_incidents
            """,
        ),
        "us": fetchone(
            cur,
            """
            SELECT
              count(*) AS n,
              count(*) FILTER (WHERE geom IS NULL) AS geom_null,
              count(*) FILTER (WHERE event_date IS NULL) AS date_null,
              min(event_date) AS min_date,
              max(event_date) AS max_date,
              min(year) AS min_year,
              max(year) AS max_year
            FROM wildfire.us_ignitions
            """,
        ),
    }
    results["completeness"] = completeness

    print("=== 3. CAL FIRE type / acres / county text ===")
    results["calfire_types"] = fetchall(
        cur,
        """
        SELECT COALESCE(incident_type, '<NULL>') AS incident_type, count(*) AS n
        FROM wildfire.calfire_incidents
        GROUP BY incident_type
        ORDER BY n DESC
        """,
    )
    results["calfire_acres"] = fetchone(
        cur,
        """
        SELECT
          count(*) FILTER (WHERE incident_type IN ('Wildfire','Fire')) AS n_default,
          count(*) FILTER (
            WHERE incident_type IN ('Wildfire','Fire') AND acres_burned IS NULL
          ) AS acres_null,
          count(*) FILTER (
            WHERE incident_type IN ('Wildfire','Fire') AND acres_burned = 0
          ) AS acres_zero,
          count(*) FILTER (
            WHERE incident_type IN ('Wildfire','Fire') AND acres_burned > 0
              AND acres_burned < 10
          ) AS acres_0_10,
          count(*) FILTER (
            WHERE incident_type IN ('Wildfire','Fire') AND acres_burned >= 10
              AND acres_burned < 100
          ) AS acres_10_100,
          count(*) FILTER (
            WHERE incident_type IN ('Wildfire','Fire') AND acres_burned >= 100
          ) AS acres_ge_100,
          percentile_cont(0.5) WITHIN GROUP (
            ORDER BY acres_burned
          ) FILTER (WHERE incident_type IN ('Wildfire','Fire')) AS median_acres,
          percentile_cont(0.5) WITHIN GROUP (
            ORDER BY acres_burned
          ) FILTER (
            WHERE incident_type IN ('Wildfire','Fire') AND acres_burned > 0
          ) AS median_acres_positive
        FROM wildfire.calfire_incidents
        """,
    )
    results["cpuc_utilities"] = fetchall(
        cur,
        """
        SELECT utility, count(*) AS n
        FROM wildfire.cpuc_ignitions
        GROUP BY utility
        ORDER BY n DESC
        """,
    )
    results["calfire_county_text_samples"] = fetchall(
        cur,
        """
        SELECT county, count(*) AS n
        FROM wildfire.calfire_incidents
        WHERE incident_type IN ('Wildfire','Fire')
        GROUP BY county
        ORDER BY n DESC
        LIMIT 20
        """,
    )
    results["calfire_multi_county_text"] = int(
        scalar(
            cur,
            """
            SELECT count(*) FROM wildfire.calfire_incidents
            WHERE incident_type IN ('Wildfire','Fire')
              AND county IS NOT NULL
              AND (position(',' in county) > 0 OR county ILIKE '%% and %%')
            """,
        )
    )

    print("=== 4. US California PIP (ST_Covers vs counties) ===")
    us_ca = fetchone(
        cur,
        """
        SELECT
          (SELECT count(*) FROM wildfire.us_ignitions) AS us_total,
          count(*) FILTER (WHERE covered) AS ca_covers,
          count(*) FILTER (WHERE intersects AND NOT covered) AS ca_intersects_not_covers,
          count(*) FILTER (WHERE NOT intersects) AS outside_ca_counties
        FROM (
          SELECT
            u.id,
            EXISTS (
              SELECT 1 FROM wildfire.counties c WHERE ST_Covers(c.geom, u.geom)
            ) AS covered,
            EXISTS (
              SELECT 1 FROM wildfire.counties c WHERE ST_Intersects(c.geom, u.geom)
            ) AS intersects
          FROM wildfire.us_ignitions u
        ) t
        """,
    )
    results["us_california_pip"] = us_ca
    print(
        f"  US CA ST_Covers={us_ca['ca_covers']} / {us_ca['us_total']} "
        f"({pct(us_ca['ca_covers'], us_ca['us_total'])}%); "
        f"intersects-not-covers={us_ca['ca_intersects_not_covers']}"
    )
    results["us_ca_by_year"] = fetchall(
        cur,
        """
        SELECT u.year, count(*) AS n
        FROM wildfire.us_ignitions u
        WHERE EXISTS (
          SELECT 1 FROM wildfire.counties c WHERE ST_Covers(c.geom, u.geom)
        )
        GROUP BY u.year
        ORDER BY u.year
        """,
    )
    results["established_us_ca_state_pip"] = {
        "source": "data/north_america/_us_ignitions_state_breakdown.json",
        "method": "point-in-polygon vs PublicaMundi us-states.geojson + 0.5° nearest fallback",
        "overall_ca": 13432,
        "overall_total": 33457,
        "overall_share": 0.4015,
        "y2024_ca": 2225,
        "y2024_total": 3789,
        "y2024_share": 0.5872,
        "note": (
            "Re-measured below with ST_Covers vs wildfire.counties (cartographic "
            "CA counties). Expect a small difference vs state-polygon + nearest fallback."
        ),
    }

    print("=== 5. yearly frequency ===")
    yearly = fetchall(
        cur,
        """
        WITH years AS (
          SELECT generate_series(
            LEAST(
              (SELECT min(year) FROM wildfire.cpuc_ignitions),
              (SELECT min(EXTRACT(YEAR FROM date_only_created)::int)
                 FROM wildfire.calfire_incidents WHERE date_only_created IS NOT NULL),
              (SELECT min(year) FROM wildfire.us_ignitions)
            ),
            GREATEST(
              (SELECT max(year) FROM wildfire.cpuc_ignitions),
              (SELECT max(EXTRACT(YEAR FROM date_only_created)::int)
                 FROM wildfire.calfire_incidents WHERE date_only_created IS NOT NULL),
              (SELECT max(year) FROM wildfire.us_ignitions)
            )
          ) AS year
        )
        SELECT
          y.year,
          (SELECT count(*) FROM wildfire.cpuc_ignitions c WHERE c.year = y.year) AS cpuc,
          (SELECT count(*) FROM wildfire.calfire_incidents f
            WHERE EXTRACT(YEAR FROM f.date_only_created)::int = y.year
              AND f.incident_type IN ('Wildfire','Fire')
          ) AS calfire_default,
          (SELECT count(*) FROM wildfire.calfire_incidents f
            WHERE EXTRACT(YEAR FROM f.date_only_created)::int = y.year
          ) AS calfire_all_dated,
          (SELECT count(*) FROM wildfire.calfire_incidents f
            WHERE EXTRACT(YEAR FROM f.date_only_created)::int = y.year
              AND f.incident_type IS NULL
          ) AS calfire_untyped,
          (SELECT count(*) FROM wildfire.us_ignitions u WHERE u.year = y.year) AS us_conus,
          (SELECT count(*) FROM wildfire.us_ignitions u
            WHERE u.year = y.year
              AND EXISTS (
                SELECT 1 FROM wildfire.counties c WHERE ST_Covers(c.geom, u.geom)
              )
          ) AS us_ca
        FROM years y
        ORDER BY y.year
        """,
    )
    results["yearly"] = yearly
    results["calfire_dated_null"] = int(
        scalar(
            cur,
            "SELECT count(*) FROM wildfire.calfire_incidents WHERE date_only_created IS NULL",
        )
    )

    print("=== 6. build match universes (temp geography tables) ===")
    cur.execute(
        """
        CREATE TEMP TABLE m_cpuc AS
        SELECT
          id,
          event_date,
          year,
          county,
          geom::geography AS geog
        FROM wildfire.cpuc_ignitions
        WHERE geom IS NOT NULL AND event_date IS NOT NULL
        """
    )
    cur.execute(
        """
        CREATE TEMP TABLE m_cal AS
        SELECT
          incident_id AS id,
          date_only_created AS event_date,
          EXTRACT(YEAR FROM date_only_created)::int AS year,
          county,
          geom::geography AS geog
        FROM wildfire.calfire_incidents
        WHERE geom IS NOT NULL
          AND date_only_created IS NOT NULL
          AND incident_type IN ('Wildfire', 'Fire')
        """
    )
    cur.execute(
        """
        CREATE TEMP TABLE m_us AS
        SELECT DISTINCT ON (u.id)
          u.id,
          u.event_date,
          u.year,
          c.name AS county,
          u.geom::geography AS geog
        FROM wildfire.us_ignitions u
        JOIN wildfire.counties c ON ST_Covers(c.geom, u.geom)
        ORDER BY u.id, c.geoid
        """
    )
    for tbl in ("m_cpuc", "m_cal", "m_us"):
        cur.execute(f"CREATE INDEX ON {tbl} USING GIST (geog)")
        cur.execute(f"CREATE INDEX ON {tbl} (event_date)")
        cur.execute(f"CREATE INDEX ON {tbl} (year)")
        cur.execute(f"ANALYZE {tbl}")
    universes = {
        "cpuc": int(scalar(cur, "SELECT count(*) FROM m_cpuc")),
        "calfire_default_dated": int(scalar(cur, "SELECT count(*) FROM m_cal")),
        "us_ca": int(scalar(cur, "SELECT count(*) FROM m_us")),
    }
    results["match_universes"] = universes
    print(f"  universes: {universes}")

    cpuc_years = [int(r["year"]) for r in fetchall(cur, "SELECT DISTINCT year FROM m_cpuc")]
    cal_years = [int(r["year"]) for r in fetchall(cur, "SELECT DISTINCT year FROM m_cal")]
    us_years = [int(r["year"]) for r in fetchall(cur, "SELECT DISTINCT year FROM m_us")]
    pair_windows = {
        "cpuc_calfire": overlap_years(cpuc_years, cal_years),
        "cpuc_us": overlap_years(cpuc_years, us_years),
        "calfire_us": overlap_years(cal_years, us_years),
    }
    results["pair_year_windows"] = pair_windows

    def universe_in_years(table: str, years: list[int]) -> int:
        if not years:
            return 0
        return int(
            scalar(
                cur,
                f"SELECT count(*) FROM {table} WHERE year = ANY(%s)",
                (years,),
            )
        )

    pair_defs = [
        ("cpuc_calfire", "m_cpuc", "m_cal", "cpuc", "calfire"),
        ("cpuc_us", "m_cpuc", "m_us", "cpuc", "us_ca"),
        ("calfire_us", "m_cal", "m_us", "calfire", "us_ca"),
    ]

    print("=== 7. spatial-temporal pair dumps (10 km, ±7 d) then grid in Python ===")
    matching = {}
    for pair_name, src, dst, src_label, dst_label in pair_defs:
        years = pair_windows[pair_name]
        n_src = universe_in_years(src, years)
        n_dst = universe_in_years(dst, years)
        print(
            f"  {pair_name}: years {years[0]}–{years[-1] if years else 'n/a'} "
            f"n_{src_label}={n_src} n_{dst_label}={n_dst} … joining"
        )
        cur.execute(
            f"""
            SELECT
              a.id::text AS src_id,
              b.id::text AS dst_id,
              ST_Distance(a.geog, b.geog) AS dist_m,
              (b.event_date - a.event_date) AS delta_days
            FROM {src} a
            JOIN {dst} b
              ON ST_DWithin(a.geog, b.geog, %s)
             AND b.event_date BETWEEN a.event_date - %s AND a.event_date + %s
            WHERE a.year = ANY(%s) AND b.year = ANY(%s)
            """,
            (LOOSE_M, LOOSE_D, LOOSE_D, years, years),
        )
        pairs = cur.fetchall()
        print(f"    loose pairs={len(pairs):,}")

        grid = []
        src_best: dict[str, list] = defaultdict(list)
        dst_best: dict[str, list] = defaultdict(list)
        for src_id, dst_id, dist_m, delta_days in pairs:
            dist_m = float(dist_m)
            delta_days = int(delta_days)
            src_best[src_id].append((dist_m, abs(delta_days)))
            dst_best[dst_id].append((dist_m, abs(delta_days)))

        for dist_m in DISTANCES_M:
            for days in TIME_WINDOWS_D:
                src_matched = sum(
                    1
                    for hits in src_best.values()
                    if any(d <= dist_m and t <= days for d, t in hits)
                )
                dst_matched = sum(
                    1
                    for hits in dst_best.values()
                    if any(d <= dist_m and t <= days for d, t in hits)
                )
                grid.append(
                    {
                        "distance_m": dist_m,
                        "time_days": days,
                        f"{src_label}_n": n_src,
                        f"{src_label}_matched": src_matched,
                        f"{src_label}_unmatched": n_src - src_matched,
                        f"{src_label}_match_pct": pct(src_matched, n_src),
                        f"{dst_label}_n": n_dst,
                        f"{dst_label}_matched": dst_matched,
                        f"{dst_label}_unmatched": n_dst - dst_matched,
                        f"{dst_label}_match_pct": pct(dst_matched, n_dst),
                    }
                )

        # Collision diagnostic at mid threshold (many dst per src, many src per dst).
        mid_src_mult = []
        mid_dst_mult = []
        for hits in src_best.values():
            k = sum(1 for d, t in hits if d <= MID_M and t <= MID_D)
            if k:
                mid_src_mult.append(k)
        for hits in dst_best.values():
            k = sum(1 for d, t in hits if d <= MID_M and t <= MID_D)
            if k:
                mid_dst_mult.append(k)

        matching[pair_name] = {
            "year_window": years,
            "year_min": years[0] if years else None,
            "year_max": years[-1] if years else None,
            "src": src_label,
            "dst": dst_label,
            "n_src": n_src,
            "n_dst": n_dst,
            "loose_pair_rows": len(pairs),
            "grid": grid,
            "mid_threshold": {
                "distance_m": MID_M,
                "time_days": MID_D,
                "src_with_any_match": len(mid_src_mult),
                "dst_with_any_match": len(mid_dst_mult),
                "src_match_mean_partners": (
                    round(sum(mid_src_mult) / len(mid_src_mult), 2) if mid_src_mult else None
                ),
                "dst_match_mean_partners": (
                    round(sum(mid_dst_mult) / len(mid_dst_mult), 2) if mid_dst_mult else None
                ),
                "src_with_gt1_partner": sum(1 for k in mid_src_mult if k > 1),
                "dst_with_gt1_partner": sum(1 for k in mid_dst_mult if k > 1),
            },
        }

    results["matching"] = matching

    print("=== 8. county slices (spatial PIP for all three) ===")
    # CAL FIRE county via ST_Covers against wildfire.counties, not incident_county text.
    cur.execute(
        """
        CREATE TEMP TABLE m_cal_county AS
        SELECT DISTINCT ON (f.incident_id)
          f.incident_id AS id,
          f.date_only_created AS event_date,
          EXTRACT(YEAR FROM f.date_only_created)::int AS year,
          c.name AS county
        FROM wildfire.calfire_incidents f
        JOIN wildfire.counties c ON ST_Covers(c.geom, f.geom)
        WHERE f.geom IS NOT NULL
          AND f.date_only_created IS NOT NULL
          AND f.incident_type IN ('Wildfire', 'Fire')
        ORDER BY f.incident_id, c.geoid
        """
    )
    cal_spatial_county_n = int(scalar(cur, "SELECT count(*) FROM m_cal_county"))
    cal_default_dated = universes["calfire_default_dated"]
    results["calfire_spatial_county_coverage"] = {
        "default_dated": cal_default_dated,
        "assigned_via_ST_Covers": cal_spatial_county_n,
        "unassigned": cal_default_dated - cal_spatial_county_n,
        "note": (
            "CAL FIRE incident_county text can list multiple counties; "
            "county tables below use ST_Covers vs Census polygons for all three datasets."
        ),
    }

    # Three-way overlap years for county tables.
    three_years = sorted(set(cpuc_years) & set(cal_years) & set(us_years))
    results["three_way_year_window"] = three_years

    county_rows = []
    for name in COUNTIES:
        row = {
            "county": name,
            "year_min": three_years[0] if three_years else None,
            "year_max": three_years[-1] if three_years else None,
        }
        row["cpuc"] = int(
            scalar(
                cur,
                "SELECT count(*) FROM m_cpuc WHERE county = %s AND year = ANY(%s)",
                (name, three_years),
            )
        )
        row["calfire_spatial"] = int(
            scalar(
                cur,
                "SELECT count(*) FROM m_cal_county WHERE county = %s AND year = ANY(%s)",
                (name, three_years),
            )
        )
        row["us_ca"] = int(
            scalar(
                cur,
                "SELECT count(*) FROM m_us WHERE county = %s AND year = ANY(%s)",
                (name, three_years),
            )
        )
        row["calfire_text_exact"] = int(
            scalar(
                cur,
                """
                SELECT count(*) FROM wildfire.calfire_incidents
                WHERE incident_type IN ('Wildfire','Fire')
                  AND date_only_created IS NOT NULL
                  AND EXTRACT(YEAR FROM date_only_created)::int = ANY(%s)
                  AND county = %s
                """,
                (three_years, name),
            )
        )
        row["cpuc_to_calfire_ratio"] = (
            round(row["cpuc"] / row["calfire_spatial"], 3) if row["calfire_spatial"] else None
        )
        row["us_to_calfire_ratio"] = (
            round(row["us_ca"] / row["calfire_spatial"], 3) if row["calfire_spatial"] else None
        )
        county_rows.append(row)
    results["counties"] = county_rows

    # Statewide ratios on the same window for comparison.
    statewide = {
        "year_min": three_years[0] if three_years else None,
        "year_max": three_years[-1] if three_years else None,
        "cpuc": universe_in_years("m_cpuc", three_years),
        "calfire_default": universe_in_years("m_cal", three_years),
        "us_ca": universe_in_years("m_us", three_years),
    }
    statewide["cpuc_to_calfire_ratio"] = (
        round(statewide["cpuc"] / statewide["calfire_default"], 3)
        if statewide["calfire_default"]
        else None
    )
    statewide["us_to_calfire_ratio"] = (
        round(statewide["us_ca"] / statewide["calfire_default"], 3)
        if statewide["calfire_default"]
        else None
    )
    results["statewide_three_way"] = statewide

    # County-level match at mid threshold (CPUC→CAL FIRE and US→CAL FIRE).
    print("=== 9. county match rates at 5 km / ±3 d ===")
    county_match = []
    for name in COUNTIES:
        years = three_years
        n_cpuc = int(
            scalar(
                cur,
                "SELECT count(*) FROM m_cpuc WHERE county = %s AND year = ANY(%s)",
                (name, years),
            )
        )
        n_us = int(
            scalar(
                cur,
                "SELECT count(*) FROM m_us WHERE county = %s AND year = ANY(%s)",
                (name, years),
            )
        )
        n_cal = int(
            scalar(
                cur,
                "SELECT count(*) FROM m_cal_county WHERE county = %s AND year = ANY(%s)",
                (name, years),
            )
        )
        cpuc_m = int(
            scalar(
                cur,
                """
                SELECT count(*) FROM m_cpuc a
                WHERE a.county = %s AND a.year = ANY(%s)
                  AND EXISTS (
                    SELECT 1 FROM m_cal b
                    WHERE ST_DWithin(a.geog, b.geog, %s)
                      AND b.event_date BETWEEN a.event_date - %s AND a.event_date + %s
                      AND b.year = ANY(%s)
                  )
                """,
                (name, years, MID_M, MID_D, MID_D, years),
            )
        )
        us_m = int(
            scalar(
                cur,
                """
                SELECT count(*) FROM m_us a
                WHERE a.county = %s AND a.year = ANY(%s)
                  AND EXISTS (
                    SELECT 1 FROM m_cal b
                    WHERE ST_DWithin(a.geog, b.geog, %s)
                      AND b.event_date BETWEEN a.event_date - %s AND a.event_date + %s
                      AND b.year = ANY(%s)
                  )
                """,
                (name, years, MID_M, MID_D, MID_D, years),
            )
        )
        county_match.append(
            {
                "county": name,
                "distance_m": MID_M,
                "time_days": MID_D,
                "cpuc_n": n_cpuc,
                "cpuc_matched_to_calfire": cpuc_m,
                "cpuc_match_pct": pct(cpuc_m, n_cpuc),
                "us_n": n_us,
                "us_matched_to_calfire": us_m,
                "us_match_pct": pct(us_m, n_us),
                "calfire_spatial_n": n_cal,
            }
        )
    results["county_match_mid"] = county_match

    print("=== 10. sampling-rate inputs ===")
    results["sampling_rate"] = {
        "definition": (
            "Estimate only: US CA count / CAL FIRE default (Wildfire/Fire, dated) "
            "in the three-way overlapping year window. CAL FIRE is not a perfect "
            "census. US table is positives-only (synthetic controls dropped at extract)."
        ),
        "year_window": three_years,
        "us_ca": statewide["us_ca"],
        "calfire_default": statewide["calfire_default"],
        "ratio": statewide["us_to_calfire_ratio"],
        "us_events_vs_controls": (
            "Loaded wildfire.us_ignitions contains positive sequences only. "
            "extract_us_ignitions.py drops negatives (0 Yes days) and full-sentinel "
            "sequences. Unique (lat, lon, event_date). Cannot distinguish controls "
            "in the loaded table because they were never inserted."
        ),
    }

    OUT.write_text(json.dumps(results, indent=2, default=json_default), encoding="utf-8")
    print(f"\nwrote {OUT}")
    conn.close()


if __name__ == "__main__":
    main()
