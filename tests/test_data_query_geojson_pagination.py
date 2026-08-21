"""Pagination integrity and GeoJSON shape."""

from __future__ import annotations

import httpx


def test_pagination_epss_year_2021_no_dupes_or_drops(data_client: httpx.Client):
    r = data_client.get(
        "/epss/outages",
        params={"year": 2021, "limit": 1, "geometry": False},
    )
    total = r.json()["meta"]["total"]
    assert total == 9

    limit = 3
    seen: list[int] = []
    offset = 0
    while offset < total:
        page = data_client.get(
            "/epss/outages",
            params={
                "year": 2021,
                "limit": limit,
                "offset": offset,
                "geometry": False,
            },
        )
        assert page.status_code == 200
        body = page.json()
        assert body["meta"]["total"] == total
        ids = [row["id"] for row in body["data"]]
        assert len(ids) == len(set(ids)), "duplicate ids within page"
        seen.extend(ids)
        offset += limit

    assert len(seen) == total
    assert len(set(seen)) == total, "duplicate ids across pages"


def test_pagination_epss_year_2024_full_coverage(data_client: httpx.Client):
    r = data_client.get(
        "/epss/outages",
        params={"year": 2024, "limit": 1, "geometry": False},
    )
    total = r.json()["meta"]["total"]
    # Inventory listed 2788; loader drops 1 exact duplicate (in 2024).
    assert total == 2787, (
        f"EPSS 2024 API total={total}; expected 2787 after exact-dupe drop "
        f"(inventory raw CSV had 2788)"
    )

    limit = 500
    collected: set[int] = set()
    offset = 0
    while offset < total:
        page = data_client.get(
            "/epss/outages",
            params={
                "year": 2024,
                "limit": limit,
                "offset": offset,
                "geometry": False,
            },
        )
        assert page.status_code == 200
        body = page.json()
        assert body["meta"]["total"] == total
        ids = [row["id"] for row in body["data"]]
        overlap = collected.intersection(ids)
        assert not overlap, f"cross-page duplicate ids at offset {offset}: {list(overlap)[:5]}"
        collected.update(ids)
        offset += limit
    assert len(collected) == total



def test_geojson_format_valid_feature_collection(data_client: httpx.Client):
    r = data_client.get(
        "/ignitions",
        params={"utility": "PACIFICORP", "format": "geojson", "limit": 100},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["type"] == "FeatureCollection"
    assert body["meta"]["total"] == 14
    assert len(body["features"]) == body["meta"]["returned"]
    for feat in body["features"]:
        assert feat["type"] == "Feature"
        assert feat["geometry"]["type"] == "Point"
        assert len(feat["geometry"]["coordinates"]) == 2
        assert "properties" in feat


def test_geojson_psps_polygons(data_client: httpx.Client):
    r = data_client.get(
        "/psps/events",
        params={"utility": "PGE", "format": "geojson", "limit": 5},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["type"] == "FeatureCollection"
    assert len(body["features"]) == body["meta"]["returned"]
    for feat in body["features"]:
        assert feat["geometry"]["type"] in ("Polygon", "MultiPolygon")
