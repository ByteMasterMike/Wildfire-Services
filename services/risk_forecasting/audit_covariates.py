"""Audit train covariates for corruption before refitting."""

from __future__ import annotations

import calendar
import json
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd

from services.risk_forecasting import grid_data_prep as gdp
from services.risk_forecasting.config import DATA_DIR, GRID_CSV

COVS = ["TMP", "SPFH", "wind_speed", "NDVI", "fm100"]
TRAIN_YEARS = [2020, 2021, 2022, 2023]


def load_year_raw(year: int, grid_df: pd.DataFrame):
    days = 366 if calendar.isleap(year) else 365
    dr = pd.date_range(f"{year}-01-01", periods=days, freq="D")
    wx = gdp.load_weather_for_year(
        str(DATA_DIR / f"grid_weather_{year}.csv"), dr, grid_df
    )
    veg = gdp.load_vegetation_for_year(
        str(DATA_DIR / f"daily_gridded_CA_{year}.nc"), dr, grid_df
    )
    return gdp.build_covariate_matrix(wx, veg), dr


def col_stats(arr: np.ndarray, name: str) -> dict:
    flat = arr.ravel()
    finite = flat[np.isfinite(flat)]
    return {
        "cov": name,
        "min": float(finite.min()) if finite.size else None,
        "max": float(finite.max()) if finite.size else None,
        "mean": float(np.nanmean(flat)),
        "std": float(np.nanstd(flat)),
        "n": int(flat.size),
        "nan": int(np.isnan(flat).sum()),
        "inf": int(np.isinf(flat).sum()),
        "zero": int(np.sum(flat == 0)),
        "neg": int(np.sum(np.isfinite(flat) & (flat < 0))),
        "below_200K": int(np.sum(np.isfinite(flat) & (flat < 200)))
        if name == "TMP"
        else None,
    }


