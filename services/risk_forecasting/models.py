"""
models.py
---------
Three stacked Poisson-process baselines, following Zhu et al. (2023):

  HPP    : Homogeneous Poisson Process — constant rate everywhere.
  NHPP   : Non-Homogeneous PP — log-linear in current covariates only.
  cNHPP  : Convolutional NHPP — adds spatial-temporal memory via ξW recurrence.

All models share the same log-likelihood form:
  ℓ(θ) = Σ_{i,t: event} log λ(i,t)  −  Σ_{i,t} λ(i,t) · Δ
       = Σ_{i,t: event} h(i,t)       −  Σ_{i,t} exp(h(i,t))
where h(i,t) = log λ(i,t) and Δ=1 day cancels in the discrete case.

The cNHPP uses the mRNN recurrence (faster than explicit W^k computation):
  h(t) = ξ · W · h(t−1)  +  X(t) · β
which is equivalent to the truncated series for any K.

Paper reference: arxiv.org/abs/2301.00067
"""

import numpy as np
import scipy.sparse as sp
from scipy.optimize import minimize
from dataclasses import dataclass, field
from typing import Optional, Tuple
import warnings

warnings.filterwarnings("ignore")


# ─────────────────────────────────────────────
# SHARED LOG-LIKELIHOOD
# ─────────────────────────────────────────────

def poisson_nll(log_lambda: np.ndarray, E: np.ndarray) -> float:
    """
    Negative Poisson log-likelihood.

    Args:
        log_lambda : (N, T) array of log-intensities
        E          : (N, T) integer event count matrix
    Returns:
        scalar NLL = −Σ_{i,t:event} h(i,t) + Σ_{i,t} exp(h(i,t))
    """
    return float(-np.sum(log_lambda * E) + np.sum(np.exp(log_lambda)))


def poisson_ll(log_lambda: np.ndarray, E: np.ndarray) -> float:
    return -poisson_nll(log_lambda, E)


# ─────────────────────────────────────────────
# 1. HPP — HOMOGENEOUS POISSON PROCESS
# ─────────────────────────────────────────────

@dataclass
class HPPResult:
    lambda_hat: float        # constant event rate (events / circuit / day)
    log_lambda: np.ndarray   # (N, T) — constant everywhere
    log_likelihood: float


def fit_hpp(E: np.ndarray) -> HPPResult:
    """
    HPP closed-form MLE: λ̂ = total_events / (N × T).
    All circuits get the same constant intensity.
    """
    print("[HPP] Fitting homogeneous baseline ...")
    N, T = E.shape
    total_events = E.sum()
    lambda_hat = float(total_events) / (N * T)

    log_lambda = np.full((N, T), np.log(lambda_hat), dtype=np.float32)
    ll = poisson_ll(log_lambda, E)

    print(f"[HPP]   λ̂ = {lambda_hat:.6e}  |  log-likelihood = {ll:.3f}")
    return HPPResult(lambda_hat=lambda_hat, log_lambda=log_lambda,
                     log_likelihood=ll)


# ─────────────────────────────────────────────
# 2. NHPP — NON-HOMOGENEOUS PP (current covariates only)
# ─────────────────────────────────────────────

@dataclass
class NHPPResult:
    beta: np.ndarray         # (q+1,) coefficient vector
    log_lambda: np.ndarray   # (N, T)
    log_likelihood: float
    converged: bool


def _nhpp_objective(beta: np.ndarray, X: np.ndarray, E: np.ndarray):
    """
    NLL and gradient for NHPP.
    X: (T, N, q+1), beta: (q+1,), E: (N, T).

    log λ(i,t) = X[t, i, :] @ beta
    grad = −Σ_{i,t:event} X[t,i,:] + Σ_{i,t} exp(h(i,t)) × X[t,i,:]
    """
    T, N, qp1 = X.shape
    # h[t, i] = X[t, i, :] @ beta  →  shape (T, N)
    h = X @ beta                           # (T, N)
    exp_h = np.exp(np.clip(h, -20, 20))   # clip for numerical stability

    E_T = E.T                              # (T, N) to match h
    nll = -np.sum(h * E_T) + np.sum(exp_h)

    # gradient w.r.t. beta: sum over i,t of (exp_h - event) * X[t,i,:]
    resid = exp_h - E_T                    # (T, N)
    grad = np.einsum("tn,tnk->k", resid, X)   # (q+1,)

    return float(nll), grad.astype(np.float64)


