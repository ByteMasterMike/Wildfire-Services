"""Complete, geometry-free aggregates for the analysis workspace."""

from __future__ import annotations

from calendar import monthrange
from datetime import date, timedelta
from typing import Any

import psycopg
from psycopg.rows import dict_row

SOURCES = {
    "cpuc_ignitions": ("cpuc_ignitions", "event_date"),
    "epss_outages": ("epss_outages", "start_date"),
    "calfire_incidents": ("calfire_incidents", "date_only_created"),
    "psps_events": ("psps_events", "deenergization_start_date"),
    "us_ignitions": ("us_ignitions", "event_date"),
}
UTILITY_LABELS = {"PGE": "PG&E", "SDGE": "SDG&E"}


def validate_scope(dataset: str, utility: str | None, county: str | None) -> None:
    if dataset not in SOURCES:
        raise ValueError(f"unsupported aggregate dataset: {dataset}")
    if dataset == "us_ignitions" and (utility or county):
        raise ValueError("US ignitions do not support county or utility filters")
    if dataset == "psps_events" and county:
        raise ValueError("PSPS county filtering is not available")
    if dataset == "epss_outages" and utility not in (None, "PGE"):
        raise ValueError("EPSS data are available for PG&E only")


def _filtered_sql(
    dataset: str, start_date: date, end_date: date,
    utility: str | None, county: str | None,
) -> tuple[str, list[Any]]:
    validate_scope(dataset, utility, county)
    table, date_column = SOURCES[dataset]
    where = [f"{date_column} >= %s", f"{date_column} <= %s"]
    params: list[Any] = [start_date, end_date]
    if dataset == "calfire_incidents":
        where.append("incident_type IN ('Wildfire', 'Fire')")
    if utility and dataset != "epss_outages":
        if utility == "untagged":
            where.append("utility IS NULL")
        else:
            where.append("utility = %s")
            params.append(utility)
    if county:
        where.append("lower(county) = lower(%s)")
        params.append(county)
    utility_sql = (
        "'PG&E'::text" if dataset == "epss_outages" else
        "NULL::text" if dataset == "us_ignitions" else
        "CASE utility WHEN 'PGE' THEN 'PG&E' WHEN 'SDGE' THEN 'SDG&E' ELSE NULLIF(utility, '') END"
    )
    county_sql = "NULLIF(county, '')" if dataset in {"cpuc_ignitions", "epss_outages", "calfire_incidents"} else "NULL::text"
    epss = dataset == "epss_outages"
    columns = {
        "event_date": date_column,
        "utility": utility_sql,
        "county": county_sql,
        "cause": "NULLIF(cause, '')" if epss else "NULL::text",
        "division": "division" if epss else "NULL::text",
        "circuit_id": "NULLIF(circuit_id, '')" if epss else "NULL::text",
        "acres": "acres_burned" if dataset == "calfire_incidents" else "NULL::double precision",
        "customers": "customers_deenergized" if dataset == "psps_events" else "NULL::bigint",
    }
    projection = ", ".join(f"{expression} AS {name}" for name, expression in columns.items())
    return f"SELECT {projection} FROM wildfire.{table} WHERE {' AND '.join(where)}", params


def grouped_counts(
    conn: psycopg.Connection, *, dataset: str, group_by: str,
    start_date: date, end_date: date, utility: str | None, county: str | None,
) -> dict[str, Any]:
    if dataset not in {"cpuc_ignitions", "epss_outages", "calfire_incidents"}:
        raise ValueError("grouped counts support CPUC, EPSS and CAL FIRE")
    if group_by not in {"county", "utility", "cause"}:
        raise ValueError("group_by must be county, utility or cause")
    if group_by == "cause" and dataset != "epss_outages":
        raise ValueError("cause grouping is available only for EPSS")
    source, params = _filtered_sql(dataset, start_date, end_date, utility, county)
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            f"WITH filtered AS ({source}) "
            f"SELECT COALESCE({group_by}, 'Not recorded') AS key, COUNT(*) AS value "
            "FROM filtered GROUP BY 1 ORDER BY value DESC, key ASC", params,
        )
        rows = list(cur.fetchall())
    total = sum(row["value"] for row in rows)
    if group_by == "utility":
        present = {row["key"] for row in rows}
        labels = [UTILITY_LABELS.get(utility, utility)] if utility else ["PG&E", "SCE", "SDG&E"]
        for label in labels:
            if label not in present:
                unavailable = dataset == "epss_outages" and label != "PG&E"
                rows.append({"key": label, "value": None if unavailable else 0})
    return {"dataset": dataset, "group_by": group_by, "rows": rows, "total": total}


