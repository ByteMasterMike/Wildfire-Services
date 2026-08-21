"""Load persisted cNHPP params and score cells/dates (wraps models.py)."""

from __future__ import annotations

import calendar
import pickle
from dataclasses import dataclass
from datetime import date, datetime
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
from services.risk_forecasting.place import PlaceResolution


DateLike = Union[str, date, datetime, pd.Timestamp]

AGGREGATION = "p_at_least_one"
AGGREGATION_NOTE = (
    "1 - exp(-sum(lambda)); independent Poisson cells; "
    "expected_count is the sum of intensities"
)
DROPPED_DEC_2020_START = date(2020, 12, 2)
DROPPED_DEC_2020_END = date(2020, 12, 31)
LOCAL_PERCENTILE_YEARS = range(2020, 2026)
_MONTH_NAMES = (
    "",
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)

_year_raw_cache: dict[tuple[str, int], tuple[np.ndarray, pd.DatetimeIndex]] = {}
_weather_dates_cache: dict[str, set] = {}
_coverage_end_cache: dict[str, date] = {}
_lambda_cache: dict[tuple[str, int, date], np.ndarray] = {}


class CoverageError(ValueError):
    """Date is outside scoreable covariate coverage."""


def coverage_end_message(end: date) -> str:
    return (
        f"Covariates end {end.isoformat()} and no forecast ingestion exists. "
        "This service scores historical dates only."
    )


def dropped_dec_2020_message() -> str:
    return (
        "Dates 2020-12-02 through 2020-12-31 were dropped because of "
        "corrupt HRRR export."
    )


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


def last_covariate_date(data_dir: Path) -> date:
    """Latest date present in grid_weather_YYYY.csv files."""
    key = str(Path(data_dir).resolve())
    cached = _coverage_end_cache.get(key)
    if cached is not None:
        return cached
    last: Optional[date] = None
    for path in sorted(Path(data_dir).glob("grid_weather_*.csv")):
        series = pd.read_csv(path, usecols=["date"], parse_dates=["date"])["date"]
        if series.empty:
            continue
        mx = pd.to_datetime(series).max().date()
        if last is None or mx > last:
            last = mx
    if last is None:
        raise FileNotFoundError(f"No grid_weather_YYYY.csv files under {data_dir}")
    _coverage_end_cache[key] = last
    return last


def is_dropped_dec_2020(on_date: date) -> bool:
    return DROPPED_DEC_2020_START <= on_date <= DROPPED_DEC_2020_END


def raise_if_unscoreable(on_date: date, data_dir: Path) -> None:
    """Fail with an honest coverage message before generic weather-row errors."""
    if is_dropped_dec_2020(on_date):
        raise CoverageError(dropped_dec_2020_message())
    data_dir = Path(data_dir)
    last = last_covariate_date(data_dir)
    weather = data_dir / f"grid_weather_{on_date.year}.csv"
    veg = data_dir / f"daily_gridded_CA_{on_date.year}.nc"
    if on_date > last or not weather.is_file() or not veg.is_file():
        raise CoverageError(coverage_end_message(last))


def poisson_at_least_one(lambdas: np.ndarray) -> float:
    """P(≥1) under independent Poisson cells: 1 - exp(-sum(λ))."""
    total = float(np.sum(np.asarray(lambdas, dtype=np.float64)))
    return float(1.0 - np.exp(-total))


def percentile_rank(value: float, references: Sequence[float]) -> float:
    """Percent (0–100) of reference values ≤ this value."""
    refs = np.asarray(list(references), dtype=np.float64)
    if refs.size == 0:
        raise ValueError("percentile_rank requires at least one reference value")
    return float(100.0 * np.mean(refs <= float(value)))


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
    key = (str(Path(data_dir).resolve()), int(year))
    cached = _year_raw_cache.get(key)
    if cached is not None:
        return cached
    weather, veg = _year_paths(data_dir, year)
    days = 366 if calendar.isleap(year) else 365
    date_range = pd.date_range(f"{year}-01-01", periods=days, freq="D")
    print(f"[PRED] Loading covariates for {year} ...")
    wx = gdp.load_weather_for_year(str(weather), date_range, grid_df)
    veg_x = gdp.load_vegetation_for_year(str(veg), date_range, grid_df)
    loaded = gdp.build_covariate_matrix(wx, veg_x), date_range
    _year_raw_cache[key] = loaded
    return loaded


