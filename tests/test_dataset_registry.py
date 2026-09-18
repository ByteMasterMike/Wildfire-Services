"""Registry shape: keys, unique aliases, no invented datasets."""

from __future__ import annotations

from services.shared.dataset_registry import (
    ALIASES,
    CANONICAL_KEYS,
    DATASETS,
    GROUP_BY_FIELDS,
    SUMMARY_METRIC_IDS,
    parse_viz_dataset,
    to_canonical,
    to_viz_key,
)


def test_required_canonical_keys_present():
    expected = {
        "cpuc_ignitions",
        "calfire_incidents",
        "epss_outages",
        "psps_events",
        "us_ignitions",
        "circuits",
        "hftd_tiers",
        "iou_territories",
        "counties",
        "grid_cells",
        "cpuc_ignitions_with_time",
        "psps_event_circuits",
    }
    assert CANONICAL_KEYS == expected


def test_aliases_are_unique_and_resolve():
    seen: dict[str, str] = {}
    for key, entry in DATASETS.items():
        for alias in entry.aliases:
            assert alias not in seen, f"alias {alias!r} on {key} and {seen[alias]}"
            seen[alias] = key
            assert to_canonical(alias) == key
    assert ALIASES == seen


def test_viz_parse_keeps_short_keys():
    assert parse_viz_dataset("cpuc") == "ignitions"
    assert parse_viz_dataset("calfire_incidents") == "calfire"
    assert parse_viz_dataset("epss_outages") == "epss"
    assert parse_viz_dataset("circuits") == "circuits"
    assert parse_viz_dataset("us_ignitions") == "us_ignitions"


def test_canonical_to_viz_round_trip():
    assert to_viz_key("cpuc_ignitions") == "ignitions"
    assert to_viz_key("hftd") == "hftd"
    assert to_viz_key("hftd_tiers") == "hftd"


def test_summary_and_group_by_match_pre_registry_endpoints():
    assert GROUP_BY_FIELDS == frozenset({"cause", "utility", "county"})
    assert SUMMARY_METRIC_IDS["us_ignitions"] == ("events",)
    assert SUMMARY_METRIC_IDS["cpuc_ignitions"] == ("events", "counties", "utilities")
