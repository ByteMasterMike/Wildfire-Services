"""SQL query helpers for the data query service."""

from __future__ import annotations

from datetime import date
from typing import Any

import psycopg
from psycopg.rows import dict_row


def _fetch_page(
    conn: psycopg.Connection,
    select_sql: str,
    count_sql: str,
    params: list[Any],
    *,
    limit: int | None,
    offset: int | None,
) -> tuple[list[dict[str, Any]], int]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(count_sql, params)
        total = int(cur.fetchone()["count"])
        if limit is not None:
            page_sql = select_sql + " LIMIT %s OFFSET %s"
            cur.execute(page_sql, params + [limit, offset or 0])
        else:
            cur.execute(select_sql, params)
        rows = list(cur.fetchall())
    return rows, total


def _bbox_clause(alias: str, bbox: tuple[float, float, float, float] | None, params: list) -> str:
    if bbox is None:
        return ""
    min_lon, min_lat, max_lon, max_lat = bbox
    params.extend([min_lon, min_lat, max_lon, max_lat])
    return f" AND {alias}.geom && ST_MakeEnvelope(%s, %s, %s, %s, 4326)"


def table_counts(conn: psycopg.Connection) -> dict[str, int]:
    tables = [
        "circuits",
        "epss_outages",
        "psps_events",
        "psps_event_circuits",
        "cpuc_ignitions",
        "calfire_incidents",
        "hftd_tiers",
        "iou_territories",
        "counties",
        "grid_cells",
    ]
    out: dict[str, int] = {}
    with conn.cursor() as cur:
        for t in tables:
            cur.execute(f"SELECT count(*) FROM wildfire.{t}")
            out[t] = int(cur.fetchone()[0])
    return out


def null_utility_count(conn: psycopg.Connection) -> int:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT count(*) FROM wildfire.calfire_incidents WHERE utility IS NULL"
        )
        return int(cur.fetchone()[0])


def null_incident_type_count(conn: psycopg.Connection) -> int:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT count(*) FROM wildfire.calfire_incidents WHERE incident_type IS NULL"
        )
        return int(cur.fetchone()[0])


# ---- Ignitions (CPUC combined) ----

def query_ignitions(
    conn: psycopg.Connection,
    *,
    utility: str | None,
    include_untagged: bool,
    year: int | None,
    start_date: date | None,
    end_date: date | None,
    county: str | None,
    bbox: tuple[float, float, float, float] | None,
    limit: int,
    offset: int,
) -> tuple[list[dict[str, Any]], int]:
    where = ["TRUE"]
    params: list[Any] = []
    if utility == "untagged":
        where.append("i.utility IS NULL")
    elif utility is not None:
        if include_untagged:
            where.append("(i.utility = %s OR i.utility IS NULL)")
            params.append(utility)
        else:
            where.append("i.utility = %s")
            params.append(utility)
    if year is not None:
        where.append("i.year = %s")
        params.append(year)
    if start_date is not None:
        where.append("i.event_date >= %s")
        params.append(start_date)
    if end_date is not None:
        where.append("i.event_date <= %s")
        params.append(end_date)
    if county is not None:
        where.append("lower(i.county) = lower(%s)")
        params.append(county)
    where_sql = " AND ".join(where) + _bbox_clause("i", bbox, params)

    select_sql = f"""
        SELECT i.id, i.utility, i.event_date, i.year, i.source_file, i.county,
               ST_Y(i.geom)::double precision AS latitude,
               ST_X(i.geom)::double precision AS longitude,
               ST_AsGeoJSON(i.geom) AS _geom_geojson
        FROM wildfire.cpuc_ignitions i
        WHERE {where_sql}
        ORDER BY i.event_date, i.id
    """
    count_sql = f"SELECT count(*) AS count FROM wildfire.cpuc_ignitions i WHERE {where_sql}"
    return _fetch_page(conn, select_sql, count_sql, params, limit=limit, offset=offset)


