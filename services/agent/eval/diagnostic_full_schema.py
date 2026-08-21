"""Five-turn Qwen diagnostic with real argument schemas and native timings."""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import time
from collections import Counter
from pathlib import Path
from typing import Any

import httpx
from pydantic import ValidationError

from services.agent.config import AgentSettings
from services.agent.model_setup import ensure_runtime_model
from services.agent.schemas import TOOL_MODELS, openai_tools

HERE = Path(__file__).resolve().parent
RESULT_FILE = HERE / "diagnostic_full_schema_results.json"

ROUTING_PROMPT = """Route this wildfire-data question with the provided tools.
Call every tool needed and do not answer or explain. Construct complete arguments
using exact schema enum values. Emit tool calls only."""

CASES: list[dict[str, Any]] = [
    {
        "id": "spatial_utility_count",
        "question": "How many ignitions were spatially inside PG&E territory in 2024?",
        "candidates": ["data_query_spatial", "data_query_records"],
        "expected": [
            {
                "tool": "data_query_spatial",
                "arguments": {"kind": "summary", "utility": "PGE"},
                "year": 2024,
            }
        ],
    },
    {
        "id": "filtered_us_count",
        "question": "How many US ignition sample events occurred in 2024?",
        "candidates": ["data_query_records", "data_query_spatial"],
        "expected": [
            {
                "tool": "data_query_records",
                "arguments": {
                    "dataset": "us_ignitions",
                    "result_mode": "count",
                },
                "year": 2024,
            }
        ],
    },
    {
        "id": "calfire_monthly_trend",
        "question": "Show the monthly CAL FIRE incident trend for 2024.",
        "candidates": ["visualization_create", "data_query_records"],
        "expected": [
            {
                "tool": "visualization_create",
                "arguments": {
                    "kind": "time_series",
                    "dataset": "calfire",
                    "interval": "monthly",
                },
                "year": 2024,
            }
        ],
    },
    {
        "id": "cross_dataset_counts",
        "question": "Compare CPUC and US ignition counts in 2024.",
        "candidates": ["data_query_records", "comparison_run"],
        "expected": [
            {
                "tool": "data_query_records",
                "arguments": {
                    "dataset": "cpuc_ignitions",
                    "result_mode": "count",
                },
                "year": 2024,
            },
            {
                "tool": "data_query_records",
                "arguments": {
                    "dataset": "us_ignitions",
                    "result_mode": "count",
                },
                "year": 2024,
            },
        ],
    },
    {
        "id": "count_plus_trend",
        "question": "Give me the PGE ignition count and its monthly trend for 2024.",
        "candidates": ["data_query_records", "visualization_create"],
        "expected": [
            {
                "tool": "data_query_records",
                "arguments": {
                    "dataset": "cpuc_ignitions",
                    "result_mode": "count",
                    "utility": "PGE",
                },
                "year": 2024,
            },
            {
                "tool": "visualization_create",
                "arguments": {
                    "kind": "time_series",
                    "dataset": "ignitions",
                    "utility": "PGE",
                    "interval": "monthly",
                },
                "year": 2024,
            },
        ],
    },
]


