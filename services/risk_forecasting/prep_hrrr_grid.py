"""
prep_hrrr_grid.py
-----------------
STANDALONE script. Run this LOCALLY to extract HRRR weather at the
exact 824 grid cells used by the vegetation/modeling pipeline.

This replaces prep_hrrr.py for the grid-based pipeline.
Output: grid_weather_YYYY.csv with columns:
    date, cell_id, lat, lon, TMP, SPFH, wind_speed

One file per year. Each is ~5MB and uploadable.

Usage:
    python prep_hrrr_grid.py --grid data/grid_cells.csv \
        --hrrr "California_HRRR_daily*.csv" \
        --year 2024 \
        --out grid_weather_2024.csv
"""

import argparse
import glob
import numpy as np
import pandas as pd
from pathlib import Path
from scipy.spatial import cKDTree


HRRR_COLS = {
    "date": "Date",
    "cell": "Cell_ID",
    "lat":  "Latitude",
    "lon":  "Longitude",
    "tmp":  "Temperature",
    "spfh": "Specific humidity",
    "u":    "U component of wind",
    "v":    "V component of wind",
}


# Reject days whose median TMP is outside this Kelvin range (catches
# export/column-shift corruption, e.g. Dec 2020 in California_HRRR_daily_2020_01).
TMP_MEDIAN_MIN_K = 200.0
TMP_MEDIAN_MAX_K = 330.0


def load_hrrr_file(path: str) -> pd.DataFrame:
    df = pd.read_csv(path, low_memory=False)
    df.columns = df.columns.str.strip()
    c = HRRR_COLS
    df["date"] = pd.to_datetime(df[c["date"]], errors="coerce").dt.normalize()
    df = df.dropna(subset=["date"])
    for col in [c["tmp"], c["spfh"], c["u"], c["v"], c["lat"], c["lon"]]:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df.dropna(subset=[c["tmp"], c["u"], c["v"]])
    df["wind_speed"] = np.sqrt(df[c["u"]] ** 2 + df[c["v"]] ** 2)
    out = df.rename(columns={
        c["cell"]: "Cell_ID", c["lat"]: "hrrr_lat", c["lon"]: "hrrr_lon",
        c["tmp"]: "TMP", c["spfh"]: "SPFH",
    })[["date", "Cell_ID", "hrrr_lat", "hrrr_lon", "TMP", "SPFH", "wind_speed"]]
    return reject_bad_tmp_days(out, source=path)


def reject_bad_tmp_days(
    df: pd.DataFrame,
    source: str = "",
    min_k: float = TMP_MEDIAN_MIN_K,
    max_k: float = TMP_MEDIAN_MAX_K,
) -> pd.DataFrame:
    """Drop calendar days whose median TMP is outside [min_k, max_k]."""
    if df.empty:
        return df
    med = df.groupby("date", sort=True)["TMP"].median()
    bad = med[(med < min_k) | (med > max_k)]
    if len(bad) == 0:
        return df
    label = Path(source).name if source else "HRRR"
    print(
        f"  [SANITY] {label}: rejecting {len(bad)} day(s) with median TMP "
        f"outside [{min_k}, {max_k}] K"
    )
    for dt, val in bad.items():
        print(f"           {pd.Timestamp(dt).date()}  median_TMP={val:.4f}")
    keep = ~df["date"].isin(bad.index)
    return df.loc[keep].reset_index(drop=True)


def match_grid_to_hrrr(grid_df: pd.DataFrame, hrrr_cells: pd.DataFrame) -> np.ndarray:
    """For each grid cell, find the nearest HRRR Cell_ID."""
    R = 111_320.0
    lat0 = np.deg2rad(grid_df["lat"].mean())
    def to_xy(lat, lon):
        return np.column_stack([np.deg2rad(lon)*np.cos(lat0)*R, np.deg2rad(lat)*R])
    tree = cKDTree(to_xy(hrrr_cells["hrrr_lat"].values, hrrr_cells["hrrr_lon"].values))
    dist, idx = tree.query(to_xy(grid_df["lat"].values, grid_df["lon"].values), k=1)
    print(f"  Grid->HRRR match: median={np.median(dist)/1000:.2f} km, "
          f"max={dist.max()/1000:.2f} km")
    return hrrr_cells["Cell_ID"].values[idx]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--grid",  default="data/grid_cells.csv",
                    help="Path to grid_cells.csv")
    ap.add_argument("--hrrr",  required=True,
                    help="Glob for HRRR CSVs, e.g. 'California_HRRR_daily*.csv'")
    ap.add_argument("--year",  type=int, required=True,
                    help="Year to extract, e.g. 2024")
    ap.add_argument("--out",   required=True,
                    help="Output CSV path, e.g. grid_weather_2024.csv")
    args = ap.parse_args()

    print(f"[1/4] Loading grid ({args.grid}) ...")
    grid = pd.read_csv(args.grid)
    N = len(grid)
    print(f"      {N} grid cells.")

    files = sorted(glob.glob(args.hrrr))
    if not files:
        raise SystemExit(f"No files found: {args.hrrr}")
    print(f"[2/4] Found {len(files)} HRRR file(s). Filtering to year {args.year} ...")

    pieces = []
    for f in files:
        df = load_hrrr_file(f)
        yr = df[df["date"].dt.year == args.year]
        if len(yr) == 0:
            continue
        pieces.append(yr)
        print(f"      {Path(f).name}: {yr['date'].nunique()} days for {args.year}")

    if not pieces:
        raise SystemExit(f"No data found for year {args.year}")
    hrrr = pd.concat(pieces, ignore_index=True)

    print(f"[3/4] Matching grid cells to HRRR cells ...")
    hrrr_centroids = hrrr.groupby("Cell_ID")[["hrrr_lat","hrrr_lon"]].first().reset_index()
    grid_to_hrrr = match_grid_to_hrrr(grid, hrrr_centroids)
    grid["hrrr_cell"] = grid_to_hrrr

    print(f"[4/4] Joining weather to grid cells ...")
    daily = (hrrr.groupby(["date", "Cell_ID"])[["TMP", "SPFH", "wind_speed"]]
                  .mean().reset_index()
                  .rename(columns={"Cell_ID": "hrrr_cell"}))

    result = grid[["cell_id", "lat", "lon", "hrrr_cell"]].merge(
        daily, on="hrrr_cell", how="left"
    )[["date", "cell_id", "lat", "lon", "TMP", "SPFH", "wind_speed"]]
    result = result.dropna(subset=["date"])
    result = result.sort_values(["date", "cell_id"])

    result.to_csv(args.out, index=False)
    mb = Path(args.out).stat().st_size / 1e6
    print(f"\nDONE. {len(result)} rows -> {args.out} ({mb:.1f} MB)")
    print(f"Dates: {result['date'].min().date()} to {result['date'].max().date()}")
    print("Upload this file to the pipeline.")


if __name__ == "__main__":
    main()