def _weather_dates_present(data_dir: Path, years: Sequence[int]) -> set:
    """Dates that actually exist in grid_weather CSVs (not ffill inventions)."""
    root = str(Path(data_dir).resolve())
    present: set = set()
    for year in years:
        cache_key = f"{root}:{year}"
        cached = _weather_dates_cache.get(cache_key)
        if cached is None:
            path = Path(data_dir) / f"grid_weather_{year}.csv"
            if not path.is_file():
                cached = set()
            else:
                s = pd.read_csv(path, usecols=["date"], parse_dates=["date"])["date"]
                cached = set(pd.to_datetime(s).dt.normalize().unique().tolist())
            _weather_dates_cache[cache_key] = cached
        present.update(cached)
    return present


def lookback_window_complete(
    on_date: date,
    lookback_days: int,
    data_dir: Path,
) -> bool:
    """True when every day in the trailing window has weather rows."""
    if lookback_days < 1:
        return False
    end = pd.Timestamp(on_date).normalize()
    start = end - pd.Timedelta(days=lookback_days - 1)
    window_dates = pd.date_range(start, end, freq="D")
    years = sorted({d.year for d in window_dates})
    present = _weather_dates_present(Path(data_dir), years)
    return all(d in present for d in window_dates)


def load_covariate_window(
    data_dir: Path,
    grid_df: pd.DataFrame,
    end_date: date,
    lookback_days: int,
    means: np.ndarray,
    stds: np.ndarray,
    *,
    verbose: bool = True,
) -> np.ndarray:
    """
    Build standardized full-grid X_window of shape (T_window, N, 6)
    ending on ``end_date``.
    """
    if lookback_days < 1:
        raise ValueError("lookback_days must be >= 1")

    raise_if_unscoreable(_as_date(end_date), Path(data_dir))

    end = pd.Timestamp(end_date).normalize()
    start = end - pd.Timedelta(days=lookback_days - 1)
    window_dates = pd.date_range(start, end, freq="D")

    years = sorted({d.year for d in window_dates})
    if verbose:
        print(
            f"[PRED] Building window {start.date()} .. {end.date()} "
            f"({len(window_dates)} days, years={years}) ..."
        )

    # Reject target / window days absent from weather CSVs (ffill would invent them)
    present = _weather_dates_present(Path(data_dir), years)
    if end not in present:
        if is_dropped_dec_2020(end.date()):
            raise CoverageError(dropped_dec_2020_message())
        raise ValueError(
            f"Date {end.date()} has no weather rows in grid_weather CSV "
            f"(removed or never extracted)"
        )
    missing_wx = [d for d in window_dates if d not in present]
    if missing_wx:
        if any(is_dropped_dec_2020(d.date()) for d in missing_wx):
            raise CoverageError(
                "Lookback window includes 2020-12-02 through 2020-12-31, "
                "which were dropped because of corrupt HRRR export."
            )
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
    if verbose:
        print(f"[PRED]   X_window shape={x_window.shape}")
    return x_window