def fit_nhpp(X: np.ndarray, E: np.ndarray,
             beta_init: Optional[np.ndarray] = None) -> NHPPResult:
    """
    NHPP: log λ(i,t) = X[t,i,:] @ β.
    Maximise log-likelihood via L-BFGS-B (concave in β → global optimum).
    X: (T, N, q+1), E: (N, T).
    """
    print("[NHPP] Fitting non-homogeneous baseline (L-BFGS-B) ...")
    T, N, qp1 = X.shape
    if beta_init is None:
        beta_init = np.zeros(qp1)

    result = minimize(
        _nhpp_objective,
        beta_init,
        args=(X, E),
        method="L-BFGS-B",
        jac=True,
        options={"maxiter": 1000, "ftol": 1e-10, "gtol": 1e-6},
    )

    beta = result.x
    h = (X @ beta).T              # (N, T)
    ll = poisson_ll(h, E)

    print(f"[NHPP]   β = {np.round(beta, 4)}  |  log-likelihood = {ll:.3f}  "
          f"|  converged={result.success}")
    return NHPPResult(beta=beta, log_lambda=h.astype(np.float32),
                      log_likelihood=ll, converged=result.success)


# ─────────────────────────────────────────────
# 3. cNHPP — CONVOLUTIONAL NHPP  (mRNN form)
# ─────────────────────────────────────────────

@dataclass
class CNHPPResult:
    xi: float                # decay factor (best from grid search)
    beta: np.ndarray         # (q+1,) covariate coefficients
    log_lambda: np.ndarray   # (N, T) estimated log-intensities
    log_likelihood: float
    xi_grid: np.ndarray      # all ξ values evaluated
    ll_grid: np.ndarray      # corresponding log-likelihoods
    converged: bool


def _mrnn_forward(
    xi: float,
    beta: np.ndarray,
    X: np.ndarray,
    W: sp.csr_matrix,
) -> np.ndarray:
    """
    mRNN forward pass: h(t) = ξ·W·h(t−1) + X(t)·β.
    Returns log_lambda of shape (T, N).
    """
    T, N, _ = X.shape
    h = np.zeros(N, dtype=np.float64)
    log_lambda = np.empty((T, N), dtype=np.float64)

    for t in range(T):
        h = xi * (W @ h) + X[t] @ beta
        log_lambda[t] = h

    return log_lambda


def _cnhpp_objective(
    beta: np.ndarray,
    xi: float,
    X: np.ndarray,
    W: sp.csr_matrix,
    E: np.ndarray,
):
    """
    NLL and gradient for cNHPP with fixed ξ.
    Uses BPTT (back-prop through time) for the gradient w.r.t. β.

    BPTT recurrence (from paper Section 2.3):
      δ(T) = ∂ℓ/∂h(T) = exp(h(T)) − E[:,T]
      δ(t) = ∂ℓ/∂h(t) = (exp(h(t)) − E[:,t]) + ξ·Wᵀ·δ(t+1)
      ∂ℓ/∂β = Σ_t  X[t]ᵀ · δ(t)
    """
    T, N, qp1 = X.shape
    beta = beta.astype(np.float64)

    # ── forward pass ──────────────────────────────────────────────────────
    log_lambda = _mrnn_forward(xi, beta, X, W)   # (T, N)
    exp_h = np.exp(np.clip(log_lambda, -20, 20))

    E_T = E.T   # (T, N)
    nll = float(-np.sum(log_lambda * E_T) + np.sum(exp_h))

    # ── backward pass (BPTT) ──────────────────────────────────────────────
    delta = np.zeros(N, dtype=np.float64)
    grad_beta = np.zeros(qp1, dtype=np.float64)

    for t in range(T - 1, -1, -1):
        delta = (exp_h[t] - E_T[t]) + xi * (W.T @ delta)
        grad_beta += X[t].T @ delta   # (qp1, N) @ (N,) → (qp1,)

    return nll, grad_beta


