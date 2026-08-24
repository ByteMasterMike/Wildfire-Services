"""Background GPU bring-up: wait for Ollama, reuse agent warmup, then pre-fire /ask."""

from __future__ import annotations

import asyncio
import time
from typing import Any, Awaitable, Callable

import httpx

from services.gpu_control.config import GpuControlSettings
from services.gpu_control.ollama import probe_ollama

PREFLIGHT_QUESTION = "How many CPUC ignitions were there in 2023?"
OLLAMA_WAIT_SECONDS = 240
OLLAMA_POLL_SECONDS = 3.0
PREFLIGHT_TIMEOUT_SECONDS = 180.0

BOOT_ACTIVE = frozenset({"waiting_ollama", "warming", "preflight"})

ProbeFn = Callable[[str, str], Awaitable[dict[str, Any]]]
WarmFn = Callable[[], Awaitable[dict[str, Any]]]
AskFn = Callable[[str], Awaitable[dict[str, Any]]]


def empty_pipeline() -> dict[str, Any]:
    return {
        "status": "idle",
        "reason": None,
        "preflight": None,
    }


pipeline: dict[str, Any] = empty_pipeline()


def reset_pipeline() -> None:
    pipeline.clear()
    pipeline.update(empty_pipeline())


def overlay_boot_pipeline(state: str, pipeline_status: str) -> str:
    """Keep reporting loading_model until warmup + pre-fire succeed."""
    if pipeline_status == "failed":
        return "error"
    if pipeline_status in BOOT_ACTIVE and state == "ready":
        return "loading_model"
    return state


async def wait_for_ollama(
    ollama_url: str,
    model: str,
    *,
    probe: ProbeFn = probe_ollama,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    timeout_seconds: float = OLLAMA_WAIT_SECONDS,
    interval_seconds: float = OLLAMA_POLL_SECONDS,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout_seconds
    last_detail = "Ollama did not become reachable"
    while time.monotonic() < deadline:
        result = await probe(ollama_url, model)
        if result.get("reachable"):
            return result
        last_detail = str(result.get("detail") or last_detail)
        await sleep(interval_seconds)
    raise TimeoutError(last_detail)


async def warm_with_agent_provider() -> dict[str, Any]:
    """Load the model with the same num_ctx / options as the agent warmup."""
    from services.agent.config import AgentSettings
    from services.agent.provider import OpenAICompatibleProvider

    settings = AgentSettings.from_env()
    provider = OpenAICompatibleProvider(settings)
    try:
        return await provider.ensure_context_loaded()
    finally:
        await provider.close()


async def preflight_ask(
    agent_url: str,
    *,
    question: str = PREFLIGHT_QUESTION,
    timeout_seconds: float = PREFLIGHT_TIMEOUT_SECONDS,
) -> dict[str, Any]:
    url = agent_url.rstrip("/") + "/ask"
    async with httpx.AsyncClient(timeout=timeout_seconds) as client:
        response = await client.post(url, json={"question": question})
    try:
        payload = response.json()
    except Exception:  # noqa: BLE001
        payload = {}
    status = payload.get("status")
    answer = str(payload.get("answer_text") or "")
    if response.status_code != 200 or status != "answer":
        detail = answer or f"HTTP {response.status_code}"
        raise RuntimeError(
            f"Pre-fire /ask failed (status={status or response.status_code}): {detail[:300]}"
        )
    return {
        "ok": True,
        "question": question,
        "status": status,
        "answer_preview": answer[:300],
        "route": (payload.get("route") or {}).get("path"),
    }


async def bring_up_gpu(
    settings: GpuControlSettings,
    *,
    probe: ProbeFn = probe_ollama,
    warm: WarmFn = warm_with_agent_provider,
    ask: AskFn | None = None,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> None:
    ask_fn = ask or (lambda url: preflight_ask(url))
    reset_pipeline()
    pipeline["status"] = "waiting_ollama"
    try:
        ollama = await wait_for_ollama(
            settings.ollama_url,
            settings.model,
            probe=probe,
            sleep=sleep,
        )
        if not ollama.get("model_resident"):
            pipeline["status"] = "warming"
            await warm()
        pipeline["status"] = "preflight"
        pipeline["preflight"] = await ask_fn(settings.agent_url)
        pipeline["status"] = "succeeded"
        pipeline["reason"] = None
        print(
            "[gpu_control] bring-up succeeded: model resident and pre-fire /ask answered"
        )
    except asyncio.CancelledError:
        reset_pipeline()
        raise
    except Exception as exc:  # noqa: BLE001
        pipeline["status"] = "failed"
        pipeline["reason"] = str(exc)
        pipeline["preflight"] = {
            "ok": False,
            "question": PREFLIGHT_QUESTION,
            "error": str(exc)[:300],
        }
        print(f"[gpu_control] bring-up failed: {exc}")
