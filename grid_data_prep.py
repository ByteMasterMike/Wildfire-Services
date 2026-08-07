"""
grid_data_prep.py
-----------------
Grid-based data pipeline for the cNHPP wildfire baseline.

Network: 824 cells on a 0.24-degree grid covering California.
Replaces the circuit-based pipeline entirely.

All three utilities (PG&E, SCE, SDG&E) snap to grid cells by lat/lon.
Weather and vegetation are already at cell resolution - no spatial joining needed.

Outputs:
    grid_df    : DataFrame with cell_id, lat, lon (N=824 rows)
    W          : (N x N) sparse adjacency (4-connected grid neighbors + self)
    E          : (N x T) integer event count matrix
    X          : (T x N x q+1) covariate array with intercept
    date_range : T-length DatetimeIndex
"""

import numpy as np
import pandas as pd
import pickle
import netCDF4 as nc
from pathlib import Path
from scipy.sparse import lil_matrix, csr_matrix
from typing import Optional


# ─────────────────────────────────────────────
# 1.  GRID  (network definition)
# ─────────────────────────────────────────────

def load_grid(grid_csv: str = "data/grid_cells.csv") -> pd.DataFrame:
    """Load the 824-cell California grid."""
    grid = pd.read_csv(grid_csv)
    grid = grid.sort_values("cell_id").reset_index(drop=True)
    grid["seg_idx"] = grid.index   # model uses seg_idx internally
    print(f"[GRID]  {len(grid)} cells  |  "
          f"lat [{grid.lat.min():.2f}, {grid.lat.max():.2f}]  |  "
          f"lon [{grid.lon.min():.2f}, {grid.lon.max():.2f}]")
    return grid


def load_grid_adjacency(pkl_path: str = "data/grid_W.pkl") -> csr_matrix:
    """Load precomputed 4-connected grid adjacency matrix."""
    with open(pkl_path, "rb") as f:
        W = pickle.load(f)
    print(f"[ADJ]   W: {W.shape[0]}x{W.shape[1]}  |  nnz={W.nnz}  |  "
          f"avg neighbors={W.nnz/W.shape[0]-1:.1f}")
    return W


# ─────────────────────────────────────────────
# 2.  FIRE EVENTS
# ─────────────────────────────────────────────

