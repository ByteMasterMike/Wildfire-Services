"""SSE helpers for POST /ask/stream. Harness events only; never model prose."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

ProgressCallback = Callable[[str, dict[str, Any]], Awaitable[None]]


def format_sse(event: str, data: dict[str, Any]) -> str:
    payload = json.dumps(data, default=str, ensure_ascii=False)
    return f"event: {event}\ndata: {payload}\n\n"


def make_queue_emitter(
    queue: Any,
) -> ProgressCallback:
    async def on_event(event: str, data: dict[str, Any]) -> None:
        await queue.put((event, data))

    return on_event


async def iter_sse_queue(
    queue: Any,
) -> AsyncIterator[str]:
    while True:
        item = await queue.get()
        if item is None:
            break
        event, data = item
        yield format_sse(event, data)
