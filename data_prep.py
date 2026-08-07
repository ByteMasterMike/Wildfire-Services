"""
data_prep.py
------------
Loads and prepares all data sources for the cNHPP wildfire baseline:
  - GNA circuits: attribute table (substation topology)
  - CPUC fire events: point events with lat/lon/datetime
  - HRRR weather: gridded covariates (temperature, wind, humidity)

Outputs:
  - circuits_df   : GNA attribute DataFrame (N rows)
  - W             : (N x N) sparse adjacency matrix (same-substation neighbors)
  - events_df     : CPUC events snapped to circuits
  - E             : (N x T) integer event count matrix
  - X             : (T x N x q) covariate array [TMP, WIND, SPFH]
  - date_range    : T-length DatetimeIndex
"""

import numpy as np
import pandas as pd
from scipy.sparse import lil_matrix, csr_matrix
from pathlib import Path
from collections import defaultdict
from typing import Tuple, Optional
import warnings

warnings.filterwarnings("ignore")


# ─────────────────────────────────────────────
# 1.  GNA CIRCUITS (attribute table)
# ─────────────────────────────────────────────

def load_gna_attributes(dbf_path: str) -> pd.DataFrame:
    """
    Load GNA circuits from the .dbf attribute table.
    Returns a DataFrame with one row per circuit, indexed 0..N-1.
    """
    from dbfread import DBF

    print("[GNA] Loading circuit attributes from .dbf ...")
    table = DBF(dbf_path, encoding="latin-1", ignore_missing_memofile=True)
    df = pd.DataFrame(iter(table)).reset_index(drop=True)

    # Keep useful columns; rename truncated shapefile names
    rename = {
        "substati_1": "substation_name",
        "circuitnam": "circuit_name",
        "gnafacilit": "gna_facility",
        "Shape__Len": "length_m",
    }
    df = df.rename(columns=rename)

    # Assign a clean integer segment index used throughout the pipeline
    df["seg_idx"] = df.index

    print(f"[GNA]   {len(df)} circuits  |  {df['substation'].nunique()} substations  "
          f"|  {df['division'].nunique()} divisions")
    return df


# ─────────────────────────────────────────────
# 2.  ADJACENCY MATRIX  W
# ─────────────────────────────────────────────

def build_adjacency_matrix(circuits_df: pd.DataFrame) -> csr_matrix:
    """
    Build N×N sparse weight matrix W where two circuits are neighbors
    if they share the same substation.  Equal weights: w_ij = 1/|Ω_i|.

    Self-loops are included so isolated circuits (single feeder substations)
    still have a valid h(i,t) term.
    """
    print("[ADJ] Building adjacency matrix W from substation topology ...")
    N = len(circuits_df)
    substations = circuits_df["substation"].values

    # Map substation code → list of segment indices
    sub_to_segs: dict[str, list[int]] = defaultdict(list)
    for idx, sub in enumerate(substations):
        sub_to_segs[sub].append(idx)

    W = lil_matrix((N, N), dtype=np.float32)
    for sub, indices in sub_to_segs.items():
        deg = len(indices)
        w = 1.0 / deg          # equal weight among all circuits at this substation
        for i in indices:
            for j in indices:
                W[i, j] = w    # includes self-loop when deg==1; off-diag otherwise

    W_csr = W.tocsr()
    nnz = W_csr.nnz
    print(f"[ADJ]   W shape: {N}×{N}  |  nonzeros: {nnz}  "
          f"|  sparsity: {100*(1 - nnz/N**2):.4f}%")
    return W_csr


# ─────────────────────────────────────────────
# 3.  CPUC FIRE EVENTS
# ─────────────────────────────────────────────