def load_fire_events(
    csv_path: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> pd.DataFrame:
    """
    Load combined fire events (PG&E + SCE + SDG&E).
    Expected columns: Lat, Lon, T  (or variations thereof).
    Returns DataFrame with standardised: lat, lon, datetime, date.
    """
    print(f"[EVENTS] Loading {Path(csv_path).name} ...")
    df = pd.read_csv(csv_path, low_memory=False)
    df.columns = df.columns.str.strip()

    # Standardise column names
    col_map = {}
    for c in df.columns:
        cl = c.strip().lower()
        if cl in ('lat', 'latitude'):
            col_map[c] = 'lat'
        elif cl in ('lon', 'longitude', 'lng'):
            col_map[c] = 'lon'
        elif cl in ('t', 'date', 'datetime', 'time'):
            col_map[c] = 'datetime'
    df = df.rename(columns=col_map)

    df['lat'] = pd.to_numeric(df['lat'], errors='coerce')
    df['lon'] = pd.to_numeric(df['lon'], errors='coerce')
    df['datetime'] = pd.to_datetime(df['datetime'], errors='coerce')
    df = df.dropna(subset=['lat', 'lon', 'datetime'])
    df['date'] = df['datetime'].dt.normalize()

    if start_date:
        df = df[df['datetime'] >= pd.Timestamp(start_date)]
    if end_date:
        df = df[df['datetime'] <= pd.Timestamp(end_date)]

    df = df.reset_index(drop=True)
    print(f"[EVENTS]   {len(df)} events  |  "
          f"{df['datetime'].min().date()} to {df['datetime'].max().date()}")
    return df


def snap_events_to_grid(
    events_df: pd.DataFrame,
    grid_df: pd.DataFrame,
) -> pd.DataFrame:
    """
    Snap each fire event to its nearest grid cell.
    Uses fast KD-tree in projected metres. Returns events with seg_idx added.
    """
    from scipy.spatial import cKDTree

    print("[SNAP]  Snapping events to grid cells ...")
    R = 111_320.0
    lat0 = np.deg2rad(grid_df['lat'].mean())

    def to_xy(lat, lon):
        return np.column_stack([
            np.deg2rad(lon) * np.cos(lat0) * R,
            np.deg2rad(lat) * R,
        ])

    tree = cKDTree(to_xy(grid_df['lat'].values, grid_df['lon'].values))
    dist, idx = tree.query(to_xy(events_df['lat'].values, events_df['lon'].values), k=1)

    out = events_df.copy()
    out['seg_idx']    = grid_df['seg_idx'].values[idx]
    out['cell_id']    = grid_df['cell_id'].values[idx]
    out['snap_dist_m'] = dist
    print(f"[SNAP]    median dist={np.median(dist)/1000:.1f} km  |  "
          f"max dist={dist.max()/1000:.1f} km")
    return out


# ─────────────────────────────────────────────
# 3.  EVENT MATRIX  E  (N x T)
# ─────────────────────────────────────────────

def build_event_matrix(
    events_df: pd.DataFrame,
    N: int,
    date_range: pd.DatetimeIndex,
) -> np.ndarray:
    E = np.zeros((N, len(date_range)), dtype=np.int32)
    date_to_t = {d: t for t, d in enumerate(date_range)}
    valid = events_df.dropna(subset=['seg_idx'])
    for _, row in valid.iterrows():
        t_idx = date_to_t.get(pd.Timestamp(row['date']))
        if t_idx is not None:
            E[int(row['seg_idx']), t_idx] += 1
    print(f"[EVENT]  {int(E.sum())} events in {N}x{len(date_range)} matrix  |  "
          f"{int((E>0).any(axis=1).sum())} cells with fires")
    return E


# ─────────────────────────────────────────────
# 4.  COVARIATES  (already at cell resolution)
# ─────────────────────────────────────────────

WEATHER_COVS = ['TMP', 'SPFH', 'wind_speed']
VEG_COVS     = ['NDVI', 'fm100']
ALL_COVS     = WEATHER_COVS + VEG_COVS


def load_weather_for_year(
    csv_path: str,
    date_range: pd.DatetimeIndex,
    grid_df: pd.DataFrame,
) -> np.ndarray:
    """
    Load cell-level HRRR weather CSV (output of prep_hrrr_grid.py).
    Columns: date, cell_id, lat, lon, TMP, SPFH, wind_speed.
    Maps cell_id -> grid seg_idx, returns (T, N, 3): TMP, SPFH, wind_speed.
    """
    print(f"[WX]    Loading {Path(csv_path).name} ...")
    wx = pd.read_csv(csv_path, parse_dates=['date'])
    wx['date'] = wx['date'].dt.normalize()

    # Map cell_id to grid seg_idx
    cell_to_seg = dict(zip(grid_df['cell_id'], grid_df['seg_idx']))
    wx['seg_idx'] = wx['cell_id'].map(cell_to_seg)

    T = len(date_range)
    N = len(grid_df)
    X = np.full((T, N, 3), np.nan, dtype=np.float32)

    for c_idx, cov in enumerate(WEATHER_COVS):
        pivot = wx.pivot_table(index='date', columns='seg_idx',
                               values=cov, aggfunc='mean')
        pivot = pivot.reindex(index=date_range).reindex(columns=range(N))
        pivot = pivot.ffill().bfill()
        arr = pivot.values.astype(np.float32)
        col_mean = np.nanmean(arr)
        arr = np.where(np.isnan(arr), col_mean, arr)
        X[:, :, c_idx] = arr

    print(f"[WX]      shape={X.shape}")
    return X


def load_vegetation_for_year(
    nc_path: str,
    date_range: pd.DatetimeIndex,
    grid_df: pd.DataFrame,
) -> np.ndarray:
    """
    Load vegetation NetCDF for one year.
    Variables: NDVI, fm100.
    Returns (T, N, 2) array.
    """
    print(f"[VEG]   Loading {Path(nc_path).name} ...")
    ds = nc.Dataset(nc_path)
    ndvi  = np.array(ds.variables['NDVI'][:])    # (days, cells)
    fm100 = np.array(ds.variables['fm100'][:])
    nc_cells = np.array(ds.variables['cell'][:])
    ds.close()

    # Align NetCDF cell order to grid_df order
    nc_cell_to_idx = {c: i for i, c in enumerate(nc_cells)}
    grid_order = [nc_cell_to_idx[c] for c in grid_df['cell_id'].values]

    ndvi_aligned  = ndvi[:, grid_order]    # (days, N)
    fm100_aligned = fm100[:, grid_order]

    # Align days to date_range
    year = int(Path(nc_path).stem.split('_')[-1])
    nc_dates = pd.date_range(f'{year}-01-01', periods=ndvi.shape[0], freq='D')
    T = len(date_range)
    N = len(grid_df)
    X = np.full((T, N, 2), np.nan, dtype=np.float32)

    date_to_nc = {d: i for i, d in enumerate(nc_dates)}
    for t_idx, dt in enumerate(date_range):
        nc_idx = date_to_nc.get(dt)
        if nc_idx is not None:
            X[t_idx, :, 0] = ndvi_aligned[nc_idx]
            X[t_idx, :, 1] = fm100_aligned[nc_idx]

    # Fill missing days
    for c_idx in range(2):
        df_tmp = pd.DataFrame(X[:, :, c_idx])
        df_tmp = df_tmp.ffill().bfill()
        X[:, :, c_idx] = df_tmp.values.astype(np.float32)

    print(f"[VEG]     shape={X.shape}  "
          f"NDVI=[{np.nanmin(X[:,:,0]):.3f},{np.nanmax(X[:,:,0]):.3f}]  "
          f"fm100=[{np.nanmin(X[:,:,1]):.2f},{np.nanmax(X[:,:,1]):.2f}]")
    return X


def build_covariate_matrix(
    weather_X: np.ndarray,
    veg_X: np.ndarray,
) -> np.ndarray:
    """Concatenate weather and vegetation into (T, N, 5) array."""
    return np.concatenate([weather_X, veg_X], axis=2)


def standardise_and_add_intercept(
    X_raw: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Standardise covariates (mean=0, std=1) and prepend intercept column."""
    T, N, q = X_raw.shape
    flat = X_raw.reshape(-1, q)
    means = np.nanmean(flat, axis=0)
    stds  = np.nanstd(flat, axis=0)
    stds[stds == 0] = 1.0
    X_std = ((X_raw - means) / stds).astype(np.float32)
    ones  = np.ones((T, N, 1), dtype=np.float32)
    X     = np.concatenate([ones, X_std], axis=2)
    print(f"[PREP]  Standardised X: shape={X.shape}  "
          f"means={np.round(means, 4)}")
    return X, means, stds


# ─────────────────────────────────────────────
# 5.  MULTI-YEAR LOADER
# ─────────────────────────────────────────────

def load_year(
    year: int,
    weather_csv: str,
    veg_nc: str,
    grid_df: pd.DataFrame,
) -> tuple[np.ndarray, pd.DatetimeIndex]:
    """Load one year of covariates. Returns (X_raw, date_range)."""
    import calendar
    days = 366 if calendar.isleap(year) else 365
    date_range = pd.date_range(f'{year}-01-01', periods=days, freq='D')
    N = len(grid_df)

    wx  = load_weather_for_year(weather_csv, date_range, N)
    veg = load_vegetation_for_year(veg_nc, date_range, grid_df)
    X_raw = build_covariate_matrix(wx, veg)
    return X_raw, date_range


def prepare_multiyear(
    fire_csv:     str,
    train_years:  list[int],
    test_year:    int,
    weather_csvs: dict[int, str],
    veg_ncs:      dict[int, str],
    grid_csv:     str = "data/grid_cells.csv",
    grid_W_pkl:   str = "data/grid_W.pkl",
) -> dict:
    """
    Full multi-year grid pipeline.

    Returns:
        grid_df, W,
        X_train, E_train, date_range_train,
        X_test,  E_test,  date_range_test,
        cov_means, cov_stds
    """
    print("=" * 60)
    print("GRID-BASED cNHPP PIPELINE  (multi-year)")
    print("=" * 60)

    grid_df = load_grid(grid_csv)
    W       = load_grid_adjacency(grid_W_pkl)
    N       = len(grid_df)

    # Events
    all_years = train_years + [test_year]
    y0, y1 = min(all_years), max(all_years)
    events = load_fire_events(fire_csv,
                               start_date=f'{y0}-01-01',
                               end_date=f'{y1}-12-31')
    events = snap_events_to_grid(events, grid_df)

    # ── TRAINING SET ─────────────────────────────────────────────────────
    train_X_list, train_E_list, train_dates = [], [], []
    for yr in train_years:
        X_raw, dr = load_year(yr, weather_csvs[yr], veg_ncs[yr], grid_df)
        ev_yr = events[(events['datetime'].dt.year == yr)]
        E_yr  = build_event_matrix(ev_yr, N, dr)
        train_X_list.append(X_raw)
        train_E_list.append(E_yr)
        train_dates.append(dr)
        print(f"  {yr}: {int(E_yr.sum())} events")

    X_train_raw    = np.concatenate(train_X_list, axis=0)
    E_train        = np.concatenate(train_E_list, axis=1)
    date_range_train = train_dates[0].append(train_dates[1:])

    # ── TEST SET ──────────────────────────────────────────────────────────
    X_test_raw, date_range_test = load_year(test_year, weather_csvs[test_year],
                                             veg_ncs[test_year], grid_df)
    ev_test  = events[(events['datetime'].dt.year == test_year)]
    E_test   = build_event_matrix(ev_test, N, date_range_test)
    print(f"  {test_year} (TEST): {int(E_test.sum())} events")

    # ── STANDARDISE (fit on train, apply to both) ─────────────────────────
    flat = X_train_raw.reshape(-1, X_train_raw.shape[2])
    means = np.nanmean(flat, axis=0)
    stds  = np.nanstd(flat,  axis=0); stds[stds==0] = 1.0

    def std_and_intercept(X_raw):
        X_std = ((X_raw - means) / stds).astype(np.float32)
        return np.concatenate([np.ones((*X_std.shape[:2], 1), dtype=np.float32),
                                X_std], axis=2)

    X_train = std_and_intercept(X_train_raw)
    X_test  = std_and_intercept(X_test_raw)

    print(f"\nTRAIN: {X_train.shape[0]} days, {int(E_train.sum())} events")
    print(f"TEST:  {X_test.shape[0]} days,  {int(E_test.sum())} events")
    print("=" * 60)

    return dict(
        grid_df=grid_df, W=W,
        X_train=X_train, E_train=E_train, date_range_train=date_range_train,
        X_test=X_test,   E_test=E_test,   date_range_test=date_range_test,
        cov_means=means,  cov_stds=stds,
    )
