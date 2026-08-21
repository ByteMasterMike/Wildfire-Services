"""Back-compat shim — DB settings live in shared.db."""

from __future__ import annotations

from shared.db import Settings, clear_settings_cache, get_settings, load_env

__all__ = ["Settings", "get_settings", "load_env", "clear_settings_cache"]