def fit_cnhpp(
    X: np.ndarray,
    E: np.ndarray,
    W: sp.csr_matrix,
    xi_grid: Optional[np.ndarray] = None,
    beta_init: Optional[np.ndarray] = None,
    verbose: bool = True,
) -> CNHPPResult:
    """
    cNHPP: grid-search over ξ ∈ xi_grid, for each ξ maximise log-likelihood
    over β via L-BFGS-B with BPTT gradients.
    Returns result for the best ξ.
    """
    if xi_grid is None:
        xi_grid = np.arange(0.0, 1.0, 0.1)

    T, N, qp1 = X.shape
    if beta_init is None:
        beta_init = np.zeros(qp1)

    print(f"[cNHPP] Grid search over ξ ∈ {np.round(xi_grid, 1)} ...")

    best_ll   = -np.inf
    best_xi   = 0.0
    best_beta = beta_init.copy()
    best_conv = False
    ll_grid   = np.full(len(xi_grid), np.nan)

    for k, xi in enumerate(xi_grid):
        result = minimize(
            _cnhpp_objective,
            beta_init,
            args=(float(xi), X, W, E),
            method="L-BFGS-B",
            jac=True,
            options={"maxiter": 500, "ftol": 1e-9, "gtol": 1e-5},
        )
        beta_k = result.x
        h_k    = _mrnn_forward(float(xi), beta_k, X, W)   # (T, N)
        ll_k   = poisson_ll(h_k.T, E)
        ll_grid[k] = ll_k

        if verbose:
            print(f"[cNHPP]   ξ={xi:.1f}  ll={ll_k:.2f}  "
                  f"β={np.round(beta_k, 3)}  ok={result.success}")

        if ll_k > best_ll:
            best_ll   = ll_k
            best_xi   = xi
            best_beta = beta_k.copy()
            best_conv = result.success

    # Final forward pass with best parameters
    log_lambda = _mrnn_forward(best_xi, best_beta, X, W)   # (T, N)

    print(f"\n[cNHPP] Best: ξ={best_xi:.1f}  log-likelihood={best_ll:.3f}")
    return CNHPPResult(
        xi=best_xi,
        beta=best_beta,
        log_lambda=log_lambda.T.astype(np.float32),   # (N, T)
        log_likelihood=best_ll,
        xi_grid=xi_grid,
        ll_grid=ll_grid,
        converged=best_conv,
    )


# ─────────────────────────────────────────────
# 4. COMPARISON TABLE  (mirrors Table 1 in paper)
# ─────────────────────────────────────────────

def comparison_table(
    hpp: HPPResult,
    nhpp: NHPPResult,
    cnhpp: CNHPPResult,
    covariate_names: list[str],
) -> None:
    """Print a summary table matching the paper's Table 1."""
    coef_names = ["intercept"] + covariate_names

    header = f"{'':20s}  {'HPP':>10}  {'NHPP':>10}  {'cNHPP':>10}"
    sep    = "─" * len(header)
    print(f"\n{sep}\n{header}\n{sep}")

    print(f"{'log-likelihood':20s}  {hpp.log_likelihood:10.3f}  "
          f"{nhpp.log_likelihood:10.3f}  {cnhpp.log_likelihood:10.3f}")

    print(f"{'ξ (decay)':20s}  {'—':>10}  {'—':>10}  {cnhpp.xi:10.1f}")

    for k, name in enumerate(coef_names):
        nhpp_val  = nhpp.beta[k]  if k < len(nhpp.beta)  else float("nan")
        cnhpp_val = cnhpp.beta[k] if k < len(cnhpp.beta) else float("nan")
        hpp_val   = hpp.lambda_hat if name == "intercept" else float("nan")
        hpp_str   = f"{hpp_val:.3e}" if name == "intercept" else "—"
        print(f"  {name:18s}  {hpp_str:>10}  {nhpp_val:10.4f}  {cnhpp_val:10.4f}")

    print(sep + "\n")


# ─────────────────────────────────────────────
# 5. PERCENTILE VALIDATION  (mirrors paper Figure 6)
# ─────────────────────────────────────────────

def percentile_validation(
    E: np.ndarray,
    hpp: HPPResult,
    nhpp: NHPPResult,
    cnhpp: CNHPPResult,
) -> dict:
    """
    For each observed fire event, compute the percentile rank of the
    true circuit's predicted intensity among all N circuits on that day.
    Higher percentile = better model (fire occurred where model said it would).

    Returns dict of model_name → list of percentile values.
    """
    N, T = E.shape
    results = {"HPP": [], "NHPP": [], "cNHPP": []}

    for t in range(T):
        for i in range(N):
            if E[i, t] > 0:
                for model_name, log_lam in [
                    ("HPP",   hpp.log_lambda),
                    ("NHPP",  nhpp.log_lambda),
                    ("cNHPP", cnhpp.log_lambda),
                ]:
                    col = log_lam[:, t]
                    pct = float(np.mean(col <= col[i]) * 100)
                    results[model_name].append(pct)

    # Summary
    print("[VALIDATION] Median percentile rank of event circuits:")
    for name, pcts in results.items():
        if pcts:
            print(f"  {name:8s}: median={np.median(pcts):.1f}%  "
                  f"mean={np.mean(pcts):.1f}%  n={len(pcts)}")
    return results
