"""Deterministic router must not silently drop county/month constraints."""

from __future__ import annotations

from services.agent.routing import route_question
from services.agent.time_resolve import apply_harness_years, resolve_time
from services.agent.tools import _ungrounded_utility_error


def test_cpuc_sacramento_county_2023_answers():
    decision = route_question(
        "how many CPUC ignitions in Sacramento County in 2023"
    )
    assert decision.path == "deterministic"
    assert decision.rule == "filtered_records"
    tool, args = decision.tool_calls[0]
    assert tool == "data_query_records"
    assert args["dataset"] == "cpuc_ignitions"
    assert args["county"] == "Sacramento"
    assert args.get("year") == 2023 or str(args.get("start_date") or "").startswith(
        "2023"
    )


def test_cpuc_sacramento_august_expresses_county_and_month():
    decision = route_question(
        "how many wildfires in sacramento 2023 cpuc august"
    )
    assert decision.path == "deterministic"
    tool, args = decision.tool_calls[0]
    assert args["dataset"] == "cpuc_ignitions"
    assert args["county"] == "Sacramento"
    assert str(args.get("start_date") or "").startswith("2023-08")
    assert str(args.get("end_date") or "").startswith("2023-08")


def test_sacramento_wildfires_last_year_is_unexpressable_without_calfire():
    decision = route_question("How many wildfires in Sacramento last year?")
    assert decision.path == "unsupported"
    assert decision.rule == "unexpressable_county_filter"
    assert decision.slots.get("county") == "Sacramento"


def test_calfire_county_and_month_are_expressed():
    decision = route_question(
        "How many CAL FIRE wildfire incidents were there in "
        "Sacramento County in August 2023?"
    )
    assert decision.path == "deterministic"
    assert decision.rule == "filtered_records"
    tool, args = decision.tool_calls[0]
    assert tool == "data_query_records"
    assert args["dataset"] == "calfire_incidents"
    assert args["county"] == "Sacramento"
    assert args["start_date"] == "2023-08-01"
    assert args["end_date"] == "2023-08-31"


def test_month_without_county_uses_date_window_not_full_year():
    decision = route_question("How many CPUC ignitions in August 2023?")
    assert decision.path == "deterministic"
    assert decision.rule == "filtered_records"
    args = decision.tool_calls[0][1]
    assert args["start_date"] == "2023-08-01"
    assert args["end_date"] == "2023-08-31"
    assert "year" not in args or args.get("start_date")


def test_harness_overrides_wrong_model_year():
    from datetime import date

    today = date(2026, 8, 10)
    resolution = resolve_time(
        "how many ignitions last year", today=today
    ).as_slot()
    filled, error = apply_harness_years(
        {"dataset": "cpuc_ignitions", "year": 2022, "result_mode": "count"},
        time_resolution=resolution,
        today=today,
    )
    assert error is None
    assert filled.get("year") == 2025


def test_invented_year_still_rejected_without_harness_year():
    from datetime import date

    filled, error = apply_harness_years(
        {"year": 2024},
        time_resolution={"status": "none"},
        today=date(2026, 8, 10),
    )
    assert error is not None
    assert filled.get("year") == 2024


def test_utility_must_appear_in_question_slots():
    from services.agent.tools import _strip_ungrounded_utilities

    assert (
        _ungrounded_utility_error({"utility": "SCE"}, utilities=[])
        is not None
    )
    assert (
        _ungrounded_utility_error({"utility": "SCE"}, utilities=["SCE"])
        is None
    )
    filled, stripped = _strip_ungrounded_utilities(
        {"utility": "SCE", "dataset": "cpuc_ignitions", "year": 2023},
        utilities=[],  # Sacramento / statewide question → no IOU
    )
    assert stripped == ["SCE"]
    assert "utility" not in filled
