"""FastAPI ignition-risk predict service."""

from __future__ import annotations

import csv
from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from services.risk_forecasting.config import DATA_DIR, lookback_days_from_env
from services.risk_forecasting.observed import (
    observed_surface,
    observed_training_surface,
)
from services.risk_forecasting.place import PlaceNotFound, resolve_place
from services.risk_forecasting.predictor import (
    AGGREGATION,
    AGGREGATION_NOTE,
    CoverageError,
    FittedModel,
    load_fitted_model,
    score_place,
    score_surface,
)

_model: Optional[FittedModel] = None
_load_error: Optional[str] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _model, _load_error
    print("[API] Startup: loading fitted model ...")
    try:
        _model = load_fitted_model()
        _load_error = None
        print("[API] Startup complete.")
    except Exception as exc:  # noqa: BLE001 — surface any load failure as 503
        _model = None
        _load_error = str(exc)
        print(f"[API] Startup WARNING: model not loaded: {_load_error}")
    yield
    print("[API] Shutdown.")


app = FastAPI(
    title="Wildfire Risk Forecasting",
    description=(
        "Historical place-based ignition risk from a fitted cNHPP model. "
        "Scores dates with local weather/vegetation files only; no live HRRR."
    ),
    version="0.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class PlaceScope(BaseModel):
    type: str
    name: str


class PredictResponse(BaseModel):
    date: date
    risk: float = Field(
        ...,
        description="P(≥1 ignition) for the requested place: 1 - exp(-sum(λ))",
    )
    expected_count: float
    xi: float
    lookback_days: int
    aggregation: str = AGGREGATION
    aggregation_note: str = AGGREGATION_NOTE
    cell_count: int
    scope: PlaceScope
    local_percentile: float
    statewide_percentile: float
    local_period: str
    local_n: int
    cell_id: Optional[int] = None
    cell_ids: Optional[list[int]] = None
    intensity: Optional[float] = Field(
        None, description="Single-cell Poisson intensity λ"
    )
    mean_intensity: Optional[float] = None
    includes_cell_461: bool = False


class SurfaceCell(BaseModel):
    cell_id: int
    lat: float
    lon: float
    risk: float = Field(
        ...,
        description="P(≥1 ignition) for this cell: 1 - exp(-λ)",
    )
    expected_count: float
    intensity: float = Field(..., description="Single-cell Poisson intensity λ")


class SurfaceResponse(BaseModel):
    date: date
    lookback_days: int
    cells: list[SurfaceCell]


class ObservedCell(BaseModel):
    cell_id: int
    lat: float
    lon: float
    observed_count: int


class ObservedResponse(BaseModel):
    date: date
    cells: list[ObservedCell]


class MetricsResponse(BaseModel):
    model: str
    log_likelihood: float
    top5_precision: float
    top1_precision: float
    lift_top5: float
    auc: float = Field(
        ...,
        description="Secondary ranking diagnostic; not a headline Poisson count metric",
    )


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    detail: Optional[str] = None


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    if _model is None:
        return HealthResponse(
            status="degraded",
            model_loaded=False,
            detail=_load_error or "Fitted model not loaded",
        )
    return HealthResponse(status="ok", model_loaded=True)


@app.get("/metrics", response_model=MetricsResponse)
def metrics() -> MetricsResponse:
    """Return the persisted cNHPP evaluation row; no model recomputation."""
    metrics_path = Path(__file__).resolve().parent / "outputs" / "metrics_table.csv"
    try:
        with metrics_path.open(newline="", encoding="utf-8") as handle:
            row = next(
                item
                for item in csv.DictReader(handle)
                if item["model"].strip().lower() == "cnhpp"
            )
    except (FileNotFoundError, StopIteration, KeyError) as exc:
        raise HTTPException(
            status_code=503,
            detail=f"cNHPP metrics are unavailable in {metrics_path}",
        ) from exc

    return MetricsResponse(
        model=row["model"],
        log_likelihood=float(row["log_likelihood"]),
        top5_precision=float(row["top5%_precision"]),
        top1_precision=float(row["top1%_precision"]),
        lift_top5=float(row["lift_top5%"]),
        auc=float(row["AUC"]),
    )


@app.get("/predict", response_model=PredictResponse)
def predict(
    date: date = Query(..., description="Historical date YYYY-MM-DD"),
    cell_id: Optional[int] = Query(None, description="Grid cell ID"),
    lat: Optional[float] = Query(None, ge=-90, le=90),
    lon: Optional[float] = Query(None, ge=-180, le=180),
    county: Optional[str] = Query(None, description="County name (Census TIGER)"),
    utility: Optional[str] = Query(None, description="PGE, SCE, or SDGE"),
    lookback_days: Optional[int] = Query(
        None,
        ge=1,
        description="Trailing window length (default LOOKBACK_DAYS env / 90)",
    ),
) -> PredictResponse:
    if _model is None:
        raise HTTPException(
            status_code=503,
            detail=_load_error
            or "Fitted parameters not available. Run fit_model first.",
        )

    lb = lookback_days if lookback_days is not None else lookback_days_from_env()
    print(
        f"[API] /predict date={date} cell_id={cell_id} lat={lat} lon={lon} "
        f"county={county!r} utility={utility!r} lookback_days={lb}"
    )

    try:
        place = resolve_place(
            cell_id=cell_id,
            lat=lat,
            lon=lon,
            county=county,
            utility=utility,
            known_cell_ids=_model.cell_id_to_idx.keys(),
        )
        scored = score_place(
            _model,
            place,
            on_date=date,
            data_dir=DATA_DIR,
            lookback_days=lb,
        )
    except PlaceNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except CoverageError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    payload: dict[str, Any] = scored.as_response()
    return PredictResponse.model_validate(payload)


@app.get("/surface", response_model=SurfaceResponse)
def surface(
    date: date = Query(..., description="Historical date YYYY-MM-DD"),
    lookback_days: Optional[int] = Query(
        None,
        ge=1,
        description="Trailing window length (default LOOKBACK_DAYS env / 90)",
    ),
) -> SurfaceResponse:
    if _model is None:
        raise HTTPException(
            status_code=503,
            detail=_load_error
            or "Fitted parameters not available. Run fit_model first.",
        )

    lb = lookback_days if lookback_days is not None else lookback_days_from_env()
    print(f"[API] /surface date={date} lookback_days={lb}")

    try:
        payload = score_surface(_model, date, DATA_DIR, lb)
    except CoverageError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return SurfaceResponse.model_validate(payload)


@app.get("/observed", response_model=ObservedResponse)
def observed(
    date: date = Query(..., description="Historical date YYYY-MM-DD"),
) -> ObservedResponse:
    """Polygon containment against live warehouse CPUC ignitions.

    ``ST_Contains(grid_cells.geom, cpuc_ignitions.geom)`` for the given date.
    Points outside every 0.24° cell are dropped. Use ``/observed-training``
    for residuals against the fitted cNHPP evaluation.
    """
    print(f"[API] /observed date={date}")
    return ObservedResponse.model_validate(observed_surface(date))


@app.get("/observed-training", response_model=ObservedResponse)
def observed_training(
    date: date = Query(..., description="Historical date YYYY-MM-DD"),
) -> ObservedResponse:
    """Nearest SW-corner snap, matching how the model training set was built.

    Assigns each warehouse CPUC point with ``snap_events_to_grid`` (same
    method as ``events_YYYY.csv``). Every point lands in a cell. Use this
    endpoint for residuals against the model's own evaluation.
    """
    print(f"[API] /observed-training date={date}")
    return ObservedResponse.model_validate(observed_training_surface(date))
