"""Probe Ollama from the backend box (same security-group path as the agent)."""

from __future__ import annotations

from typing import Any

import httpx


def model_is_resident(models: list[dict[str, Any]], model: str) -> bool:
    target = (model or "").strip()
    if not target:
        return False
    for item in models:
        name = str(item.get("name") or item.get("model") or "")
        if name != target and not name.startswith(target):
            continue
        vram = item.get("size_vram")
        if vram is None:
            return True
        try:
            return int(vram) > 0
        except (TypeError, ValueError):
            return True
    return False


async def probe_ollama(
    base_url: str,
    model: str,
    *,
    timeout_seconds: float = 3.0,
) -> dict[str, Any]:
    url = base_url.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            response = await client.get(f"{url}/api/ps")
            response.raise_for_status()
            models = response.json().get("models") or []
        return {
            "reachable": True,
            "model_resident": model_is_resident(models, model),
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "reachable": False,
            "model_resident": False,
            "detail": str(exc),
        }
