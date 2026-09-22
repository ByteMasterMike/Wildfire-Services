"""Keyword collisions and relative-date slot fill for the deterministic router."""

from __future__ import annotations

from datetime import date

from services.agent.argument_normalize import prepare_tool_arguments
from services.agent.routing import route_question, _year


def test_quantity_outranks_territory_keyword():
    decision = route_question(
        "How many ignitions happened inside SCE's territory in 2023?"
    )
    assert decision.path == "deterministic"
    assert decision.rule == "spatial_utility_count"
    tool, args = decision.tool_calls[0]
    assert tool == "data_query_spatial"
    assert args["kind"] == "summary"
    assert args["utility"] == "SCE"
    assert args["start_date"] == "2023-01-01"


def test_territory_boundary_still_matches_without_quantity():
    decision = route_question("Show the SCE utility territory boundary")
    assert decision.path == "deterministic"
    assert decision.rule == "utility_territory"
    assert decision.tool_calls[0][0] == "visualization_inspect"


def test_map_outages_without_year_clarifies_not_open_ended():
    decision = route_question("Show me the map of PG&E outages")
    assert decision.path == "clarification"
    assert decision.rule == "map_missing_year"


def test_map_month_to_month_range_is_deterministic():
    decision = route_question(
        "map cpuc ignitions from august 2023 to september 2024"
    )
    assert decision.path == "deterministic"
    assert decision.rule == "map"
    args = decision.tool_calls[0][1]
    assert args["kind"] == "map"
    assert args["dataset"] == "ignitions"
    assert args["start_date"] == "2023-08-01"
    assert args["end_date"] == "2024-09-30"


def test_trend_year_to_year_range_is_deterministic():
    decision = route_question("trend of SCE ignitions 2021 to 2025")
    assert decision.path == "deterministic"
    assert decision.rule == "time_series"
    args = decision.tool_calls[0][1]
    assert args["kind"] == "time_series"
    assert args["dataset"] == "ignitions"
    assert args["utility"] == "SCE"
    assert args["start_date"] == "2021-01-01"
    assert args["end_date"] == "2025-12-31"
    assert args["interval"] == "monthly"


def test_bare_year_map_still_uses_year():
    decision = route_question(
        "I'd like to see where PG&E's CPUC ignitions happened in 2024"
    )
    assert decision.path == "deterministic"
    assert decision.rule == "map"
    assert decision.tool_calls[0][1]["year"] == 2024


def test_compare_last_year_resolves_and_uses_utilities_kind():
    decision = route_question(
        "Compare wildfire activity between PG&E and SCE territories last year"
    )
    assert decision.path == "deterministic"
    assert decision.rule == "utility_comparison"
    tool, args = decision.tool_calls[0]
    assert tool == "comparison_run"
    assert args["kind"] == "utilities"
    assert args["utilities"] == ["PGE", "SCE"]
    assert args["ignition_definition"] == "spatial"
    assert decision.slots["year"] == date.today().year - 1


def test_period_comparison_still_requires_two_explicit_years():
    decision = route_question("Compare PGE ignitions in 2023 versus 2024")
    assert decision.rule == "period_comparison"
    assert decision.tool_calls[0][1]["kind"] == "periods"


def test_recent_clarifies_but_past_two_years_resolves():
    recent = route_question("What were recent ignitions for SCE?")
    assert recent.path == "clarification"
    assert recent.rule == "ambiguous_relative_time"

    span = route_question("How many ignitions in the past two years for PGE?")
    assert span.path == "deterministic"
    assert span.rule == "filtered_records"
    args = span.tool_calls[0][1]
    assert args["start_date"] == f"{date.today().year - 1}-01-01"
    assert args["end_date"] == f"{date.today().year}-12-31"


def test_relative_year_helpers():
    today = date(2026, 8, 10)
    assert _year("last year", today=today) == 2025
    assert _year("this year", today=today) == 2026
    assert _year("2 years ago", today=today) == 2024
    assert _year("two years ago", today=today) == 2024
    assert _year("recent fires", today=today) is None


def test_near_place_without_radius_clarifies():
    decision = route_question("Show me fires near Sacramento in 2024")
    assert decision.path == "clarification"
    assert decision.rule == "undefined_spatial_scope"


def test_two_years_ago_compare_resolves_to_harness_year():
    today = date(2026, 8, 10)
    from services.agent.time_resolve import resolve_time

    resolution = resolve_time(
        "Compare wildfire activity between PG&E and SCE territories 2 years ago",
        today=today,
    )
    assert resolution.status == "relative_year"
    assert resolution.year == 2024
    decision = route_question(
        "Compare wildfire activity between PG&E and SCE territories 2 years ago"
    )
    assert decision.path == "deterministic"
    assert decision.slots["year"] == date.today().year - 2


