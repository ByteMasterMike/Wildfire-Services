"""
Fit cNHPP on multi-year grid data and persist xi / beta (+ standardization).

Does NOT call grid_data_prep.load_year() or prepare_multiyear() — those paths
are broken / mismatched for per-year event files. See README known issues.

xi is selected by validation-year log-likelihood (default 2024); beta is fit
on the training years only at each xi candidate.
"""

from __future__ import annotations

import calendar
import os
import sys
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd
from scipy.optimize import minimize
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
from services.risk_forecasting.models import (
    _cnhpp_objective,
    _mrnn_forward,
    poisson_ll,
)

# Corrupt export window in California_HRRR_daily_2020_01.csv / grid_weather_2020.
# No clean same-hour (01Z) replacement exists; other hours have a multi-K bias.
EXCLUDE_DATE_RANGES = [
    (pd.Timestamp("2020-12-02"), pd.Timestamp("2020-12-31")),
]


def _require_file(path: Path, label: str) -> Path:
    if not path.is_file():
        raise FileNotFoundError(f"Missing {label}: {path}")
    return path


def val_year_from_env() -> int:
    return int(os.environ.get("VAL_YEAR", "2024"))


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


def _exclusion_mask(dates: pd.DatetimeIndex) -> np.ndarray:
    """True for dates to keep."""
    keep = np.ones(len(dates), dtype=bool)
    for start, end in EXCLUDE_DATE_RANGES:
        bad = (dates >= start) & (dates <= end)
        n_bad = int(bad.sum())
        if n_bad:
            print(
                f"[DATA] Excluding {n_bad} day(s) "
                f"{start.date()} .. {end.date()} (corrupt HRRR export)"
            )
        keep &= ~bad
    return keep


