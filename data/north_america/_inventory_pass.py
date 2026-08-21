"""One-shot inventory of Wildfire_Dataset.csv — report only, no loaders."""

from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent
CSV = ROOT / "Wildfire_Dataset.csv"
OUT = ROOT / "_inventory_results.json"

CHUNK = 250_000
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


def main() -> None:
    size_bytes = CSV.stat().st_size
    header = CSV.open("r", encoding="utf-8").readline().rstrip("\n").split(",")

    # Accumulators
    n_rows = 0
    wildfire_counts: Counter[str] = Counter()
    nulls = Counter({c: 0 for c in header})
    state_proxy = Counter()  # lat/lon bins rough; also use approx state via bounds
    year_counts = Counter()
    year_pos = Counter()
    year_neg = Counter()
    date_parse_fail = 0
    date_formats: Counter[str] = Counter()
    min_dt: datetime | None = None
    max_dt: datetime | None = None
    lat_min = lon_min = np.inf
    lat_max = lon_max = -np.inf
    # unique (lat,lon) rounded
    unique_locs: set[tuple[float, float]] = set()
    unique_locs_pos: set[tuple[float, float]] = set()
    unique_locs_neg: set[tuple[float, float]] = set()
    # sequence structure: group by rounded lat/lon + see window lengths
    # track consecutive days per location for a sample of locations
    # For positives: days labeled Yes per location
    pos_days_per_loc: Counter[tuple[float, float]] = Counter()
    # Duplicate full-row hashes sample
    # Value ranges
    cov_min = {c: np.inf for c in COVARIATES}
    cov_max = {c: -np.inf for c in COVARIATES}
    cov_sum = {c: 0.0 for c in COVARIATES}
    cov_count = {c: 0 for c in COVARIATES}
    # Implausible TMP flags (Kelvin expected ~200-330)
    tmmx_out_of_kelvin = 0
    tmmn_out_of_kelvin = 0
    sph_out = 0  # expect ~0-0.03 kg/kg
    vs_neg = 0
    fm100_out = 0  # percent 0-100ish
    # CA filter
    ca_year_all = Counter()
    ca_year_pos = Counter()
    ca_year_neg = Counter()
    # Exact duplicate keys (lat,lon,datetime)
    key_dupes = 0
    seen_keys_sample: set[tuple] = set()
    # Track wildfire label values
    # Day gaps: sample sequence lengths — collect per (lat_r, lon_r) the set of dates for first N locs
    seq_dates: dict[tuple[float, float], set[str]] = {}
    SEQ_CAP_LOCS = 5000
    # Distinct datetimes overall
    # Positive event "ignition day" candidates: for each pos location, min date with Yes?
    # Better: count distinct (lat,lon) that ever have Yes, and count of Yes rows
    yes_rows = 0
    no_rows = 0
    # Check if Yes appears only once per location or multiple days in window
    # Track for each location: count of Yes days
    loc_yes_counts: dict[tuple[float, float], int] = {}
    LOC_YES_TRACK = 200_000  # cap memory

    # Approximate state coverage via coarse lat/lon grid + known CA box
    # Also count CONUS bbox
    outside_conus_paper = 0  # paper: [24.4,49.4] x [-125,-66.9]

    # Datetime string pattern
    iso_re = re.compile(r"^\d{4}-\d{2}-\d{2}$")

    reader = pd.read_csv(
        CSV,
        chunksize=CHUNK,
        dtype={
            "latitude": "float64",
            "longitude": "float64",
            "datetime": "string",
            "Wildfire": "string",
            **{c: "float64" for c in COVARIATES},
        },
        low_memory=False,
    )

    chunk_i = 0
    for chunk in reader:
        chunk_i += 1
        n = len(chunk)
        n_rows += n

        # Nulls
        for c in header:
            nulls[c] += int(chunk[c].isna().sum())

        # Labels
        wf = chunk["Wildfire"].fillna("<NA>").astype(str).str.strip()
        wildfire_counts.update(wf.value_counts().to_dict())
        is_yes = wf.str.lower().isin(["yes", "true", "1"])
        is_no = wf.str.lower().isin(["no", "false", "0"])
        yes_rows += int(is_yes.sum())
        no_rows += int(is_no.sum())

        # Dates
        dts = chunk["datetime"].astype(str).str.strip()
        for s in dts.head(3):
            if iso_re.match(s):
                date_formats["YYYY-MM-DD"] += 1
            else:
                date_formats[s[:20]] += 1
        # vectorized parse
        parsed = pd.to_datetime(dts, errors="coerce", format="%Y-%m-%d")
        date_parse_fail += int(parsed.isna().sum())
        years = parsed.dt.year
        year_counts.update(years.dropna().astype(int).value_counts().to_dict())
        year_pos.update(years[is_yes].dropna().astype(int).value_counts().to_dict())
        year_neg.update(years[is_no].dropna().astype(int).value_counts().to_dict())
        if parsed.notna().any():
            cmin = parsed.min().to_pydatetime()
            cmax = parsed.max().to_pydatetime()
            min_dt = cmin if min_dt is None or cmin < min_dt else min_dt
            max_dt = cmax if max_dt is None or cmax > max_dt else max_dt

        lat = chunk["latitude"].to_numpy()
        lon = chunk["longitude"].to_numpy()
        lat_min = min(lat_min, float(np.nanmin(lat)))
        lat_max = max(lat_max, float(np.nanmax(lat)))
        lon_min = min(lon_min, float(np.nanmin(lon)))
        lon_max = max(lon_max, float(np.nanmax(lon)))

        # CONUS paper bbox
        outside_conus_paper += int(
            (
                (lat < 24.4)
                | (lat > 49.4)
                | (lon < -125.0)
                | (lon > -66.9)
                | np.isnan(lat)
                | np.isnan(lon)
            ).sum()
        )

        # CA bbox (same as website client roughly)
        in_ca = (lat >= 32.0) & (lat <= 42.5) & (lon >= -124.5) & (lon <= -114.0)
        # tighter CA: also use lon/lat; for inventory bbox is enough
        ca_years = years[in_ca].dropna().astype(int)
        ca_year_all.update(ca_years.value_counts().to_dict())
        ca_year_pos.update(years[in_ca & is_yes].dropna().astype(int).value_counts().to_dict())
        ca_year_neg.update(years[in_ca & is_no].dropna().astype(int).value_counts().to_dict())

        # Unique locations rounded to 5 decimals (~1m) — memory heavy; use 4 decimals (~11m)
        lat_r = np.round(lat, 4)
        lon_r = np.round(lon, 4)
        for a, b in zip(lat_r, lon_r):
            if np.isnan(a) or np.isnan(b):
                continue
            unique_locs.add((float(a), float(b)))
        for a, b in zip(lat_r[is_yes.to_numpy()], lon_r[is_yes.to_numpy()]):
            if np.isnan(a) or np.isnan(b):
                continue
            unique_locs_pos.add((float(a), float(b)))
        for a, b in zip(lat_r[is_no.to_numpy()], lon_r[is_no.to_numpy()]):
            if np.isnan(a) or np.isnan(b):
                continue
            unique_locs_neg.add((float(a), float(b)))

        # Track Yes counts per location (capped)
        if len(loc_yes_counts) < LOC_YES_TRACK:
            for a, b, y in zip(lat_r[is_yes.to_numpy()], lon_r[is_yes.to_numpy()], [True] * int(is_yes.sum())):
                if np.isnan(a) or np.isnan(b):
                    continue
                key = (float(a), float(b))
                loc_yes_counts[key] = loc_yes_counts.get(key, 0) + 1

        # Sequence length sampling
        if len(seq_dates) < SEQ_CAP_LOCS:
            for a, b, d in zip(lat_r, lon_r, dts):
                if np.isnan(a) or np.isnan(b):
                    continue
                key = (float(a), float(b))
                if key not in seq_dates:
                    if len(seq_dates) >= SEQ_CAP_LOCS:
                        break
                    seq_dates[key] = set()
                if key in seq_dates:
                    seq_dates[key].add(str(d))

        # Within-chunk duplicate (lat,lon,datetime); also cross-chunk for first 500k keys only
        keys = list(zip(lat_r, lon_r, dts.tolist()))
        key_dupes += n - len(set(keys))
        if len(seen_keys_sample) < 500_000:
            for k in keys:
                if len(seen_keys_sample) >= 500_000:
                    break
                if k in seen_keys_sample:
                    key_dupes += 1
                else:
                    seen_keys_sample.add(k)

        # Covariate ranges
        for c in COVARIATES:
            s = chunk[c]
            valid = s.dropna()
            if valid.empty:
                continue
            vmin = float(valid.min())
            vmax = float(valid.max())
            cov_min[c] = min(cov_min[c], vmin)
            cov_max[c] = max(cov_max[c], vmax)
            cov_sum[c] += float(valid.sum())
            cov_count[c] += int(valid.shape[0])

        tmmx = chunk["tmmx"]
        tmmn = chunk["tmmn"]
        tmmx_out_of_kelvin += int(((tmmx < 200) | (tmmx > 330)).fillna(False).sum())
        tmmn_out_of_kelvin += int(((tmmn < 200) | (tmmn > 330)).fillna(False).sum())
        sph = chunk["sph"]
        sph_out += int(((sph < 0) | (sph > 0.05)).fillna(False).sum())
        vs_neg += int((chunk["vs"] < 0).fillna(False).sum())
        fm100_out += int(((chunk["fm100"] < 0) | (chunk["fm100"] > 100)).fillna(False).sum())

        if chunk_i % 4 == 0:
            print(f"[inventory] chunk {chunk_i}: rows={n_rows:,} unique_locs≈{len(unique_locs):,}", flush=True)

    # Sequence length stats from sample
    seq_lens = [len(v) for v in seq_dates.values()]
    seq_len_counter = Counter(seq_lens)

    # Yes-days per location distribution from tracked set
    yes_per_loc = list(loc_yes_counts.values())
    yes_dist = Counter(yes_per_loc)

    # Coarse US state coverage: 1-degree bins count
    # Re-scan lightly? Too expensive. Approximate from unique_locs
    deg_bins = Counter()
    for a, b in unique_locs:
        deg_bins[(int(np.floor(a)), int(np.floor(b)))] += 1

    results = {
        "file": str(CSV),
        "size_bytes": size_bytes,
        "size_gb": round(size_bytes / 1e9, 3),
        "columns": header,
        "n_rows": n_rows,
        "wildfire_label_counts": dict(wildfire_counts),
        "yes_rows": yes_rows,
        "no_rows": no_rows,
        "nulls": dict(nulls),
        "date": {
            "min": min_dt.isoformat() if min_dt else None,
            "max": max_dt.isoformat() if max_dt else None,
            "parse_fail": date_parse_fail,
            "formats_sample": dict(date_formats),
            "rows_by_year": dict(sorted(year_counts.items())),
            "yes_by_year": dict(sorted(year_pos.items())),
            "no_by_year": dict(sorted(year_neg.items())),
        },
        "geo": {
            "lat_min": lat_min,
            "lat_max": lat_max,
            "lon_min": lon_min,
            "lon_max": lon_max,
            "outside_paper_conus_bbox": outside_conus_paper,
            "unique_locations_round4": len(unique_locs),
            "unique_locations_with_yes": len(unique_locs_pos),
            "unique_locations_with_no": len(unique_locs_neg),
            "degree_bins_count": len(deg_bins),
        },
        "sequence_sample": {
            "n_locations_sampled": len(seq_dates),
            "length_histogram": dict(sorted(seq_len_counter.items())),
            "mean_length": float(np.mean(seq_lens)) if seq_lens else None,
            "median_length": float(np.median(seq_lens)) if seq_lens else None,
            "pct_exactly_75": (
                round(100.0 * seq_len_counter.get(75, 0) / len(seq_lens), 2) if seq_lens else None
            ),
        },
        "yes_days_per_location_tracked": {
            "n_locations_tracked": len(loc_yes_counts),
            "distribution": dict(sorted(yes_dist.items())[:50]),
            "max_yes_days": max(yes_per_loc) if yes_per_loc else None,
            "pct_exactly_1_yes_day": (
                round(100.0 * yes_dist.get(1, 0) / len(yes_per_loc), 2) if yes_per_loc else None
            ),
            "pct_exactly_15_yes_days": (
                round(100.0 * yes_dist.get(15, 0) / len(yes_per_loc), 2) if yes_per_loc else None
            ),
            "note": "Paper: 15 days after ignition labeled; expect many locs with 15 Yes days if label is window-wide after ignition",
        },
        "duplicates": {
            "exact_latlon_datetime_dupes_in_first_2M_rows": key_dupes,
            "keys_tracked": len(seen_keys_sample),
        },
        "covariates": {
            c: {
                "min": None if cov_min[c] == np.inf else cov_min[c],
                "max": None if cov_max[c] == -np.inf else cov_max[c],
                "mean": (cov_sum[c] / cov_count[c]) if cov_count[c] else None,
                "non_null": cov_count[c],
            }
            for c in COVARIATES
        },
        "quality_flags": {
            "tmmx_outside_200_330K": tmmx_out_of_kelvin,
            "tmmn_outside_200_330K": tmmn_out_of_kelvin,
            "sph_outside_0_0.05": sph_out,
            "vs_negative": vs_neg,
            "fm100_outside_0_100": fm100_out,
        },
        "california_bbox_32_42p5_N_124p5_114_W": {
            "rows_by_year": dict(sorted(ca_year_all.items())),
            "yes_by_year": dict(sorted(ca_year_pos.items())),
            "no_by_year": dict(sorted(ca_year_neg.items())),
            "total_rows": int(sum(ca_year_all.values())),
            "total_yes": int(sum(ca_year_pos.values())),
            "total_no": int(sum(ca_year_neg.values())),
        },
    }

    OUT.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(f"[inventory] DONE rows={n_rows:,} -> {OUT}", flush=True)


if __name__ == "__main__":
    main()