def test_comparison_kind_repair_periods_to_utilities():
    repaired = prepare_tool_arguments(
        "comparison_run",
        {
            "kind": "periods",
            "metric": "ignition_count",
            "scope_type": "utility",
            "scope": "PGE",
        },
        year=2025,
        years=[2025],
        utilities=["PGE", "SCE"],
        fill_aliases=True,
        fill_year=True,
        repair_comparison=True,
    )
    assert repaired["kind"] == "utilities"
    assert repaired["utilities"] == ["PGE", "SCE"]
    assert repaired["start_date"] == "2025-01-01"
    assert "period_a_start" not in repaired


def test_trend_with_territory_keyword_is_not_boundary_lookup():
    decision = route_question(
        "Weekly CAL FIRE trend in SCE territory for 2023"
    )
    assert decision.rule == "time_series"
    assert decision.tool_calls[0][0] == "visualization_create"


def test_map_territory_alone_is_boundary_not_multi_intent():
    decision = route_question("Map SCE territory")
    assert decision.rule == "utility_territory"


def test_map_plus_monthly_trend_fires_both_visualization_calls():
    decision = route_question(
        "Map PG&E CPUC ignition events for 2024 and show the monthly trend."
    )
    assert decision.path == "deterministic"
    assert decision.rule == "map_plus_trend"
    assert [tool for tool, _args in decision.tool_calls] == [
        "visualization_create",
        "visualization_create",
    ]
    map_args, series_args = decision.tool_calls[0][1], decision.tool_calls[1][1]
    assert map_args["kind"] == "map"
    assert series_args["kind"] == "time_series"
    assert series_args["interval"] == "monthly"
    assert map_args["dataset"] == series_args["dataset"] == "ignitions"
    assert map_args["utility"] == series_args["utility"] == "PGE"
    assert map_args["year"] == series_args["year"] == 2024


def test_map_monthly_without_trend_word_stays_map_only():
    decision = route_question("Map monthly CAL FIRE incidents for 2024.")
    assert decision.rule == "map"
    assert len(decision.tool_calls) == 1
    assert decision.tool_calls[0][1]["kind"] == "map"


def test_see_where_outranks_count_and_maps():
    decision = route_question(
        "I'd like to see where PG&E's CPUC ignitions happened in 2024"
    )
    assert decision.path == "deterministic"
    assert decision.rule == "map"
    tool, args = decision.tool_calls[0]
    assert tool == "visualization_create"
    assert args["kind"] == "map"
    assert args["dataset"] == "ignitions"
    assert args["utility"] == "PGE"
    assert args["year"] == 2024


def test_locations_of_maps_even_with_how_many():
    decision = route_question(
        "How many and where are PG&E CPUC ignitions in 2024?"
    )
    assert decision.rule == "map"
    assert decision.tool_calls[0][1]["kind"] == "map"


def test_show_me_where_maps():
    decision = route_question(
        "Show me where SCE CAL FIRE incidents were in 2024"
    )
    assert decision.rule == "map"
    assert decision.tool_calls[0][1]["dataset"] == "calfire"
    assert decision.tool_calls[0][1]["utility"] == "SCE"


def test_list_records_uses_preview_limit_25():
    decision = route_question(
        "Show me CAL FIRE incidents in Sacramento County in 2024"
    )
    assert decision.path == "deterministic"
    assert decision.rule == "filtered_records"
    args = decision.tool_calls[0][1]
    assert args["result_mode"] == "records"
    assert args["dataset"] == "calfire_incidents"
    assert args["county"] == "Sacramento"
    assert args["limit"] == 25


def test_summary_phrase_opens_summary_panel_and_bare_counts_do_not():
    summary = route_question("summary of EPSS outages in 2024")
    assert summary.rule == "summary_stats"
    assert summary.slots["stat_mode"] == "summary"
    assert summary.slots["dataset"] == "epss_outages"
    assert summary.tool_calls[0][1]["result_mode"] == "count"
    assert summary.tool_calls[0][1]["year"] == 2024
    overview = route_question("overview of CPUC ignitions 2024")
    assert overview.rule == "summary_stats"
    assert overview.slots["dataset"] == "cpuc_ignitions"
    bare = route_question("How many PG&E ignitions in 2024?")
    assert bare.rule == "filtered_records"
    assert bare.slots.get("stat_mode") is None
    medical = route_question("show me medical baseline data 2024")
    assert medical.rule == "medical_exposure"
    assert medical.slots["stat_mode"] == "medical_exposure"
    missing = route_question("summary of EPSS outages")
    assert missing.rule == "records_missing_year"
    assert missing.tool_calls == []


