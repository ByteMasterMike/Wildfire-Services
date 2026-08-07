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

### Cell 461 vegetation is all-NaN

Grid cell `461` has all-NaN `NDVI` and `fm100` in every available vegetation NetCDF year. The fit/predict wrappers mean-fill those values from the training column means, so **predictions for cell 461 are not meaningfully data-driven on vegetation** (weather covariates still apply). Related: cells `71`, `439`, and `521` have all-NaN `fm100` only. Excluding those four cells from a refit does not materially change coefficients (they hold 0 train events).

### SPFH coefficient is a covariate-semantics issue

After fixing Dec 2020 weather, cNHPP still fits a **positive** SPFH coefficient. That is not a data bug: specific humidity is not a dryness measure (warm air holds more moisture). Train TMP–SPFH correlation is moderate (~0.31 overall, ~0.44 within-cell; summer slightly negative). The eventual fix is to replace SPFH with **VPD or RH**, consistent with the lab’s fire-weather work.

### fm100 is largely redundant with TMP

Train Pearson(TMP, fm100) ≈ **−0.64**. Once TMP is estimated correctly (β ≈ +0.55), fm100’s coefficient collapses toward zero (~−0.02) because temperature already carries the warm/dry seasonal signal. That shrink is collinearity, not NaN dilution or a loader bug.

### December 2020 weather in `grid_weather_2020.csv`

`California_HRRR_daily_2020_01.csv` has a mid-file column shift for 2020-12-02…12-31 (TMP holds SPFH-scale values; real Kelvin sits under `Total Cloud Cover`). No clean same-hour (01Z) replacement exists. Other hours (06/12/18Z) are clean but systematically colder by ~2–6 K vs 01Z in November (~0.3–0.7× daily TMP std), so they were **not** substituted.

**Resolution:** those 30 days are removed from `grid_weather_2020.csv` and excluded from training. `prep_hrrr_grid.py` now rejects any day whose median TMP is outside 200–330 K. Fit selects `xi` by **2024 validation** log-likelihood (`VAL_YEAR`, default 2024).

## HPP vs NHPP vs cNHPP (corrected data)

Leave-one-year-out on 2022/2023/2024 (train = other years in 2020–2024; Dec 2–31 2020 excluded). cNHPP ξ selected by train LL. Uncertainty on ΔLL = cNHPP − NHPP via day-blocked bootstrap (5000 resamples).

| Holdout | NHPP val LL | cNHPP val LL | ΔLL | Bootstrap SE | 95% CI | P(Δ≤0) |
|---------|-------------|--------------|-----|--------------|--------|--------|
| 2022 | −4246.0 | −4248.6 | **−2.6** | 7.9 | [−20.6, +9.8] | 0.58 |
| 2023 | −3419.9 | −3424.0 | **−4.2** | 10.7 | [−28.0, +11.2] | 0.61 |
| 2024 | −4877.6 | −4873.9 | **+3.7** | 5.6 | [−9.0, +12.3] | 0.24 |

**Verdict: tie.** ΔLL flips sign across years, every 95% CI covers 0, and \|ΔLL\| is ≪ SE (~0.1% of \|NHPP LL\|). Fixing Dec 2020 does not change the prior finding that spatial memory adds little on this 824-cell weather grid. Rerun: `python -m services.risk_forecasting.compare_models`.

## Scope

Historical dates only for years with local covariate files. No live HRRR ingestion in this service.
