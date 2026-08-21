"""Load CAL FIRE incidents with cleaning flags."""

from __future__ import annotations

import csv

import psycopg

from db.loaders.config import Settings
from db.loaders.util import (
    blank_to_none,
    parse_bool,
    parse_date_null_sentinel,
    parse_timestamptz,
    parse_timestamptz_null_sentinel,
    print_counts,
    print_step,
    table_count,
    truncate,
)


def _float_or_none(value: str | None) -> float | None:
    value = blank_to_none(value)
    if value is None:
        return None
    return float(value)


def load(conn: psycopg.Connection, settings: Settings) -> int:
    path = settings.dataset_demo_data_dir / "calfire_incidents.csv"
    print_step(f"calfire_incidents ← {path}")
    with path.open(newline="", encoding="utf-8") as f:
        raw = list(csv.DictReader(f))
    print_counts("read", rows=len(raw))

    sentinel_nulls = 0
    blank_utility = 0
    rows = []
    for r in raw:
        date_only_created = parse_date_null_sentinel(r.get("incident_dateonly_created"))
        date_created = parse_timestamptz_null_sentinel(r.get("incident_date_created"))
        if (
            blank_to_none(r.get("incident_dateonly_created"))
            and str(r.get("incident_dateonly_created", "")).startswith("1970-01-01")
        ) or (
            blank_to_none(r.get("incident_date_created"))
            and str(r.get("incident_date_created", "")).startswith("1970-01-01")
        ):
            sentinel_nulls += 1

        utility = blank_to_none(r.get("utility"))
        if utility is None:
            blank_utility += 1

        rows.append(
            (
                r["incident_id"],
                blank_to_none(r.get("incident_name")),
                blank_to_none(r.get("incident_type")),
                _float_or_none(r.get("incident_acres_burned")),
                _float_or_none(r.get("incident_containment")),
                blank_to_none(r.get("incident_control")),
                blank_to_none(r.get("incident_county")),
                blank_to_none(r.get("incident_location")),
                blank_to_none(r.get("incident_administrative_unit")),
                blank_to_none(r.get("incident_cooperating_agencies")),
                utility,
                date_created,
                date_only_created,
                parse_timestamptz(r.get("incident_date_last_update")),
                parse_timestamptz(r.get("incident_date_extinguished")),
                parse_date_null_sentinel(r.get("incident_dateonly_extinguished")),
                parse_bool(r.get("incident_is_final")),
                parse_bool(r.get("is_active")),
                parse_bool(r.get("calfire_incident")),
                parse_bool(r.get("notification_desired")),
                blank_to_none(r.get("incident_url")),
                float(r["incident_longitude"]),
                float(r["incident_latitude"]),
            )
        )

    print_counts(
        "cleaned",
        sentinel_dates_nulled=sentinel_nulls,
        blank_utility_as_null=blank_utility,
    )

    with conn.transaction():
        truncate(conn, "wildfire.calfire_incidents")
        with conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO wildfire.calfire_incidents (
                  incident_id, incident_name, incident_type, acres_burned, containment,
                  control, county, location, administrative_unit, cooperating_agencies,
                  utility, date_created, date_only_created, date_last_update,
                  date_extinguished, date_only_extinguished,
                  is_final, is_active, is_calfire_incident, notification_desired,
                  incident_url, geom
                ) VALUES (
                  %s, %s, %s, %s, %s,
                  %s, %s, %s, %s, %s,
                  %s, %s, %s, %s,
                  %s, %s,
                  %s, %s, %s, %s,
                  %s,
                  ST_SetSRID(ST_MakePoint(%s, %s), 4326)
                )
                """,
                rows,
            )
        inserted = len(rows)

    final = table_count(conn, "wildfire.calfire_incidents")
    print_counts("loaded", inserted=inserted, table_count=final)
    return final
