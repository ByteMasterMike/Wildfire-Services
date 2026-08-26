"""Layer colors / opacities for the Historical Map and visualization API.

One hue per dataset. Magnitude uses size or opacity within that hue — not a
second categorical color (HFTD tiers share amber; CAL FIRE stays red).
"""

from __future__ import annotations

from typing import Any

# HISTORICAL_DATASETS + PSPS_EVENTS_LAYER + HFTD_LAYER in the website JS.
DATASET_STYLES: dict[str, dict[str, Any]] = {
    "ignitions": {
        "color": "#c0440e",
        "opacity": 0.9,
        "fillOpacity": 0.6,
        "weight": 1,
        "geometry_type": "Point",
        "label": "CPUC Ignition Events",
        "chart_short_label": "CPUC Ignitions",
    },
    "epss": {
        "color": "#7c3aed",
        "highlight_color": "#5b21b6",
        "opacity": 0.9,
        "weight": 2.5,
        "geometry_type": "MultiLineString",
        "label": "EPSS Outage Events",
        "chart_short_label": "EPSS",
        "render_as": "circuit_lines",
    },
    "calfire": {
        "color": "#b91c1c",
        "opacity": 0.85,
        "fillOpacity": 0.55,
        "weight": 1,
        "geometry_type": "Point",
        "label": "CAL FIRE Incidents",
        "chart_short_label": "CAL FIRE",
        "bubble_by_acres": True,
    },
    "us_ignitions": {
        "color": "#dc2626",
        "opacity": 0.9,
        "fillOpacity": 0.65,
        "weight": 1,
        "geometry_type": "Point",
        "label": "US Ignitions (IRWIN / all-cause)",
        "chart_short_label": "US Ignitions",
    },
    "psps": {
        "color": "#1d6fa5",
        "highlight_color": "#155a85",
        "opacity": 0.9,
        "fillColor": "#1d6fa5",
        "fillOpacity": 0.25,
        "weight": 1.5,
        "geometry_type": "MultiPolygon",
        "label": "PSPS Event Areas",
    },
    "hftd": {
        "color": "#d97706",
        "geometry_type": "MultiPolygon",
        "label": "CPUC HFTD",
        "tiers": {
            "Tier 2": {
                "color": "#d97706",
                "weight": 0.75,
                "opacity": 0.45,
                "fillColor": "#d97706",
                "fillOpacity": 0.16,
            },
            "Tier 3": {
                "color": "#d97706",
                "weight": 0.9,
                "opacity": 0.55,
                "fillColor": "#d97706",
                "fillOpacity": 0.38,
            },
        },
    },
}

IOU_STYLE = {
    "color": "#334155",
    "weight": 1.25,
    "opacity": 0.85,
    "fillOpacity": 0.05,
    "fillColor": "#64748b",
    "geometry_type": "MultiPolygon",
}

STATEWIDE_CENTER = [37.6, -120.8]

DATASETS = frozenset(DATASET_STYLES)


def style_for(dataset: str, *, tier: str | None = None) -> dict[str, Any]:
    if dataset not in DATASET_STYLES:
        raise KeyError(dataset)
    base = dict(DATASET_STYLES[dataset])
    if dataset == "hftd" and tier:
        tier_style = base.get("tiers", {}).get(tier)
        if tier_style:
            out = {k: v for k, v in base.items() if k != "tiers"}
            out.update(tier_style)
            out["tier"] = tier
            return out
    return {k: v for k, v in base.items() if k != "tiers"}


def acres_radius_hint(acres: float | None) -> float | None:
    """Simple bubble size hint (website uses leaflet radius by acres)."""
    if acres is None:
        return None
    try:
        a = float(acres)
    except (TypeError, ValueError):
        return None
    if a <= 0:
        return 4.0
    # sqrt scale, clamped
    return max(4.0, min(40.0, (a ** 0.5) * 0.35))