def main() -> None:
    grid = gdp.load_grid(str(GRID_CSV))
    n = len(grid)

    by_year = {}
    chunks = []
    for year in TRAIN_YEARS:
        x, dr = load_year_raw(year, grid)
        by_year[year] = {"X": x, "dr": dr}
        chunks.append(x)
        print(f"[AUDIT] loaded {year} shape={x.shape}")

    x_all = np.concatenate(chunks, axis=0)

    print("\n=== FULL TRAIN RAW (pre-standardize, no intercept) ===")
    overall = []
    for i, cov in enumerate(COVS):
        s = col_stats(x_all[:, :, i], cov)
        overall.append(s)
        print(
            f"{cov:12s} min={s['min']:.6g} max={s['max']:.6g} "
            f"mean={s['mean']:.6g} std={s['std']:.6g} "
            f"nan={s['nan']} zero={s['zero']} neg={s['neg']}"
            + (f" below_200K={s['below_200K']}" if cov == "TMP" else "")
        )

    print("\n=== BY YEAR ===")
    yearly = []
    for year in TRAIN_YEARS:
        x = by_year[year]["X"]
        for i, cov in enumerate(COVS):
            s = col_stats(x[:, :, i], cov)
            s["year"] = year
            yearly.append(s)
            extra = f" below_200K={s['below_200K']}" if cov == "TMP" else ""
            print(
                f"{year} {cov:12s} min={s['min']:.6g} max={s['max']:.6g} "
                f"mean={s['mean']:.6g} std={s['std']:.6g} "
                f"nan={s['nan']} zero={s['zero']} neg={s['neg']}{extra}"
            )

    print("\n=== DECEMBER 2020 TMP (loader output) ===")
    x20, dr20 = by_year[2020]["X"], by_year[2020]["dr"]
    dec_mask = dr20.month == 12
    dec_tmp = x20[dec_mask, :, 0]
    print(
        f"days={int(dec_mask.sum())} min={np.nanmin(dec_tmp):.4f} "
        f"max={np.nanmax(dec_tmp):.4f} mean={np.nanmean(dec_tmp):.4f} "
        f"std={np.nanstd(dec_tmp):.4f} nan={np.isnan(dec_tmp).sum()} "
        f"zero={np.sum(dec_tmp == 0)} below_200K={np.sum(dec_tmp < 200)}"
    )
    daily = []
    for d, day_slice in zip(dr20[dec_mask], dec_tmp):
        row = {
            "date": str(d.date()),
            "mean": float(np.nanmean(day_slice)),
            "min": float(np.nanmin(day_slice)),
            "max": float(np.nanmax(day_slice)),
            "zero": int(np.sum(day_slice == 0)),
            "nan": int(np.isnan(day_slice).sum()),
            "below_200K": int(np.sum(day_slice < 200)),
        }
        daily.append(row)
        print(
            f"  {row['date']} mean={row['mean']:.3f} min={row['min']:.3f} "
            f"max={row['max']:.3f} zero={row['zero']} nan={row['nan']} "
            f"below_200K={row['below_200K']}"
        )

    print("\n=== 2020 TMP MONTHLY ===")
    monthly_2020 = []
    for month in range(1, 13):
        msk = dr20.month == month
        sl = x20[msk, :, 0]
        row = {
            "month": month,
            "mean": float(np.nanmean(sl)),
            "min": float(np.nanmin(sl)),
            "max": float(np.nanmax(sl)),
            "zero": int(np.sum(sl == 0)),
            "nan": int(np.isnan(sl).sum()),
            "below_200K": int(np.sum(sl < 200)),
        }
        monthly_2020.append(row)
        print(
            f"  {month:02d} mean={row['mean']:.3f} min={row['min']:.3f} "
            f"max={row['max']:.3f} zero={row['zero']} nan={row['nan']} "
            f"below_200K={row['below_200K']}"
        )

    print("\n=== CELLS MISSING OR CONSTANT PER YEAR ===")
    issues = []
    for year in TRAIN_YEARS:
        x = by_year[year]["X"]
        t = x.shape[0]
        for i, cov in enumerate(COVS):
            for cell_i in range(n):
                series = x[:, cell_i, i]
                n_nan = int(np.isnan(series).sum())
                finite = series[np.isfinite(series)]
                cell_id = int(grid.cell_id.iloc[cell_i])
                if n_nan == t:
                    issues.append(
                        {
                            "year": year,
                            "cell_id": cell_id,
                            "cov": cov,
                            "issue": "all_nan",
                            "n_nan": n_nan,
                            "std": None,
                            "const_val": None,
                        }
                    )
                elif finite.size > 0:
                    s = float(np.std(finite))
                    if s == 0.0:
                        issues.append(
                            {
                                "year": year,
                                "cell_id": cell_id,
                                "cov": cov,
                                "issue": "constant",
                                "n_nan": n_nan,
                                "std": s,
                                "const_val": float(finite[0]),
                            }
                        )
                    elif n_nan / t >= 0.1:
                        issues.append(
                            {
                                "year": year,
                                "cell_id": cell_id,
                                "cov": cov,
                                "issue": "partial_nan",
                                "n_nan": n_nan,
                                "std": s,
                                "const_val": None,
                            }
                        )

    print(f"total issue records: {len(issues)}")
    print("by issue/cov:", Counter((x["issue"], x["cov"]) for x in issues))
    all_nan = [x for x in issues if x["issue"] == "all_nan"]
    print(
        "unique cells with any all_nan:",
        sorted({x["cell_id"] for x in all_nan}),
    )
    print("ALL_NAN detail:")
    for x in all_nan:
        print(" ", x)

    const_weather = [
        x
        for x in issues
        if x["issue"] == "constant" and x["cov"] in ("TMP", "SPFH", "wind_speed")
    ]
    print(f"CONSTANT weather rows: {len(const_weather)}")
    for x in const_weather[:40]:
        print(" ", x)

    const_veg = [
        x for x in issues if x["issue"] == "constant" and x["cov"] in ("NDVI", "fm100")
    ]
    print(f"CONSTANT veg rows: {len(const_veg)}")
    # summarize constant veg by whether suspicious
    if const_veg:
        vals = Counter(
            (x["cov"], round(x["const_val"], 6) if x["const_val"] is not None else None)
            for x in const_veg
        )
        print(" constant veg value histogram (top 20):", vals.most_common(20))

    print("\n=== STANDARDIZATION CHECK ===")
    print("gdp.ALL_COVS:", gdp.ALL_COVS)
    print("gdp.WEATHER_COVS:", gdp.WEATHER_COVS)
    print("gdp.VEG_COVS:", gdp.VEG_COVS)
    assert list(gdp.ALL_COVS) == COVS

    flat = x_all.reshape(-1, 5)
    means = np.nanmean(flat, axis=0)
    stds = np.nanstd(flat, axis=0)
    stds[stds == 0] = 1.0
    x_filled = x_all.copy()
    for k in range(5):
        mask = ~np.isfinite(x_filled[:, :, k])
        if mask.any():
            x_filled[:, :, k][mask] = means[k]
    x_std = ((x_filled - means) / stds).astype(np.float32)
    ones = np.ones((*x_std.shape[:2], 1), dtype=np.float32)
    x_final = np.concatenate([ones, x_std], axis=2)

    print("X_final shape:", x_final.shape, "(expect T,N,6)")
    print("means length:", len(means), "(must be 5)")
    print("intercept unique values:", np.unique(x_final[:, :, 0]))
    print(
        "intercept mean/std:",
        float(x_final[:, :, 0].mean()),
        float(x_final[:, :, 0].std()),
    )
    post_means = {}
    post_stds = {}
    for i, cov in enumerate(COVS):
        col = x_final[:, :, i + 1]
        post_means[cov] = float(col.mean())
        post_stds[cov] = float(col.std())
        print(
            f"  std col {i + 1} {cov}: mean={post_means[cov]:.6f} "
            f"std={post_stds[cov]:.6f}"
        )

    print("\n=== RAW CSV SPOT CHECK Dec 2020 TMP ===")
    wx = pd.read_csv(DATA_DIR / "grid_weather_2020.csv", parse_dates=["date"])
    dec = wx[wx["date"].dt.month == 12]
    print(dec["TMP"].describe())
    print(
        "raw Dec zero=",
        int((dec["TMP"] == 0).sum()),
        "nan=",
        int(dec["TMP"].isna().sum()),
        "below_200=",
        int((dec["TMP"] < 200).sum()),
    )
    wx["month"] = wx["date"].dt.month
    for month, g in wx.groupby("month"):
        z = int((g["TMP"] == 0).sum())
        b = int((g["TMP"] < 200).sum())
        if z or b:
            print(
                f"raw month {month}: zero={z} below_200={b} "
                f"mean={g['TMP'].mean():.3f}"
            )

    # Correlation sanity: TMP vs events (point-biserial-ish) and SPFH
    print("\n=== QUICK ASSOCIATION SANITY (train, cell-day) ===")
    # rebuild E cheaply from events
    frames = []
    for year in TRAIN_YEARS:
        frames.append(gdp.load_fire_events(str(DATA_DIR / f"events_{year}.csv")))
    events = gdp.snap_events_to_grid(pd.concat(frames, ignore_index=True), grid)
    e_list = []
    for year in TRAIN_YEARS:
        dr = by_year[year]["dr"]
        ev_yr = events[events["datetime"].dt.year == year]
        e_list.append(gdp.build_event_matrix(ev_yr, n, dr))
    e_all = np.concatenate(e_list, axis=1)  # N,T
    e_tn = e_all.T  # T,N
    associations = {}
    for i, cov in enumerate(COVS):
        xv = x_filled[:, :, i].ravel()
        yv = e_tn.ravel().astype(np.float64)
        # point-biserial / pearson with event indicator
        y_bin = (yv > 0).astype(np.float64)
        if xv.std() > 0 and y_bin.std() > 0:
            corr = float(np.corrcoef(xv, y_bin)[0, 1])
        else:
            corr = None
        associations[cov] = corr
        print(f"  corr({cov}, event>0) = {corr}")

    out = {
        "overall": overall,
        "yearly": yearly,
        "dec2020_tmp": {
            "min": float(np.nanmin(dec_tmp)),
            "max": float(np.nanmax(dec_tmp)),
            "mean": float(np.nanmean(dec_tmp)),
            "std": float(np.nanstd(dec_tmp)),
            "nan": int(np.isnan(dec_tmp).sum()),
            "zero": int(np.sum(dec_tmp == 0)),
            "below_200K": int(np.sum(dec_tmp < 200)),
            "daily": daily,
        },
        "monthly_2020_tmp": monthly_2020,
        "issues_summary": {
            "n_issues": len(issues),
            "counts": {f"{a}/{b}": c for (a, b), c in Counter((x["issue"], x["cov"]) for x in issues).items()},
            "all_nan_cells": sorted({x["cell_id"] for x in all_nan}),
            "all_nan": all_nan,
            "n_constant_weather": len(const_weather),
            "constant_weather": const_weather[:50],
            "n_constant_veg": len(const_veg),
        },
        "standardization": {
            "cov_order": COVS,
            "gdp_all_covs": list(gdp.ALL_COVS),
            "means": {c: float(means[i]) for i, c in enumerate(COVS)},
            "stds": {c: float(stds[i]) for i, c in enumerate(COVS)},
            "means_len": int(len(means)),
            "intercept_unique": [float(v) for v in np.unique(x_final[:, :, 0])],
            "post_std_means": post_means,
            "post_std_stds": post_stds,
        },
        "event_associations": associations,
    }

    out_path = Path("services/risk_forecasting/outputs/covariate_audit.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"\n[AUDIT] Wrote {out_path}")


if __name__ == "__main__":
    main()