def predict_grid(
    model: FittedModel,
    on_date: DateLike,
    data_dir: Path,
    lookback_days: Optional[int] = None,
    *,
    verbose: bool = True,
) -> np.ndarray:
    """Return the 824-cell λ vector for one date (one window + one forward)."""
    if lookback_days is None:
        lookback_days = lookback_days_from_env()
    target = _as_date(on_date)
    cache_key = (str(Path(data_dir).resolve()), int(lookback_days), target)
    cached = _lambda_cache.get(cache_key)
    if cached is not None:
        return cached

    if verbose:
        print(f"[PRED] Grid score date={target} lookback_days={lookback_days}")
    x_window = load_covariate_window(
        data_dir=Path(data_dir),
        grid_df=model.grid_df,
        end_date=target,
        lookback_days=lookback_days,
        means=model.means,
        stds=model.stds,
        verbose=verbose,
    )
    if verbose:
        print("[PRED] Running _mrnn_forward ...")
    log_lambda = _mrnn_forward(model.xi, model.beta, x_window, model.W)
    lambdas = np.exp(log_lambda[-1]).astype(np.float64)
    _lambda_cache[cache_key] = lambdas
    return lambdas


def intensities_for_cells(
    model: FittedModel,
    lambdas: np.ndarray,
    cell_ids: Sequence[int],
) -> np.ndarray:
    """Slice a full-grid λ vector to the requested cell IDs."""
    out = np.empty(len(cell_ids), dtype=np.float64)
    for i, cell_id in enumerate(cell_ids):
        cid = int(cell_id)
        if cid not in model.cell_id_to_idx:
            raise KeyError(f"Unknown cell_id={cid} (not in grid_cells.csv)")
        out[i] = float(lambdas[model.cell_id_to_idx[cid]])
    return out


def predict_cell_risk(
    model: FittedModel,
    cell_id: int,
    on_date: DateLike,
    data_dir: Path,
    lookback_days: Optional[int] = None,
) -> float:
    """Return ignition intensity λ for one cell on one date."""
    cell_id = int(cell_id)
    if cell_id not in model.cell_id_to_idx:
        raise KeyError(f"Unknown cell_id={cell_id} (not in grid_cells.csv)")
    lambdas = predict_grid(
        model, on_date, Path(data_dir), lookback_days, verbose=True
    )
    return float(lambdas[model.cell_id_to_idx[cell_id]])


def _month_candidate_dates(month: int) -> list[date]:
    dates: list[date] = []
    for year in LOCAL_PERCENTILE_YEARS:
        last = calendar.monthrange(year, month)[1]
        for day in range(1, last + 1):
            dates.append(date(year, month, day))
    return dates


def _ensure_month_lambda_cache(
    model: FittedModel,
    data_dir: Path,
    month: int,
    lookback_days: int,
) -> None:
    """Score every complete-window day in this calendar month (all years)."""
    data_dir = Path(data_dir)
    for on_date in _month_candidate_dates(month):
        cache_key = (str(data_dir.resolve()), int(lookback_days), on_date)
        if cache_key in _lambda_cache:
            continue
        if not lookback_window_complete(on_date, lookback_days, data_dir):
            continue
        try:
            predict_grid(
                model,
                on_date,
                data_dir,
                lookback_days,
                verbose=False,
            )
        except (CoverageError, ValueError, FileNotFoundError, KeyError):
            continue


def local_and_statewide_percentiles(
    model: FittedModel,
    data_dir: Path,
    on_date: date,
    cell_ids: Sequence[int],
    lambdas: np.ndarray,
    lookback_days: int,
) -> tuple[float, float, str, int]:
    """Local month-history P(≥1) percentile and statewide mean-λ percentile."""
    place_idx_lambdas = intensities_for_cells(model, lambdas, cell_ids)
    place_p = poisson_at_least_one(place_idx_lambdas)
    place_mean = float(np.mean(place_idx_lambdas))
    statewide = percentile_rank(place_mean, lambdas)

    _ensure_month_lambda_cache(model, data_dir, on_date.month, lookback_days)
    local_refs: list[float] = []
    root = str(Path(data_dir).resolve())
    for hist_date in _month_candidate_dates(on_date.month):
        cached = _lambda_cache.get((root, int(lookback_days), hist_date))
        if cached is None:
            continue
        hist_place = intensities_for_cells(model, cached, cell_ids)
        local_refs.append(poisson_at_least_one(hist_place))
    if not local_refs:
        raise ValueError(
            f"No complete { _MONTH_NAMES[on_date.month] } weather windows "
            f"in {LOCAL_PERCENTILE_YEARS.start}–{LOCAL_PERCENTILE_YEARS.stop - 1}"
        )
    local = percentile_rank(place_p, local_refs)
    years = sorted({d.year for d in _month_candidate_dates(on_date.month)
                    if (root, int(lookback_days), d) in _lambda_cache})
    year_span = (
        f"{years[0]}–{years[-1]}" if years else
        f"{LOCAL_PERCENTILE_YEARS.start}–{LOCAL_PERCENTILE_YEARS.stop - 1}"
    )
    local_period = f"{_MONTH_NAMES[on_date.month]} {year_span}"
    return local, statewide, local_period, len(local_refs)


