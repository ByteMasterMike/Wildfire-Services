"""Ranking routing and user-facing error copy."""

from __future__ import annotations

from services.agent.orchestrator import _user_facing_tool_failure
from services.agent.routing import route_question
from services.agent.tools import ToolExecution


def test_circuit_most_epss_is_deterministic_rank():
    decision = route_question(
        "Find the circuit with the most EPSS outages in 2024 and tell me "
        "what division it is in"
    )
    assert decision.path == "deterministic"
    assert decision.rule == "ranked_records"
    assert decision.tool_calls
    tool, args = decision.tool_calls[0]
    assert tool == "data_query_rank"
    assert args["dataset"] == "epss_outages"
    assert args["group_by"] == "circuit"
    assert args["year"] == 2024


def test_calfire_counties_2023_is_deterministic_rank():
    decision = route_question(
        "Which counties had the most CAL FIRE incidents in 2023?"
    )
    assert decision.path == "deterministic"
    assert decision.rule == "ranked_records"
    tool, args = decision.tool_calls[0]
    assert tool == "data_query_rank"
    assert args["dataset"] == "calfire_incidents"
    assert args["group_by"] == "county"
    assert args["metric"] == "count"
    assert args["year"] == 2023


def test_cross_dataset_rank_is_unsupported():
    decision = route_question(
        "Which county had the most CAL FIRE incidents and CPUC ignitions in 2023?"
    )
    assert decision.path == "unsupported"
    assert decision.rule == "unsupported_rank_cross_dataset"
    assert decision.answer
    assert "cannot mix datasets" in decision.answer.lower()


def test_epss_utility_rank_is_unsupported():
    decision = route_question(
        "Which utility had the most EPSS outages in 2024?"
    )
    assert decision.path == "unsupported"
    assert decision.rule == "unsupported_rank_epss_utility"


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
