"""Quick smoke test against a running PostGIS warehouse."""

from __future__ import annotations

from fastapi.testclient import TestClient

from services.data_query.app import app
from shared.db import clear_settings_cache


def main() -> None:
    clear_settings_cache()
    c = TestClient(app)

    r = c.get("/health")
    assert r.status_code == 200, r.text
    tables = r.json()["tables"]
    assert tables["epss_outages"] == 9651, tables
    print("health OK", r.json()["database"])

    r = c.get("/ignitions", params={"year": 2024, "limit": 2, "geometry": False})
    j = r.json()
    assert r.status_code == 200
    assert j["meta"]["total"] > 0
    assert "geometry" not in j["data"][0]
    print("ignitions OK", j["meta"]["total"])

    r = c.get("/ignitions", params={"county": "Butte", "limit": 1, "geometry": False})
    assert r.status_code == 200
    print("ignitions county OK", r.json()["meta"]["total"])

    r = c.get("/epss/outages", params={"circuit_id": "43371102", "limit": 5})
    j = r.json()
    assert j["meta"]["filters"]["circuit_id"] == "043371102"
    assert j["meta"]["total"] > 0
    print("epss zfill OK", j["meta"]["total"])

    r = c.get("/calfire/incidents", params={"limit": 1})
    j = r.json()
    assert j["meta"]["null_incident_type_count"] == 1234
    assert j["meta"]["filters"]["incident_type"] == "Wildfire,Fire"
    print("calfire default OK", j["meta"]["total"])

    r = c.get("/calfire/incidents", params={"incident_type": "untyped", "limit": 1})
    assert r.json()["meta"]["total"] == 1234
    print("calfire untyped OK")

    r = c.get(
        "/calfire/incidents",
        params={"utility": "untagged", "incident_type": "all", "limit": 1},
    )
    assert r.json()["meta"]["total"] == 282
    print("calfire untagged OK")

    r = c.get("/psps/events", params={"utility": "PGE", "limit": 20, "geometry": False})
    events = r.json()["data"]
    found = False
    for ev in events:
        name = ev["event_name"]
        # Starlette :path param — pass raw name; TestClient joins path segments.
        rr = c.get(f"/psps/events/{name}/circuits", params={"format": "geojson"})
        assert rr.status_code == 200, (name, rr.status_code, rr.text)
        meta = rr.json()["meta"]
        if meta.get("circuits_missing_geometry", 0) > 0:
            feat = next(f for f in rr.json()["features"] if f["geometry"] is None)
            print(
                "psps orphans OK",
                name,
                meta["circuits_missing_geometry"],
                feat["properties"]["circuit_id"],
            )
            found = True
            break
    assert found, "expected at least one PGE event with orphan circuits"

    r = c.get("/spatial/point", params={"lat": 37.8, "lon": -122.3})
    j = r.json()
    assert j["county"] == "San Francisco"
    assert j["meta"]["county_unavailable"] is False
    print("point OK", j["iou"]["utility"], j["county"], j["grid_cell"]["cell_id"])

    r = c.get(
        "/spatial/summary",
        params={"utility": "PGE", "start_date": "2024-01-01", "end_date": "2024-12-31"},
    )
    print("summary OK", r.json()["counts"])

    r = c.get("/circuits/012041102")
    assert r.status_code in (200, 404)
    print("circuit lookup", r.status_code)

    r = c.get("/epss/outages", params={"utility": "SCE", "limit": 1})
    assert r.json()["meta"]["total"] == 0
    print("epss SCE empty OK")

    print("SMOKE OK")


if __name__ == "__main__":
    main()
