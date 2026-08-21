"""Repeat selected model-tier cases and report failure rates for PI notes."""

from __future__ import annotations

import argparse
import asyncio
import json
import time
from pathlib import Path
from typing import Any

from services.agent.artifacts import ArtifactStore
from services.agent.config import AgentSettings
from services.agent.eval.runner import EvalCell, preflight, score_case, warmup
from services.agent.model_setup import ensure_runtime_model
from services.agent.orchestrator import AgentOrchestrator
from services.agent.provider import OpenAICompatibleProvider
from services.agent.tools import ToolExecutor

HERE = Path(__file__).resolve().parent
CASES_FILE = HERE / "cases.json"
OUT_FILE = HERE / "flake_probe_results.json"


def _case_passed(score: dict[str, Any]) -> bool:
    return bool(
        score.get("routing_pass")
        and score.get("status_pass")
        and score.get("caveat_pass")
        and score.get("recovery_pass")
    )


def _failure_reasons(score: dict[str, Any]) -> list[str]:
    reasons: list[str] = []
    if not score.get("route_pass"):
        reasons.append("route")
    if score.get("actual_tools") != score.get("expected_tools"):
        reasons.append(
            f"tools expected={score.get('expected_tools')} "
            f"actual={score.get('actual_tools')}"
        )
    if not score.get("status_pass"):
        reasons.append("status")
    if not score.get("caveat_pass"):
        reasons.append(f"caveats missing={score.get('missing_caveats')}")
    if score.get("no_tool_response_attempts_before_evidence"):
        reasons.append(
            f"no_tool_attempts={score.get('no_tool_response_attempts_before_evidence')}"
        )
    if score.get("direct_answer_without_tool_attempts"):
        reasons.append(
            f"direct_without_tool={score.get('direct_answer_without_tool_attempts')}"
        )
    return reasons


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--case-ids", default="cpuc_vs_us,count_plus_trend")
    parser.add_argument("--trials", type=int, default=10)
    parser.add_argument("--modes", default="constrained")
    args = parser.parse_args()

    cases_by_id = {
        item["id"]: item for item in json.loads(CASES_FILE.read_text(encoding="utf-8"))
    }
    case_ids = [item.strip() for item in args.case_ids.split(",") if item.strip()]
    missing = [cid for cid in case_ids if cid not in cases_by_id]
    if missing:
        raise SystemExit(f"Unknown case ids: {missing}")

    base = AgentSettings.from_env()
    cell = EvalCell(model=base.model, thinking="off", mode=args.modes)
    settings = base.with_eval_cell(
        model=cell.model, thinking=cell.thinking, structured_mode=cell.mode
    )
    settings = await ensure_runtime_model(settings)
    await preflight(settings)
    provider = OpenAICompatibleProvider(settings)
    await provider.ensure_context_loaded()
    await warmup(provider)

    results: dict[str, Any] = {
        "cell": cell.key,
        "trials": args.trials,
        "cases": {},
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }

    for case_id in case_ids:
        case = cases_by_id[case_id]
        trials: list[dict[str, Any]] = []
        print(f"[flake] {case_id}: {args.trials} trials")
        for trial in range(1, args.trials + 1):
            artifacts = ArtifactStore(settings.artifact_ttl_seconds)
            executor = ToolExecutor(settings, artifacts)
            orchestrator = AgentOrchestrator(settings, provider, executor)
            started = time.perf_counter()
            try:
                result = await orchestrator.ask(
                    case["question"],
                    force_model=bool(case.get("force_model")),
                )
                response = result.response
                score = score_case(case, response)
                ok = _case_passed(score)
                failures = _failure_reasons(score)
            except Exception as exc:  # noqa: BLE001
                response = {"status": "runner_error", "answer_text": str(exc)}
                score = {}
                ok = False
                failures = [f"runner_error:{exc!r}"]
            finally:
                await executor.close()
            elapsed = time.perf_counter() - started
            row = {
                "trial": trial,
                "ok": ok,
                "elapsed_s": round(elapsed, 1),
                "status": response.get("status"),
                "answer_origin": (response.get("route") or {}).get("answer_origin"),
                "failures": failures,
                "actual_tools": score.get("actual_tools"),
                "no_tool_attempts": score.get(
                    "no_tool_response_attempts_before_evidence"
                ),
            }
            trials.append(row)
            print(
                f"  trial {trial}/{args.trials}: "
                f"{'PASS' if row['ok'] else 'FAIL'} "
                f"{row['elapsed_s']}s "
                f"failures={row['failures']}"
            )
        fails = [t for t in trials if not t["ok"]]
        results["cases"][case_id] = {
            "n": len(trials),
            "failures": len(fails),
            "failure_rate": round(len(fails) / len(trials), 3) if trials else None,
            "trials": trials,
        }

    results["finished_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    OUT_FILE.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(f"[flake] wrote {OUT_FILE}")
    for case_id, summary in results["cases"].items():
        print(
            f"[flake] {case_id}: {summary['failures']}/{summary['n']} "
            f"({summary['failure_rate']:.0%})"
        )
    await provider.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
