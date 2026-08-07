# Wildfire Services

Modular service layer for wildfire risk research. The first service wraps an existing **cNHPP** (convolutional Non-homogeneous Poisson Process) ignition model and exposes historical cell/date risk scores via FastAPI.

## Layout

```text
shared/                         # cross-service utilities (paths, etc.)
services/risk_forecasting/
  models.py                     # HPP / NHPP / cNHPP (do not modify lightly)
  grid_data_prep.py             # grid data loaders (do not modify lightly)
  adjacency.py                  # rebuild W from grid_cells.csv
  fit_model.py                  # fit + persist xi/beta
  predictor.py                  # trailing-window scoring
  app.py                        # FastAPI service
  data/                         # local data (large files gitignored)
  artifacts/                    # cnhpp_params.npz after fit
  legacy/                       # superseded circuit-level code (reference only)
```

## Setup

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Place (or keep) local data under `services/risk_forecasting/data/`:

| File | Tracked? |
|------|----------|
| `grid_cells.csv` | yes |
| `circuit_midpoints.csv` | yes |
| `grid_weather_YYYY.csv` | no |
| `events_YYYY.csv` | no |
| `daily_gridded_CA_YYYY.nc` | no |
| `grid_W.pkl` | no (rebuilt by fit / adjacency) |

## Fit the model

Default train years: **2020–2023** (2024 held out).

```bash
# from repo root
python -m services.risk_forecasting.adjacency   # rebuild W only
python -m services.risk_forecasting.fit_model   # rebuild W + fit + persist
```

Artifacts land in `services/risk_forecasting/artifacts/cnhpp_params.npz`.

Adjacency sanity check after rebuild: **nnz ≈ 3922**, **avg neighbors ≈ 3.8**.

## Run the API

```bash
uvicorn services.risk_forecasting.app:app --reload --app-dir .
```

- `GET /health`
- `GET /predict?cell_id=0&date=2024-07-15`
- Optional: `&lookback_days=30` (default **90**, overridable via `LOOKBACK_DAYS`)

Prediction uses a **full-grid** covariate window (required by the spatial memory term `W @ h`) and returns `exp(log_lambda)` for the requested cell only.

## Configuration

| Env var | Default | Purpose |
|---------|---------|---------|
| `RISK_FORECASTING_DATA_DIR` | `services/risk_forecasting/data` | Data root |
| `RISK_FORECASTING_ARTIFACTS_DIR` | `services/risk_forecasting/artifacts` | Params root |
| `TRAIN_YEARS` | `2020,2021,2022,2023` | Fit years |
| `LOOKBACK_DAYS` | `90` | Trailing window for `/predict` |

## Known issues

### `grid_data_prep.load_year()` is broken

`load_year()` passes an integer `N` into `load_weather_for_year(..., grid_df)`, which expects a DataFrame. **Do not call `load_year()`.** The fit and predict wrappers call `load_weather_for_year` / `load_vegetation_for_year` directly instead. `prepare_multiyear()` also expects a single combined events CSV; this repo uses per-year `events_YYYY.csv` files, so the service layers concatenate those itself.

`models.py` and `grid_data_prep.py` are left unchanged on purpose; new code wraps them.

## Scope

Historical dates only for years with local covariate files. No live HRRR ingestion in this service.
