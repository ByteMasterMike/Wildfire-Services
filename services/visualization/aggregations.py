"""Time-series binning. Weekly bins match dataset_demo calendar weeks (Jan 1 + 7d)."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Iterable, Literal

Interval = Literal["daily", "weekly", "monthly"]


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
