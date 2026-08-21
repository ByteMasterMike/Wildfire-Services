"""Serialize rows with optional GeoJSON geometry."""

from __future__ import annotations

import json
from datetime import date, datetime, time
from typing import Any


def _jsonable(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, memoryview):
        return bytes(value)
    return value


def geom_from_geojson_text(text: str | None) -> dict | None:
    if text is None:
        return None
    return json.loads(text)


def row_to_feature(
    props: dict[str, Any],
    geom_geojson: str | None,
    *,
    include_geometry: bool,
) -> dict[str, Any]:
    geometry = geom_from_geojson_text(geom_geojson) if include_geometry else None
    clean = {k: _jsonable(v) for k, v in props.items()}
    if include_geometry:
        return {"type": "Feature", "geometry": geometry, "properties": clean}
    return clean


def build_json_envelope(
    rows: list[dict[str, Any]],
    *,
    total: int,
    limit: int | None,
    offset: int | None,
    filters: dict[str, Any],
    include_geometry: bool,
    extra_meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    data = []
    for r in rows:
        geom = r.pop("_geom_geojson", None)
        # geometry_missing hint for null geoms
        if include_geometry and geom is None and r.get("geometry_missing") is not False:
            if "geometry_missing" not in r and geom is None:
                # only set when caller marked or geom absent for circuit joins
                pass
        item = {k: _jsonable(v) for k, v in r.items()}
        if include_geometry:
            item["geometry"] = geom_from_geojson_text(geom) if geom else None
        data.append(item)

    meta: dict[str, Any] = {
        "total": total,
        "returned": len(data),
        "filters": {k: _jsonable(v) for k, v in filters.items() if v is not None},
    }
    if limit is not None:
        meta["limit"] = limit
    if offset is not None:
        meta["offset"] = offset
    if extra_meta:
        meta.update(extra_meta)
    return {"data": data, "meta": meta}


def build_geojson_envelope(
    rows: list[dict[str, Any]],
    *,
    total: int,
    limit: int | None,
    offset: int | None,
    filters: dict[str, Any],
    include_geometry: bool,
    extra_meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    features = []
    for r in rows:
        geom = r.pop("_geom_geojson", None)
        props = {k: _jsonable(v) for k, v in r.items()}
        if include_geometry:
            geometry = geom_from_geojson_text(geom) if geom else None
            if geometry is None:
                props.setdefault("geometry_missing", True)
        else:
            geometry = None
        features.append(
            {"type": "Feature", "geometry": geometry, "properties": props}
        )

    meta: dict[str, Any] = {
        "total": total,
        "returned": len(features),
        "filters": {k: _jsonable(v) for k, v in filters.items() if v is not None},
    }
    if limit is not None:
        meta["limit"] = limit
    if offset is not None:
        meta["offset"] = offset
    if extra_meta:
        meta.update(extra_meta)
    return {"type": "FeatureCollection", "features": features, "meta": meta}


def respond(
    rows: list[dict[str, Any]],
    *,
    total: int,
    limit: int | None,
    offset: int | None,
    filters: dict[str, Any],
    fmt: str,
    include_geometry: bool,
    extra_meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    # Copy rows so callers can reuse
    copied = [dict(r) for r in rows]
    if fmt == "geojson":
        return build_geojson_envelope(
            copied,
            total=total,
            limit=limit,
            offset=offset,
            filters=filters,
            include_geometry=include_geometry,
            extra_meta=extra_meta,
        )
    return build_json_envelope(
        copied,
        total=total,
        limit=limit,
        offset=offset,
        filters=filters,
        include_geometry=include_geometry,
        extra_meta=extra_meta,
    )
