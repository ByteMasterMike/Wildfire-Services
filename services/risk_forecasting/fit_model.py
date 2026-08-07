"""
Fit cNHPP on multi-year grid data and persist xi / beta (+ standardization).

Does NOT call grid_data_prep.load_year() or prepare_multiyear() — those paths
are broken / mismatched for per-year event files. See README known issues.
"""

from __future__ import annotations

import calendar
import sys
from pathlib import Path
from typing import Dict, List, Sequence, Tuple

import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix

from services.risk_forecasting.adjacency import rebuild_and_cache_adjacency
from services.risk_forecasting.config import (
    ARTIFACTS_DIR,
    DATA_DIR,
    GRID_CSV,
    GRID_W_PKL,
    PARAMS_PATH,
    train_years_from_env,
)
from services.risk_forecasting import grid_data_prep as gdp
from services.risk_forecasting.models import fit_cnhpp


def _require_file(path: Path, label: str) -> Path:
    if not path.is_file():
        raise FileNotFoundError(f"Missing {label}: {path}")
    return path


def resolve_year_paths(data_dir: Path, years: Sequence[int]) -> Dict[int, dict]:
    """Map year -> {weather, veg, events}; fail clearly if any file is missing."""
    data_dir = Path(data_dir)
    out: Dict[int, dict] = {}
    missing: List[str] = []

    for year in years:
        weather = data_dir / f"grid_weather_{year}.csv"
        veg = data_dir / f"daily_gridded_CA_{year}.nc"
        events = data_dir / f"events_{year}.csv"
        for path, label in (
            (weather, f"weather CSV for {year}"),
            (veg, f"vegetation NetCDF for {year}"),
            (events, f"events CSV for {year}"),
        ):
            if not path.is_file():
                missing.append(f"  - {label}: {path}")
        out[int(year)] = {
            "weather": weather,
            "veg": veg,
            "events": events,
        }

    if missing:
        raise FileNotFoundError(
            "Required training data files are missing:\n" + "\n".join(missing)
        )
    return out


def _load_year_raw(
    year: int,
    weather_csv: Path,
    veg_nc: Path,
    grid_df: pd.DataFrame,
) -> Tuple[np.ndarray, pd.DatetimeIndex]:
    """Load one year of raw covariates (T, N, 5). Routes around load_year()."""
    days = 366 if calendar.isleap(year) else 365
    date_range = pd.date_range(f"{year}-01-01", periods=days, freq="D")
    print(f"[DATA] Loading covariates for {year} ({days} days) ...")
    wx = gdp.load_weather_for_year(str(weather_csv), date_range, grid_df)
    veg = gdp.load_vegetation_for_year(str(veg_nc), date_range, grid_df)
    x_raw = gdp.build_covariate_matrix(wx, veg)
    if x_raw.shape != (days, len(grid_df), 5):
        raise ValueError(
            f"Malformed covariates for {year}: expected "
            f"({days}, {len(grid_df)}, 5), got {x_raw.shape}"
        )
    return x_raw, date_range


