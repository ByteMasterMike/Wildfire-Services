"""Re-measure the recommended default after each residual harness fix.

Stages:
1. aliases only — same catalog as the matrix default cell
2. aliases + year/utility slot fill
3. boundary — production candidate_tools() + strengthened comparison_run text,
   with full harness repairs

Stages 1–2 share one model run and differ only in post-call harness scoring, so
the delta is the fix rather than sampling noise. Stage 3 needs a new run because
the catalog and tool descriptions change.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from collections import Counter
from pathlib import Path
from typing import Any

import httpx
from pydantic import ValidationError

from services.agent.argument_normalize import prepare_tool_arguments
from services.agent.config import AgentSettings
from services.agent.eval.diagnostic_full_schema import CASES, ROUTING_PROMPT
from services.agent.eval.diagnostic_matrix import (
    CONSTRAINED_PROMPT,
    build_payload,
    call_envelope_schema,
    extract_calls,
)
from services.agent.model_setup import ensure_runtime_model
from services.agent.routing import _year, _utilities, candidate_tools
from services.agent.schemas import TOOL_MODELS, openai_tools
from services.agent.domain import DOMAIN_REFERENCE

HERE = Path(__file__).resolve().parent
RESULT_FILE = HERE / "diagnostic_residual_fixes_results.json"


def _arguments_match(arguments: dict[str, Any], expected: dict[str, Any]) -> bool:
    for key, value in expected["arguments"].items():
        if arguments.get(key) != value:
            return False
    year = expected.get("year")
    if year is None:
        return True
    if arguments.get("year") == year:
        return True
    return (
        str(arguments.get("start_date")) == f"{year}-01-01"
        and str(arguments.get("end_date")) == f"{year}-12-31"
    )


def score_with_harness(
    case: dict[str, Any],
    raw_calls: list[dict[str, Any]],
    *,
    fill_aliases: bool,
    fill_year: bool,
    fill_utility: bool,
) -> dict[str, Any]:
    year = _year(case["question"])
    utilities = _utilities(case["question"])
    actual: list[dict[str, Any]] = []
    for call in raw_calls:
        prepared = prepare_tool_arguments(
            call["tool"],
            call["arguments"],
            year=year,
            utilities=utilities,
            fill_aliases=fill_aliases,
            fill_year=fill_year,
            fill_utility=fill_utility,
        )
        schema_valid = False
        schema_error = None
        try:
            TOOL_MODELS[call["tool"]].model_validate(prepared)
            schema_valid = True
        except (KeyError, ValidationError, ValueError) as exc:
            schema_error = str(exc)
        actual.append(
            {
                "tool": call["tool"],
                "raw_arguments": call["arguments"],
                "arguments": prepared,
                "schema_valid": schema_valid,
                "schema_error": schema_error,
            }
        )

    expected_tools = [item["tool"] for item in case["expected"]]
    selection_correct = Counter(expected_tools) == Counter(
        item["tool"] for item in actual
    )
    unmatched = set(range(len(actual)))
    expected_scores = []
    for expected in case["expected"]:
        match = next(
            (
                index
                for index in unmatched
                if actual[index]["tool"] == expected["tool"]
                and actual[index]["schema_valid"]
                and _arguments_match(actual[index]["arguments"], expected)
            ),
            None,
        )
        if match is not None:
            unmatched.remove(match)
        expected_scores.append(
            {"tool": expected["tool"], "arguments_correct": match is not None}
        )
    arguments_correct = selection_correct and all(
        item["arguments_correct"] for item in expected_scores
    )
    return {
        "id": case["id"],
        "selection_correct": selection_correct,
        "arguments_correct": arguments_correct,
        "end_to_end_correct": arguments_correct,
        "actual_calls": actual,
        "expected_call_scores": expected_scores,
    }


def summarize(cases: list[dict[str, Any]]) -> dict[str, Any]:
    n = len(cases)
    return {
        "selection": sum(item["selection_correct"] for item in cases),
        "arguments": sum(item["arguments_correct"] for item in cases),
        "end_to_end": sum(item["end_to_end_correct"] for item in cases),
        "case_count": n,
        "selection_rate": f"{sum(item['selection_correct'] for item in cases)}/{n}",
        "arguments_rate": f"{sum(item['arguments_correct'] for item in cases)}/{n}",
        "end_to_end_rate": f"{sum(item['end_to_end_correct'] for item in cases)}/{n}",
    }


async def run_model_cell(
    client: httpx.AsyncClient,
    settings: AgentSettings,
    *,
    use_production_candidates: bool,
) -> list[dict[str, Any]]:
    results = []
    for index, case in enumerate(CASES, start=1):
        candidates = (
            candidate_tools(case["question"])
            if use_production_candidates
            else list(case["candidates"])
        )
        # Ensure expected tools remain available when using production filter.
        for tool in [item["tool"] for item in case["expected"]]:
            if tool not in candidates:
                candidates.append(tool)
        payload = {
            "model": settings.request_model,
            "messages": [
                {
                    "role": "system",
                    "content": f"{DOMAIN_REFERENCE}\n\n{CONSTRAINED_PROMPT}",
                },
                {"role": "user", "content": case["question"]},
            ],
            "tools": openai_tools(candidates, profile="lean_enums"),
            "format": call_envelope_schema(candidates, "lean_enums"),
            "think": False,
            "stream": False,
            "keep_alive": -1,
            "options": {
                "num_predict": 1800,
                "temperature": 0,
                "seed": settings.seed,
                "stop": ["\n\n\n"],
            },
        }
        started = time.perf_counter()
        response = await client.post("/api/chat", json=payload)
        wall_ms = (time.perf_counter() - started) * 1000
        response.raise_for_status()
        raw = response.json()
        calls = extract_calls(raw, constrained=True)
        print(
            f"  [{index}/{len(CASES)}] {case['id']} candidates={candidates} "
            f"tools={[c['tool'] for c in calls]} "
            f"{wall_ms/1000:.1f}s",
            flush=True,
        )
        results.append(
            {
                "id": case["id"],
                "question": case["question"],
                "candidates": candidates,
                "raw_calls": calls,
                "timing": {
                    "wall_ms": round(wall_ms, 2),
                    "prompt_tokens": int(raw.get("prompt_eval_count") or 0),
                    "completion_tokens": int(raw.get("eval_count") or 0),
                    "generation_ms": round(
                        float(raw.get("eval_duration") or 0) / 1e6, 2
                    ),
                },
                "content": str((raw.get("message") or {}).get("content") or "")[:2000],
                "done_reason": raw.get("done_reason"),
            }
        )
    return results


async def main() -> int:
    settings = await ensure_runtime_model(AgentSettings.from_env())
    native_url = settings.model_base_url.removesuffix("/v1")
    output: dict[str, Any] = {
        "config": {
            "model": settings.model,
            "runtime_model": settings.request_model,
            "recommended_default": "constrained + domain + lean_enums",
        },
        "stages": {},
    }

    async with httpx.AsyncClient(base_url=native_url, timeout=2400.0) as client:
        await client.post(
            "/api/chat",
            json={
                "model": settings.request_model,
                "messages": [{"role": "user", "content": "Reply OK."}],
                "stream": False,
                "keep_alive": -1,
                "options": {"num_predict": 1, "temperature": 0},
            },
        )

        print("[residual] model run A: matrix candidates", flush=True)
        run_a = await run_model_cell(
            client, settings, use_production_candidates=False
        )
        case_by_id = {case["id"]: case for case in CASES}

        stages = [
            (
                "baseline_no_harness",
                dict(fill_aliases=False, fill_year=False, fill_utility=False),
                run_a,
            ),
            (
                "alias_normalization",
                dict(fill_aliases=True, fill_year=False, fill_utility=False),
                run_a,
            ),
            (
                "alias_plus_slot_fill",
                dict(fill_aliases=True, fill_year=True, fill_utility=True),
                run_a,
            ),
        ]
        for name, flags, run in stages:
            scored = [
                score_with_harness(case_by_id[item["id"]], item["raw_calls"], **flags)
                for item in run
            ]
            summary = summarize(scored)
            output["stages"][name] = {
                "harness": flags,
                "use_production_candidates": False,
                "summary": summary,
                "cases": scored,
            }
            print(f"[residual] {name}: {summary}", flush=True)
            RESULT_FILE.write_text(
                json.dumps(output, indent=2, ensure_ascii=False, default=str) + "\n",
                encoding="utf-8",
            )

        print("[residual] model run B: production candidates + boundary text", flush=True)
        run_b = await run_model_cell(
            client, settings, use_production_candidates=True
        )
        scored_b = [
            score_with_harness(
                case_by_id[item["id"]],
                item["raw_calls"],
                fill_aliases=True,
                fill_year=True,
                fill_utility=True,
            )
            for item in run_b
        ]
        summary_b = summarize(scored_b)
        output["stages"]["boundary_plus_full_harness"] = {
            "harness": {
                "fill_aliases": True,
                "fill_year": True,
                "fill_utility": True,
            },
            "use_production_candidates": True,
            "comparison_description": "strengthened do-not-use for cross-dataset",
            "summary": summary_b,
            "cases": scored_b,
            "raw_run": run_b,
        }
        output["stages"]["alias_plus_slot_fill"]["raw_run"] = run_a
        print(f"[residual] boundary_plus_full_harness: {summary_b}", flush=True)

        await client.post(
            "/api/generate",
            json={"model": settings.request_model, "keep_alive": 0},
        )

    RESULT_FILE.write_text(
        json.dumps(output, indent=2, ensure_ascii=False, default=str) + "\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
