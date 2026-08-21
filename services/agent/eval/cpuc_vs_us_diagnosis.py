"""Characterize cpuc_vs_us multi-tool failure and test a compare-prompt patch."""

from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from typing import Any

from services.agent.artifacts import ArtifactStore
from services.agent.config import AgentSettings
from services.agent.model_setup import ensure_runtime_model
from services.agent.orchestrator import AgentOrchestrator
from services.agent.provider import OpenAICompatibleProvider
from services.agent.tools import ToolExecutor

HERE = Path(__file__).resolve().parent
OUT = HERE / "cpuc_vs_us_diagnosis.json"
QUESTION = (
    "Compare CPUC and US ignition counts in 2024 and explain the difference."
)
COMPARE_HINT = (
    "This is a cross-dataset comparison. Emit TWO data_query_records calls in "
    "the same turn: one with dataset=cpuc_ignitions and one with "
    "dataset=us_ignitions, both for the harness-resolved 2024 window. Do not "
    "synthesize after a single dataset."
)


def _summarize(response: dict[str, Any]) -> dict[str, Any]:
    traj = response.get("trajectory") or []
    primary = [
        event
        for event in traj
        if event.get("type") == "tool_call" and not event.get("qualification_call")
    ]
    routing_turns = [
        event
        for event in traj
        if event.get("type") == "model_turn" and event.get("phase") == "routing"
    ]
    datasets = [
        (event.get("arguments") or {}).get("dataset")
        for event in primary
        if event.get("ok")
    ]
    return {
        "answer_origin": (response.get("route") or {}).get("answer_origin"),
        "status": response.get("status"),
        "routing_turns": len(routing_turns),
        "tool_calls_in_first_routing_turn": next(
            (
                event.get("tool_call_count")
                for event in routing_turns
                if event.get("step") == 1
            ),
            None,
        ),
        "primary_tools": [event.get("tool") for event in primary],
        "primary_ok_datasets": datasets,
        "emitted_two_datasets": set(datasets) >= {"cpuc_ignitions", "us_ignitions"},
        "went_to_synthesis_after_single_success": any(
            event.get("type") == "synthesis_start" for event in traj
        )
        and len([event for event in primary if event.get("ok")]) == 1,
        "answer_text": response.get("answer_text"),
        "trajectory_types": [event.get("type") for event in traj],
    }


async def _run_once(
    settings: AgentSettings,
    provider: OpenAICompatibleProvider,
    *,
    compare_hint: bool,
) -> dict[str, Any]:
    artifacts = ArtifactStore(settings.artifact_ttl_seconds)
    executor = ToolExecutor(settings, artifacts)
    orch = AgentOrchestrator(settings, provider, executor)
    if compare_hint:
        # Patch the first routing user message construction by wrapping ask
        # with a temporary question suffix — keeps production code unchanged.
        question = f"{QUESTION}\n{COMPARE_HINT}"
    else:
        question = QUESTION
    t0 = time.perf_counter()
    result = await orch.ask(question, force_model=True)
    elapsed = time.perf_counter() - t0
    await executor.close()
    row = _summarize(result.response)
    row["elapsed_s"] = round(elapsed, 1)
    row["compare_hint"] = compare_hint
    return row


async def main() -> int:
    settings = await ensure_runtime_model(AgentSettings.from_env())
    provider = OpenAICompatibleProvider(settings)
    await provider.ensure_context_loaded()
    report: dict[str, Any] = {
        "question": QUESTION,
        "baseline_trials": [],
        "prompt_hint_trials": [],
    }
    print("[diag] baseline x5")
    for i in range(1, 6):
        row = await _run_once(settings, provider, compare_hint=False)
        report["baseline_trials"].append(row)
        print(
            f"  baseline {i}: calls={row['tool_calls_in_first_routing_turn']} "
            f"datasets={row['primary_ok_datasets']} "
            f"two={row['emitted_two_datasets']} "
            f"single_then_synth={row['went_to_synthesis_after_single_success']} "
            f"{row['elapsed_s']}s"
        )
    print("[diag] compare-hint prompt x5")
    for i in range(1, 6):
        row = await _run_once(settings, provider, compare_hint=True)
        report["prompt_hint_trials"].append(row)
        print(
            f"  hint {i}: calls={row['tool_calls_in_first_routing_turn']} "
            f"datasets={row['primary_ok_datasets']} "
            f"two={row['emitted_two_datasets']} "
            f"single_then_synth={row['went_to_synthesis_after_single_success']} "
            f"{row['elapsed_s']}s"
        )

    def rate(rows: list[dict[str, Any]], key: str) -> float:
        return sum(1 for row in rows if row.get(key)) / len(rows) if rows else 0.0

    report["summary"] = {
        "baseline_two_dataset_rate": rate(
            report["baseline_trials"], "emitted_two_datasets"
        ),
        "baseline_single_then_synth_rate": rate(
            report["baseline_trials"], "went_to_synthesis_after_single_success"
        ),
        "hint_two_dataset_rate": rate(
            report["prompt_hint_trials"], "emitted_two_datasets"
        ),
        "hint_single_then_synth_rate": rate(
            report["prompt_hint_trials"], "went_to_synthesis_after_single_success"
        ),
    }
    OUT.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report["summary"], indent=2))
    print(f"[diag] wrote {OUT}")
    await provider.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
