"""Shared Postgres/PostGIS connection settings (loaders + API services)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import psycopg
from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[1]
_ENV_LOADED = False


def load_env(*, override: bool = False) -> Path:
    """Load repo-root `.env` once. Returns the path that was (attempted to be) loaded."""
    global _ENV_LOADED
    env_path = REPO_ROOT / ".env"
    # Always (re)apply when override requested; otherwise once per process.
    if override or not _ENV_LOADED:
        loaded = load_dotenv(env_path, override=override)
        _ENV_LOADED = True
        if loaded:
            print(f"[db] loaded env file: {env_path}")
        elif env_path.exists():
            print(f"[db] env file present but empty/unparsed: {env_path}")
        else:
            print(f"[db] no .env at {env_path}; using process env + defaults")
    return env_path


@dataclass(frozen=True)
class Settings:
    host: str
    port: int
    dbname: str
    user: str
    password: str
    database_url: str | None
    dataset_demo_data_dir: Path
    risk_forecasting_data_dir: Path
    grid_cell_spacing_deg: float
    schema_sql: Path

    @property
    def dsn(self) -> str:
        if self.database_url:
            return self.database_url
        return (
            f"postgresql://{self.user}:{self.password}"
            f"@{self.host}:{self.port}/{self.dbname}"
        )

    @property
    def safe_target(self) -> str:
        """Host/port/db for logs (no password)."""
        if self.database_url:
            # Avoid printing password if URL embeds it
            return f"DATABASE_URL(host={self.host}:{self.port}/{self.dbname})"
        return f"{self.host}:{self.port}/{self.dbname}"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    load_env(override=False)

    default_demo = (REPO_ROOT.parent / "dataset_demo" / "assets" / "data").resolve()
    default_risk = (REPO_ROOT / "services" / "risk_forecasting" / "data").resolve()

    demo_raw = os.environ.get("DATASET_DEMO_DATA_DIR", str(default_demo))
    risk_raw = os.environ.get("RISK_FORECASTING_DATA_DIR", str(default_risk))

    demo_path = Path(demo_raw)
    if not demo_path.is_absolute():
        demo_path = (REPO_ROOT / demo_path).resolve()
    risk_path = Path(risk_raw)
    if not risk_path.is_absolute():
        risk_path = (REPO_ROOT / risk_path).resolve()

    # Default host port 5433 matches docker-compose (avoids local Windows Postgres on 5432).
    settings = Settings(
        host=os.environ.get("POSTGRES_HOST", "localhost"),
        port=int(os.environ.get("POSTGRES_PORT", "5433")),
        dbname=os.environ.get("POSTGRES_DB", "wildfire"),
        user=os.environ.get("POSTGRES_USER", "wildfire"),
        password=os.environ.get("POSTGRES_PASSWORD", "wildfire"),
        database_url=os.environ.get("DATABASE_URL") or None,
        dataset_demo_data_dir=demo_path,
        risk_forecasting_data_dir=risk_path,
        grid_cell_spacing_deg=float(os.environ.get("GRID_CELL_SPACING_DEG", "0.24")),
        schema_sql=REPO_ROOT / "db" / "schema.sql",
    )
    print(f"[db] connection target: {settings.safe_target} user={settings.user}")
    return settings


def connect(
    settings: Settings | None = None,
    *,
    autocommit: bool = False,
) -> psycopg.Connection:
    settings = settings or get_settings()
    conn = psycopg.connect(settings.dsn, autocommit=autocommit)
    return conn


def clear_settings_cache() -> None:
    get_settings.cache_clear()
