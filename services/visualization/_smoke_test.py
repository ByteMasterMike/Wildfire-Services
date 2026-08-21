"""Smoke test visualization endpoints against a running PostGIS warehouse."""

from __future__ import annotations

from fastapi.testclient import TestClient

from services.visualization.app import app
from shared.db import clear_settings_cache


def main() -> None:
    clear_settings_cache()
    c = TestClient(app)

    r = c.get("/health")
    assert r.status_code == 200
    assert "ignitions_attribute" in r.json()["definitions"]
    print("health OK")

    r = c.get("/map-layer", params={"dataset": "ignitions", "year": 2024, "limit": 5})
    assert r.status_code == 200
    body = r.json()
    assert body["style"]["color"] == "#c0440e"
    assert body["geojson"]["type"] == "FeatureCollection"
    assert body["meta"]["total"] == 741
    print("map ignitions OK", body["meta"]["returned"])

    r = c.get("/map-layer", params={"dataset": "epss", "year": 2024, "limit": 10})
    assert r.status_code == 200
    body = r.json()
    assert body["style"]["geometry_type"] == "MultiLineString"
    assert body["meta"]["render_as"] == "circuit_lines"
    feat = body["geojson"]["features"][0]
    assert "event_count" in feat["properties"]
    assert feat["geometry"] is None or feat["geometry"]["type"] in (
        "LineString",
        "MultiLineString",
    )
    print("map epss lines OK", body["meta"]["total"], "circuits")

    r = c.get("/time-series", params={"dataset": "epss", "interval": "weekly", "year": 2024})
    assert r.status_code == 200
    body = r.json()
    assert body["meta"]["binning"] == "website_calendar_weeks"
    assert len(body["buckets"]) >= 52
    assert body["meta"]["total_events"] == 2787
    print("time-series weekly OK", body["meta"]["total_events"])

    r = c.get("/utility-territory", params={"utility": "PGE"})
    assert r.status_code == 200
    body = r.json()
    assert body["bounds"]["min_lon"] < body["bounds"]["max_lon"]
    assert body["geojson"]["geometry"]["type"] in ("Polygon", "MultiPolygon")
    print("utility-territory OK", body["utility_name"])

    # event detail: first ignition id from map layer
    ign = c.get("/map-layer", params={"dataset": "ignitions", "limit": 1}).json()
    ign_id = ign["geojson"]["features"][0]["properties"]["id"]
    r = c.get("/event-detail", params={"dataset": "ignitions", "id": str(ign_id)})
    assert r.status_code == 200
    assert r.json()["detail_fields"]
    print("event-detail OK", ign_id)

    r = c.get("/map-layer", params={"dataset": "hftd"})
    assert r.status_code == 200
    assert r.json()["meta"]["total"] == 2
    assert "style" in r.json()["geojson"]["features"][0]["properties"]
    print("hftd OK")

    print("SMOKE OK")


if __name__ == "__main__":
    main()
