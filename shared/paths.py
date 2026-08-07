"""Configurable filesystem roots for Wildfire Services."""

from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SERVICE_ROOT = REPO_ROOT / "services" / "risk_forecasting"


def get_service_root() -> Path:
    return Path(
        os.environ.get("RISK_FORECASTING_ROOT", str(DEFAULT_SERVICE_ROOT))
    ).resolve()


def get_data_dir() -> Path:
    return Path(
        os.environ.get(
            "RISK_FORECASTING_DATA_DIR",
            str(get_service_root() / "data"),
        )
    ).resolve()


def get_artifacts_dir() -> Path:
    return Path(
        os.environ.get(
            "RISK_FORECASTING_ARTIFACTS_DIR",
            str(get_service_root() / "artifacts"),
        )
    ).resolve()
