"""Harness argument repairs are deterministic and non-overwriting."""

from services.agent.argument_normalize import prepare_tool_arguments
from services.agent.routing import candidate_tools


def test_dataset_and_utility_aliases():
    prepared = prepare_tool_arguments(
        "visualization_create",
        {
            "kind": "time_series",
            "dataset": "calfire_incidents",
            "utility": "PG&E",
            "interval": "monthly",
            "year": 2024,
        },
        fill_aliases=True,
    )
    assert prepared["dataset"] == "calfire"
    assert prepared["utility"] == "PGE"


def test_year_fill_only_when_temporal_fields_absent():
    filled = prepare_tool_arguments(
        "visualization_create",
        {"kind": "time_series", "dataset": "calfire", "interval": "monthly"},
        year=2024,
        fill_aliases=True,
        fill_year=True,
    )
    assert filled["year"] == 2024

    untouched = prepare_tool_arguments(
        "visualization_create",
        {
            "kind": "time_series",
            "dataset": "calfire",
            "interval": "monthly",
            "start_date": "2023-01-01",
            "end_date": "2023-12-31",
        },
        year=2024,
        fill_aliases=True,
        fill_year=True,
    )
    assert "year" not in untouched
    assert untouched["start_date"] == "2023-01-01"


def test_utility_fill_remaps_us_sample_trend_to_cpuc():
    prepared = prepare_tool_arguments(
        "visualization_create",
        {
            "kind": "time_series",
            "dataset": "us_ignitions",
            "interval": "monthly",
        },
        year=2024,
        utilities=["PGE"],
        fill_aliases=True,
        fill_year=True,
        fill_utility=True,
    )
    assert prepared["utility"] == "PGE"
    assert prepared["dataset"] == "ignitions"
    assert prepared["year"] == 2024


def test_cross_dataset_candidates_exclude_comparison_run():
    assert candidate_tools("Compare CPUC and US ignition counts in 2024.") == [
        "data_query_records"
    ]


def test_ignition_risk_candidates_are_not_a_count_read():
    tools = candidate_tools(
        "What was the ignition risk in Sacramento County on 2024-08-15?"
    )
    assert "risk_forecast" in tools
    assert "data_query_records" not in tools


def test_truncated_year_is_repaired_from_slot():
    prepared = prepare_tool_arguments(
        "data_query_records",
        {"dataset": "us_ignitions", "result_mode": "count", "year": 2},
        year=2024,
        fill_aliases=True,
        fill_year=True,
    )
    assert prepared["year"] == 2024
