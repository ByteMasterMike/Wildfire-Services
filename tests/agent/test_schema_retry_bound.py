"""Identical schema failures should block a tool after two attempts."""

from __future__ import annotations

import asyncio

from services.agent.config import AgentSettings
from services.agent.orchestrator import AgentOrchestrator
from services.agent.provider import OpenAICompatibleProvider
from services.agent.tools import ToolExecutor
from services.agent.artifacts import ArtifactStore


class _AlwaysBadSchemaProvider(OpenAICompatibleProvider):
    """Emit the same invalid tool call every routing turn."""

    def __init__(self) -> None:
        self.settings = AgentSettings.from_env()
        self.calls = 0

    async def complete(self, **kwargs):  # type: ignore[no-untyped-def]
        from types import SimpleNamespace

        self.calls += 1
        return SimpleNamespace(
            content="",
            tool_calls=[
                {
                    "id": f"call_{self.calls}",
                    "type": "function",
                    "function": {
                        "name": "data_query_records",
                        "arguments": "{}",
                    },
                }
            ],
            latency_ms=1.0,
            usage={},
            raw={"choices": [{"finish_reason": "tool_calls"}]},
        )


def test_schema_retry_bound_stops_identical_failures():
    settings = AgentSettings.from_env()
    # Keep loop long enough that an unbounded harness would thrash.
    from dataclasses import replace

    settings = replace(settings, max_tool_steps=5)
    provider = _AlwaysBadSchemaProvider()
    executor = ToolExecutor(settings, ArtifactStore(60), fault_scenario=None)
    orchestrator = AgentOrchestrator(settings, provider, executor)

    async def _run():
        return await orchestrator._model_loop(
            "How many US ignition sample events occurred in 2024?",
            "test-request",
            ["data_query_records"],
            year=2024,
            years=[2024],
            utilities=[],
            time_resolution={
                "status": "explicit",
                "year": 2024,
                "years": [2024],
                "start_date": "2024-01-01",
                "end_date": "2024-12-31",
            },
        )

    status, answer, executions, trajectory, *_ = asyncio.run(_run())
    assert status == "error"
    bound_events = [
        event for event in trajectory if event.get("type") == "schema_retry_bound"
    ]
    assert bound_events, "expected schema_retry_bound after identical failures"
    # Two real schema failures, then blocked short-circuits — not six identical tries.
    schema_failures = [
        item
        for item in executions
        if not item.ok and (item.error or {}).get("code") == "invalid_arguments"
    ]
    assert len(schema_failures) == 2
    assert "could not" in answer.lower()
    assert "schema validation" not in answer.lower()


class _AlwaysInventedYearProvider(OpenAICompatibleProvider):
    """Emit the same invented year when the harness resolved none."""

    def __init__(self) -> None:
        self.settings = AgentSettings.from_env()
        self.calls = 0

    async def complete(self, **kwargs):  # type: ignore[no-untyped-def]
        from types import SimpleNamespace

        self.calls += 1
        return SimpleNamespace(
            content="",
            tool_calls=[
                {
                    "id": f"call_{self.calls}",
                    "type": "function",
                    "function": {
                        "name": "data_query_records",
                        "arguments": (
                            '{"dataset":"cpuc_ignitions","result_mode":"count",'
                            '"year":2024}'
                        ),
                    },
                }
            ],
            latency_ms=1.0,
            usage={},
            raw={"choices": [{"finish_reason": "tool_calls"}]},
        )


def test_identical_non_schema_failures_are_bounded():
    """Invented-year failures must not loop until max_tool_steps."""
    from dataclasses import replace

    settings = replace(AgentSettings.from_env(), max_tool_steps=5)
    provider = _AlwaysInventedYearProvider()
    executor = ToolExecutor(settings, ArtifactStore(60), fault_scenario=None)
    orchestrator = AgentOrchestrator(settings, provider, executor)

    async def _run():
        return await orchestrator._model_loop(
            "How many CPUC ignitions are there?",
            "test-request",
            ["data_query_records"],
            year=None,
            years=[],
            utilities=[],
            time_resolution={"status": "none"},
        )

    status, answer, executions, trajectory, *_ = asyncio.run(_run())
    assert status == "error"
    bound_events = [
        event for event in trajectory if event.get("type") == "schema_retry_bound"
    ]
    assert bound_events
    year_failures = [
        item
        for item in executions
        if not item.ok and (item.error or {}).get("code") == "year_not_derived"
    ]
    assert len(year_failures) == 2
    assert "year" in answer.lower() or "could not" in answer.lower()
