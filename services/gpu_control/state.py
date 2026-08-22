"""Coarse GPU lifecycle states. EC2 `running` is not the same as ready."""

from __future__ import annotations

from typing import Any

EBS_NOTE = (
    "Stopping the instance does not stop disk cost. "
    "The volume still bills about $20/month."
)


def classify_state(
    ec2_state: str,
    *,
    ollama_reachable: bool,
    model_resident: bool,
) -> tuple[str, str | None]:
    raw = (ec2_state or "").strip().lower()
    if raw in {"terminated", "terminating"}:
        return "error", f"Instance is {raw}"
    if raw in {"stopping", "shutting-down"}:
        return "stopping", None
    if raw == "stopped":
        return "stopped", None
    if raw == "pending":
        return "starting", None
    if raw == "running":
        if not ollama_reachable:
            return "starting", None
        if not model_resident:
            return "loading_model", None
        return "ready", None
    if not raw:
        return "error", "Could not read the instance state"
    return "error", f"Unexpected EC2 state: {raw}"


def eta_fields(
    state: str,
    start_requested_at: float | None,
    *,
    now: float,
    budget_seconds: int,
) -> dict[str, Any]:
    """ETA only while this process saw POST /gpu/start and boot is in progress."""
    if state not in {"starting", "loading_model"} or start_requested_at is None:
        return {}
    remaining = max(0, int(budget_seconds - (now - start_requested_at)))
    if remaining == 0:
        copy = "Almost ready (estimate)"
    else:
        minutes = max(1, round(remaining / 60))
        unit = "minute" if minutes == 1 else "minutes"
        copy = f"about {minutes} {unit} (estimate)"
    return {"eta_seconds": remaining, "eta_copy": copy}
