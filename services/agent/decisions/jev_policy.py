"""Turn Jev's atomic facts into a routing outcome. Jev does not apply policy."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any, Callable

from services.agent.time_resolve import resolve_time

COUNTY_CAPABLE = {
    "calfire_incidents",
    "cpuc_ignitions",
    "epss_outages",
    "psps_events",
    "circuits",
}
RISK_COVERAGE_END = date(2025, 12, 31)

OFF_TOPIC_RULES = {
    "cpz": "unsupported_cpz",
    "cost_or_budget": "unsupported_cost",
    "optimization_or_scheduling": "unsupported_optimization",
    "damage_or_loss": "unsupported_damage",
    "live_or_web": "unsupported_live_web",
}


@dataclass
class JevFacts:
    has_time_scope: float = 0.0
    vague_time: float = 0.0
    future_time: float = 0.0
    names_specific_place: float = 0.0
    vague_proximity: float = 0.0
    broad_region: float = 0.0
    asks_risk: float = 0.0
    names_risk_metric: float = 0.0
    prompt_injection: float = 0.0
    off_topic: str | None = "on_topic"
    intent: str | None = None
    dataset: str | None = None
    is_multi_intent: float = 0.0
    county: str | None = "none"
    utilities: dict[str, float] = field(default_factory=dict)
    # Optional facts used by ranking refusals. Production leaves these unset
    # unless a later question asks them; tests set them explicitly.
    rank_group: str | None = None
    rank_cross_dataset: float = 0.0
    dropped_filter: float = 0.0
    threshold: float = 0.5


@dataclass
class DerivedOutcome:
    disposition: str
    clarify_reason: str | None
    unsupported_topic: str | None
    trace: list[str]
    confidence: float | None
    deciding_margins: dict[str, float]


def _yes(value: float, threshold: float) -> bool:
    return value >= threshold


def _margin(value: float, threshold: float) -> float:
    return abs(value - threshold)


def derive_outcome(
    facts: JevFacts,
    *,
    question: str = "",
    today: date | None = None,
) -> DerivedOutcome:
    """Apply policies in route_question order where the order changes the answer."""
    threshold = facts.threshold
    margins: dict[str, float] = {}
    trace: list[str] = []

    def hit(rule_id: str, *fact_names: str) -> DerivedOutcome:
        trace.append(rule_id)
        for name in fact_names:
            raw = getattr(facts, name, None)
            if isinstance(raw, float):
                margins[name] = _margin(raw, threshold)
        disposition = "clarify"
        clarify = rule_id
        topic = None
        if rule_id.startswith("unsupported") or rule_id == "prompt_injection":
            disposition = "unsupported"
            clarify = None
            topic = None if rule_id == "prompt_injection" else rule_id
        confidence = min(margins.values()) if margins else None
        return DerivedOutcome(disposition, clarify, topic, trace, confidence, margins)

    if _yes(facts.prompt_injection, threshold):
        return hit("prompt_injection", "prompt_injection")
    topic_rule = OFF_TOPIC_RULES.get(facts.off_topic or "")
    if topic_rule:
        trace.append(topic_rule)
        return DerivedOutcome("unsupported", None, topic_rule, trace, None, {})
    if facts.off_topic == "other_off_topic":
        trace.append("other_off_topic")
        return DerivedOutcome("unsupported", None, None, trace, None, {})

    if _yes(facts.asks_risk, threshold) and not _yes(facts.names_risk_metric, threshold):
        return hit("ambiguous_risk_metric", "asks_risk", "names_risk_metric")
    if _yes(facts.vague_proximity, threshold) and not _yes(facts.names_specific_place, threshold):
        return hit("missing_location", "vague_proximity", "names_specific_place")
    if _yes(facts.vague_proximity, threshold):
        return hit("undefined_spatial_scope", "vague_proximity")
    if _yes(facts.broad_region, threshold):
        return hit("undefined_region", "broad_region")
    if _yes(facts.vague_time, threshold) and not _yes(facts.has_time_scope, threshold):
        return hit("ambiguous_relative_time", "vague_time", "has_time_scope")

    resolved = resolve_time(question, today=today) if question else None
    if resolved is not None and getattr(resolved, "status", None) == "out_of_coverage":
        trace.append("time_out_of_coverage")
        return DerivedOutcome("clarify", "time_out_of_coverage", None, trace, None, {})
    if _yes(facts.asks_risk, threshold) and (
        _yes(facts.future_time, threshold)
        or _risk_date_after_coverage(question)
    ):
        return hit("risk_future_date", "asks_risk", "future_time")
    if _yes(facts.asks_risk, threshold) and not _yes(facts.names_specific_place, threshold):
        return hit("risk_missing_place", "asks_risk", "names_specific_place")
    if _yes(facts.asks_risk, threshold) and not _yes(facts.has_time_scope, threshold):
        return hit("forecast_missing_date", "asks_risk", "has_time_scope")

    if _yes(facts.rank_cross_dataset, threshold) or (
        facts.intent == "rank" and facts.dataset == "multiple"
    ):
        trace.append("unsupported_rank_cross_dataset")
        return DerivedOutcome("unsupported", None, "unsupported_rank_cross_dataset", trace, None, {})
    if facts.intent == "rank" and (
        facts.rank_group == "state" or facts.dataset == "us_ignitions"
    ):
        trace.append("unsupported_rank_us_state")
        return DerivedOutcome("unsupported", None, "unsupported_rank_us_state", trace, None, {})
    if facts.intent == "rank" and facts.dataset == "epss_outages" and facts.rank_group == "utility":
        trace.append("unsupported_rank_epss_utility")
        return DerivedOutcome("unsupported", None, "unsupported_rank_epss_utility", trace, None, {})
    if facts.intent == "rank" and facts.rank_group in {"cell", "division"}:
        trace.append("unsupported_ranking")
        return DerivedOutcome("unsupported", None, "unsupported_ranking", trace, None, {})

    if (
        facts.county
        and facts.county != "none"
        and facts.dataset not in COUNTY_CAPABLE
        and facts.intent == "count"
    ):
        trace.append("unexpressable_county_filter")
        return DerivedOutcome("unsupported", None, "unexpressable_county_filter", trace, None, {})
    if _yes(facts.dropped_filter, threshold):
        return hit("unexpressed_filter_constraints", "dropped_filter")
    if (
        _yes(facts.asks_risk, threshold)
        and facts.county not in (None, "none")
        and any(_yes(value, threshold) for value in facts.utilities.values())
    ):
        return hit("ambiguous_risk_place", "asks_risk")

    intent = facts.intent or ""
    missing_year = {
        "map_plus_trend": "map_plus_trend_missing_year",
        "map": "map_missing_year",
        "trend": "trend_missing_year",
        "spatial_context": "spatial_missing_year",
        "count": "records_missing_year",
        "records_list": "records_missing_year",
        "rank": "ranking_missing_year",
    }
    if (
        intent in missing_year
        and not _yes(facts.has_time_scope, threshold)
        and not (intent == "map" and facts.dataset == "hftd")
    ):
        return hit(missing_year[intent], "has_time_scope")
    if intent == "rank" and facts.rank_group == "missing":
        trace.append("ranking_missing_slots")
        return DerivedOutcome("clarify", "ranking_missing_slots", None, trace, None, {})
    if intent == "rank" and facts.rank_group == "county" and facts.county not in (None, "none"):
        trace.append("ranking_county_contradiction")
        return DerivedOutcome("clarify", "ranking_county_contradiction", None, trace, None, {})

    if _yes(facts.is_multi_intent, threshold):
        trace.append("multi_intent_count_and_trend")
        margins["is_multi_intent"] = _margin(facts.is_multi_intent, threshold)
        return DerivedOutcome("answer", None, None, trace, margins["is_multi_intent"], margins)

    trace.append("answer")
    return DerivedOutcome("answer", None, None, trace, None, {})


def _risk_date_after_coverage(question: str) -> bool:
    if not question:
        return False
    resolved = resolve_time(question)
    end = resolved.end_date or (
        f"{resolved.year}-12-31" if resolved.year else None
    )
    if not end:
        return False
    try:
        return date.fromisoformat(end) > RISK_COVERAGE_END
    except ValueError:
        return False


def covered_rule_ids() -> set[str]:
    """Rule ids this module can emit, excluding the extra prompt_injection fact."""
    return {
        "ambiguous_risk_metric",
        "missing_location",
        "undefined_spatial_scope",
        "undefined_region",
        "ambiguous_relative_time",
        "time_out_of_coverage",
        "risk_future_date",
        "risk_missing_place",
        "forecast_missing_date",
        "unsupported_rank_cross_dataset",
        "unsupported_rank_us_state",
        "unsupported_rank_epss_utility",
        "unsupported_ranking",
        "unexpressable_county_filter",
        "unexpressed_filter_constraints",
        "ambiguous_risk_place",
        "map_plus_trend_missing_year",
        "map_missing_year",
        "trend_missing_year",
        "spatial_missing_year",
        "records_missing_year",
        "ranking_missing_year",
        "ranking_missing_slots",
        "ranking_county_contradiction",
        *OFF_TOPIC_RULES.values(),
    }


PolicyFn = Callable[[JevFacts], Any]
