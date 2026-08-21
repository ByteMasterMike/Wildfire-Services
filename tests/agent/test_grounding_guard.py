"""Quantity grounding must compare asserted counts to tool evidence."""

from __future__ import annotations

from services.agent.orchestrator import _quantity_mismatches, _unsupported_numbers
from services.agent.tools import ToolExecution


def _records_execution(total: int) -> ToolExecution:
    return ToolExecution(
        tool="data_query_records",
        arguments={"dataset": "calfire_incidents", "year": 2024, "limit": 1},
        ok=True,
        summary={
            "dataset": "calfire_incidents",
            "result_mode": "records",
            "total": total,
            "returned": 1,
            "filters": {"year": 2024},
            "records": [],
            "metadata": {
                "null_incident_type_count": 1234,
                "null_utility_records_in_table": 282,
            },
        },
        raw={},
        error=None,
        artifact=None,
        latency_ms=1.0,
    )


def test_eleven_records_versus_one_incident_is_rejected():
    executions = [_records_execution(11)]
    answer = (
        "There was 1 wildfire incident in Sacramento County: the Marsh Fire."
    )
    mismatches = _quantity_mismatches(answer, executions)
    # returned=1 must not launder a primary incident-count claim of 1 when total=11.
    assert "1" in mismatches


def test_matching_total_is_allowed():
    executions = [_records_execution(11)]
    answer = "There were 11 wildfire incidents near the queried area."
    assert not _quantity_mismatches(answer, executions)
    unsupported = _unsupported_numbers(
        answer,
        "Show me fires near Sacramento in 2024",
        executions,
    )
    assert not unsupported


def test_metadata_numbers_in_evidence_are_allowed():
    executions = [_records_execution(11)]
    answer = (
        "There were 11 CAL FIRE wildfire incidents in Sacramento County in 2024. "
        "The warehouse also notes 1,234 records without an incident type and 282 "
        "without utility tags."
    )
    assert not _unsupported_numbers(
        answer, "Tell me about wildfire incidents in Sacramento County during 2024", executions
    )
    assert not _quantity_mismatches(answer, executions)


def test_invented_number_is_rejected():
    executions = [_records_execution(11)]
    answer = "There were 99 wildfire incidents in Sacramento County in 2024."
    assert "99" in _unsupported_numbers(
        answer, "Tell me about wildfires in Sacramento in 2024", executions
    )
    assert "99" in _quantity_mismatches(answer, executions)


def test_caveat_only_numbers_are_allowed():
    """Caveat text is in the synthesis prompt; grounding must allow its figures."""
    executions = [
        ToolExecution(
            tool="data_query_records",
            arguments={"dataset": "cpuc_ignitions", "year": 2023, "limit": 1},
            ok=True,
            summary={
                "dataset": "cpuc_ignitions",
                "result_mode": "count",
                "total": 480,
                "returned": 1,
                "filters": {"year": 2023},
                "records": [],
                "metadata": {},
            },
            raw={},
            error=None,
            artifact=None,
            latency_ms=1.0,
        )
    ]
    caveats = [
        "Warehouse notes 1,234 CAL FIRE rows without an incident type (context only)."
    ]
    answer = (
        "CPUC recorded 480 utility-caused ignitions in 2023. "
        "For comparison context, the warehouse notes 1,234 CAL FIRE rows "
        "without an incident type."
    )
    assert not _unsupported_numbers(
        answer, "Tell me about CPUC ignitions in 2023", executions, caveats
    )
    assert not _quantity_mismatches(answer, executions, caveats)
    # Without caveats in the allow-list, the same answer must fail (regression guard).
    assert "1234" in _unsupported_numbers(
        answer, "Tell me about CPUC ignitions in 2023", executions, None
    )


def test_synthesis_evidence_drops_date_fragments_from_prompt():
    from services.agent.orchestrator import _synthesis_evidence_payload

    count = ToolExecution(
        tool="data_query_records",
        arguments={"dataset": "cpuc_ignitions", "year": 2023},
        ok=True,
        summary={
            "dataset": "cpuc_ignitions",
            "result_mode": "count",
            "total": 480,
            "returned": 1,
            "filters": {"year": 2023},
            "records": [{"event_date": "2023-01-04", "utility": "PGE"}],
            "metadata": {},
        },
        raw={},
        error=None,
        artifact=None,
        latency_ms=1.0,
    )
    sample = ToolExecution(
        tool="data_query_records",
        arguments={"dataset": "cpuc_ignitions", "year": 2023, "result_mode": "records"},
        ok=True,
        summary={
            "dataset": "cpuc_ignitions",
            "result_mode": "records",
            "total": 480,
            "returned": 2,
            "filters": {"year": 2023},
            "records": [
                {"event_date": "2023-01-04", "utility": "PGE"},
                {"event_date": "2023-01-05", "utility": "SCE"},
            ],
            "metadata": {},
        },
        raw={},
        error=None,
        artifact=None,
        latency_ms=1.0,
        qualification_call=True,
    )
    payloads = _synthesis_evidence_payload([count, sample])
    assert payloads[0]["summary"]["records"] == []
    for row in payloads[1]["summary"]["records"]:
        assert "event_date" not in row
    assert "PGE" in payloads[1]["summary"].get("sample_examples", [])