@dataclass
class PlaceScore:
    date: date
    risk: float
    expected_count: float
    xi: float
    lookback_days: int
    aggregation: str
    aggregation_note: str
    cell_count: int
    scope_type: str
    scope_name: str
    local_percentile: float
    statewide_percentile: float
    local_period: str
    local_n: int
    cell_id: Optional[int] = None
    cell_ids: Optional[list[int]] = None
    intensity: Optional[float] = None
    mean_intensity: Optional[float] = None
    includes_cell_461: bool = False

    def as_response(self) -> dict:
        payload = {
            "date": self.date,
            "risk": self.risk,
            "expected_count": self.expected_count,
            "xi": self.xi,
            "lookback_days": self.lookback_days,
            "aggregation": self.aggregation,
            "aggregation_note": self.aggregation_note,
            "cell_count": self.cell_count,
            "scope": {"type": self.scope_type, "name": self.scope_name},
            "local_percentile": self.local_percentile,
            "statewide_percentile": self.statewide_percentile,
            "local_period": self.local_period,
            "local_n": self.local_n,
            "includes_cell_461": self.includes_cell_461,
        }
        if self.cell_id is not None:
            payload["cell_id"] = self.cell_id
        if self.cell_ids is not None:
            payload["cell_ids"] = self.cell_ids
        if self.intensity is not None:
            payload["intensity"] = self.intensity
        if self.mean_intensity is not None:
            payload["mean_intensity"] = self.mean_intensity
        return payload


def score_place(
    model: FittedModel,
    place: PlaceResolution,
    on_date: DateLike,
    data_dir: Path,
    lookback_days: Optional[int] = None,
) -> PlaceScore:
    """Score one resolved place from a single full-grid forward pass."""
    if lookback_days is None:
        lookback_days = lookback_days_from_env()
    target = _as_date(on_date)
    unknown = [cid for cid in place.cell_ids if cid not in model.cell_id_to_idx]
    if unknown:
        raise KeyError(f"Unknown cell_id={unknown[0]} (not in grid_cells.csv)")

    lambdas = predict_grid(model, target, Path(data_dir), lookback_days)
    place_l = intensities_for_cells(model, lambdas, place.cell_ids)
    expected = float(np.sum(place_l))
    risk = poisson_at_least_one(place_l)
    local_p, state_p, local_period, local_n = local_and_statewide_percentiles(
        model, Path(data_dir), target, place.cell_ids, lambdas, lookback_days
    )
    single = place.cell_count == 1
    return PlaceScore(
        date=target,
        risk=risk,
        expected_count=expected,
        xi=float(model.xi),
        lookback_days=int(lookback_days),
        aggregation=AGGREGATION,
        aggregation_note=AGGREGATION_NOTE,
        cell_count=place.cell_count,
        scope_type=place.scope_type,
        scope_name=place.scope_name,
        local_percentile=local_p,
        statewide_percentile=state_p,
        local_period=local_period,
        local_n=local_n,
        cell_id=place.cell_ids[0] if single else None,
        cell_ids=place.cell_ids_for_response(),
        intensity=float(place_l[0]) if single else None,
        mean_intensity=None if single else float(np.mean(place_l)),
        includes_cell_461=place.includes_cell_461,
    )
