"""Extract one ignition row per positive FireCastRL sequence.

Reads data/north_america/Wildfire_Dataset.csv (126,795 × 75-day blocks).
Writes data/north_america/us_ignitions_extracted.csv (gitignored).
"""

from __future__ import annotations

import csv
import sys
from collections import Counter
from pathlib import Path

from shared.db import REPO_ROOT

SOURCE = REPO_ROOT / "data" / "north_america" / "Wildfire_Dataset.csv"
OUT = REPO_ROOT / "data" / "north_america" / "us_ignitions_extracted.csv"

SEQ_LEN = 75
SENTINEL = 32767.0
COVARIATES = [
    "pr",
    "rmax",
    "rmin",
    "sph",
    "srad",
    "tmmn",
    "tmmx",
    "vs",
    "bi",
    "fm100",
    "fm1000",
    "erc",
    "etr",
    "pet",
    "vpd",
]
OUT_FIELDS = ["latitude", "longitude", "event_date", "year", *COVARIATES]


def _f(row: dict, key: str) -> float:
    return float(row[key])


def _is_yes(row: dict) -> bool:
    return str(row.get("Wildfire", "")).strip().lower() == "yes"


def _row_all_sentinel(row: dict) -> bool:
    return all(abs(_f(row, c) - SENTINEL) < 1e-6 for c in COVARIATES)


def _row_any_sentinel(row: dict) -> bool:
    return any(abs(_f(row, c) - SENTINEL) < 1e-6 for c in COVARIATES)


def _seq_sentinel_kind(rows: list[dict]) -> str:
    """Return 'full', 'partial', or 'none'."""
    all_full = all(_row_all_sentinel(r) for r in rows)
    if all_full:
        return "full"
    if any(_row_any_sentinel(r) for r in rows):
        return "partial"
    return "none"


def _process_sequence(
    rows: list[dict],
    *,
    stats: Counter,
    events: list[dict],
) -> None:
    stats["sequences"] += 1
    if len(rows) != SEQ_LEN:
        stats["sequences_not_75"] += 1

    yes_idx = [i for i, r in enumerate(rows) if _is_yes(r)]
    n_yes = len(yes_idx)
    is_positive = n_yes == 15
    is_negative = n_yes == 0

    if n_yes not in (0, 15):
        stats["sequences_anomalous_yes_count"] += 1
        stats[f"anomalous_yes_{n_yes}"] += 1
        return

    kind = _seq_sentinel_kind(rows)
    if kind == "full":
        stats["sentinel_full_sequences"] += 1
        if is_positive:
            stats["sentinel_full_positive"] += 1
        else:
            stats["sentinel_full_negative"] += 1
        return
    if kind == "partial":
        stats["sentinel_partial_sequences"] += 1
        if is_positive:
            stats["sentinel_partial_positive"] += 1
            ign = rows[yes_idx[0]]
            if _row_any_sentinel(ign):
                stats["sentinel_partial_positive_dropped_bad_ignition_day"] += 1
                return
            stats["sentinel_partial_positive_kept"] += 1
            # Fall through to extract using the clean ignition day.
        else:
            stats["sentinel_partial_negative"] += 1
            stats["negatives_dropped"] += 1
            return

    if is_negative:
        stats["negatives_dropped"] += 1
        return

    # Positive
    ign = rows[yes_idx[0]]
    event_date = str(ign["datetime"]).strip()[:10]
    year = int(event_date[:4])
    events.append(
        {
            "latitude": _f(ign, "latitude"),
            "longitude": _f(ign, "longitude"),
            "event_date": event_date,
            "year": year,
            **{c: _f(ign, c) for c in COVARIATES},
        }
    )
    stats["positives_extracted"] += 1


def extract(*, source: Path = SOURCE, out: Path = OUT) -> list[dict]:
    if not source.is_file():
        raise FileNotFoundError(f"source CSV not found: {source}")

    stats: Counter = Counter()
    events: list[dict] = []
    current: list[dict] = []
    current_key: tuple[float, float] | None = None

    print(f"[extract_us_ignitions] reading {source}")
    with source.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            stats["rows_read"] += 1
            key = (_f(row, "latitude"), _f(row, "longitude"))
            if current_key is None:
                current_key = key
                current = [row]
            elif key == current_key:
                current.append(row)
            else:
                _process_sequence(current, stats=stats, events=events)
                current_key = key
                current = [row]
            if stats["rows_read"] % 1_000_000 == 0:
                print(f"  … {stats['rows_read']:,} rows, {stats['sequences']:,} sequences")

    if current:
        _process_sequence(current, stats=stats, events=events)

    print_counts = [
        ("rows_read", stats["rows_read"]),
        ("sequences", stats["sequences"]),
        ("sequences_not_75", stats["sequences_not_75"]),
        ("sequences_anomalous_yes_count", stats["sequences_anomalous_yes_count"]),
        ("sentinel_full_sequences", stats["sentinel_full_sequences"]),
        ("  sentinel_full_positive", stats["sentinel_full_positive"]),
        ("  sentinel_full_negative", stats["sentinel_full_negative"]),
        ("sentinel_partial_sequences", stats["sentinel_partial_sequences"]),
        ("  sentinel_partial_positive", stats["sentinel_partial_positive"]),
        ("  sentinel_partial_negative", stats["sentinel_partial_negative"]),
        (
            "  sentinel_partial_positive_dropped_bad_ignition_day",
            stats["sentinel_partial_positive_dropped_bad_ignition_day"],
        ),
        ("  sentinel_partial_positive_kept", stats["sentinel_partial_positive_kept"]),
        ("negatives_dropped", stats["negatives_dropped"]),
        ("positives_extracted", stats["positives_extracted"]),
    ]
    print("[extract_us_ignitions] stage counts:")
    for label, n in print_counts:
        print(f"  {label}: {n:,}")

    # Exact dedupe
    before = len(events)
    seen: set[tuple] = set()
    deduped: list[dict] = []
    for e in events:
        k = (e["latitude"], e["longitude"], e["event_date"])
        if k in seen:
            continue
        seen.add(k)
        deduped.append(e)
    exact_dropped = before - len(deduped)
    print(f"  exact_dedupe_dropped: {exact_dropped:,}")
    print(f"  final_events: {len(deduped):,}")

    # Near-duplicates at 4 decimal places (report only; do not drop)
    near: Counter = Counter()
    for e in deduped:
        near[(round(e["latitude"], 4), round(e["longitude"], 4), e["event_date"])] += 1
    near_groups = {k: v for k, v in near.items() if v > 1}
    near_extra = sum(v - 1 for v in near_groups.values())
    print(f"  near_dupe_groups_at_4dp: {len(near_groups):,}")
    print(f"  near_dupe_extra_rows_at_4dp: {near_extra:,}")
    print(
        "  note: UNIQUE(lat,lon,date) is exact-float only; "
        f"{near_extra:,} additional rows share a 4dp (lat,lon,date) with another event."
    )

    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=OUT_FIELDS)
        w.writeheader()
        w.writerows(deduped)
    print(f"[extract_us_ignitions] wrote {out} ({len(deduped):,} rows)")
    return deduped


def main() -> int:
    try:
        extract()
    except FileNotFoundError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
