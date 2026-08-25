"""Serve the slim frontend and sibling dataset_demo Planning Tool plots.

`python -m http.server` from frontend/ cannot resolve
``../../dataset_demo/assets/website_plots``. Browsers collapse that relative
path to ``/dataset_demo/...`` on the origin, which 404s when the server root
is ``frontend/``. This handler keeps ``/index.html`` for canvas work and maps
``/dataset_demo/`` onto the sibling checkout.

Usage (from repo root):

    python frontend/serve.py
    python frontend/serve.py --port 8765
"""

from __future__ import annotations

import argparse
import http.server
import os
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

FRONTEND_ROOT = Path(__file__).resolve().parent
REPO_ROOT = FRONTEND_ROOT.parent
SIBLING_DEMO = REPO_ROOT.parent / "dataset_demo"
PLOTS_MOUNT = "/dataset_demo"


class DualRootHandler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path: str) -> str:
        rel = unquote(urlparse(path).path)
        if rel == PLOTS_MOUNT or rel.startswith(PLOTS_MOUNT + "/"):
            suffix = rel[len(PLOTS_MOUNT) :].lstrip("/")
            demo_root = SIBLING_DEMO.resolve()
            target = (demo_root / suffix).resolve() if suffix else demo_root
            try:
                target.relative_to(demo_root)
            except ValueError:
                return str(FRONTEND_ROOT / "__forbidden__")
            return str(target)
        return super().translate_path(path)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--bind", default="127.0.0.1")
    args = parser.parse_args()

    if not SIBLING_DEMO.is_dir():
        print(
            f"warning: sibling dataset_demo not found at {SIBLING_DEMO}\n"
            "Planning Tool images will 404. Map tab still works with :8002.",
            file=sys.stderr,
        )

    os.chdir(FRONTEND_ROOT)
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    server = http.server.ThreadingHTTPServer((args.bind, args.port), DualRootHandler)
    plots = SIBLING_DEMO / "assets" / "website_plots"
    print(f"Serving frontend at http://{args.bind}:{args.port}/index.html")
    print(f"Planning plots mounted at {PLOTS_MOUNT}/ -> {plots}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