def query_us_ignitions(
    conn: psycopg.Connection,
    *,
    year: int | None,
    start_date: date | None,
    end_date: date | None,
    bbox: tuple[float, float, float, float] | None,
    limit: int,
    offset: int,
) -> tuple[list[dict[str, Any]], int]:
    where = ["TRUE"]
    params: list[Any] = []
    if year is not None:
        where.append("u.year = %s")
        params.append(year)
    if start_date is not None:
        where.append("u.event_date >= %s")
        params.append(start_date)
    if end_date is not None:
        where.append("u.event_date <= %s")
        params.append(end_date)
    where_sql = " AND ".join(where) + _bbox_clause("u", bbox, params)
    select_sql = f"""
        SELECT u.id, u.event_date, u.year, u.latitude, u.longitude,
               u.pr, u.rmax, u.rmin, u.sph, u.srad, u.tmmn, u.tmmx, u.vs,
               u.bi, u.fm100, u.fm1000, u.erc, u.etr, u.pet, u.vpd,
               ST_AsGeoJSON(u.geom) AS _geom_geojson
        FROM wildfire.us_ignitions u
        WHERE {where_sql}
        ORDER BY u.event_date, u.id
    """
    count_sql = f"SELECT count(*) AS count FROM wildfire.us_ignitions u WHERE {where_sql}"
    return _fetch_page(conn, select_sql, count_sql, params, limit=limit, offset=offset)


# ---- EPSS ----

def query_epss(
    conn: psycopg.Connection,
    *,
    circuit_id: str | None,
    utility: str | None,
    county: str | None,
    year: int | None,
    start_date: date | None,
    end_date: date | None,
    outage_type: str | None,
    cause: str | None,
    bbox: tuple[float, float, float, float] | None,
    limit: int,
    offset: int,
) -> tuple[list[dict[str, Any]], int, dict[str, Any]]:
    notes: dict[str, Any] = {"dataset_utility": "PGE"}
    # EPSS is PGE-only. Other utilities → empty.
    if utility is not None and utility not in ("PGE", "untagged"):
        notes["empty_reason"] = f"EPSS outages are PG&E-only; utility={utility} matches nothing"
        return [], 0, notes
    if utility == "untagged":
        notes["empty_reason"] = "EPSS rows always have implicit utility PGE; untagged matches nothing"
        return [], 0, notes

    where = ["TRUE"]
    params: list[Any] = []
    if circuit_id is not None:
        where.append("e.circuit_id = %s")
        params.append(circuit_id)
    if county is not None:
        where.append("lower(e.county) = lower(%s)")
        params.append(county)
    if year is not None:
        where.append("e.year = %s")
        params.append(year)
    if start_date is not None:
        where.append("e.start_date >= %s")
        params.append(start_date)
    if end_date is not None:
        where.append("e.start_date <= %s")
        params.append(end_date)
    if outage_type is not None:
        where.append("e.outage_type = %s")
        params.append(outage_type)
    if cause is not None:
        where.append("e.cause = %s")
        params.append(cause)
    where_sql = " AND ".join(where) + _bbox_clause("e", bbox, params)

    select_sql = f"""
        SELECT e.id, e.circuit_id, e.circuit, e.year, e.start_date, e.end_date,
               e.county, e.cause, e.outage_type, e.division,
               e.customer_minutes, e.restoration_min,
               e.medical_baseline, e.life_support, e.schools, e.hospitals,
               ST_AsGeoJSON(e.geom) AS _geom_geojson
        FROM wildfire.epss_outages e
        WHERE {where_sql}
        ORDER BY e.start_date, e.id
    """
    count_sql = f"SELECT count(*) AS count FROM wildfire.epss_outages e WHERE {where_sql}"
    rows, total = _fetch_page(conn, select_sql, count_sql, params, limit=limit, offset=offset)
    return rows, total, notes


# ---- PSPS ----

