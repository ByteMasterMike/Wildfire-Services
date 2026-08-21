"""Ranking unsupported routing and user-facing error copy."""

from __future__ import annotations

from services.agent.orchestrator import _user_facing_tool_failure
from services.agent.routing import route_question
from services.agent.tools import ToolExecution


def test_circuit_most_epss_is_unsupported_ranking():
    decision = route_question(
        "Find the circuit with the most EPSS outages in 2024 and tell me "
        "what division it is in"
    )
    assert decision.path == "unsupported"
    assert decision.rule == "unsupported_ranking"
    assert decision.answer and "Ranking is not supported" in decision.answer


def test_user_facing_error_avoids_harness_jargon():
    executions = [
        ToolExecution(
            tool="data_query_records",
            arguments={"dataset": "epss_outages"},
            ok=False,
            summary={},
            raw=None,
            error={
                "code": "invalid_arguments",
                "message": "Tool arguments failed schema validation.",
            },
            artifact=None,
            latency_ms=1.0,
        )
    ]
    message = _user_facing_tool_failure(executions, {"data_query_records"})
    assert "schema validation" not in message.lower()
    assert "exhausted available tools" not in message.lower()
    assert "ranking" in message.lower() or "valid query" in message.lower()
