"""Constrained-decoding and domain-context matrix over the five diagnostic cases.

Four cells: constrained on/off x domain document on/off. Everything else is
held at the diagnostic baseline (qwen3:4b no-thinking alias, the same
two-candidate catalog per case, temperature 0, one attempt, no retries).

The unconstrained path emits native tool calls. The constrained path forces
output into a JSON call envelope with Ollama's `format` grammar, which is the
only mechanism here that prevents deliberation prose from being generated at
all rather than discarded afterward.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import time
from collections import Counter
from pathlib import Path
from typing import Any

import httpx
from pydantic import ValidationError

from services.agent.config import AgentSettings
from services.agent.domain import DOMAIN_REFERENCE
from services.agent.eval.diagnostic_full_schema import CASES
from services.agent.model_setup import ensure_runtime_model
from services.agent.schemas import TOOL_MODELS, openai_tools

HERE = Path(__file__).resolve().parent
RESULT_FILE = HERE / "diagnostic_matrix_results.json"

SCHEMA_PROFILE = "lean"
DOMAIN_TOKEN_CAP = 300

# name -> (constrained, domain document, tool schema profile)
CELLS: dict[str, tuple[bool, bool, str]] = {
    "plain": (False, False, "lean"),
    "domain": (False, True, "lean"),
    "constrained": (True, False, "lean"),
    "constrained_domain": (True, True, "lean"),
    "constrained_enums": (True, False, "lean_enums"),
    "constrained_domain_enums": (True, True, "lean_enums"),
}

# Byte-stable instruction halves of the static prefix. Only the question and
# the prefiltered candidate catalog vary per request.
ROUTING_PROMPT = """Route this wildfire-data question with the provided tools.
Call every tool needed and do not answer or explain. Construct complete arguments
using exact schema enum values. Emit tool calls only."""

CONSTRAINED_PROMPT = """Route this wildfire-data question with the provided tools.
Reply with JSON only, matching {"calls":[{"tool":name,"arguments":{...}}]}.
Include every call needed. Use exact schema enum values. Do not explain."""

# Grammar conversion rejects or mishandles annotation-only keywords, so the
# constrained envelope keeps types, enums, and required fields and drops the
# rest. The executor still validates against the full Pydantic model.
_GRAMMAR_UNSAFE_KEYS = {
    "format",
    "pattern",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "minItems",
    "maxItems",
    "minLength",
    "maxLength",
    "description",
}


def _grammar_safe(value: Any) -> Any:
    if isinstance(value, list):
        return [_grammar_safe(item) for item in value]
    if not isinstance(value, dict):
        return value
    return {
        key: _grammar_safe(item)
        for key, item in value.items()
        if key not in _GRAMMAR_UNSAFE_KEYS
    }


def call_envelope_schema(
    candidates: list[str], profile: str = SCHEMA_PROFILE
) -> dict[str, Any]:
    """JSON schema for one or more tool calls drawn from the candidate set."""
    variants = []
    for tool in openai_tools(candidates, profile=profile):
        function = tool["function"]
        variants.append(
            {
                "type": "object",
                "properties": {
                    "tool": {"const": function["name"]},
                    "arguments": _grammar_safe(function["parameters"]),
                },
                "required": ["tool", "arguments"],
            }
        )
    item = variants[0] if len(variants) == 1 else {"anyOf": variants}
    return {
        "type": "object",
        "properties": {"calls": {"type": "array", "items": item}},
        "required": ["calls"],
    }


def build_payload(
    case: dict[str, Any],
    *,
    settings: AgentSettings,
    constrained: bool,
    domain: bool,
    max_tokens: int,
    profile: str = SCHEMA_PROFILE,
) -> dict[str, Any]:
    instructions = CONSTRAINED_PROMPT if constrained else ROUTING_PROMPT
    system = f"{DOMAIN_REFERENCE}\n\n{instructions}" if domain else instructions
    payload: dict[str, Any] = {
        "model": settings.request_model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": case["question"]},
        ],
        "tools": openai_tools(case["candidates"], profile=profile),
        "think": False,
        "stream": False,
        "keep_alive": -1,
        "options": {
            "num_predict": max_tokens,
            "temperature": 0,
            "seed": settings.seed,
        },
    }
    if constrained:
        payload["format"] = call_envelope_schema(case["candidates"], profile)
        # Redundant under a grammar that cannot emit prose, but confirms the
        # option is accepted alongside `format` and bounds any trailing text.
        payload["options"]["stop"] = ["\n\n\n"]
    return payload


def extract_calls(raw: dict[str, Any], constrained: bool) -> list[dict[str, Any]]:
    message = raw.get("message") or {}
    if not constrained:
        calls = []
        for call in message.get("tool_calls") or []:
            function = call.get("function") or {}
            arguments = function.get("arguments") or {}
            if isinstance(arguments, str):
                try:
                    arguments = json.loads(arguments)
                except json.JSONDecodeError:
                    arguments = {"_invalid_json": arguments}
            calls.append(
                {"tool": str(function.get("name") or ""), "arguments": arguments}
            )
        return calls

    content = str(message.get("content") or "").strip()
    if not content:
        return []
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        return []
    entries = parsed.get("calls") if isinstance(parsed, dict) else None
    if not isinstance(entries, list):
        return []
    return [
        {
            "tool": str(entry.get("tool") or ""),
            "arguments": entry.get("arguments") or {},
        }
        for entry in entries
        if isinstance(entry, dict)
    ]


def score_case(
    case: dict[str, Any],
    raw: dict[str, Any],
    wall_ms: float,
    *,
    constrained: bool,
) -> dict[str, Any]:
    actual: list[dict[str, Any]] = []
    for call in extract_calls(raw, constrained):
        schema_valid = False
        schema_error = None
        try:
            TOOL_MODELS[call["tool"]].model_validate(call["arguments"])
            schema_valid = True
        except (KeyError, ValidationError, ValueError) as exc:
            schema_error = str(exc)
        actual.append({**call, "schema_valid": schema_valid, "schema_error": schema_error})

    expected_tools = [item["tool"] for item in case["expected"]]
    selection_correct = Counter(expected_tools) == Counter(
        item["tool"] for item in actual
    )
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
            {"tool": expected["tool"], "arguments_correct": match is not None}
        )
    arguments_correct = selection_correct and all(
        item["arguments_correct"] for item in expected_scores
    )

    message = raw.get("message") or {}
    content = str(message.get("content") or "")
    completion_tokens = int(raw.get("eval_count") or 0)
    eval_ms = float(raw.get("eval_duration") or 0) / 1_000_000
    call_chars = len(json.dumps(actual, ensure_ascii=False, default=str))
    if constrained:
        # Grammar-forced output is entirely call payload.
        deliberation_share = 0.0 if actual else 1.0
    elif not actual:
        deliberation_share = 1.0 if completion_tokens else 0.0
    else:
        deliberation_share = len(content) / max(len(content) + call_chars, 1)

    return {
        "id": case["id"],
        "expected_tools": expected_tools,
        "actual_calls": actual,
        "selection_correct": selection_correct,
        "arguments_correct": arguments_correct,
        "expected_call_scores": expected_scores,
        "done_reason": raw.get("done_reason"),
        "content": content[:4000],
        "timing": {
            "wall_ms": round(wall_ms, 2),
            "prompt_eval_ms": round(float(raw.get("prompt_eval_duration") or 0) / 1e6, 2),
            "generation_ms": round(eval_ms, 2),
            "prompt_tokens": int(raw.get("prompt_eval_count") or 0),
            "completion_tokens": completion_tokens,
            "deliberation_tokens_estimate": round(completion_tokens * deliberation_share),
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


def summarize(cases: list[dict[str, Any]]) -> dict[str, Any]:
    selected = sum(item["selection_correct"] for item in cases)
    correct_args = sum(item["arguments_correct"] for item in cases)
    prompt_tokens = sum(item["timing"]["prompt_tokens"] for item in cases)
    completion_tokens = sum(item["timing"]["completion_tokens"] for item in cases)
    generation_ms = sum(item["timing"]["generation_ms"] for item in cases)
    generations = sorted(item["timing"]["generation_ms"] for item in cases)
    return {
        "selection_correct": selected,
        "arguments_correct": correct_args,
        "case_count": len(cases),
        "prompt_tokens_total": prompt_tokens,
        "prompt_tokens_mean": round(prompt_tokens / max(len(cases), 1), 1),
        "completion_tokens_total": completion_tokens,
        "total_tokens_per_successful_call": (
            round((prompt_tokens + completion_tokens) / selected, 1)
            if selected
            else None
        ),
        "generation_ms_total": round(generation_ms, 2),
        "generation_ms_median": round(generations[len(generations) // 2], 2),
        "deliberation_tokens_total": sum(
            item["timing"]["deliberation_tokens_estimate"] for item in cases
        ),
    }


async def run_cell(
    client: httpx.AsyncClient,
    settings: AgentSettings,
    *,
    constrained: bool,
    domain: bool,
    max_tokens: int,
    profile: str = SCHEMA_PROFILE,
    start_index: int = 0,
    prior_cases: list[dict[str, Any]] | None = None,
    on_case: Any = None,
) -> dict[str, Any]:
    results: list[dict[str, Any]] = list(prior_cases or [])
    for index, case in enumerate(CASES, start=1):
        if index <= start_index:
            continue
        payload = build_payload(
            case,
            settings=settings,
            constrained=constrained,
            domain=domain,
            max_tokens=max_tokens,
            profile=profile,
        )
        started = time.perf_counter()
        response = await client.post("/api/chat", json=payload)
        wall_ms = (time.perf_counter() - started) * 1000
        response.raise_for_status()
        scored = score_case(case, response.json(), wall_ms, constrained=constrained)
        results.append(scored)
        print(
            f"  [{index}/{len(CASES)}] {case['id']}: "
            f"selection={scored['selection_correct']} "
            f"args={scored['arguments_correct']} "
            f"{scored['timing']['generation_ms'] / 1000:.1f}s "
            f"{scored['timing']['completion_tokens']}tok",
            flush=True,
        )
        if on_case:
            on_case(results)
    return {
        "constrained": constrained,
        "domain_document": domain,
        "schema_profile": profile,
        "cases": results,
        "summary": summarize(results),
    }


async def run_matrix(
    max_tokens: int,
    cells: list[str],
    *,
    merge_existing: bool = True,
) -> dict[str, Any]:
    settings = await ensure_runtime_model(AgentSettings.from_env())
    native_url = settings.model_base_url.removesuffix("/v1")
    output: dict[str, Any] = {
        "config": {
            "model": settings.model,
            "runtime_model": settings.request_model,
            "endpoint": "Ollama native /api/chat",
            "thinking": "off alias plus think=false",
            "max_completion_tokens": max_tokens,
            "attempts_per_case": 1,
            "case_count": len(CASES),
            "domain_document_token_cap": DOMAIN_TOKEN_CAP,
        },
        "cells": {},
    }
    if merge_existing and RESULT_FILE.exists():
        prior = json.loads(RESULT_FILE.read_text(encoding="utf-8"))
        output["cells"] = prior.get("cells") or {}
        if prior.get("config"):
            output["config"] = {**prior["config"], **output["config"]}

    def flush() -> None:
        RESULT_FILE.write_text(
            json.dumps(output, indent=2, ensure_ascii=False, default=str) + "\n",
            encoding="utf-8",
        )

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
        for name in cells:
            if name not in CELLS:
                raise ValueError(f"Unknown cell {name}; choose from {sorted(CELLS)}")
            constrained, domain, profile = CELLS[name]
            existing = output["cells"].get(name) or {}
            prior_cases = list(existing.get("cases") or [])
            if len(prior_cases) >= len(CASES) and existing.get("summary"):
                print(
                    f"[matrix] skip {name}: already complete "
                    f"({existing['summary'].get('selection_correct')}/"
                    f"{existing['summary'].get('case_count')})",
                    flush=True,
                )
                continue
            start_index = len(prior_cases)
            print(
                f"[matrix] cell {name} "
                f"(constrained={constrained}, domain={domain}, profile={profile}, "
                f"resume_from={start_index})",
                flush=True,
            )
            cell = await run_cell(
                client,
                settings,
                constrained=constrained,
                domain=domain,
                max_tokens=max_tokens,
                profile=profile,
                start_index=start_index,
                prior_cases=prior_cases,
                on_case=lambda partial, key=name, c=constrained, d=domain, p=profile: (
                    output["cells"].__setitem__(
                        key,
                        {
                            "constrained": c,
                            "domain_document": d,
                            "schema_profile": p,
                            "cases": partial,
                            "summary": summarize(partial),
                        },
                    ),
                    flush(),
                ),
            )
            output["cells"][name] = cell
            flush()
            print(f"[matrix] {name}: {json.dumps(cell['summary'])}", flush=True)

        await client.post(
            "/api/generate",
            json={"model": settings.request_model, "keep_alive": 0},
        )
    return output


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-tokens", type=int, default=1800)
    parser.add_argument(
        "--cells",
        default=",".join(CELLS),
        help=f"Comma-separated subset of {','.join(CELLS)}",
    )
    parser.add_argument(
        "--no-merge",
        action="store_true",
        help="Ignore existing results and overwrite selected cells",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    cells = [item.strip() for item in args.cells.split(",") if item.strip()]
    result = asyncio.run(
        run_matrix(args.max_tokens, cells, merge_existing=not args.no_merge)
    )
    for name, cell in result["cells"].items():
        summary = cell.get("summary") or {}
        print(
            f"[matrix] {name}: selection "
            f"{summary.get('selection_correct')}/{summary.get('case_count')}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