def _standardize(
    x_raw: np.ndarray,
    means: Optional[np.ndarray] = None,
    stds: Optional[np.ndarray] = None,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Fill NaNs, standardize, prepend intercept. Fit means/stds if not given."""
    x = x_raw.copy()
    flat = x.reshape(-1, x.shape[2])
    n_bad = int(np.size(flat) - np.isfinite(flat).sum())
    if n_bad:
        print(
            f"[DATA] WARNING: {n_bad} non-finite covariate values "
            f"(typically all-NaN veg cells); filling with column means"
        )

    if means is None or stds is None:
        means = np.nanmean(flat, axis=0)
        stds = np.nanstd(flat, axis=0)
        stds[stds == 0] = 1.0
    if not np.isfinite(means).all() or not np.isfinite(stds).all():
        raise ValueError(
            f"Cannot standardize: non-finite means={means} or stds={stds}"
        )

    for k in range(x.shape[2]):
        mask = ~np.isfinite(x[:, :, k])
        if mask.any():
            x[:, :, k][mask] = means[k]

    x_std = ((x - means) / stds).astype(np.float32)
    ones = np.ones((*x_std.shape[:2], 1), dtype=np.float32)
    return np.concatenate([ones, x_std], axis=2), means, stds


def load_year_bundle(
    data_dir: Path,
    year: int,
    grid_df: pd.DataFrame,
    events: pd.DataFrame,
) -> Tuple[np.ndarray, np.ndarray, pd.DatetimeIndex]:
    """Load one year, drop excluded dates. Returns raw X, E, dates."""
    paths = resolve_year_paths(data_dir, [year])
    p = paths[int(year)]
    x_raw, dr = _load_year_raw(int(year), p["weather"], p["veg"], grid_df)
    keep = _exclusion_mask(dr)
    x_raw = x_raw[keep]
    dr = dr[keep]
    ev_yr = events[events["datetime"].dt.year == int(year)]
    e_yr = gdp.build_event_matrix(ev_yr, len(grid_df), dr)
    print(f"[DATA]   {year}: days={len(dr)} events_in_matrix={int(e_yr.sum())}")
    return x_raw, e_yr, dr


def load_events(data_dir: Path, years: Sequence[int], grid_df: pd.DataFrame) -> pd.DataFrame:
    paths = resolve_year_paths(data_dir, years)
    frames = []
    for year in years:
        ev_path = paths[int(year)]["events"]
        print(f"[DATA] Loading events {ev_path.name} ...")
        frames.append(gdp.load_fire_events(str(ev_path)))
    events = pd.concat(frames, ignore_index=True)
    return gdp.snap_events_to_grid(events, grid_df)


def fit_cnhpp_val_select(
    X_train: np.ndarray,
    E_train: np.ndarray,
    X_val: np.ndarray,
    E_val: np.ndarray,
    W: csr_matrix,
    xi_grid: Optional[np.ndarray] = None,
) -> dict:
    """
    Grid-search xi: fit beta on train via L-BFGS-B, score poisson LL on val.
    Returns best params + diagnostics.
    """
    if xi_grid is None:
        xi_grid = np.arange(0.0, 1.0, 0.1)

    qp1 = X_train.shape[2]
    beta_init = np.zeros(qp1)
    best = {
        "xi": 0.0,
        "beta": beta_init.copy(),
        "train_ll": -np.inf,
        "val_ll": -np.inf,
        "converged": False,
        "xi_grid": xi_grid,
        "train_ll_grid": np.full(len(xi_grid), np.nan),
        "val_ll_grid": np.full(len(xi_grid), np.nan),
    }

    print(f"[cNHPP] Validation xi search over {np.round(xi_grid, 1)} ...")
    for k, xi in enumerate(xi_grid):
        result = minimize(
            _cnhpp_objective,
            beta_init,
            args=(float(xi), X_train, W, E_train),
            method="L-BFGS-B",
            jac=True,
            options={"maxiter": 500, "ftol": 1e-9, "gtol": 1e-5},
        )
        beta_k = result.x
        h_tr = _mrnn_forward(float(xi), beta_k, X_train, W)
        h_va = _mrnn_forward(float(xi), beta_k, X_val, W)
        ll_tr = poisson_ll(h_tr.T, E_train)
        ll_va = poisson_ll(h_va.T, E_val)
        best["train_ll_grid"][k] = ll_tr
        best["val_ll_grid"][k] = ll_va
        print(
            f"[cNHPP]   xi={xi:.1f}  train_ll={ll_tr:.2f}  val_ll={ll_va:.2f}  "
            f"beta={np.round(beta_k, 3)}  ok={result.success}"
        )
        if ll_va > best["val_ll"]:
            best["val_ll"] = ll_va
            best["train_ll"] = ll_tr
            best["xi"] = float(xi)
            best["beta"] = beta_k.copy()
            best["converged"] = bool(result.success)

    print(
        f"\n[cNHPP] Best by VAL LL: xi={best['xi']:.1f}  "
        f"val_ll={best['val_ll']:.3f}  train_ll={best['train_ll']:.3f}"
    )
    return best


def persist_params(
    path: Path,
    *,
    xi: float,
    beta: np.ndarray,
    means: np.ndarray,
    stds: np.ndarray,
    train_years: Sequence[int],
    val_year: int,
    train_ll: float,
    val_ll: float,
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
        val_year=np.asarray(val_year, dtype=np.int32),
        train_log_likelihood=np.asarray(train_ll, dtype=np.float64),
        val_log_likelihood=np.asarray(val_ll, dtype=np.float64),
        log_likelihood=np.asarray(val_ll, dtype=np.float64),  # primary = val
        converged=np.asarray(bool(converged)),
    )
    print(f"[FIT] Persisted parameters to {path}")


def main() -> None:
    train_years = train_years_from_env()
    val_year = val_year_from_env()
    if val_year in train_years:
        print(
            f"[ERROR] VAL_YEAR={val_year} overlaps TRAIN_YEARS={train_years}",
            file=sys.stderr,
        )
        sys.exit(1)

    print("=" * 60)
    print("cNHPP FIT  |  train_years=", train_years, " val_year=", val_year)
    print("data_dir  =", DATA_DIR)
    print("artifacts =", ARTIFACTS_DIR)
    print("=" * 60)

    try:
        w = rebuild_and_cache_adjacency(GRID_CSV, GRID_W_PKL)
        if not isinstance(w, csr_matrix):
            w = csr_matrix(w)

        print(f"[DATA] Loading grid from {GRID_CSV} ...")
        grid_df = gdp.load_grid(str(_require_file(GRID_CSV, "grid_cells.csv")))

        all_years = list(train_years) + [val_year]
        events = load_events(DATA_DIR, all_years, grid_df)

        train_x_raw, train_e, train_dates = [], [], []
        for year in train_years:
            x_raw, e_yr, dr = load_year_bundle(DATA_DIR, year, grid_df, events)
            train_x_raw.append(x_raw)
            train_e.append(e_yr)
            train_dates.append(dr)

        x_train_raw = np.concatenate(train_x_raw, axis=0)
        e_train = np.concatenate(train_e, axis=1)
        date_range_train = train_dates[0].append(train_dates[1:])

        x_val_raw, e_val, date_range_val = load_year_bundle(
            DATA_DIR, val_year, grid_df, events
        )

        x_train, means, stds = _standardize(x_train_raw)
        x_val, _, _ = _standardize(x_val_raw, means=means, stds=stds)

        print(
            f"[DATA] TRAIN ready: T={x_train.shape[0]} N={x_train.shape[1]} "
            f"q+1={x_train.shape[2]}  events={int(e_train.sum())}"
        )
        print(
            f"[DATA] VAL   ready: T={x_val.shape[0]}  events={int(e_val.sum())}"
        )
        print(f"[DATA]   cov means={np.round(means, 4)}")
        print(f"[DATA]   cov stds ={np.round(stds, 4)}")
        print(
            f"[DATA]   train span {date_range_train.min().date()} .. "
            f"{date_range_train.max().date()}"
        )
        print(
            f"[DATA]   val span   {date_range_val.min().date()} .. "
            f"{date_range_val.max().date()}"
        )
    except (FileNotFoundError, ValueError) as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        sys.exit(1)

    result = fit_cnhpp_val_select(x_train, e_train, x_val, e_val, w)

    print("\n[FIT] === Diagnostics ===")
    print(f"[FIT]   xi (val-selected) = {result['xi']:.4f}")
    print(f"[FIT]   beta              = {np.round(result['beta'], 4)}")
    print(f"[FIT]   train LL          = {result['train_ll']:.3f}")
    print(f"[FIT]   val LL            = {result['val_ll']:.3f}")
    print(f"[FIT]   converged         = {result['converged']}")
    print(f"[FIT]   train LL grid     = {np.round(result['train_ll_grid'], 2)}")
    print(f"[FIT]   val   LL grid     = {np.round(result['val_ll_grid'], 2)}")
    print(f"[FIT]   cells             = {len(grid_df)}")
    print(f"[FIT]   train days/events = {x_train.shape[0]} / {int(e_train.sum())}")
    print(f"[FIT]   val   days/events = {x_val.shape[0]} / {int(e_val.sum())}")

    # Rough sanity vs prior memory
    prior_beta = np.array([-8.2, 0.43, -0.13, 0.13, 0.19, -0.30])
    if result["xi"] < 0.15 or result["xi"] > 0.45:
        print(
            f"[FIT] WARNING: xi={result['xi']} outside prior memory range ~0.24–0.3"
        )
    if abs(result["beta"][0] - prior_beta[0]) > 3.0:
        print(
            f"[FIT] WARNING: intercept {result['beta'][0]:.3f} far from "
            f"prior memory ~{prior_beta[0]}"
        )
    if result["beta"][1] < 0.1:
        print(
            f"[FIT] WARNING: TMP coef {result['beta'][1]:.4f} still near-zero/weak"
        )
    if result["beta"][2] > 0:
        print(
            f"[FIT] WARNING: SPFH coef {result['beta'][2]:.4f} still positive "
            f"(humidity increasing risk)"
        )

    persist_params(
        PARAMS_PATH,
        xi=float(result["xi"]),
        beta=result["beta"],
        means=means,
        stds=stds,
        train_years=train_years,
        val_year=val_year,
        train_ll=float(result["train_ll"]),
        val_ll=float(result["val_ll"]),
        converged=bool(result["converged"]),
    )
    print("[FIT] Done.")


if __name__ == "__main__":
    main()
