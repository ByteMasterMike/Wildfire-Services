"""FastAPI ignition-risk predict service."""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import date
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field

from services.risk_forecasting.config import DATA_DIR, lookback_days_from_env
from services.risk_forecasting.predictor import FittedModel, load_fitted_model, predict_cell_risk

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
    description="Historical ignition risk scores from a fitted cNHPP model.",
    version="0.1.0",
    lifespan=lifespan,
)


class PredictResponse(BaseModel):
    cell_id: int
    date: date
    risk: float = Field(..., description="Ignition intensity λ for the cell/day")
    xi: float
    lookback_days: int


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
    cell_id: int = Query(..., description="Grid cell ID"),
    date: date = Query(..., description="Historical date YYYY-MM-DD"),
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
    print(f"[API] /predict cell_id={cell_id} date={date} lookback_days={lb}")

    try:
        risk = predict_cell_risk(
            _model,
            cell_id=cell_id,
            on_date=date,
            data_dir=DATA_DIR,
            lookback_days=lb,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return PredictResponse(
        cell_id=cell_id,
        date=date,
        risk=risk,
        xi=_model.xi,
        lookback_days=lb,
    )