def query_psps_events(
    conn: psycopg.Connection,
    *,
    utility: str | None,
    year: int | None,
    start_date: date | None,
    end_date: date | None,
    limit: int,
    offset: int,
) -> tuple[list[dict[str, Any]], int]:
    where = ["TRUE"]
    params: list[Any] = []
    if utility == "untagged":
        where.append("FALSE")  # all events have utility
    elif utility is not None:
        where.append("p.utility = %s")
        params.append(utility)
    if year is not None:
        where.append("p.year = %s")
        params.append(year)
    if start_date is not None:
        where.append("p.deenergization_start_date >= %s")
        params.append(start_date)
    if end_date is not None:
        where.append("p.deenergization_start_date <= %s")
        params.append(end_date)
    where_sql = " AND ".join(where)

    select_sql = f"""
        SELECT p.event_name, p.utility, p.iou_raw, p.first_date_of_poc,
               p.deenergization_start_date, p.full_restoration_date,
               p.de_energization, p.customers_deenergized, p.year,
               ST_AsGeoJSON(p.geom) AS _geom_geojson
        FROM wildfire.psps_events p
        WHERE {where_sql}
        ORDER BY p.deenergization_start_date NULLS LAST, p.event_name
    """
    count_sql = f"SELECT count(*) AS count FROM wildfire.psps_events p WHERE {where_sql}"
    return _fetch_page(conn, select_sql, count_sql, params, limit=limit, offset=offset)


def query_psps_event_circuits(
    conn: psycopg.Connection, event_name: str
) -> list[dict[str, Any]] | None:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT 1 FROM wildfire.psps_events WHERE event_name = %s",
            (event_name,),
        )
        if cur.fetchone() is None:
            return None
        cur.execute(
            """
            SELECT pec.event_name, pec.circuit_id, pec.circuit_name,
                   (c.circuit_id IS NULL) AS geometry_missing,
                   ST_AsGeoJSON(c.geom) AS _geom_geojson
            FROM wildfire.psps_event_circuits pec
            LEFT JOIN wildfire.circuits c ON c.circuit_id = pec.circuit_id
            WHERE pec.event_name = %s
            ORDER BY pec.circuit_id
            """,
            (event_name,),
        )
        return list(cur.fetchall())


# ---- CAL FIRE ----

def query_calfire(
    conn: psycopg.Connection,
    *,
    utility: str | None,
    include_untagged: bool,
    county: str | None,
    year: int | None,
    start_date: date | None,
    end_date: date | None,
    min_acres: float | None,
    incident_type: str | None,
    limit: int,
    offset: int,
) -> tuple[list[dict[str, Any]], int, dict[str, Any]]:
    where = ["TRUE"]
    params: list[Any] = []
    type_mode = "default_wildfire"

    if incident_type is None or incident_type.strip() == "":
        where.append("c.incident_type IN ('Wildfire', 'Fire')")
        type_mode = "default_wildfire"
    elif incident_type.strip().lower() == "all":
        type_mode = "all"
    elif incident_type.strip().lower() == "untyped":
        where.append("c.incident_type IS NULL")
        type_mode = "untyped"
    else:
        where.append("c.incident_type = %s")
        params.append(incident_type.strip())
        type_mode = "explicit"

    if utility == "untagged":
        where.append("c.utility IS NULL")
    elif utility is not None:
        if include_untagged:
            where.append("(c.utility = %s OR c.utility IS NULL)")
            params.append(utility)
        else:
            where.append("c.utility = %s")
            params.append(utility)

    if county is not None:
        where.append("lower(c.county) = lower(%s)")
        params.append(county)
    if year is not None:
        where.append("EXTRACT(YEAR FROM c.date_only_created) = %s")
        params.append(year)
    if start_date is not None:
        where.append("c.date_only_created >= %s")
        params.append(start_date)
    if end_date is not None:
        where.append("c.date_only_created <= %s")
        params.append(end_date)
    if min_acres is not None:
        where.append("c.acres_burned >= %s")
        params.append(min_acres)

    where_sql = " AND ".join(where)
    select_sql = f"""
        SELECT c.incident_id, c.incident_name, c.incident_type, c.acres_burned,
               c.containment, c.county, c.location, c.utility,
               c.date_only_created, c.date_created, c.is_final, c.is_active,
               c.is_calfire_incident, c.incident_url,
               ST_AsGeoJSON(c.geom) AS _geom_geojson
        FROM wildfire.calfire_incidents c
        WHERE {where_sql}
        ORDER BY c.date_only_created NULLS LAST, c.incident_id
    """
    count_sql = (
        f"SELECT count(*) AS count FROM wildfire.calfire_incidents c WHERE {where_sql}"
    )
    rows, total = _fetch_page(conn, select_sql, count_sql, params, limit=limit, offset=offset)
    extra = {
        "incident_type_mode": type_mode,
        "null_incident_type_count": null_incident_type_count(conn),
        "null_utility_records_in_table": null_utility_count(conn),
    }
    return rows, total, extra


