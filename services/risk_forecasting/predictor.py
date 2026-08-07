"""Load persisted cNHPP params and score a single cell/date."""

from __future__ import annotations

import calendar
import pickle
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Dict, Optional, Sequence, Union

import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix

from services.risk_forecasting.config import (
    GRID_CSV,
    GRID_W_PKL,
    PARAMS_PATH,
    lookback_days_from_env,
)
from services.risk_forecasting import grid_data_prep as gdp
from services.risk_forecasting.models import _mrnn_forward


DateLike = Union[str, date, datetime, pd.Timestamp]


@dataclass
class FittedModel:
    xi: float
    beta: np.ndarray
    means: np.ndarray
    stds: np.ndarray
    W: csr_matrix
    grid_df: pd.DataFrame
    cell_id_to_idx: Dict[int, int]
    train_years: np.ndarray


def _as_date(value: DateLike) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    ts = pd.Timestamp(value)
    if pd.isna(ts):
        raise ValueError(f"Invalid date: {value!r}")
    return ts.date()


def load_fitted_model(
    params_path: Path = PARAMS_PATH,
    grid_csv: Path = GRID_CSV,
    grid_w_pkl: Path = GRID_W_PKL,
) -> FittedModel:
    params_path = Path(params_path)
    grid_csv = Path(grid_csv)
    grid_w_pkl = Path(grid_w_pkl)

    if not params_path.is_file():
        raise FileNotFoundError(
            f"Missing fitted parameters: {params_path}. "
            "Run: python -m services.risk_forecasting.fit_model"
        )
    if not grid_csv.is_file():
        raise FileNotFoundError(f"Missing grid CSV: {grid_csv}")
    if not grid_w_pkl.is_file():
        raise FileNotFoundError(
            f"Missing adjacency pickle: {grid_w_pkl}. "
            "Run: python -m services.risk_forecasting.adjacency"
        )

    print(f"[PRED] Loading params from {params_path} ...")
    with np.load(params_path, allow_pickle=False) as z:
        xi = float(z["xi"])
        beta = np.asarray(z["beta"], dtype=np.float64)
        means = np.asarray(z["means"], dtype=np.float64)
        stds = np.asarray(z["stds"], dtype=np.float64)
        train_years = np.asarray(z["train_years"], dtype=np.int32)

    print(f"[PRED] Loading grid from {grid_csv} ...")
    grid_df = gdp.load_grid(str(grid_csv))
    cell_id_to_idx = {
        int(cid): int(idx)
        for cid, idx in zip(grid_df["cell_id"], grid_df["seg_idx"])
    }

    print(f"[PRED] Loading adjacency from {grid_w_pkl} ...")
    with open(grid_w_pkl, "rb") as f:
        w = pickle.load(f)
    if not isinstance(w, csr_matrix):
        w = csr_matrix(w)

    if w.shape[0] != len(grid_df):
        raise ValueError(
            f"Adjacency size {w.shape} does not match grid N={len(grid_df)}"
        )

    print(
        f"[PRED] Model ready: xi={xi:.3f}  beta={np.round(beta, 3)}  "
        f"N={len(grid_df)}  train_years={train_years.tolist()}"
    )
    return FittedModel(
        xi=xi,
        beta=beta,
        means=means,
        stds=stds,
        W=w,
        grid_df=grid_df,
        cell_id_to_idx=cell_id_to_idx,
        train_years=train_years,
    )


def _year_paths(data_dir: Path, year: int) -> tuple[Path, Path]:
    weather = data_dir / f"grid_weather_{year}.csv"
    veg = data_dir / f"daily_gridded_CA_{year}.nc"
    if not weather.is_file():
        raise FileNotFoundError(
            f"No weather data for year {year}: missing {weather}"
        )
    if not veg.is_file():
        raise FileNotFoundError(
            f"No vegetation data for year {year}: missing {veg}"
        )
    return weather, veg


def _load_year_raw(
    year: int,
    data_dir: Path,
    grid_df: pd.DataFrame,
) -> tuple[np.ndarray, pd.DatetimeIndex]:
    weather, veg = _year_paths(data_dir, year)
    days = 366 if calendar.isleap(year) else 365
    date_range = pd.date_range(f"{year}-01-01", periods=days, freq="D")
    print(f"[PRED] Loading covariates for {year} ...")
    wx = gdp.load_weather_for_year(str(weather), date_range, grid_df)
    veg_x = gdp.load_vegetation_for_year(str(veg), date_range, grid_df)
    return gdp.build_covariate_matrix(wx, veg_x), date_range


