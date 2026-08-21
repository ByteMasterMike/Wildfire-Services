"""Metric registry and normalization helpers for the comparison service."""

from __future__ import annotations

from typing import Any, Literal

MetricName = Literal[
    "ignition_count",
    "epss_outage_count",
    "epss_to_ignition_ratio",
    "calfire_incident_count",
    "acres_burned",
    "psps_event_count",
    "customers_deenergized",
]

METRICS: frozenset[str] = frozenset(
    {
        "ignition_count",
        "epss_outage_count",
        "epss_to_ignition_ratio",
        "calfire_incident_count",
        "acres_burned",
        "psps_event_count",
        "customers_deenergized",
    }
)

NormalizeMode = Literal["none", "per_circuit", "per_km2"]
NORMALIZATIONS: frozenset[str] = frozenset({"none", "per_circuit", "per_km2"})

IgnitionDefinition = Literal["attribute", "spatial"]
IGNITION_DEFINITIONS: frozenset[str] = frozenset({"attribute", "spatial"})

REASON_EPSS_PGE_ONLY = "EPSS is PG&E-only in this warehouse"
REASON_NO_COUNTY = "No county attribute/polygon for this metric in the warehouse"
REASON_NO_COUNTY_AREA = "No county polygon layer; per_km2 unavailable for county regions"
REASON_CIRCUITS_PGE = (
    "per_circuit uses the PGE EPSS circuits inventory; not meaningful for this scope"
)
REASON_ZERO_IGNITIONS = "Ignition count is zero; ratio undefined"
REASON_COMPONENT_NULL = "One or more component metrics are null"


def parse_metric(value: str) -> str:
    m = value.strip().lower()
    if m not in METRICS:
        raise ValueError(f"unknown metric {value!r}; allowed: {', '.join(sorted(METRICS))}")
    return m


def parse_normalize(value: str | None) -> str:
    if value is None or value.strip() == "":
        return "none"
    n = value.strip().lower()
    if n not in NORMALIZATIONS:
        raise ValueError(
            f"unknown normalize {value!r}; allowed: {', '.join(sorted(NORMALIZATIONS))}"
        )
    return n


def parse_ignition_definition(value: str | None, *, default: str) -> str:
    if value is None or value.strip() == "":
        return default
    d = value.strip().lower()
    if d not in IGNITION_DEFINITIONS:
        raise ValueError(
            f"ignition_definition must be attribute|spatial; got {value!r}"
        )
    return d


def result_row(
    key: str,
    *,
    value: float | int | None,
    raw_value: float | int | None = None,
    denominator: float | int | None = None,
    reason: str | None = None,
) -> dict[str, Any]:
    return {
        "key": key,
        "value": value,
        "raw_value": raw_value if raw_value is not None else value,
        "denominator": denominator,
        "reason": reason,
    }


def apply_normalization(
    raw: float | int | None,
    *,
    key: str,
    normalize: str,
    denominator: float | int | None,
    denom_reason: str | None,
) -> dict[str, Any]:
    if raw is None:
        return result_row(key, value=None, raw_value=None, reason=denom_reason or REASON_COMPONENT_NULL)
    if normalize == "none":
        return result_row(key, value=raw, raw_value=raw, denominator=None, reason=None)
    if denominator is None:
        return result_row(
            key,
            value=None,
            raw_value=raw,
            denominator=None,
            reason=denom_reason or "Normalization denominator unavailable",
        )
    if float(denominator) == 0:
        return result_row(
            key,
            value=None,
            raw_value=raw,
            denominator=denominator,
            reason="Normalization denominator is zero",
        )
    return result_row(
        key,
        value=float(raw) / float(denominator),
        raw_value=raw,
        denominator=denominator,
        reason=None,
    )