async def run_diagnostic(max_tokens: int) -> dict[str, Any]:
    settings = await ensure_runtime_model(AgentSettings.from_env())
    native_url = settings.model_base_url.removesuffix("/v1")
    results: list[dict[str, Any]] = []

    async with httpx.AsyncClient(base_url=native_url, timeout=1200.0) as client:
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
        for index, case in enumerate(CASES, start=1):
            print(f"[diagnostic] {index}/{len(CASES)} {case['id']}", flush=True)
            payload = {
                "model": settings.request_model,
                "messages": [
                    {"role": "system", "content": ROUTING_PROMPT},
                    {"role": "user", "content": case["question"]},
                ],
                "tools": openai_tools(case["candidates"], profile="full"),
                "think": False,
                "stream": False,
                "keep_alive": -1,
                "options": {
                    "num_predict": max_tokens,
                    "temperature": 0,
                    "seed": settings.seed,
                },
            }
            started = time.perf_counter()
            response = await client.post("/api/chat", json=payload)
            wall_ms = (time.perf_counter() - started) * 1000
            response.raise_for_status()
            raw = response.json()
            result = _score_case(case, raw, wall_ms)
            results.append(result)
            RESULT_FILE.write_text(
                json.dumps(
                    {
                        "config": _config(settings, max_tokens),
                        "cases": results,
                    },
                    indent=2,
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )
            print(
                f"[diagnostic] selection={result['selection_correct']} "
                f"arguments={result['arguments_correct']} "
                f"latency={wall_ms / 1000:.1f}s "
                f"tokens={result['timing']['completion_tokens']}",
                flush=True,
            )

        await client.post(
            "/api/generate",
            json={"model": settings.request_model, "keep_alive": 0},
        )

    return {"config": _config(settings, max_tokens), "cases": results}


def _score_case(
    case: dict[str, Any],
    raw: dict[str, Any],
    wall_ms: float,
) -> dict[str, Any]:
    message = raw.get("message") or {}
    tool_calls = message.get("tool_calls") or []
    actual: list[dict[str, Any]] = []
    for call in tool_calls:
        function = call.get("function") or {}
        name = str(function.get("name") or "")
        arguments = function.get("arguments") or {}
        if isinstance(arguments, str):
            try:
                arguments = json.loads(arguments)
            except json.JSONDecodeError:
                arguments = {"_invalid_json": arguments}
        schema_valid = False
        schema_error = None
        try:
            TOOL_MODELS[name].model_validate(arguments)
            schema_valid = True
        except (KeyError, ValidationError, ValueError) as exc:
            schema_error = str(exc)
        actual.append(
            {
                "tool": name,
                "arguments": arguments,
                "schema_valid": schema_valid,
                "schema_error": schema_error,
            }
        )

    expected_tools = [item["tool"] for item in case["expected"]]
    actual_tools = [item["tool"] for item in actual]
    selection_correct = Counter(expected_tools) == Counter(actual_tools)
    unmatched = set(range(len(actual)))
    expected_scores: list[dict[str, Any]] = []
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
            {
                "tool": expected["tool"],
                "arguments_correct": match is not None,
                "matched_actual_index": match,
            }
        )
    arguments_correct = selection_correct and all(
        item["arguments_correct"] for item in expected_scores
    )

    completion_tokens = int(raw.get("eval_count") or 0)
    eval_ms = float(raw.get("eval_duration") or 0) / 1_000_000
    prompt_ms = float(raw.get("prompt_eval_duration") or 0) / 1_000_000
    load_ms = float(raw.get("load_duration") or 0) / 1_000_000
    content = str(message.get("content") or "")
    call_chars = len(json.dumps(tool_calls, ensure_ascii=False))
    content_chars = len(content)
    if not tool_calls:
        deliberation_share = 1.0 if completion_tokens else 0.0
    else:
        deliberation_share = content_chars / max(content_chars + call_chars, 1)
    deliberation_tokens_estimate = round(completion_tokens * deliberation_share)

    return {
        "id": case["id"],
        "question": case["question"],
        "candidates": case["candidates"],
        "expected_tools": expected_tools,
        "actual_calls": actual,
        "selection_correct": selection_correct,
        "arguments_correct": arguments_correct,
        "expected_call_scores": expected_scores,
        "done_reason": raw.get("done_reason"),
        "content": content,
        "timing": {
            "wall_ms": round(wall_ms, 2),
            "load_ms": round(load_ms, 2),
            "prompt_eval_ms": round(prompt_ms, 2),
            "generation_ms": round(eval_ms, 2),
            "prompt_tokens": int(raw.get("prompt_eval_count") or 0),
            "completion_tokens": completion_tokens,
            "tokens_per_second": (
                round(completion_tokens / (eval_ms / 1000), 2)
                if eval_ms and completion_tokens
                else None
            ),
            "deliberation_tokens_estimate": deliberation_tokens_estimate,
            "deliberation_generation_ms_estimate": round(
                eval_ms * deliberation_share, 2
            ),
            "deliberation_estimate_method": (
                "exact: no tool call, so all completion tokens preceded a call"
                if not tool_calls
                else "estimated by deliberation-content/tool-call character share"
            ),
        },
    }


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


def _config(settings: AgentSettings, max_tokens: int) -> dict[str, Any]:
    return {
        "model": settings.model,
        "runtime_model": settings.request_model,
        "endpoint": "Ollama native /api/chat (same template/tools, timing fields exposed)",
        "thinking": "off alias plus think=false",
        "max_completion_tokens": max_tokens,
        "tool_schema_profile": "full",
        "attempts_per_case": 1,
        "case_count": len(CASES),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-tokens", type=int, default=1800)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    result = asyncio.run(run_diagnostic(args.max_tokens))
    passed = sum(item["selection_correct"] for item in result["cases"])
    print(f"[diagnostic] complete: {passed}/{len(result['cases'])} selected correctly")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