def load_training_arrays(
    data_dir: Path,
    train_years: Sequence[int],
) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, pd.DataFrame, pd.DatetimeIndex]:
    """
    Returns X, E, means, stds, grid_df, date_range_train.

    X: (T, N, 6) standardized with intercept
    E: (N, T) event counts
    """
    data_dir = Path(data_dir)
    paths = resolve_year_paths(data_dir, train_years)

    print(f"[DATA] Loading grid from {GRID_CSV} ...")
    grid_df = gdp.load_grid(str(_require_file(GRID_CSV, "grid_cells.csv")))
    n = len(grid_df)

    # Concatenate per-year event files covering the training span
    event_frames = []
    for year in train_years:
        ev_path = paths[int(year)]["events"]
        print(f"[DATA] Loading events {ev_path.name} ...")
        event_frames.append(gdp.load_fire_events(str(ev_path)))
    events = pd.concat(event_frames, ignore_index=True)
    events = gdp.snap_events_to_grid(events, grid_df)

    x_list, e_list, date_list = [], [], []
    for year in train_years:
        p = paths[int(year)]
        x_raw, dr = _load_year_raw(int(year), p["weather"], p["veg"], grid_df)
        ev_yr = events[events["datetime"].dt.year == int(year)]
        e_yr = gdp.build_event_matrix(ev_yr, n, dr)
        print(f"[DATA]   {year}: events_in_matrix={int(e_yr.sum())}")
        x_list.append(x_raw)
        e_list.append(e_yr)
        date_list.append(dr)

    x_train_raw = np.concatenate(x_list, axis=0)
    e_train = np.concatenate(e_list, axis=1)
    date_range_train = date_list[0].append(date_list[1:])

    # Fit standardization on train only (same logic as prepare_multiyear).
    # A few coastal cells have all-NaN NDVI/fm100 in the NetCDF; fill with
    # column means after computing stats (weather loader already does this).
    flat = x_train_raw.reshape(-1, x_train_raw.shape[2])
    n_bad = int(np.size(flat) - np.isfinite(flat).sum())
    if n_bad:
        print(
            f"[DATA] WARNING: {n_bad} non-finite covariate values "
            f"(typically all-NaN veg cells); filling with column means"
        )

    means = np.nanmean(flat, axis=0)
    stds = np.nanstd(flat, axis=0)
    stds[stds == 0] = 1.0
    if not np.isfinite(means).all() or not np.isfinite(stds).all():
        raise ValueError(
            f"Cannot standardize: non-finite means={means} or stds={stds}"
        )

    for k in range(x_train_raw.shape[2]):
        mask = ~np.isfinite(x_train_raw[:, :, k])
        if mask.any():
            x_train_raw[:, :, k][mask] = means[k]

    x_std = ((x_train_raw - means) / stds).astype(np.float32)
    ones = np.ones((*x_std.shape[:2], 1), dtype=np.float32)
    x_train = np.concatenate([ones, x_std], axis=2)

    print(
        f"[DATA] TRAIN ready: T={x_train.shape[0]} N={x_train.shape[1]} "
        f"q+1={x_train.shape[2]}  total_events={int(e_train.sum())}"
    )
    print(f"[DATA]   cov means={np.round(means, 4)}")
    print(f"[DATA]   cov stds ={np.round(stds, 4)}")
    return x_train, e_train, means, stds, grid_df, date_range_train


def persist_params(
    path: Path,
    *,
    xi: float,
    beta: np.ndarray,
    means: np.ndarray,
    stds: np.ndarray,
    train_years: Sequence[int],
    log_likelihood: float,
    converged: bool,
) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        path,
        xi=np.asarray(xi, dtype=np.float64),
        beta=np.asarray(beta, dtype=np.float64),
        means=np.asarray(means, dtype=np.float64),
        stds=np.asarray(stds, dtype=np.float64),
        train_years=np.asarray(list(train_years), dtype=np.int32),
        log_likelihood=np.asarray(log_likelihood, dtype=np.float64),
        converged=np.asarray(bool(converged)),
    )
    print(f"[FIT] Persisted parameters to {path}")


def main() -> None:
    train_years = train_years_from_env()
    print("=" * 60)
    print("cNHPP FIT  |  train_years=", train_years)
    print("data_dir  =", DATA_DIR)
    print("artifacts =", ARTIFACTS_DIR)
    print("=" * 60)

    try:
        w = rebuild_and_cache_adjacency(GRID_CSV, GRID_W_PKL)
        x_train, e_train, means, stds, grid_df, _dates = load_training_arrays(
            DATA_DIR, train_years
        )
    except (FileNotFoundError, ValueError) as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        sys.exit(1)

    if not isinstance(w, csr_matrix):
        w = csr_matrix(w)

    print("[FIT] Calling fit_cnhpp ...")
    result = fit_cnhpp(x_train, e_train, w)

    print("\n[FIT] === Diagnostics ===")
    print(f"[FIT]   xi              = {result.xi:.4f}")
    print(f"[FIT]   beta            = {np.round(result.beta, 4)}")
    print(f"[FIT]   log-likelihood  = {result.log_likelihood:.3f}")
    print(f"[FIT]   converged       = {result.converged}")
    print(f"[FIT]   xi_grid LL      = {np.round(result.ll_grid, 2)}")
    print(f"[FIT]   cells           = {len(grid_df)}")
    print(f"[FIT]   train days      = {x_train.shape[0]}")
    print(f"[FIT]   train events    = {int(e_train.sum())}")

    persist_params(
        PARAMS_PATH,
        xi=float(result.xi),
        beta=result.beta,
        means=means,
        stds=stds,
        train_years=train_years,
        log_likelihood=float(result.log_likelihood),
        converged=bool(result.converged),
    )
    print("[FIT] Done.")


if __name__ == "__main__":
    main()