def test_series_modes_resolve_dataset_and_year():
    cases = [
        ("Show year over year CPUC ignition totals for 2024.", "series_yearly", "ignitions", "cpuc_ignitions"),
        ("Show the seasonal profile of CAL FIRE incidents for 2024.", "series_seasonal", "calfire", "calfire_incidents"),
        ("Show cumulative acres burned over the year for 2024.", "series_cumulative_acres", "calfire", "calfire_incidents"),
        ("Show customers affected over time in 2024.", "series_customer_events", "psps", "psps_events"),
        ("Show EPSS outages by division in 2024.", "series_regional", "epss", "epss_outages"),
    ]
    for question, rule, viz, warehouse in cases:
        decision = route_question(question)
        assert decision.path == "deterministic", question
        assert decision.rule == rule
        assert decision.slots["series_mode"] == rule.removeprefix("series_")
        assert decision.slots["dataset"] == warehouse
        assert decision.slots["year"] == 2024
        tool, args = decision.tool_calls[0]
        assert tool == "visualization_create"
        assert args["kind"] == "time_series"
        assert args["dataset"] == viz
        assert args["year"] == 2024


def test_series_modes_clarify_when_the_year_or_dataset_is_missing():
    missing_year = route_question("Show cumulative acres burned over the year.")
    assert missing_year.path == "clarification"
    assert missing_year.rule == "series_mode_missing_year"
    assert missing_year.tool_calls == []
    missing_dataset = route_question("Show annual totals for 2024.")
    assert missing_dataset.path == "clarification"
    assert missing_dataset.rule == "series_mode_missing_dataset"
    assert missing_dataset.tool_calls == []


def test_series_mode_guards_keep_existing_routes():
    trend = route_question("Show the monthly CAL FIRE incident trend for 2024.")
    assert trend.rule == "time_series"
    assert "series_mode" not in trend.slots
    count = route_question("How many EPSS outages were there in 2024?")
    assert count.rule == "filtered_records"
    assert count.tool_calls[0][1]["result_mode"] == "count"
    incidents = route_question("How many CAL FIRE incidents were there in 2024?")
    assert incidents.rule == "filtered_records"
    assert incidents.tool_calls[0][1]["dataset"] == "calfire_incidents"
    assert incidents.slots.get("series_mode") is None


def test_medical_baseline_opens_epss_exposure_panel():
    decision = route_question("show me medical baseline data 2024")
    assert decision.path == "deterministic"
    assert decision.rule == "medical_exposure"
    assert decision.slots["dataset"] == "epss"
    assert decision.slots["stat_mode"] == "medical_exposure"
    assert decision.slots["view_id"] == "medical-exposure"
    assert decision.slots["year"] == 2024
    tool, args = decision.tool_calls[0]
    assert tool == "data_query_records"
    assert args == {"dataset": "epss_outages", "result_mode": "count", "year": 2024}


def test_life_support_and_medically_vulnerable_use_the_same_panel():
    for question in (
        "life support customers in 2024",
        "life-support customers in 2024",
        "medically vulnerable customers 2024",
    ):
        decision = route_question(question)
        assert decision.rule == "medical_exposure", question
        assert decision.slots["dataset"] == "epss"
        assert decision.tool_calls[0][1]["dataset"] == "epss_outages"
        assert decision.tool_calls[0][1]["year"] == 2024


def test_medical_exposure_without_a_year_clarifies():
    decision = route_question("show me medical baseline data")
    assert decision.path == "clarification"
    assert decision.rule == "medical_exposure_missing_year"
    assert decision.tool_calls == []


def test_nearby_epss_questions_keep_their_routes():
    count = route_question("How many EPSS outages were there in 2024?")
    assert count.rule == "filtered_records"
    assert count.tool_calls[0][1]["dataset"] == "epss_outages"
    assert count.tool_calls[0][1]["result_mode"] == "count"

    mapped = route_question("Map EPSS outages for 2024.")
    assert mapped.rule == "map"
    assert mapped.tool_calls[0][0] == "visualization_create"
    assert mapped.tool_calls[0][1]["dataset"] == "epss"

    ranked = route_question("Which EPSS circuits had the most outages in 2024?")
    assert ranked.rule == "ranked_records"
    assert ranked.tool_calls[0][0] == "data_query_rank"

    listed = route_question("Show me PG&E outages in 2024")
    assert listed.rule == "filtered_records"
    assert listed.tool_calls[0][1]["result_mode"] == "records"
    assert listed.tool_calls[0][1]["utility"] == "PGE"
