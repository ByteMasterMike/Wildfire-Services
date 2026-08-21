"""Follow-up inventory: sentinels, event inference, sequence structure, CA events."""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent
CSV = ROOT / "Wildfire_Dataset.csv"
OUT = ROOT / "_inventory_results2.json"
CHUNK = 250_000
COVARIATES = [
    "pr", "rmax", "rmin", "sph", "srad", "tmmn", "tmmx", "vs",
    "bi", "fm100", "fm1000", "erc", "etr", "pet", "vpd",
]
SENTINEL = 32767.0


def main() -> None:
    n_rows = 0
    sentinel_rows = 0  # any cov == 32767
    sentinel_per_col = Counter()
    # clean ranges
    cov_min = {c: np.inf for c in COVARIATES}
    cov_max = {c: -np.inf for c in COVARIATES}
    cov_sum = {c: 0.0 for c in COVARIATES}
    cov_n = {c: 0 for c in COVARIATES}

    # Full-precision unique coords
    unique_full: set[tuple[float, float]] = set()
    unique_full_yes: set[tuple[float, float]] = set()

    # Infer events: for each (lat,lon) collect Yes date strings, then cluster into runs
    # Memory: only track CA + sample of national
    yes_dates_by_loc: dict[tuple[float, float], list[str]] = defaultdict(list)
    ca_yes_dates_by_loc: dict[tuple[float, float], list[str]] = defaultdict(list)

    # Count sequences: group consecutive rows? File may be ordered by sequence.
    # Detect run length of same (lat,lon) as we stream if file is sequence-blocked.
    prev_key = None
    run_len = 0
    run_lens: list[int] = []
    run_yes = 0
    run_yes_counts: list[int] = []

    # CA unique events by year: number of 15-day Yes blocks starting year
    # Simpler: count unique (lat4, lon4, year) that have any Yes
    ca_pos_loc_years: set[tuple[float, float, int]] = set()
    nat_pos_loc_years: set[tuple[float, float, int]] = set()

    # State coverage via coarse centroids - count unique locs in state bboxes (approx)
    # Rough state boxes for presence only
    STATE_BOXES = {
        "CA": (32.5, 42.0, -124.5, -114.1),
        "OR": (42.0, 46.3, -124.6, -116.5),
        "WA": (45.5, 49.0, -124.8, -116.9),
        "NV": (35.0, 42.0, -120.0, -114.0),
        "AZ": (31.3, 37.0, -114.8, -109.0),
        "TX": (25.8, 36.5, -106.6, -93.5),
        "FL": (24.5, 31.0, -87.6, -80.0),
        "CO": (37.0, 41.0, -109.1, -102.0),
        "MT": (44.4, 49.0, -116.1, -104.0),
        "ID": (42.0, 49.0, -117.2, -111.0),
        "NM": (31.3, 37.0, -109.1, -103.0),
        "UT": (37.0, 42.0, -114.1, -109.0),
        "WY": (41.0, 45.0, -111.1, -104.1),
        "OK": (33.6, 37.0, -103.0, -94.4),
        "KS": (37.0, 40.0, -102.1, -94.6),
        "NE": (40.0, 43.0, -104.1, -95.3),
        "SD": (42.5, 46.0, -104.1, -96.4),
        "ND": (45.9, 49.0, -104.1, -96.6),
        "MN": (43.5, 49.4, -97.2, -89.5),
        "WI": (42.5, 47.1, -92.9, -86.8),
        "MI": (41.7, 48.3, -90.4, -82.4),
        "NY": (40.5, 45.0, -79.8, -71.9),
        "PA": (39.7, 42.3, -80.5, -74.7),
        "GA": (30.4, 35.0, -85.6, -80.8),
        "AL": (30.2, 35.0, -88.5, -84.9),
        "MS": (30.2, 35.0, -91.7, -88.1),
        "LA": (29.0, 33.0, -94.0, -89.0),
        "AR": (33.0, 36.5, -94.6, -89.6),
        "MO": (36.0, 40.6, -95.8, -89.1),
        "IL": (37.0, 42.5, -91.5, -87.5),
        "IN": (37.8, 41.8, -88.1, -84.8),
        "OH": (38.4, 42.0, -84.8, -80.5),
        "KY": (36.5, 39.1, -89.6, -82.0),
        "TN": (35.0, 36.7, -90.3, -81.6),
        "NC": (33.8, 36.6, -84.3, -75.5),
        "SC": (32.0, 35.2, -83.4, -78.5),
        "VA": (36.5, 39.5, -83.7, -75.2),
        "WV": (37.2, 40.6, -82.6, -77.7),
        "AK": (51.0, 72.0, -180.0, -130.0),  # expect none (CONUS)
        "HI": (18.0, 23.0, -161.0, -154.0),
    }
    state_locs = Counter()
    state_yes_locs = Counter()

    reader = pd.read_csv(CSV, chunksize=CHUNK, low_memory=False)
    for chunk in reader:
        n_rows += len(chunk)
        lat = chunk["latitude"].to_numpy(dtype=float)
        lon = chunk["longitude"].to_numpy(dtype=float)
        dts = chunk["datetime"].astype(str).to_numpy()
        wf = chunk["Wildfire"].astype(str).str.strip().str.lower().eq("yes").to_numpy()

        # sentinel
        cov = chunk[COVARIATES]
        any_sent = (cov == SENTINEL).any(axis=1)
        sentinel_rows += int(any_sent.sum())
        for c in COVARIATES:
            sentinel_per_col[c] += int((chunk[c] == SENTINEL).sum())
            s = chunk[c]
            valid = s[(s != SENTINEL) & s.notna()]
            if valid.empty:
                continue
            cov_min[c] = min(cov_min[c], float(valid.min()))
            cov_max[c] = max(cov_max[c], float(valid.max()))
            cov_sum[c] += float(valid.sum())
            cov_n[c] += int(len(valid))

        for a, b, y in zip(lat, lon, wf):
            key = (float(a), float(b))
            unique_full.add(key)
            if y:
                unique_full_yes.add(key)

        # Sequence run lengths if file ordered by location blocks
        for a, b, y in zip(lat, lon, wf):
            key = (float(a), float(b))
            if prev_key is None:
                prev_key = key
                run_len = 1
                run_yes = int(y)
            elif key == prev_key:
                run_len += 1
                run_yes += int(y)
            else:
                run_lens.append(run_len)
                run_yes_counts.append(run_yes)
                prev_key = key
                run_len = 1
                run_yes = int(y)
        # don't close last run until end

        # CA / national loc-years with Yes
        years = pd.to_datetime(chunk["datetime"], format="%Y-%m-%d", errors="coerce").dt.year.to_numpy()
        in_ca = (lat >= 32.0) & (lat <= 42.5) & (lon >= -124.5) & (lon <= -114.0)
        for a, b, y, yr, ca in zip(lat, lon, wf, years, in_ca):
            if not y or yr != yr:  # nan year
                continue
            k4 = (round(float(a), 4), round(float(b), 4))
            nat_pos_loc_years.add((k4[0], k4[1], int(yr)))
            if ca:
                ca_pos_loc_years.add((k4[0], k4[1], int(yr)))
                ca_yes_dates_by_loc[k4].append(str(chunk["datetime"].iloc[0]))  # wrong - fix below

        # Fix CA yes dates properly
        ca_idx = np.where(in_ca & wf)[0]
        for i in ca_idx:
            k4 = (round(float(lat[i]), 4), round(float(lon[i]), 4))
            # overwrite list properly — use set later
            if k4 not in ca_yes_dates_by_loc or True:
                pass
        # clear and rebuild with sets
        # Actually use separate set accumulator
        # (handled via ca_pos_loc_years)

        # State presence
        for a, b, y in zip(lat[::50], lon[::50], wf[::50]):  # subsample for speed
            for st, (la0, la1, lo0, lo1) in STATE_BOXES.items():
                if la0 <= a <= la1 and lo0 <= b <= lo1:
                    state_locs[st] += 1
                    if y:
                        state_yes_locs[st] += 1
                    break

        if n_rows % 1_000_000 < CHUNK:
            print(f"[pass2] rows={n_rows:,} unique_full={len(unique_full):,}", flush=True)

    if prev_key is not None:
        run_lens.append(run_len)
        run_yes_counts.append(run_yes)

    run_len_hist = Counter(run_lens)
    run_yes_hist = Counter(run_yes_counts)

    # Implied events from yes/15
    # From pass1 distribution we have; recompute from run_yes_counts for consecutive blocks
    implied_events_from_runs = sum(y / 15.0 for y in run_yes_counts if y > 0)

    # CA events by year from loc-years
    ca_events_by_year = Counter(y for _, _, y in ca_pos_loc_years)
    nat_events_by_year = Counter(y for _, _, y in nat_pos_loc_years)

    # GRIDMET grid alignment: check if coords snap to ~1/24 degree
    # sample unique coords
    sample = list(unique_full)[:5000]
    # GRIDMET often 1/24 deg = 0.041666...
    fracs_lat = [abs((a * 24) - round(a * 24)) for a, _ in sample]
    fracs_lon = [abs((b * 24) - round(b * 24)) for _, b in sample]

    results = {
        "n_rows": n_rows,
        "sentinel_32767": {
            "rows_with_any_sentinel": sentinel_rows,
            "pct_rows": round(100.0 * sentinel_rows / n_rows, 4),
            "per_column": dict(sentinel_per_col),
            "note": "32767 is classic Int16 fill; treat as missing, not physical",
        },
        "covariates_excluding_sentinel": {
            c: {
                "min": None if cov_min[c] == np.inf else cov_min[c],
                "max": None if cov_max[c] == -np.inf else cov_max[c],
                "mean": (cov_sum[c] / cov_n[c]) if cov_n[c] else None,
                "n": cov_n[c],
            }
            for c in COVARIATES
        },
        "unique_locations_full_precision": len(unique_full),
        "unique_locations_with_yes_full_precision": len(unique_full_yes),
        "sequence_runs_if_file_blocked_by_location": {
            "n_runs": len(run_lens),
            "length_histogram_top": dict(run_len_hist.most_common(15)),
            "pct_run_len_75": round(100.0 * run_len_hist.get(75, 0) / max(len(run_lens), 1), 2),
            "yes_count_histogram_top": dict(run_yes_hist.most_common(15)),
            "implied_positive_events_yes_over_15": round(implied_events_from_runs, 1),
        },
        "positive_loc_year_units": {
            "national_unique_loc4_year_with_yes": len(nat_pos_loc_years),
            "national_by_year": dict(sorted(nat_events_by_year.items())),
            "california_unique_loc4_year_with_yes": len(ca_pos_loc_years),
            "california_by_year": dict(sorted(ca_events_by_year.items())),
            "note": "A loc-year with Yes is a proxy for one ignition event after 15-day labeling; multi-fire same cell-year collapses",
        },
        "gridmet_1_24_deg_snap_sample": {
            "n_sample": len(sample),
            "mean_lat_frac_from_1_24": float(np.mean(fracs_lat)),
            "mean_lon_frac_from_1_24": float(np.mean(fracs_lon)),
            "pct_lat_within_1e-4_of_1_24": round(100.0 * np.mean([f < 1e-4 for f in fracs_lat]), 2),
            "pct_lon_within_1e-4_of_1_24": round(100.0 * np.mean([f < 1e-4 for f in fracs_lon]), 2),
        },
        "approx_state_presence_subsampled_rows": {
            "row_hits": dict(state_locs.most_common()),
            "yes_hits": dict(state_yes_locs.most_common()),
            "note": "Rough bbox hits on 1/50 row subsample — presence signal only, not counts",
        },
    }
    OUT.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(json.dumps({
        "unique_full": len(unique_full),
        "unique_yes": len(unique_full_yes),
        "n_runs": len(run_lens),
        "pct_75": results["sequence_runs_if_file_blocked_by_location"]["pct_run_len_75"],
        "implied_events": implied_events_from_runs,
        "ca_loc_years": len(ca_pos_loc_years),
        "nat_loc_years": len(nat_pos_loc_years),
        "sentinel_rows": sentinel_rows,
    }, indent=2), flush=True)


if __name__ == "__main__":
    main()
