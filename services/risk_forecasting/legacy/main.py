"""
main.py
-------
Driver script for the cNHPP wildfire baseline.

Usage:
    python main.py

Paths are set in CONFIG below. Update shp_path once gna_circuits.shp
is uploaded — that unlocks real spatial matching and proper HRRR assignment.
"""

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
from pathlib import Path

from data_prep import prepare_all
from models import fit_hpp, fit_nhpp, fit_cnhpp, comparison_table, percentile_validation


# ─────────────────────────────────────────────
# CONFIG  — update paths before running
# ─────────────────────────────────────────────

CONFIG = dict(
    dbf_path      = "data/gna_circuits.dbf",
    shp_path      = "data/gna_circuits.shp",
    midpoints_csv = "data/circuit_midpoints.csv",
    cpuc_csv      = "data/cpuc_fire_events.csv",
    weather_csv   = "data/circuit_weather.csv",   # output of prep_hrrr.py
    raw_hrrr      = False,                          # True if uploading raw HRRR grid
    start_date    = "2024-06-01",
    end_date      = "2024-08-31",
    utility       = "PG&E",
    output_dir    = "outputs/",
    xi_grid       = np.arange(0.0, 1.0, 0.1),
)

COVARIATE_NAMES = ["TMP", "SPFH", "wind_speed"]


# ─────────────────────────────────────────────
# MAIN PIPELINE
# ─────────────────────────────────────────────

def main(cfg: dict = CONFIG) -> None:
    Path(cfg["output_dir"]).mkdir(parents=True, exist_ok=True)

    # ── Data prep ────────────────────────────────────────────────────────
    data = prepare_all(
        dbf_path      = cfg["dbf_path"],
        cpuc_csv      = cfg["cpuc_csv"],
        weather_csv   = cfg["weather_csv"],
        shp_path      = cfg["shp_path"],
        midpoints_csv = cfg["midpoints_csv"],
        start_date    = cfg["start_date"],
        end_date      = cfg["end_date"],
        utility       = cfg["utility"],
        raw_hrrr      = cfg["raw_hrrr"],
    )

    circuits_df = data["circuits_df"]
    W           = data["W"]
    E           = data["E"]          # (N, T)
    X           = data["X"]          # (T, N, q+1) with intercept
    date_range  = data["date_range"]

    # ── Fit models ───────────────────────────────────────────────────────
    hpp   = fit_hpp(E)
    nhpp  = fit_nhpp(X, E)
    cnhpp = fit_cnhpp(X, E, W, xi_grid=cfg["xi_grid"])

    # ── Comparison table (mirrors paper Table 1) ──────────────────────────
    comparison_table(hpp, nhpp, cnhpp, COVARIATE_NAMES)

    # ── Percentile validation (mirrors paper Figure 6) ────────────────────
    pct_results = percentile_validation(E, hpp, nhpp, cnhpp)

    # ── Visualizations ───────────────────────────────────────────────────
    plot_xi_grid(cnhpp, save_path=cfg["output_dir"] + "xi_grid_search.png")
    plot_percentile_validation(pct_results,
                               save_path=cfg["output_dir"] + "percentile_validation.png")
    plot_coefficient_comparison(hpp, nhpp, cnhpp, COVARIATE_NAMES,
                                save_path=cfg["output_dir"] + "coefficient_comparison.png")
    plot_intensity_time_series(cnhpp.log_lambda, E, date_range,
                               save_path=cfg["output_dir"] + "intensity_time_series.png")

    print(f"\n[DONE] All outputs saved to {cfg['output_dir']}")


# ─────────────────────────────────────────────
# VISUALIZATIONS
# ─────────────────────────────────────────────

def plot_xi_grid(cnhpp, save_path: str = None):
    """Log-likelihood vs ξ — mirrors paper Figure 4."""
    fig, ax = plt.subplots(figsize=(7, 4))
    ax.plot(cnhpp.xi_grid, cnhpp.ll_grid, "o-", color="#534AB7", linewidth=2,
            markersize=6)
    ax.axvline(cnhpp.xi, color="#D85A30", linestyle="--", linewidth=1.5,
               label=f"best ξ = {cnhpp.xi:.1f}")
    ax.set_xlabel("Decay factor ξ", fontsize=12)
    ax.set_ylabel("Log-likelihood  ℓ(β̂ | ξ)", fontsize=12)
    ax.set_title("Grid search over ξ (cNHPP)", fontsize=13)
    ax.legend()
    ax.grid(True, alpha=0.3)
    plt.tight_layout()
    if save_path:
        plt.savefig(save_path, dpi=150)
        print(f"[VIZ]  Saved: {save_path}")
    plt.close()