def load_cpuc_events(
    csv_path: str,
    utility_filter: str = "PG&E",
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> pd.DataFrame:
    """
    Load CPUC fire-ignition events.

    Accepts two formats:
      Simple  : columns  Lat, Lon, T
      Detailed: columns  Latitude, Longitude, Fire Start Date, Time, Utility Name, ...

    Returns a DataFrame with standardised columns:
      lat, lon, datetime, date, utility, event_id (if available)
    """
    print(f"[CPUC] Loading fire events from {Path(csv_path).name} ...")

    # The CPUC Excel export has a two-row header (category row + field row).
    # Detect it: if the second row contains "Latitude", use header=1.
    probe = pd.read_csv(csv_path, nrows=2, header=None)
    has_two_row_header = "Latitude" in probe.iloc[1].astype(str).values

    if has_two_row_header:
        df = pd.read_csv(csv_path, header=1, low_memory=False)
        df.columns = df.columns.str.strip()
        # First two unnamed columns are Index and Utility Name
        df = df.rename(columns={
            df.columns[0]: "Index",
            df.columns[1]: "Utility Name",
        })
        df = df.dropna(how="all")
        df["Fire Start Date"] = df["Date"]   # unify with detailed-format parser
    else:
        df = pd.read_csv(csv_path, low_memory=False)
        df.columns = df.columns.str.strip()

    # ── Detect format and parse datetime ──────────────────────────────────
    if "Fire Start Date" in df.columns:
        # Detailed CPUC format
        df["datetime"] = pd.to_datetime(
            df["Fire Start Date"].astype(str).str.strip()
            + " "
            + df["Time"].astype(str).str.strip(),
            errors="coerce",
        )
        lat_col = "Latitude"
        lon_col = "Longitude"
    else:
        # Simple format (Lat, Lon, T)
        df["datetime"] = pd.to_datetime(df["T"], errors="coerce")
        lat_col = "Lat"
        lon_col = "Lon"

    df = df.rename(columns={lat_col: "lat", lon_col: "lon"})

    # ── Utility filter ────────────────────────────────────────────────────
    if "Utility Name" in df.columns and utility_filter:
        before = len(df)
        df = df[df["Utility Name"].str.strip() == utility_filter].copy()
        print(f"[CPUC]   Filtered to {utility_filter}: {before} → {len(df)} events")

    # ── Date filter ───────────────────────────────────────────────────────
    df = df.dropna(subset=["lat", "lon", "datetime"])
    if start_date:
        df = df[df["datetime"] >= pd.Timestamp(start_date)]
    if end_date:
        df = df[df["datetime"] <= pd.Timestamp(end_date)]

    df["date"] = df["datetime"].dt.normalize()

    # Copy through useful diagnostic columns if present
    for col in ["Index", "Facility Identification", "Voltage",
                "Equipment Involved With Ignition", "Suspected Initiating Event"]:
        if col in df.columns:
            df[col] = df[col]

    df = df.reset_index(drop=True)
    print(f"[CPUC]   {len(df)} events  |  "
          f"{df['datetime'].min().date()} to {df['datetime'].max().date()}")
    return df


# ─────────────────────────────────────────────
# 4.  SNAP EVENTS TO CIRCUITS  (requires .shp geometry)
# ─────────────────────────────────────────────

def snap_events_to_circuits(
    events_df: pd.DataFrame,
    shp_path: str,
    circuits_df: pd.DataFrame,
    max_snap_dist_m: float = 10_000,
) -> pd.DataFrame:
    """
    For each CPUC event (lat/lon) find the nearest GNA circuit line.
    Returns events_df with columns added:
      seg_idx      : integer index into circuits_df
      circuitid    : GNA circuit identifier
      snap_dist_m  : distance to nearest circuit line (metres)

    Requires: gna_circuits.shp + companion files (.shx, .dbf, .prj)
    CRS: re-projects everything to UTM Zone 10N (EPSG:26910) for metre distances.
    """
    import geopandas as gpd
    from shapely.geometry import Point

    print("[SNAP] Snapping events to nearest circuit ...")
    # Shapefile is in Web Mercator (EPSG:3857); reproject to UTM 10N for metres
    gdf = gpd.read_file(shp_path).to_crs("EPSG:26910")
    gdf = gdf.merge(circuits_df[["circuitid", "seg_idx"]], on="circuitid", how="left")

    pts = gpd.GeoDataFrame(
        events_df.reset_index(drop=True),
        geometry=[Point(lon, lat) for lat, lon in zip(events_df.lat, events_df.lon)],
        crs="EPSG:4326",
    ).to_crs("EPSG:26910")

    joined = gpd.sjoin_nearest(
        pts, gdf[["seg_idx", "circuitid", "geometry"]],
        how="left", distance_col="snap_dist_m",
    )
    # sjoin_nearest can create duplicate rows on ties; keep the first per event
    joined = joined[~joined.index.duplicated(keep="first")]

    out = events_df.copy().reset_index(drop=True)
    out["seg_idx"]     = joined["seg_idx"].values
    out["circuitid"]   = joined["circuitid"].values
    out["snap_dist_m"] = joined["snap_dist_m"].values

    dropped = out["snap_dist_m"] > max_snap_dist_m
    print(f"[SNAP]   {len(out)} events snapped  |  "
          f"median dist={out['snap_dist_m'].median():.0f} m  |  "
          f"dropping {dropped.sum()} events > {max_snap_dist_m/1000:.0f} km")
    out.loc[dropped, ["seg_idx", "circuitid"]] = np.nan
    return out


# ─────────────────────────────────────────────
# 5.  BUILD EVENT MATRIX  E  (N × T)
# ─────────────────────────────────────────────

def build_event_matrix(
    events_df: pd.DataFrame,
    N: int,
    date_range: pd.DatetimeIndex,
) -> np.ndarray:
    """
    Returns integer array E of shape (N, T).
    E[i, t] = number of CPUC fire events assigned to circuit i on day t.
    """
    T = len(date_range)
    E = np.zeros((N, T), dtype=np.int32)

    date_to_t = {d: t for t, d in enumerate(date_range)}

    valid = events_df.dropna(subset=["seg_idx"])
    for _, row in valid.iterrows():
        t_idx = date_to_t.get(pd.Timestamp(row["date"]))
        if t_idx is not None:
            E[int(row["seg_idx"]), t_idx] += 1

    n_events = int(E.sum())
    n_circuits = int((E > 0).any(axis=1).sum())
    print(f"[EVENT] {n_events} events mapped to {n_circuits} unique circuits "
          f"over {T} days.")
    return E


# ─────────────────────────────────────────────
# 6.  HRRR WEATHER COVARIATES
# ─────────────────────────────────────────────

def load_hrrr(csv_path: str) -> pd.DataFrame:
    """
    Load the HRRR extracted weather CSV.
    Expected columns: Date, Cell_ID, Latitude, Longitude,
      Temperature, Specific humidity, U component of wind, V component of wind.

    Derived: wind_speed = sqrt(U² + V²).
    Returns DataFrame indexed by (Date, Cell_ID) with covariate columns.
    """
    print(f"[HRRR] Loading HRRR data from {Path(csv_path).name} ...")
    df = pd.read_csv(csv_path, low_memory=False)
    df.columns = df.columns.str.strip()

    df["date"] = pd.to_datetime(df["Date"]).dt.normalize()

    # Compute wind speed from components
    df["wind_speed"] = np.sqrt(
        df["U component of wind"] ** 2 + df["V component of wind"] ** 2
    )

    # Rename to match paper conventions
    df = df.rename(columns={
        "Temperature":      "TMP",
        "Specific humidity": "SPFH",
        "Latitude":         "lat",
        "Longitude":        "lon",
    })

    keep = ["date", "Cell_ID", "lat", "lon", "TMP", "SPFH", "wind_speed"]
    df = df[keep].dropna()

    print(f"[HRRR]   {df['Cell_ID'].nunique()} grid cells  |  "
          f"{df['date'].min().date()} to {df['date'].max().date()}  |  "
          f"{df['date'].nunique()} days")
    return df


def load_circuit_weather(
    weather_csv: str,
    circuits_df: pd.DataFrame,
    date_range: pd.DatetimeIndex,
) -> np.ndarray:
    """
    Load the compact per-circuit daily weather table produced by prep_hrrr.py.
    Columns expected: date, seg_idx, circuitid, TMP, SPFH, wind_speed.

    Returns X of shape (T, N, q) with q=3: [TMP, SPFH, wind_speed].
    Missing (circuit, day) cells are forward/back-filled per circuit, then
    any remaining gaps imputed with the covariate's global mean.
    """
    print(f"[WX] Loading precomputed circuit weather from {Path(weather_csv).name} ...")
    N = len(circuits_df)
    T = len(date_range)
    COVS = ["TMP", "SPFH", "wind_speed"]
    q = len(COVS)

    wx = pd.read_csv(weather_csv, parse_dates=["date"])
    wx["date"] = wx["date"].dt.normalize()

    # Pivot each covariate to a (T x N) grid
    X = np.full((T, N, q), np.nan, dtype=np.float32)
    date_to_t = {d: t for t, d in enumerate(date_range)}

    for cov_idx, cov in enumerate(COVS):
        pivot = (wx.pivot_table(index="date", columns="seg_idx",
                                values=cov, aggfunc="mean"))
        pivot = pivot.reindex(index=date_range)            # align days
        pivot = pivot.reindex(columns=range(N))            # align circuits
        pivot = pivot.ffill().bfill()                       # fill temporal gaps
        arr = pivot.values.astype(np.float32)
        # Impute any remaining NaNs with column (global) mean
        col_mean = np.nanmean(arr)
        arr = np.where(np.isnan(arr), col_mean, arr)
        X[:, :, cov_idx] = arr

    n_missing = int(np.isnan(X).sum())
    print(f"[WX]   X shape: {X.shape}  (T={T}, N={N}, q={q})  |  residual NaNs: {n_missing}")
    return X


def assign_hrrr_to_circuits(
    hrrr_df: pd.DataFrame,
    circuits_df: pd.DataFrame,
    date_range: pd.DatetimeIndex,
    midpoints_csv: str = "data/circuit_midpoints.csv",
) -> np.ndarray:
    """
    Assign RAW HRRR grid weather to each circuit using real circuit midpoints
    (precomputed from the .shp by prep_hrrr or the midpoints step).

    Use this only if you upload raw HRRR instead of running prep_hrrr.py.
    Returns X of shape (T, N, q), q=3: [TMP, SPFH, wind_speed].
    """
    from scipy.spatial import cKDTree

    N = len(circuits_df)
    T = len(date_range)
    COVS = ["TMP", "SPFH", "wind_speed"]
    q = len(COVS)
    X = np.zeros((T, N, q), dtype=np.float32)

    mid = pd.read_csv(midpoints_csv)

    # KD-tree nearest cell (equirectangular metres approximation)
    R = 111_320.0
    lat0 = np.deg2rad(mid["mid_lat"].mean())
    def to_xy(lat, lon):
        return np.column_stack([np.deg2rad(lon) * np.cos(lat0) * R,
                                np.deg2rad(lat) * R])

    cells = hrrr_df.groupby("Cell_ID")[["lat", "lon"]].first().reset_index()
    tree = cKDTree(to_xy(cells["lat"].values, cells["lon"].values))
    _, idx = tree.query(to_xy(mid["mid_lat"].values, mid["mid_lon"].values), k=1)
    circuit_cell = cells["Cell_ID"].values[idx]   # (N,) cell per circuit
    print(f"[HRRR] Assigned circuits to {len(np.unique(circuit_cell))} unique cells.")

    pivot = hrrr_df.set_index(["date", "Cell_ID"])[COVS].sort_index()
    for t, dt in enumerate(date_range):
        for cov_idx, cov in enumerate(COVS):
            for i in range(N):
                try:
                    X[t, i, cov_idx] = pivot.loc[(dt, circuit_cell[i]), cov]
                except KeyError:
                    X[t, i, cov_idx] = np.nan
    # Impute residual NaNs with global mean per covariate
    for cov_idx in range(q):
        m = np.nanmean(X[:, :, cov_idx])
        X[:, :, cov_idx] = np.where(np.isnan(X[:, :, cov_idx]), m, X[:, :, cov_idx])

    print(f"[HRRR]   X shape: {X.shape}")
    return X


# ─────────────────────────────────────────────
# 7.  STANDARDISE COVARIATES
# ─────────────────────────────────────────────

def standardise_X(X: np.ndarray) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Standardise each covariate (mean=0, std=1) across all circuits and days.
    Returns (X_std, means, stds).  Follows paper Section 3.2.
    """
    T, N, q = X.shape
    X_flat = X.reshape(-1, q)
    means = X_flat.mean(axis=0)
    stds  = X_flat.std(axis=0)
    stds[stds == 0] = 1.0          # avoid division by zero for constant covariates
    X_std = (X - means) / stds
    print(f"[PREP]  Standardised X: means={np.round(means,4)}, stds={np.round(stds,4)}")
    return X_std.astype(np.float32), means, stds


def add_intercept(X_std: np.ndarray) -> np.ndarray:
    """
    Prepend a column of ones for the intercept term.
    Input:  (T, N, q)  →  Output: (T, N, q+1).
    """
    T, N, q = X_std.shape
    ones = np.ones((T, N, 1), dtype=np.float32)
    return np.concatenate([ones, X_std], axis=2)


# ─────────────────────────────────────────────
# 8.  CONVENIENCE LOADER
# ─────────────────────────────────────────────

def prepare_all(
    dbf_path: str,
    cpuc_csv: str,
    weather_csv: str,
    shp_path: str,
    midpoints_csv: str = "data/circuit_midpoints.csv",
    start_date: str = "2024-06-01",
    end_date: str   = "2024-08-31",
    utility: str    = "PG&E",
    raw_hrrr: bool  = False,
) -> dict:
    """
    Run the full data-prep pipeline and return a results dict with keys:
      circuits_df, W, events_df, E, X, X_raw, date_range, cov_means, cov_stds

    weather_csv:
      - If raw_hrrr=False (default): path to the compact per-circuit weather
        table from prep_hrrr.py (columns: date, seg_idx, circuitid, TMP, SPFH, wind_speed).
      - If raw_hrrr=True: path to a raw HRRR grid CSV (gets snapped via midpoints).
    """
    print("=" * 60)
    print("cNHPP DATA PREPARATION")
    print("=" * 60)

    # 1. GNA circuits
    circuits_df = load_gna_attributes(dbf_path)
    N = len(circuits_df)

    # 2. Adjacency matrix
    W = build_adjacency_matrix(circuits_df)

    # 3. CPUC events
    events_df = load_cpuc_events(cpuc_csv, utility_filter=utility,
                                  start_date=start_date, end_date=end_date)

    # 4. Snap events to nearest circuit (uses real .shp geometry)
    events_df = snap_events_to_circuits(events_df, shp_path, circuits_df)

    # 5. Date range and event matrix
    date_range = pd.date_range(start=start_date, end=end_date, freq="D")
    T = len(date_range)
    E = build_event_matrix(events_df, N, date_range)

    # 6. Weather covariates
    if raw_hrrr:
        hrrr_df = load_hrrr(weather_csv)
        X_raw = assign_hrrr_to_circuits(hrrr_df, circuits_df, date_range, midpoints_csv)
    else:
        X_raw = load_circuit_weather(weather_csv, circuits_df, date_range)

    # 7. Standardise and add intercept
    X_std, means, stds = standardise_X(X_raw)
    X = add_intercept(X_std)   # shape (T, N, q+1)

    print("=" * 60)
    print(f"READY: N={N} circuits, T={T} days, "
          f"events={int(E.sum())}, X shape={X.shape}")
    print("=" * 60)

    return dict(
        circuits_df = circuits_df,
        W           = W,
        events_df   = events_df,
        E           = E,
        X           = X,
        X_raw       = X_raw,
        date_range  = date_range,
        cov_means   = means,
        cov_stds    = stds,
    )
