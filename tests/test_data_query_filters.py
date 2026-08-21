"""CAL FIRE filters, circuit ID round-trip, PSPS orphans."""

from __future__ import annotations

from urllib.parse import quote

import httpx
import psycopg
import pytest

from tests.conftest import sql_count

REAL_LEADING_ZERO_CIRCUIT = "043371102"
ABSENT_EXAMPLE_CIRCUIT = "012041102"
ORPHAN_EVENT = "PGE PSPS Event 10/11/21"


def test_calfire_untyped_returns_exactly_null_types(
    data_client: httpx.Client, db_conn: psycopg.Connection
):
    expected = sql_count(
        db_conn,
        "SELECT count(*) FROM wildfire.calfire_incidents WHERE incident_type IS NULL",
    )
    assert expected == 1234
    r = data_client.get(
        "/calfire/incidents",
        params={"incident_type": "untyped", "limit": 1, "geometry": False},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["meta"]["total"] == expected
    assert body["meta"]["null_incident_type_count"] == 1234


def test_calfire_untagged_returns_exactly_282(
    data_client: httpx.Client, db_conn: psycopg.Connection
):
    expected = sql_count(
        db_conn,
        "SELECT count(*) FROM wildfire.calfire_incidents WHERE utility IS NULL",
    )
    assert expected == 282
    r = data_client.get(
        "/calfire/incidents",
        params={
            "utility": "untagged",
            "incident_type": "all",
            "limit": 1,
            "geometry": False,
        },
    )
    assert r.status_code == 200
    assert r.json()["meta"]["total"] == expected


def test_circuit_leading_zero_round_trip(data_client: httpx.Client, db_conn: psycopg.Connection):
    assert (
        sql_count(
            db_conn,
            "SELECT count(*) FROM wildfire.circuits WHERE circuit_id = %s",
            (REAL_LEADING_ZERO_CIRCUIT,),
        )
        == 1
    )
    # padded form
    r = data_client.get(f"/circuits/{REAL_LEADING_ZERO_CIRCUIT}", params={"geometry": False})
    assert r.status_code == 200
    assert r.json()["data"][0]["circuit_id"] == REAL_LEADING_ZERO_CIRCUIT

    # unpadded query param should zfill
    r = data_client.get(
        "/epss/outages",
        params={"circuit_id": "43371102", "limit": 100, "geometry": False},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["meta"]["filters"]["circuit_id"] == REAL_LEADING_ZERO_CIRCUIT
    assert body["meta"]["total"] > 0
    assert all(row["circuit_id"] == REAL_LEADING_ZERO_CIRCUIT for row in body["data"])
    assert REAL_LEADING_ZERO_CIRCUIT.startswith("0")


def test_example_circuit_012041102_is_absent(
    data_client: httpx.Client, db_conn: psycopg.Connection
):
    """Inventory example ID — not present in loaded EPSS/GNA subset."""
    n_circ = sql_count(
        db_conn,
        "SELECT count(*) FROM wildfire.circuits WHERE circuit_id = %s",
        (ABSENT_EXAMPLE_CIRCUIT,),
    )
    n_epss = sql_count(
        db_conn,
        "SELECT count(*) FROM wildfire.epss_outages WHERE circuit_id = %s",
        (ABSENT_EXAMPLE_CIRCUIT,),
    )
    assert n_circ == 0 and n_epss == 0
    r = data_client.get(f"/circuits/{ABSENT_EXAMPLE_CIRCUIT}")
    assert r.status_code == 404


def test_psps_orphans_returned_with_null_geometry(
    data_client: httpx.Client, db_conn: psycopg.Connection
):
    orphan_sql = """
        SELECT count(DISTINCT pec.circuit_id)
        FROM wildfire.psps_event_circuits pec
        LEFT JOIN wildfire.circuits c ON c.circuit_id = pec.circuit_id
        WHERE c.circuit_id IS NULL
    """
    assert sql_count(db_conn, orphan_sql) == 17

    r = data_client.get(
        f"/psps/events/{quote(ORPHAN_EVENT, safe='')}/circuits",
        params={"format": "geojson"},
    )
    # path param with slashes — use raw path
    r = data_client.get(
        f"/psps/events/{ORPHAN_EVENT}/circuits",
        params={"format": "geojson"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["type"] == "FeatureCollection"
    assert body["meta"]["circuits_missing_geometry"] >= 1
    assert len(body["features"]) == body["meta"]["total"]

    null_geom = [f for f in body["features"] if f["geometry"] is None]
    assert len(null_geom) == body["meta"]["circuits_missing_geometry"]
    assert all(f["properties"].get("geometry_missing") for f in null_geom)

    # All 17 distinct orphans appear somewhere across PGE events
    orphan_ids: set[str] = set()
    events = data_client.get(
        "/psps/events", params={"utility": "PGE", "limit": 50, "geometry": False}
    ).json()["data"]
    for ev in events:
        rr = data_client.get(
            f"/psps/events/{ev['event_name']}/circuits",
            params={"format": "geojson", "geometry": True},
        )
        assert rr.status_code == 200
        for feat in rr.json()["features"]:
            if feat["geometry"] is None:
                orphan_ids.add(feat["properties"]["circuit_id"])
    assert len(orphan_ids) == 17, f"expected 17 orphan IDs, got {len(orphan_ids)}: {sorted(orphan_ids)}"