def plot_percentile_validation(pct_results: dict, save_path: str = None):
    """Percentile rank of fire circuits — mirrors paper Figure 6."""
    fig, ax = plt.subplots(figsize=(8, 4))
    colors = {"HPP": "#888780", "NHPP": "#1D9E75", "cNHPP": "#534AB7"}

    for name, pcts in pct_results.items():
        if not pcts:
            continue
        sorted_pcts = np.sort(pcts)
        ax.plot(range(1, len(pcts)+1), sorted_pcts, "o-",
                label=name, color=colors.get(name, "gray"),
                markersize=5, linewidth=1.5)

    ax.axhline(50, color="gray", linestyle=":", linewidth=1, alpha=0.7)
    ax.set_xlabel("Event index (sorted by percentile)", fontsize=12)
    ax.set_ylabel("Percentile rank of fire circuit (%)", fontsize=12)
    ax.set_title("Validation: where did fires occur in the predicted intensity rank?",
                 fontsize=12)
    ax.legend()
    ax.set_ylim(0, 105)
    ax.grid(True, alpha=0.3)
    plt.tight_layout()
    if save_path:
        plt.savefig(save_path, dpi=150)
        print(f"[VIZ]  Saved: {save_path}")
    plt.close()


def plot_coefficient_comparison(hpp, nhpp, cnhpp, covariate_names: list,
                                 save_path: str = None):
    """Bar chart of β coefficients across models."""
    names = ["intercept"] + covariate_names
    q = len(names)
    x = np.arange(q)
    width = 0.28

    fig, ax = plt.subplots(figsize=(9, 4))
    ax.bar(x - width, [np.nan] + [np.nan]*(q-1), width, label="HPP (N/A)",
           color="#D3D1C7")
    ax.bar(x,       nhpp.beta[:q],  width, label="NHPP",  color="#1D9E75")
    ax.bar(x + width, cnhpp.beta[:q], width, label="cNHPP", color="#534AB7")

    ax.set_xticks(x)
    ax.set_xticklabels(names, rotation=20, ha="right")
    ax.set_ylabel("Estimated coefficient β", fontsize=12)
    ax.set_title("Coefficient comparison across models", fontsize=13)
    ax.axhline(0, color="black", linewidth=0.8)
    ax.legend()
    ax.grid(True, axis="y", alpha=0.3)
    plt.tight_layout()
    if save_path:
        plt.savefig(save_path, dpi=150)
        print(f"[VIZ]  Saved: {save_path}")
    plt.close()


def plot_intensity_time_series(log_lambda: np.ndarray,
                                E: np.ndarray,
                                date_range: pd.DatetimeIndex,
                                n_sample: int = 20,
                                save_path: str = None):
    """
    Plot estimated daily intensity distribution (percentiles across circuits)
    with observed fire events overlaid — mirrors paper Figure 5.
    """
    N, T = log_lambda.shape
    intensity = np.exp(log_lambda)   # convert to rate space

    p10  = np.percentile(intensity, 10,  axis=0)
    p50  = np.percentile(intensity, 50,  axis=0)
    p90  = np.percentile(intensity, 90,  axis=0)
    mean = intensity.mean(axis=0)

    event_days = np.where(E.sum(axis=0) > 0)[0]

    fig, ax = plt.subplots(figsize=(12, 4))
    ax.fill_between(date_range, p10, p90, alpha=0.2, color="#534AB7",
                    label="10–90th pct (circuits)")
    ax.plot(date_range, p50,  color="#534AB7", linewidth=1.5, label="Median intensity")
    ax.plot(date_range, mean, color="#D85A30", linewidth=1,  linestyle="--",
            label="Mean intensity")

    for t_idx in event_days:
        ax.axvline(date_range[t_idx], color="#3B8BD4", alpha=0.5,
                   linewidth=0.8, linestyle=":")

    ax.set_xlabel("Date", fontsize=12)
    ax.set_ylabel("Estimated fire intensity λ(i,t)", fontsize=12)
    ax.set_title("cNHPP: estimated intensity distribution over time", fontsize=13)
    ax.legend(fontsize=10)
    ax.grid(True, alpha=0.3)
    plt.tight_layout()
    if save_path:
        plt.savefig(save_path, dpi=150)
        print(f"[VIZ]  Saved: {save_path}")
    plt.close()


# ─────────────────────────────────────────────
if __name__ == "__main__":
    main()
