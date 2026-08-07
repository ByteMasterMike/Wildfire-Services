"""Rebuild the 4-connected grid adjacency matrix from grid_cells.csv."""

from __future__ import annotations

import pickle
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix, lil_matrix

from services.risk_forecasting.config import GRID_SPACING_DEG


def build_grid_adjacency(
    grid_df: pd.DataFrame,
    spacing: float = GRID_SPACING_DEG,
) -> csr_matrix:
    """
    Snap each cell to integer (row, col) using ``spacing`` degrees, connect
    N/S/E/W neighbors that exist plus a self-loop, then row-normalize so each
    row sums to 1.0.
    """
    if "lat" not in grid_df.columns or "lon" not in grid_df.columns:
        raise ValueError("grid_df must contain lat and lon columns")

    lat = grid_df["lat"].to_numpy(dtype=np.float64)
    lon = grid_df["lon"].to_numpy(dtype=np.float64)
    n = len(grid_df)

    lat0 = lat.min()
    lon0 = lon.min()
    rows = np.rint((lat - lat0) / spacing).astype(np.int32)
    cols = np.rint((lon - lon0) / spacing).astype(np.int32)

    coord_to_idx = {(int(r), int(c)): i for i, (r, c) in enumerate(zip(rows, cols))}
    if len(coord_to_idx) != n:
        raise ValueError(
            f"Grid snap collision: {n} cells mapped to {len(coord_to_idx)} "
            f"unique (row,col) with spacing={spacing}"
        )

    w = lil_matrix((n, n), dtype=np.float64)
    deltas = [(0, 0), (-1, 0), (1, 0), (0, -1), (0, 1)]  # self + N/S/W/E

    for i, (r, c) in enumerate(zip(rows, cols)):
        for dr, dc in deltas:
            j = coord_to_idx.get((int(r + dr), int(c + dc)))
            if j is not None:
                w[i, j] = 1.0

    # Row-normalize
    w = w.tocsr()
    row_sums = np.asarray(w.sum(axis=1)).ravel()
    if np.any(row_sums <= 0):
        raise ValueError("Adjacency has empty rows; cannot row-normalize")
    inv = 1.0 / row_sums
    w = w.multiply(inv[:, np.newaxis]).tocsr()
    return w


def rebuild_and_cache_adjacency(
    grid_csv: Path,
    out_pkl: Path,
    spacing: float = GRID_SPACING_DEG,
) -> csr_matrix:
    """Build W from grid_cells.csv, print sanity stats, cache to disk."""
    grid_csv = Path(grid_csv)
    out_pkl = Path(out_pkl)

    if not grid_csv.is_file():
        raise FileNotFoundError(f"Missing grid CSV: {grid_csv}")

    print(f"[ADJ] Loading grid from {grid_csv} ...")
    grid = pd.read_csv(grid_csv).sort_values("cell_id").reset_index(drop=True)
    print(f"[ADJ]   {len(grid)} cells")

    print(f"[ADJ] Rebuilding adjacency (spacing={spacing} deg) ...")
    w = build_grid_adjacency(grid, spacing=spacing)

    nnz = int(w.nnz)
    avg_neighbors = nnz / w.shape[0] - 1.0  # exclude self-loop
    print(f"[ADJ]   W shape={w.shape[0]}x{w.shape[1]}")
    print(f"[ADJ]   nnz={nnz}  (expected ~3922)")
    print(f"[ADJ]   avg neighbors={avg_neighbors:.1f}  (expected ~3.8)")

    out_pkl.parent.mkdir(parents=True, exist_ok=True)
    with open(out_pkl, "wb") as f:
        pickle.dump(w, f)
    print(f"[ADJ] Cached to {out_pkl}")
    return w


if __name__ == "__main__":
    from services.risk_forecasting.config import GRID_CSV, GRID_W_PKL

    rebuild_and_cache_adjacency(GRID_CSV, GRID_W_PKL)
