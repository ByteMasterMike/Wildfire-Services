"""
HPP vs NHPP vs cNHPP on corrected data.

Fit on train years (default 2020-2023, Dec 2-31 2020 excluded).
Report train and out-of-sample (default 2024) Poisson log-likelihoods.

cNHPP xi is selected by *training* LL (same as models.fit_cnhpp) so the
OOS comparison does not give cNHPP a validation-tuning advantage.
"""

from __future__ import annotations

import sys
import pickle

import numpy as np
from scipy.sparse import csr_matrix

from services.risk_forecasting import grid_data_prep as gdp
from services.risk_forecasting.config import (
    DATA_DIR,
    GRID_CSV,
    GRID_W_PKL,
    train_years_from_env,
)
from services.risk_forecasting.fit_model import (
    _require_file,
    _standardize,
    load_events,
    load_year_bundle,
    val_year_from_env,
)
from services.risk_forecasting.models import (
    _mrnn_forward,
    fit_cnhpp,
    fit_hpp,
    fit_nhpp,
    poisson_ll,
)


def main() -> None:
    train_years = train_years_from_env()
    val_year = val_year_from_env()
    print("=" * 60)
    print("HPP / NHPP / cNHPP COMPARISON")
    print("train_years=", train_years, " val_year=", val_year)
    print("=" * 60)

    grid_df = gdp.load_grid(str(_require_file(GRID_CSV, "grid_cells.csv")))
    with open(GRID_W_PKL, "rb") as f:
        w = pickle.load(f)
    if not isinstance(w, csr_matrix):
        w = csr_matrix(w)

    events = load_events(DATA_DIR, list(train_years) + [val_year], grid_df)

    train_x, train_e, train_d = [], [], []
    for year in train_years:
        x, e, d = load_year_bundle(DATA_DIR, year, grid_df, events)
        train_x.append(x)
        train_e.append(e)
        train_d.append(d)

    x_train_raw = np.concatenate(train_x, axis=0)
    e_train = np.concatenate(train_e, axis=1)
    x_val_raw, e_val, _ = load_year_bundle(DATA_DIR, val_year, grid_df, events)

    x_train, means, stds = _standardize(x_train_raw)
    x_val, _, _ = _standardize(x_val_raw, means=means, stds=stds)

    print(
        f"[DATA] TRAIN T={x_train.shape[0]} events={int(e_train.sum())}  "
        f"VAL T={x_val.shape[0]} events={int(e_val.sum())}"
    )

    # ── Fit ─────────────────────────────────────────────────────────────
    print("\n[FIT] HPP ...")
    hpp = fit_hpp(e_train)

    print("\n[FIT] NHPP ...")
    nhpp = fit_nhpp(x_train, e_train)

    print("\n[FIT] cNHPP (xi by train LL) ...")
    cnhpp = fit_cnhpp(x_train, e_train, w)

    # ── Out-of-sample forward passes ────────────────────────────────────
    # HPP: constant lambda from train
    hpp_val_ll = poisson_ll(
        np.full(e_val.shape, np.log(hpp.lambda_hat), dtype=np.float32),
        e_val,
    )
    hpp_train_ll = hpp.log_likelihood

    # NHPP: X_val @ beta
    nhpp_val_h = (x_val @ nhpp.beta).T  # (N, T)
    nhpp_val_ll = poisson_ll(nhpp_val_h, e_val)
    nhpp_train_ll = nhpp.log_likelihood

    # cNHPP: mRNN on val with train-fit xi/beta
    cnhpp_val_h = _mrnn_forward(cnhpp.xi, cnhpp.beta, x_val, w).T  # (N, T)
    cnhpp_val_ll = poisson_ll(cnhpp_val_h, e_val)
    cnhpp_train_ll = cnhpp.log_likelihood

    # Also score deployed val-selected xi=0.2 if env asks (optional note)
    print("\n" + "=" * 60)
    print("RESULTS  (Poisson log-likelihood; higher is better)")
    print("=" * 60)
    header = f"{'model':10s}  {'train LL':>12s}  {'val LL (OOS)':>12s}  {'notes'}"
    print(header)
    print("-" * len(header))
    print(
        f"{'HPP':10s}  {hpp_train_ll:12.3f}  {hpp_val_ll:12.3f}  "
        f"λ={hpp.lambda_hat:.6e}"
    )
    print(
        f"{'NHPP':10s}  {nhpp_train_ll:12.3f}  {nhpp_val_ll:12.3f}  "
        f"β={np.round(nhpp.beta, 3)}"
    )
    print(
        f"{'cNHPP':10s}  {cnhpp_train_ll:12.3f}  {cnhpp_val_ll:12.3f}  "
        f"ξ={cnhpp.xi:.1f} (train-selected) β={np.round(cnhpp.beta, 3)}"
    )

    delta_train = cnhpp_train_ll - nhpp_train_ll
    delta_val = cnhpp_val_ll - nhpp_val_ll
    print("-" * len(header))
    print(f"cNHPP − NHPP   train ΔLL = {delta_train:+.3f}")
    print(f"cNHPP − NHPP   val   ΔLL = {delta_val:+.3f}")
    if abs(delta_val) < 1.0:
        print("Verdict: cNHPP ≈ NHPP on OOS LL (tie within 1 nat).")
    elif delta_val > 0:
        print("Verdict: cNHPP improves OOS LL vs NHPP.")
    else:
        print("Verdict: NHPP improves OOS LL vs cNHPP.")

    # Persist a small summary for the repo
    out = DATA_DIR.parent / "outputs" / "model_comparison.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        f.write("model,train_ll,val_ll,xi,notes\n")
        f.write(f"HPP,{hpp_train_ll},{hpp_val_ll},,{hpp.lambda_hat}\n")
        f.write(f"NHPP,{nhpp_train_ll},{nhpp_val_ll},,\"{list(np.round(nhpp.beta,4))}\"\n")
        f.write(
            f"cNHPP,{cnhpp_train_ll},{cnhpp_val_ll},{cnhpp.xi},"
            f"\"train-selected; beta={list(np.round(cnhpp.beta,4))}\"\n"
        )
    print(f"\n[OUT] Wrote {out}")


if __name__ == "__main__":
    try:
        main()
    except (FileNotFoundError, ValueError) as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        sys.exit(1)
