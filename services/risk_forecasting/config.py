"""Service-local configuration (env overrides welcome)."""

from __future__ import annotations

import os
from typing import List

from shared.paths import get_artifacts_dir, get_data_dir, get_service_root

SERVICE_ROOT = get_service_root()
DATA_DIR = get_data_dir()
ARTIFACTS_DIR = get_artifacts_dir()

GRID_CSV = DATA_DIR / "grid_cells.csv"
GRID_W_PKL = DATA_DIR / "grid_W.pkl"
PARAMS_PATH = ARTIFACTS_DIR / "cnhpp_params.npz"

DEFAULT_TRAIN_YEARS: List[int] = [2020, 2021, 2022, 2023]
DEFAULT_LOOKBACK_DAYS = 90
GRID_SPACING_DEG = 0.24


def train_years_from_env() -> List[int]:
    raw = os.environ.get("TRAIN_YEARS", "")
    if not raw.strip():
        return list(DEFAULT_TRAIN_YEARS)
    return [int(x.strip()) for x in raw.split(",") if x.strip()]


def lookback_days_from_env() -> int:
    return int(os.environ.get("LOOKBACK_DAYS", str(DEFAULT_LOOKBACK_DAYS)))