# ---- Circuits / HFTD / IOU ----

def query_circuits(
    conn: psycopg.Connection,
    *,
    circuit_id: str | None,
    division: str | None,
    substation: str | None,
    limit: int,
    offset: int,
) -> tuple[list[dict[str, Any]], int]:
    where = ["TRUE"]
    params: list[Any] = []
    if circuit_id is not None:
        where.append("c.circuit_id = %s")
        params.append(circuit_id)
    if division is not None:
        where.append("lower(c.division) = lower(%s)")
        params.append(division)
    if substation is not None:
        where.append("lower(c.substation) = lower(%s)")
        params.append(substation)
    where_sql = " AND ".join(where)
    select_sql = f"""
        SELECT c.circuit_id, c.circuit_name, c.division, c.substation,
               ST_AsGeoJSON(c.geom) AS _geom_geojson
        FROM wildfire.circuits c
        WHERE {where_sql}
        ORDER BY c.circuit_id
    """
    count_sql = f"SELECT count(*) AS count FROM wildfire.circuits c WHERE {where_sql}"
    return _fetch_page(conn, select_sql, count_sql, params, limit=limit, offset=offset)


def get_circuit(conn: psycopg.Connection, circuit_id: str) -> dict[str, Any] | None:
    rows, _ = query_circuits(
        conn, circuit_id=circuit_id, division=None, substation=None, limit=1, offset=0
    )
    return rows[0] if rows else None


def query_hftd(
    conn: psycopg.Connection, *, tier: str | None
) -> list[dict[str, Any]]:
    with conn.cursor(row_factory=dict_row) as cur:
        if tier is None:
            cur.execute(
                """
                SELECT h.tier, h.objectid, h.shape_length, h.shape_area,
                       ST_AsGeoJSON(h.geom) AS _geom_geojson
                FROM wildfire.hftd_tiers h
                ORDER BY h.tier
                """
            )
        else:
            cur.execute(
                """
                SELECT h.tier, h.objectid, h.shape_length, h.shape_area,
                       ST_AsGeoJSON(h.geom) AS _geom_geojson
                FROM wildfire.hftd_tiers h
                WHERE h.tier = %s
                ORDER BY h.tier
                """,
                (tier,),
            )
        return list(cur.fetchall())


def query_iou(
    conn: psycopg.Connection, *, utility: str | None
) -> list[dict[str, Any]]:
    with conn.cursor(row_factory=dict_row) as cur:
        if utility is None:
            cur.execute(
                """
                SELECT i.utility, i.utility_name,
                       ST_AsGeoJSON(i.geom) AS _geom_geojson
                FROM wildfire.iou_territories i
                ORDER BY i.utility
                """
            )
        else:
            cur.execute(
                """
                SELECT i.utility, i.utility_name,
                       ST_AsGeoJSON(i.geom) AS _geom_geojson
                FROM wildfire.iou_territories i
                WHERE i.utility = %s
                ORDER BY i.utility
                """,
                (utility,),
            )
        return list(cur.fetchall())


# ---- Spatial ----

