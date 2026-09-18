"""Layer colors / opacities for the Historical Map and visualization API.

One hue per dataset. Magnitude uses size or opacity within that hue — not a
second categorical color (HFTD tiers share amber; CAL FIRE stays red).
"""

from __future__ import annotations

from typing import Any

from services.shared.dataset_registry import (
    DATASET_STYLES,
    IOU_STYLE,
    STATEWIDE_CENTER,
    style_for,
)

DATASETS = frozenset(DATASET_STYLES)


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
