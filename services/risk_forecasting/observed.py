"""Warehouse-backed observed ignition counts per grid cell and date."""

from __future__ import annotations

from datetime import date
from typing import Optional

import pandas as pd

from services.risk_forecasting import grid_data_prep as gdp
from shared.db import connect, get_settings

_grid_cache: Optional[pd.DataFrame] = None


def _grid_cells() -> pd.DataFrame:
    """SW-corner grid from the warehouse (same corners as grid_cells.csv)."""
    global _grid_cache
    if _grid_cache is not None:
        return _grid_cache
    with connect(get_settings()) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT cell_id, lat, lon
                FROM wildfire.grid_cells
                ORDER BY cell_id
                """
            )
            rows = cur.fetchall()
    grid = pd.DataFrame(rows, columns=["cell_id", "lat", "lon"])
    grid["seg_idx"] = grid.index
    _grid_cache = grid
    return grid


def _empty_cells(grid: pd.DataFrame, on_date: date) -> dict:
    cells = [
        {
            "cell_id": int(cell_id),
            "lat": float(lat),
            "lon": float(lon),
            "observed_count": 0,
        }
        for cell_id, lat, lon in zip(grid["cell_id"], grid["lat"], grid["lon"])
    ]
    return {"date": on_date, "cells": cells}


def _ignition_points(*, on_date: Optional[date] = None, year: Optional[int] = None) -> pd.DataFrame:
    clauses = []
    params: list = []
    if on_date is not None:
        clauses.append("event_date = %s")
        params.append(on_date)
    if year is not None:
        clauses.append("year = %s")
        params.append(year)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    sql = f"""
        SELECT ST_Y(geom) AS lat, ST_X(geom) AS lon
        FROM wildfire.cpuc_ignitions
        {where}
        """
    with connect(get_settings()) as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()
    return pd.DataFrame(rows, columns=["lat", "lon"])


def _counts_by_nearest_sw_corner(events: pd.DataFrame, grid: pd.DataFrame) -> dict[int, int]:
    """Assign points with the training snap: nearest grid SW-corner (metres)."""
    if events.empty:
        return {}
    snapped = gdp.snap_events_to_grid(events, grid)
    counts: dict[int, int] = {}
    for cell_id in snapped["cell_id"].astype(int):
        counts[cell_id] = counts.get(cell_id, 0) + 1
    return counts


def _cells_from_counts(grid: pd.DataFrame, counts: dict[int, int], on_date: date) -> dict:
    cells = [
        {
            "cell_id": int(cell_id),
            "lat": float(lat),
            "lon": float(lon),
            "observed_count": int(counts.get(int(cell_id), 0)),
        }
        for cell_id, lat, lon in zip(grid["cell_id"], grid["lat"], grid["lon"])
    ]
    return {"date": on_date, "cells": cells}


def observed_surface(on_date: date) -> dict:
    """
    Polygon-containment counts from live warehouse CPUC ignitions.

    ``wildfire.grid_cells.geom`` is a real 0.24° polygon (SW corner + spacing).
    Uses ST_Contains — the same predicate as place resolution. Points that
    fall outside every polygon are dropped. Use ``/observed`` for a map of
    warehouse locations; use ``observed_training_surface`` / ``/observed-training``
    for residuals against the fitted cNHPP evaluation.
    """
    sql = """
        SELECT g.cell_id,
               g.lat,
               g.lon,
               COUNT(i.id)::int AS observed_count
        FROM wildfire.grid_cells g
        LEFT JOIN wildfire.cpuc_ignitions i
          ON i.event_date = %s
         AND ST_Contains(g.geom, i.geom)
        GROUP BY g.cell_id, g.lat, g.lon
        ORDER BY g.cell_id
        """
    with connect(get_settings()) as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (on_date,))
            rows = cur.fetchall()
    cells = [
        {
            "cell_id": int(cell_id),
            "lat": float(lat),
            "lon": float(lon),
            "observed_count": int(observed_count),
        }
        for cell_id, lat, lon, observed_count in rows
    ]
    return {"date": on_date, "cells": cells}


def observed_training_surface(on_date: date) -> dict:
    """
    Training-set snap: each warehouse CPUC point to the nearest grid SW-corner.

    Reuses ``grid_data_prep.snap_events_to_grid`` (the method that built
    ``events_YYYY.csv``). ``resolve_place`` does not implement nearest-corner
    assignment — it uses ST_Contains — so this does not go through place
    resolution. Every point is assigned; none fall outside a cell.
    """
    grid = _grid_cells()
    events = _ignition_points(on_date=on_date)
    if events.empty:
        return _empty_cells(grid, on_date)
    return _cells_from_counts(grid, _counts_by_nearest_sw_corner(events, grid), on_date)


def observed_training_year_total(year: int) -> int:
    """Count of warehouse CPUC rows in ``year`` after nearest-SW-corner snap."""
    grid = _grid_cells()
    events = _ignition_points(year=year)
    if events.empty:
        return 0
    return int(sum(_counts_by_nearest_sw_corner(events, grid).values()))
