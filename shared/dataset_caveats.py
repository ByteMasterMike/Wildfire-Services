"""Dataset definitions shared by agent qualifications, cards and browser exports."""

import json
from pathlib import Path

DATASET_CAVEATS: dict[str, str] = json.loads(
    Path(__file__).with_suffix(".json").read_text(encoding="utf-8")
)
