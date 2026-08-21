"""Bounded in-memory payload store; never placed in model context."""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass
from typing import Any


@dataclass
class Artifact:
    ref: str
    kind: str
    payload: Any
    created_at: float
    expires_at: float


class ArtifactStore:
    def __init__(self, ttl_seconds: int = 900, max_items: int = 128) -> None:
        self.ttl_seconds = ttl_seconds
        self.max_items = max_items
        self._items: dict[str, Artifact] = {}

    def put(self, kind: str, payload: Any) -> dict[str, Any]:
        self._purge()
        if len(self._items) >= self.max_items:
            oldest = min(self._items.values(), key=lambda item: item.created_at)
            self._items.pop(oldest.ref, None)
        ref = f"artifact_{uuid.uuid4().hex}"
        now = time.time()
        artifact = Artifact(
            ref=ref,
            kind=kind,
            payload=payload,
            created_at=now,
            expires_at=now + self.ttl_seconds,
        )
        self._items[ref] = artifact
        return {
            "ref": ref,
            "kind": kind,
            "expires_in_seconds": self.ttl_seconds,
        }

    def get(self, ref: str) -> Artifact | None:
        self._purge()
        return self._items.get(ref)

    def _purge(self) -> None:
        now = time.time()
        expired = [ref for ref, item in self._items.items() if item.expires_at <= now]
        for ref in expired:
            self._items.pop(ref, None)