def _weather_dates_present(data_dir: Path, years: Sequence[int]) -> set:
    """Dates that actually exist in grid_weather CSVs (not ffill inventions)."""
    present: set = set()
    for year in years:
        path = Path(data_dir) / f"grid_weather_{year}.csv"
        if not path.is_file():
            continue
        s = pd.read_csv(path, usecols=["date"], parse_dates=["date"])["date"]
        present.update(pd.to_datetime(s).dt.normalize().unique().tolist())
    return present


def load_covariate_window(
    data_dir: Path,
    grid_df: pd.DataFrame,
    end_date: date,
    lookback_days: int,
    means: np.ndarray,
    stds: np.ndarray,
) -> np.ndarray:
    """
    Build standardized full-grid X_window of shape (T_window, N, 6)
    ending on ``end_date``.
    """
    if lookback_days < 1:
        raise ValueError("lookback_days must be >= 1")

    end = pd.Timestamp(end_date).normalize()
    start = end - pd.Timedelta(days=lookback_days - 1)
    window_dates = pd.date_range(start, end, freq="D")

    years = sorted({d.year for d in window_dates})
    print(
        f"[PRED] Building window {start.date()} .. {end.date()} "
        f"({len(window_dates)} days, years={years}) ..."
    )

    # Reject target / window days absent from weather CSVs (ffill would invent them)
    present = _weather_dates_present(Path(data_dir), years)
    if end not in present:
        raise ValueError(
            f"Date {end.date()} has no weather rows in grid_weather CSV "
            f"(removed or never extracted)"
        )
    missing_wx = [d for d in window_dates if d not in present]
    if missing_wx:
        raise ValueError(
            f"Lookback window includes {len(missing_wx)} day(s) without weather "
            f"rows (e.g. {missing_wx[0].date()} .. {missing_wx[-1].date()})"
        )

    chunks = []
    date_index_parts = []
    for year in years:
        try:
            x_raw, dr = _load_year_raw(year, Path(data_dir), grid_df)
        except FileNotFoundError as exc:
            raise ValueError(str(exc)) from exc
        chunks.append(x_raw)
        date_index_parts.append(dr)

    x_all = np.concatenate(chunks, axis=0)
    dates_all = date_index_parts[0].append(date_index_parts[1:])
    date_to_t = {d: i for i, d in enumerate(dates_all)}

    missing = [d for d in window_dates if d not in date_to_t]
    if missing:
        raise ValueError(
            f"Date(s) outside available covariate data: "
            f"{missing[0].date()} .. {missing[-1].date()} "
            f"({len(missing)} missing day(s) in lookback window)"
        )

    idxs = [date_to_t[d] for d in window_dates]
    x_raw_window = x_all[idxs].copy()

    for k in range(x_raw_window.shape[2]):
        mask = ~np.isfinite(x_raw_window[:, :, k])
        if mask.any():
            x_raw_window[:, :, k][mask] = means[k]

    x_std = ((x_raw_window - means) / stds).astype(np.float32)
    ones = np.ones((*x_std.shape[:2], 1), dtype=np.float32)
    x_window = np.concatenate([ones, x_std], axis=2)
    print(f"[PRED]   X_window shape={x_window.shape}")
    return x_window


def predict_cell_risk(
    model: FittedModel,
    cell_id: int,
    on_date: DateLike,
    data_dir: Path,
    lookback_days: Optional[int] = None,
) -> float:
    """Return ignition intensity λ for one cell on one date."""
    if lookback_days is None:
        lookback_days = lookback_days_from_env()

    cell_id = int(cell_id)
    if cell_id not in model.cell_id_to_idx:
        raise KeyError(f"Unknown cell_id={cell_id} (not in grid_cells.csv)")

    target = _as_date(on_date)
    print(
        f"[PRED] Request cell_id={cell_id} date={target} "
        f"lookback_days={lookback_days}"
    )

    x_window = load_covariate_window(
        data_dir=Path(data_dir),
        grid_df=model.grid_df,
        end_date=target,
        lookback_days=lookback_days,
        means=model.means,
        stds=model.stds,
    )

    print("[PRED] Running _mrnn_forward ...")
    log_lambda = _mrnn_forward(model.xi, model.beta, x_window, model.W)
    idx = model.cell_id_to_idx[cell_id]
    risk = float(np.exp(log_lambda[-1, idx]))
    print(f"[PRED]   risk={risk:.6e}  (cell_idx={idx})")
    return risk
