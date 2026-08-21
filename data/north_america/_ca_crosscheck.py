"""California warehouse yearly counts for inventory cross-check."""

from __future__ import annotations

import json
from pathlib import Path

from shared.db import connect
from psycopg.rows import dict_row

OUT = Path(__file__).resolve().parent / "_ca_warehouse_counts.json"


def main() -> None:
    conn = connect()
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT EXTRACT(YEAR FROM date_only_created)::int AS y, count(*)::int AS n
            FROM wildfire.calfire_incidents
            WHERE incident_type IN ('Wildfire', 'Fire')
              AND date_only_created IS NOT NULL
            GROUP BY 1
            ORDER BY 1
            """
        )
        calfire_wf = {int(r["y"]): int(r["n"]) for r in cur.fetchall()}

        cur.execute(
            """
            SELECT EXTRACT(YEAR FROM date_only_created)::int AS y, count(*)::int AS n
            FROM wildfire.calfire_incidents
            WHERE date_only_created IS NOT NULL
            GROUP BY 1
            ORDER BY 1
            """
        )
        calfire_all = {int(r["y"]): int(r["n"]) for r in cur.fetchall()}

        cur.execute(
            """
            SELECT year::int AS y, count(*)::int AS n
            FROM wildfire.cpuc_ignitions
            GROUP BY 1
            ORDER BY 1
            """
        )
        cpuc = {int(r["y"]): int(r["n"]) for r in cur.fetchall()}

        cur.execute("SELECT count(*)::int AS n FROM wildfire.calfire_incidents")
        cal_total = int(cur.fetchone()["n"])
        cur.execute(
            """
            SELECT count(*)::int AS n FROM wildfire.calfire_incidents
            WHERE incident_type IN ('Wildfire', 'Fire')
            """
        )
        cal_wf_total = int(cur.fetchone()["n"])
        cur.execute("SELECT count(*)::int AS n FROM wildfire.cpuc_ignitions")
        cpuc_total = int(cur.fetchone()["n"])

    conn.close()
    payload = {
        "calfire_total_rows": cal_total,
        "calfire_wildfire_fire_total": cal_wf_total,
        "cpuc_total": cpuc_total,
        "calfire_wf_by_year": calfire_wf,
        "calfire_all_by_year": calfire_all,
        "cpuc_by_year": cpuc,
    }
    OUT.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
