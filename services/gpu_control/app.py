"""FastAPI GPU control service — port 8005. Start/stop the demo Ollama instance."""

from __future__ import annotations

import hmac
import time
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from services.gpu_control import aws
from services.gpu_control.config import GpuControlSettings
from services.gpu_control.ollama import probe_ollama
from services.gpu_control.state import EBS_NOTE, classify_state, eta_fields

_start_requested_at: float | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = GpuControlSettings.from_env()
    token_state = "set" if settings.control_token else "MISSING (POST start/stop return 503)"
    print(
        f"[gpu_control] instance={settings.instance_id} "
        f"region={settings.region or '(boto3 default chain)'} "
        f"ollama={settings.ollama_url} model={settings.model} "
        f"token={token_state}"
    )
    yield
    print("[gpu_control] Shutdown")


app = FastAPI(
    title="Wildfire GPU Control",
    description=(
        "Start and stop the demo GPU instance that runs Ollama. "
        "Does not start the GPU as a side effect of Ask or health polls."
    ),
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _settings() -> GpuControlSettings:
    return GpuControlSettings.from_env()


def _require_token(request: Request, settings: GpuControlSettings) -> None:
    if not settings.control_token:
        raise HTTPException(
            status_code=503,
            detail="GPU_CONTROL_TOKEN is not configured; start and stop are disabled",
        )
    provided = request.headers.get("X-GPU-Control-Token") or ""
    expected = settings.control_token
    if len(provided) != len(expected) or not hmac.compare_digest(provided, expected):
        raise HTTPException(
            status_code=401,
            detail="Invalid or missing GPU control token",
        )


async def _status_payload(settings: GpuControlSettings) -> dict[str, Any]:
    try:
        instance = aws.describe_instance(settings)
        ec2_state = instance.get("ec2_state") or ""
        reason = None
    except Exception as exc:  # noqa: BLE001
        instance = {
            "instance_id": settings.instance_id,
            "ec2_state": "",
            "private_ip": None,
        }
        ec2_state = ""
        reason = str(exc)

    ollama = {"reachable": False, "model_resident": False}
    if ec2_state == "running":
        ollama = await probe_ollama(settings.ollama_url, settings.model)

    state, classify_reason = classify_state(
        ec2_state,
        ollama_reachable=bool(ollama.get("reachable")),
        model_resident=bool(ollama.get("model_resident")),
    )
    if reason is None:
        reason = classify_reason
    elif classify_reason:
        reason = f"{reason}; {classify_reason}"

    payload: dict[str, Any] = {
        "state": state,
        "ec2_state": ec2_state or None,
        "ollama_reachable": bool(ollama.get("reachable")),
        "model_resident": bool(ollama.get("model_resident")),
        "instance_id": instance.get("instance_id") or settings.instance_id,
        "model": settings.model,
        "ebs_note": EBS_NOTE,
        "reason": reason,
    }
    payload.update(
        eta_fields(
            state,
            _start_requested_at,
            now=time.monotonic(),
            budget_seconds=settings.start_budget_seconds,
        )
    )
    return payload


@app.get("/health")
async def health() -> dict[str, Any]:
    settings = _settings()
    return {
        "status": "ok",
        "service": "gpu_control",
        "instance_id": settings.instance_id,
        "token_configured": bool(settings.control_token),
    }


@app.get("/gpu/status")
async def gpu_status() -> dict[str, Any]:
    return await _status_payload(_settings())


@app.post("/gpu/start")
async def gpu_start(request: Request) -> dict[str, Any]:
    global _start_requested_at
    settings = _settings()
    _require_token(request, settings)
    try:
        aws.start_instance(settings)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    if _start_requested_at is None:
        _start_requested_at = time.monotonic()
    return await _status_payload(settings)


@app.post("/gpu/stop")
async def gpu_stop(request: Request) -> dict[str, Any]:
    global _start_requested_at
    settings = _settings()
    _require_token(request, settings)
    try:
        aws.stop_instance(settings)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    _start_requested_at = None
    return await _status_payload(settings)
