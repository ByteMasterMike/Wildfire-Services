"""Time-series binning. Weekly bins match dataset_demo calendar weeks (Jan 1 + 7d)."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Iterable, Literal

Interval = Literal["daily", "weekly", "monthly", "quarterly"]


def week_index_in_year(d: date, year: int) -> int | None:
    if d.year != year:
        return None
    day_index = (d - date(year, 1, 1)).days
    if day_index < 0:
        return None
    return day_index // 7


def week_bin_meta(year: int) -> list[dict]:
    year_start = date(year, 1, 1)
    year_end = date(year, 12, 31)
    day_count = (year_end - year_start).days + 1
    week_count = (day_count + 6) // 7
    buckets = []
    for w in range(week_count):
        start = year_start + timedelta(days=w * 7)
        end = year_start + timedelta(days=min(day_count - 1, w * 7 + 6))
        buckets.append(
            {
                "start": start.isoformat(),
                "end": end.isoformat(),
                "label": f"{start.isoformat()} – {end.isoformat()}",
                "count": 0,
            }
        )
    return buckets


def month_bin_meta(start: date, end: date) -> list[dict]:
    buckets = []
    y, m = start.year, start.month
    while date(y, m, 1) <= end:
        if m == 12:
            next_first = date(y + 1, 1, 1)
        else:
            next_first = date(y, m + 1, 1)
        b_start = date(y, m, 1)
        b_end = next_first - timedelta(days=1)
        # clip to range
        s = max(b_start, start)
        e = min(b_end, end)
        buckets.append(
            {
                "start": s.isoformat(),
                "end": e.isoformat(),
                "label": f"{y:04d}-{m:02d}",
                "count": 0,
            }
        )
        if m == 12:
            y, m = y + 1, 1
        else:
            m += 1
    return buckets


def daily_bin_meta(start: date, end: date) -> list[dict]:
    buckets = []
    d = start
    while d <= end:
        iso = d.isoformat()
        buckets.append({"start": iso, "end": iso, "label": iso, "count": 0})
        d += timedelta(days=1)
    return buckets


def week_bin_meta_range(start: date, end: date) -> list[dict]:
    """Week bins clipped to [start, end], indexed from Jan 1 of each year.

    Matches the workspace client: first bucket start == start, last end == end.
    Visualization `/time-series` weekly still uses `week_bin_meta(year)` (full year).
    """
    buckets: list[dict] = []
    current_key: str | None = None
    d = start
    while d <= end:
        key = f"{d.year}-W{(d - date(d.year, 1, 1)).days // 7}"
        if key != current_key:
            buckets.append(
                {
                    "start": d.isoformat(),
                    "end": d.isoformat(),
                    "label": key,
                    "count": 0,
                }
            )
            current_key = key
        else:
            buckets[-1]["end"] = d.isoformat()
        d += timedelta(days=1)
    return buckets


def quarter_bin_meta(start: date, end: date) -> list[dict]:
    buckets: list[dict] = []
    year = start.year
    quarter = (start.month - 1) // 3 + 1
    while True:
        start_month = (quarter - 1) * 3 + 1
        bin_start = date(year, start_month, 1)
        if quarter == 4:
            next_first = date(year + 1, 1, 1)
        else:
            next_first = date(year, start_month + 3, 1)
        bin_end = next_first - timedelta(days=1)
        clipped_start = max(bin_start, start)
        clipped_end = min(bin_end, end)
        if clipped_start <= clipped_end:
            buckets.append(
                {
                    "start": clipped_start.isoformat(),
                    "end": clipped_end.isoformat(),
                    "label": f"{year}-Q{quarter}",
                    "count": 0,
                }
            )
        if clipped_end >= end:
            break
        if quarter == 4:
            year, quarter = year + 1, 1
        else:
            quarter += 1
    return buckets


def interval_bin_meta(start: date, end: date, interval: str) -> list[dict]:
    """Gap-filled buckets covering [start, end] inclusive for workspace series."""
    if start > end:
        raise ValueError("start must be <= end")
    if interval == "daily":
        return daily_bin_meta(start, end)
    if interval == "weekly":
        return week_bin_meta_range(start, end)
    if interval == "monthly":
        return month_bin_meta(start, end)
    if interval == "quarterly":
        return quarter_bin_meta(start, end)
    raise ValueError(f"unknown interval: {interval}")


def aggregate_dates(
    dates: Iterable[date | None],
    *,
    interval: Interval,
    year: int | None = None,
    start: date | None = None,
    end: date | None = None,
) -> list[dict]:
    clean = [d for d in dates if d is not None]
    if interval == "weekly":
        if year is None:
            raise ValueError("year is required for weekly interval")
        buckets = week_bin_meta(year)
        for d in clean:
            idx = week_index_in_year(d, year)
            if idx is not None and 0 <= idx < len(buckets):
                buckets[idx]["count"] += 1
        return buckets

    if start is None or end is None:
        if not clean:
            return []
        start = start or min(clean)
        end = end or max(clean)

    if interval == "daily":
        buckets = daily_bin_meta(start, end)
        index = {b["start"]: i for i, b in enumerate(buckets)}
        for d in clean:
            if start <= d <= end:
                buckets[index[d.isoformat()]]["count"] += 1
        return buckets

    if interval == "monthly":
        buckets = month_bin_meta(start, end)
        for d in clean:
            if not (start <= d <= end):
                continue
            key = f"{d.year:04d}-{d.month:02d}"
            for b in buckets:
                if b["label"] == key:
                    b["count"] += 1
                    break
        return buckets

    raise ValueError(f"unknown interval: {interval}")
