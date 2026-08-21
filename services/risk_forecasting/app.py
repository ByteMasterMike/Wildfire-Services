"""FastAPI ignition-risk predict service."""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import date
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field

from services.risk_forecasting.config import DATA_DIR, lookback_days_from_env
from services.risk_forecasting.place import PlaceNotFound, resolve_place
from services.risk_forecasting.predictor import (
    AGGREGATION,
    AGGREGATION_NOTE,
    CoverageError,
    FittedModel,
    load_fitted_model,
    score_place,
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
