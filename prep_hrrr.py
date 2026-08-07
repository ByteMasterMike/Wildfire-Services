"""
prep_hrrr.py
------------
STANDALONE preprocessing script. Run this LOCALLY where your full HRRR
files live (the 4-per-year files you can't upload). It collapses the raw
HRRR grid into a compact per-circuit daily weather table that IS small
enough to upload (~1 MB per year).

What it does:
  1. Loads circuit midpoints (precomputed from the .shp).
  2. Reads each HRRR file, extracts the unique grid-cell centroids.
  3. Assigns every circuit to its nearest HRRR cell (KD-tree, done once).
  4. Joins weather onto circuits by (date, nearest cell).
  5. Writes circuit_weather.csv with columns:
        date, seg_idx, circuitid, TMP, SPFH, wind_speed

Upload only the output CSV. The main pipeline reads it directly.

Usage:
    python prep_hrrr.py \
        --midpoints data/circuit_midpoints.csv \
        --hrrr "hrrr_data/*.csv" \
        --out data/circuit_weather.csv
"""

import argparse
import glob
import numpy as np
import pandas as pd
from pathlib import Path
from scipy.spatial import cKDTree


# Expected HRRR raw column names (adjust here if your extractor differs)
HRRR_COLS = {
    "date":  "Date",
    "cell":  "Cell_ID",
    "lat":   "Latitude",
    "lon":   "Longitude",
    "tmp":   "Temperature",
    "spfh":  "Specific humidity",
    "u":     "U component of wind",
    "v":     "V component of wind",
}


def load_hrrr_file(path: str) -> pd.DataFrame:
    """Read one HRRR CSV and standardise columns + derive wind speed."""
    df = pd.read_csv(path, low_memory=False)
    df.columns = df.columns.str.strip()

    c = HRRR_COLS
    df["date"] = pd.to_datetime(df[c["date"]], errors="coerce").dt.normalize()
    df = df.dropna(subset=["date"])   # drops any header-as-data rows

    # Coerce numeric cols in case any file has embedded string header rows
    for col in [c["tmp"], c["spfh"], c["u"], c["v"]]:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df.dropna(subset=[c["tmp"], c["u"], c["v"]])
    df["wind_speed"] = np.sqrt(df[c["u"]] ** 2 + df[c["v"]] ** 2)

    out = df.rename(columns={
        c["cell"]: "Cell_ID",
        c["lat"]:  "lat",
        c["lon"]:  "lon",
        c["tmp"]:  "TMP",
        c["spfh"]: "SPFH",
    })[["date", "Cell_ID", "lat", "lon", "TMP", "SPFH", "wind_speed"]]

    return out.dropna(subset=["lat", "lon"])


def assign_circuits_to_cells(
    circuit_mid: pd.DataFrame, cell_centroids: pd.DataFrame
) -> np.ndarray:
    """
    KD-tree nearest-cell lookup. Returns an array of Cell_IDs, one per circuit.
    Uses equirectangular metres approximation for the small CA extent.
    """
    R = 111_320.0  # metres per degree latitude
    lat0 = np.deg2rad(circuit_mid["mid_lat"].mean())

    def to_xy(lat, lon):
        x = np.deg2rad(lon) * np.cos(lat0) * R
        y = np.deg2rad(lat) * R
        return np.column_stack([x, y])

    cell_xy = to_xy(cell_centroids["lat"].values, cell_centroids["lon"].values)
    circ_xy = to_xy(circuit_mid["mid_lat"].values, circuit_mid["mid_lon"].values)

    tree = cKDTree(cell_xy)
    dist, idx = tree.query(circ_xy, k=1)
    nearest_cell = cell_centroids["Cell_ID"].values[idx]

    print(f"  Assigned {len(circuit_mid)} circuits to "
          f"{len(np.unique(nearest_cell))} unique cells "
          f"(median dist {np.median(dist)/1000:.1f} km)")
    return nearest_cell


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--midpoints", default="data/circuit_midpoints.csv")
    ap.add_argument("--hrrr", required=True,
                    help="glob pattern for HRRR file(s), e.g. 'hrrr/*.csv'")
    ap.add_argument("--out", default="data/circuit_weather.csv")
    args = ap.parse_args()

    print("[1/4] Loading circuit midpoints ...")
    mid = pd.read_csv(args.midpoints)
    print(f"      {len(mid)} circuits.")

    files = sorted(glob.glob(args.hrrr))
    if not files:
        raise SystemExit(f"No HRRR files match pattern: {args.hrrr}")
    print(f"[2/4] Found {len(files)} HRRR file(s).")

    # Establish circuit->cell mapping ONCE using the first file's grid
    first = load_hrrr_file(files[0])
    centroids = first.groupby("Cell_ID")[["lat", "lon"]].first().reset_index()
    print(f"      Grid has {len(centroids)} cells.")
    mid["Cell_ID"] = assign_circuits_to_cells(mid, centroids)

    print("[3/4] Aggregating weather across all files ...")
    pieces = []
    for f in files:
        hrrr = load_hrrr_file(f)
        # daily mean per cell (in case of sub-daily records)
        daily = (hrrr.groupby(["date", "Cell_ID"])[["TMP", "SPFH", "wind_speed"]]
                      .mean().reset_index())
        pieces.append(daily)
        print(f"      {Path(f).name}: {daily['date'].nunique()} days, "
              f"{len(daily)} cell-days")
    weather = pd.concat(pieces, ignore_index=True).drop_duplicates(["date", "Cell_ID"])

    print("[4/4] Joining weather onto circuits ...")
    merged = mid[["seg_idx", "circuitid", "Cell_ID"]].merge(
        weather, on="Cell_ID", how="left"
    )
    merged = merged[["date", "seg_idx", "circuitid", "TMP", "SPFH", "wind_speed"]]
    merged = merged.dropna(subset=["date"]).sort_values(["date", "seg_idx"])

    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    merged.to_csv(args.out, index=False)

    size_mb = Path(args.out).stat().st_size / 1e6
    print(f"\nDONE. Wrote {len(merged)} circuit-days to {args.out} "
          f"({size_mb:.1f} MB).")
    print(f"Date span: {merged['date'].min().date()} to {merged['date'].max().date()}")
    print("Upload this single file; the main pipeline reads it directly.")


if __name__ == "__main__":
    main()
