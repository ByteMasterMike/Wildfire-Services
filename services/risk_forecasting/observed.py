"""Warehouse-backed observed ignition counts per grid cell and date."""

from __future__ import annotations

from datetime import date

from shared.db import connect, get_settings


def observed_surface(on_date: date) -> dict:
    """
    Count CPUC ignitions inside each 0.24° grid polygon for one calendar date.

    ``wildfire.grid_cells.geom`` is a real Polygon (SW corner + spacing), so
    this uses ST_Contains — the same predicate as place resolution — rather
    than nearest-centroid.
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
