"""Environment for the GPU control service (port 8005)."""

from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv

from shared.db import REPO_ROOT

load_dotenv(REPO_ROOT / ".env")


DEFAULT_INSTANCE_ID = "i-09526a2a9268135f2"
DEFAULT_OLLAMA_URL = "http://172.31.16.67:11434"
DEFAULT_MODEL = "qwen3:32b"
DEFAULT_AGENT_URL = "http://127.0.0.1:8004"
START_BUDGET_SECONDS = 190


@dataclass(frozen=True)
class GpuControlSettings:
    instance_id: str
    region: str | None
    ollama_url: str
    model: str
    control_token: str | None
    agent_url: str = DEFAULT_AGENT_URL
    start_budget_seconds: int = START_BUDGET_SECONDS

    @classmethod
    def from_env(cls) -> GpuControlSettings:
        load_dotenv(REPO_ROOT / ".env")
        region = (
            os.getenv("GPU_AWS_REGION")
            or os.getenv("AWS_REGION")
            or os.getenv("AWS_DEFAULT_REGION")
            or None
        )
        token = os.getenv("GPU_CONTROL_TOKEN") or None
        if token is not None:
            token = token.strip() or None
        return cls(
            instance_id=(
                os.getenv("GPU_INSTANCE_ID") or DEFAULT_INSTANCE_ID
            ).strip(),
            region=region.strip() if region else None,
            ollama_url=(
                os.getenv("GPU_OLLAMA_URL") or DEFAULT_OLLAMA_URL
            ).rstrip("/"),
            model=(os.getenv("GPU_MODEL") or DEFAULT_MODEL).strip(),
            control_token=token,
            agent_url=(
                os.getenv("GPU_AGENT_URL") or DEFAULT_AGENT_URL
            ).rstrip("/"),
        )
