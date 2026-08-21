"""Load PSPS event polygons and event↔circuit links."""

from __future__ import annotations

import json

import psycopg

from db.loaders.config import Settings
from db.loaders.util import (
    as_multi_polygon_geojson,
    load_geojson,
    normalize_circuit_id,
    normalize_psps_utility,
    parse_bool,
    parse_date,
    print_counts,
    print_step,
    report_orphans,
    table_count,
    truncate,
)


def load_events(conn: psycopg.Connection, settings: Settings) -> int:
    path = settings.dataset_demo_data_dir / "psps_events.geojson"
    print_step(f"psps_events ← {path}")
    data = load_geojson(path)
    features = data["features"]
    print_counts("read", features=len(features))

    rows = []
    for feat in features:
        props = feat["properties"]
        iou_raw = props["IOU"]
        utility = normalize_psps_utility(iou_raw)
        geom = as_multi_polygon_geojson(feat["geometry"])
        rows.append(
            (
                props["EventName"],
                utility,
                iou_raw,
                parse_date(props.get("FirstDateofPOC")),
                parse_date(props.get("DeEnergizationStartDate")),
                parse_date(props.get("FullRestorationDate")),
                parse_bool(props.get("De_Energization")),
                props.get("CustomerDeEnergized"),
                props.get("year"),
                json.dumps(geom),
            )
        )

    with conn.transaction():
        truncate(conn, "wildfire.psps_events")
        with conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO wildfire.psps_events (
                  event_name, utility, iou_raw, first_date_of_poc,
                  deenergization_start_date, full_restoration_date,
                  de_energization, customers_deenergized, year, geom
                ) VALUES (
                  %s, %s, %s, %s,
                  %s, %s,
                  %s, %s, %s,
                  ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)
                )
                """,
                rows,
            )
        inserted = len(rows)

    final = table_count(conn, "wildfire.psps_events")
    print_counts("loaded", inserted=inserted, table_count=final)
    return final


def load_event_circuits(conn: psycopg.Connection, settings: Settings) -> int:
    path = settings.dataset_demo_data_dir / "psps_event_circuits.json"
    print_step(f"psps_event_circuits ← {path}")
    with path.open(encoding="utf-8") as f:
        data = json.load(f)
    print_counts("read", events=len(data))

    with conn.cursor() as cur:
        cur.execute("SELECT circuit_id FROM wildfire.circuits")
        known_circuits = {row[0] for row in cur.fetchall()}
        cur.execute("SELECT event_name FROM wildfire.psps_events")
        known_events = {row[0] for row in cur.fetchall()}

    rows: list[tuple] = []
    seen: set[tuple[str, str]] = set()
    dupes = 0
    orphan_circuits: set[str] = set()
    orphan_events: set[str] = set()
    for event_name, circuits in data.items():
        if event_name not in known_events:
            orphan_events.add(event_name)
        for item in circuits:
            cid = normalize_circuit_id(item["circuit_id"])
            if cid not in known_circuits:
                orphan_circuits.add(cid)
            key = (event_name, cid)
            if key in seen:
                dupes += 1
                continue
            seen.add(key)
            rows.append((event_name, cid, item.get("circuit_name")))

    print_counts("dedupe", kept=len(rows), exact_duplicates_dropped=dupes)
    report_orphans("psps_event_circuits → circuits", sorted(orphan_circuits))
    if orphan_events:
        print(
            f"  WARNING psps_event_circuits → psps_events: "
            f"{len(orphan_events)} unknown event_name(s): {sorted(orphan_events)[:10]}"
        )
    else:
        print("  psps_event_circuits → psps_events: 0 orphan event_names")

    with conn.transaction():
        truncate(conn, "wildfire.psps_event_circuits")
        with conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO wildfire.psps_event_circuits
                  (event_name, circuit_id, circuit_name)
                VALUES (%s, %s, %s)
                """,
                rows,
            )
        inserted = len(rows)

    final = table_count(conn, "wildfire.psps_event_circuits")
    print_counts("loaded", inserted=inserted, table_count=final)
    return final
