"""Probe synthesis quality on the three known hard questions; print answer text."""

from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path

from services.agent.artifacts import ArtifactStore
from services.agent.config import AgentSettings
from services.agent.model_setup import ensure_runtime_model
from services.agent.orchestrator import AgentOrchestrator
from services.agent.provider import OpenAICompatibleProvider
from services.agent.tools import ToolExecutor

HERE = Path(__file__).resolve().parent
OUT = HERE / "synthesis_probe_results.json"

QUESTIONS = [
    {
        "id": "sacramento_tell_me_about",
        "question": "Tell me about wildfire incidents in Sacramento County during 2024",
        "force_model": False,
    },
    {
        "id": "model_cpuc_tell_me_about_2023",
        "question": "Tell me about CPUC ignitions in 2023",
        "force_model": True,
    },
    {
        "id": "cpuc_vs_us",
        "question": (
            "Compare CPUC and US ignition counts in 2024 and explain the difference."
        ),
        "force_model": True,
    },
]


async def main() -> int:
    settings = await ensure_runtime_model(AgentSettings.from_env())
    print(
        f"[probe] structured_mode={settings.structured_mode} "
        f"synthesis_thinking={settings.synthesis_thinking} "
        f"runtime={settings.request_model} base={settings.model}"
    )
    provider = OpenAICompatibleProvider(settings)
    await provider.ensure_context_loaded()
    rows = []
    for item in QUESTIONS:
        artifacts = ArtifactStore(settings.artifact_ttl_seconds)
        executor = ToolExecutor(settings, artifacts)
        orch = AgentOrchestrator(settings, provider, executor)
        t0 = time.perf_counter()
        result = await orch.ask(
            item["question"], force_model=bool(item["force_model"])
        )
        elapsed = time.perf_counter() - t0
        response = result.response
        traj = response.get("trajectory") or []
        synth_turns = [
            event
            for event in traj
            if event.get("type") == "model_turn" and event.get("phase") == "synthesis"
        ]
        row = {
            "id": item["id"],
            "question": item["question"],
            "elapsed_s": round(elapsed, 1),
            "status": response.get("status"),
            "answer_origin": (response.get("route") or {}).get("answer_origin"),
            "answer_text": response.get("answer_text"),
            "qualifications": [
                q.get("id") for q in (response.get("qualifications") or [])
            ],
            "qualification_texts": [
                q.get("text") for q in (response.get("qualifications") or [])
            ],
            "trajectory_types": [event.get("type") for event in traj],
            "synthesis_start": next(
                (event for event in traj if event.get("type") == "synthesis_start"),
                None,
            ),
            "synthesis_latencies_ms": [
                event.get("latency_ms") for event in synth_turns
            ],
            "grounding_errors": [
                event
                for event in traj
                if event.get("type") == "grounding_error"
            ],
            "tools": [
                {
                    "tool": event.get("tool"),
                    "ok": event.get("ok"),
                    "args": event.get("arguments"),
                    "qualification_call": event.get("qualification_call"),
                }
                for event in traj
                if event.get("type") == "tool_call"
            ],
        }
        rows.append(row)
        print("=" * 72)
        print(f"ID: {row['id']}")
        print(f"elapsed_s={row['elapsed_s']} status={row['status']} "
              f"origin={row['answer_origin']}")
        print(f"synthesis_latencies_ms={row['synthesis_latencies_ms']}")
        print(f"grounding_errors={len(row['grounding_errors'])}")
        print(f"ANSWER:\n{row['answer_text']}")
        print(f"QUALS: {row['qualifications']}")
        await executor.close()

    OUT.write_text(json.dumps(rows, indent=2), encoding="utf-8")
    print(f"[probe] wrote {OUT}")
    await provider.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