def spatial_point(conn: psycopg.Connection, lat: float, lon: float) -> dict[str, Any]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT
              (SELECT i.utility FROM wildfire.iou_territories i
                 WHERE ST_Contains(i.geom, ST_SetSRID(ST_MakePoint(%s, %s), 4326))
                 LIMIT 1) AS iou_utility,
              (SELECT i.utility_name FROM wildfire.iou_territories i
                 WHERE ST_Contains(i.geom, ST_SetSRID(ST_MakePoint(%s, %s), 4326))
                 LIMIT 1) AS iou_utility_name,
              (SELECT h.tier FROM wildfire.hftd_tiers h
                 WHERE ST_Contains(h.geom, ST_SetSRID(ST_MakePoint(%s, %s), 4326))
                 LIMIT 1) AS hftd_tier,
              (SELECT g.cell_id FROM wildfire.grid_cells g
                 WHERE ST_Contains(g.geom, ST_SetSRID(ST_MakePoint(%s, %s), 4326))
                 LIMIT 1) AS grid_cell_id,
              (SELECT g.row FROM wildfire.grid_cells g
                 WHERE ST_Contains(g.geom, ST_SetSRID(ST_MakePoint(%s, %s), 4326))
                 LIMIT 1) AS grid_row,
              (SELECT g.col FROM wildfire.grid_cells g
                 WHERE ST_Contains(g.geom, ST_SetSRID(ST_MakePoint(%s, %s), 4326))
                 LIMIT 1) AS grid_col,
              (SELECT c.name FROM wildfire.counties c
                 WHERE ST_Covers(c.geom, ST_SetSRID(ST_MakePoint(%s, %s), 4326))
                 ORDER BY c.geoid
                 LIMIT 1) AS county_name
            """,
            (lon, lat, lon, lat, lon, lat, lon, lat, lon, lat, lon, lat, lon, lat),
        )
        row = cur.fetchone() or {}
    county_name = row.get("county_name")
    return {
        "lat": lat,
        "lon": lon,
        "iou": {
            "utility": row.get("iou_utility"),
            "utility_name": row.get("iou_utility_name"),
        },
        "hftd_tier": row.get("hftd_tier"),
        "grid_cell": {
            "cell_id": row.get("grid_cell_id"),
            "row": row.get("grid_row"),
            "col": row.get("grid_col"),
        },
        "county": county_name,
        "meta": {
            "county_unavailable": False,
            "county_source": "census_tiger_pip",
        },
    }


def spatial_summary(
    conn: psycopg.Connection,
    *,
    utility: str | None,
    hftd_tier: str | None,
    start_date: date,
    end_date: date,
) -> dict[str, Any]:
    if (utility is None) == (hftd_tier is None):
        raise ValueError("Provide exactly one of utility or hftd_tier")

    if utility is not None:
        region_kind = "utility"
        region_id = utility
        region_sql = "SELECT geom FROM wildfire.iou_territories WHERE utility = %s"
        region_param: Any = utility
    else:
        region_kind = "hftd_tier"
        region_id = hftd_tier
        region_sql = "SELECT geom FROM wildfire.hftd_tiers WHERE tier = %s"
        region_param = hftd_tier

    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(region_sql, (region_param,))
        if cur.fetchone() is None:
            raise KeyError(f"unknown region {region_kind}={region_id}")

        cur.execute(
            f"""
            WITH region AS (
              {region_sql}
            )
            SELECT
              (SELECT count(*) FROM wildfire.cpuc_ignitions i, region r
                 WHERE ST_Within(i.geom, r.geom)
                   AND i.event_date BETWEEN %s AND %s) AS ignitions,
              (SELECT count(*) FROM wildfire.epss_outages e, region r
                 WHERE ST_Within(e.geom, r.geom)
                   AND e.start_date BETWEEN %s AND %s) AS epss_outages,
              (SELECT count(*) FROM wildfire.calfire_incidents c, region r
                 WHERE ST_Within(c.geom, r.geom)
                   AND c.date_only_created BETWEEN %s AND %s
                   AND c.incident_type IN ('Wildfire', 'Fire')) AS calfire_incidents
            """,
            (
                region_param,
                start_date,
                end_date,
                start_date,
                end_date,
                start_date,
                end_date,
            ),
        )
        counts = cur.fetchone() or {}

    return {
        "region": {"kind": region_kind, "id": region_id},
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "counts": {
            "ignitions": int(counts.get("ignitions") or 0),
            "epss_outages": int(counts.get("epss_outages") or 0),
            "calfire_incidents": int(counts.get("calfire_incidents") or 0),
        },
        "meta": {
            "calfire_incident_type_default": "Wildfire,Fire",
            "calfire_counts_use_spatial_containment": True,
            "null_incident_type_count": null_incident_type_count(conn),
            "null_utility_records_in_table": null_utility_count(conn),
        },
    }