def summary(
    conn: psycopg.Connection, *, dataset: str, start_date: date, end_date: date,
    utility: str | None, county: str | None,
) -> dict[str, Any]:
    source, params = _filtered_sql(dataset, start_date, end_date, utility, county)
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            f"""WITH filtered AS ({source})
            SELECT COUNT(*) AS events,
                   COUNT(DISTINCT utility) AS utilities,
                   COUNT(*) FILTER (WHERE utility IS NULL) AS utilities_missing,
                   COUNT(DISTINCT circuit_id) AS circuits,
                   COUNT(*) FILTER (WHERE circuit_id IS NULL) AS circuits_missing,
                   COUNT(*) FILTER (WHERE county IS NULL) AS counties_missing,
                   SUM(acres) AS acres,
                   COUNT(*) FILTER (WHERE acres IS NULL) AS acres_missing,
                   SUM(customers) AS customers,
                   COUNT(*) FILTER (WHERE customers IS NULL) AS customers_missing,
                   (SELECT COUNT(DISTINCT TRIM(name)) FROM filtered
                    CROSS JOIN LATERAL unnest(string_to_array(county, ',')) AS name) AS counties
            FROM filtered""", params,
        )
        row = cur.fetchone()
    total = int(row["events"])
    metrics = [{"id": "events", "value": total, "missing": 0}]
    keys = []
    if dataset == "calfire_incidents":
        keys.append("acres")
    if dataset == "psps_events":
        keys.append("customers")
    if dataset == "epss_outages":
        keys.append("circuits")
    if dataset in {"cpuc_ignitions", "epss_outages", "calfire_incidents"}:
        keys.append("counties")
    if dataset in {"cpuc_ignitions", "psps_events"}:
        keys.append("utilities")
    for key in keys:
        missing = int(row[f"{key}_missing"])
        value = 0 if total == 0 else None if missing == total else row[key]
        metrics.append({"id": key, "value": value, "missing": missing})
    return {"dataset": dataset, "total": total, "metrics": metrics}


def _periods(start: date, end: date, interval: str) -> list[dict[str, Any]]:
    periods = []
    current = start
    while current <= end:
        if interval == "daily":
            key = current
            period_end = current
        elif interval == "weekly":
            first = date(current.year, 1, 1)
            key = first + timedelta(days=((current - first).days // 7) * 7)
            period_end = key + timedelta(days=min(6, (date(current.year, 12, 31) - key).days))
        else:
            month = current.month if interval == "monthly" else ((current.month - 1) // 3) * 3 + 1
            key = date(current.year, month, 1)
            last_month = month + (0 if interval == "monthly" else 2)
            period_end = date(current.year, last_month, monthrange(current.year, last_month)[1])
        period_end = min(end, period_end)
        periods.append({"key": key, "start": current.isoformat(), "end": period_end.isoformat()})
        if period_end == end:
            break
        current = period_end + timedelta(days=1)
    return periods


def regional_series(
    conn: psycopg.Connection, *, start_date: date, end_date: date,
    interval: str, utility: str | None, county: str | None,
) -> dict[str, Any]:
    period_sql = {
        "daily": "event_date",
        "weekly": "date_trunc('year', event_date)::date + ((event_date - date_trunc('year', event_date)::date) / 7) * 7",
        "monthly": "date_trunc('month', event_date)::date",
        "quarterly": "date_trunc('quarter', event_date)::date",
    }
    if interval not in period_sql:
        raise ValueError("interval must be daily, weekly, monthly or quarterly")
    source, params = _filtered_sql("epss_outages", start_date, end_date, utility, county)
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            f"""WITH filtered AS ({source})
            SELECT COALESCE(NULLIF(TRIM(division), ''), 'Not recorded') AS name,
                   {period_sql[interval]} AS period, COUNT(*) AS count
            FROM filtered GROUP BY 1, 2 ORDER BY name, period""", params,
        )
        rows = list(cur.fetchall())
    groups: dict[str, dict[date, int]] = {}
    for row in rows:
        groups.setdefault(row["name"], {})[row["period"]] = int(row["count"])
    periods = _periods(start_date, end_date, interval) if groups else []
    series = []
    for name, counts in groups.items():
        buckets = [{"start": item["start"], "end": item["end"], "count": counts.get(item["key"], 0)} for item in periods]
        series.append({"name": name, "total": sum(counts.values()), "buckets": buckets})
    return {"series": series, "total": sum(item["total"] for item in series), "interval": interval}
