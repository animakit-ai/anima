# Pre-registration: Escape-Time Routing vs Baselines (synthetic simulation)

**Status:** frozen before any code is run. The git commit hash of this file is the pre-registration timestamp. Any deviation must be reported as a deviation, not silently applied.

**Question (falsifiable):** Does the escape time of a frozen rational map over projected vectors separate complexity classes better than parameter-matched standard baselines, under realistic noise?

**Scope note:** this simulation is the *cheap filter*. Even a win here does NOT ship anything — it only justifies the follow-up spike on real production embeddings with behavioral ground truth. A loss here kills the architecture for this use case.

---

## 1. Labels (blocker #1)

Synthetic data is generated with **complexity as an explicit latent factor, orthogonal to topic**:

- Each sample: `x = U_topic · t + U_cplx · c + η`, with `t` ~ one of K_topic=8 topic prototypes, `c` ~ complexity factor ∈ {0,1,2,3} (the 4 classes), `η` ~ N(0, σ_noise).
- Mixing ratio per regime: **Regime A** σ_topic=0.2·σ_cplx (complexity dominates — sanity check only). **Regime B (primary)** σ_topic=3·σ_cplx (topic dominates; complexity is the weak signal — mirrors real embeddings clustering by topic, not cognitive demand). **Regime C**: paraphrase pairs = same (t,c), independent η at calibrated ε (see §6).
- Labels are exact by construction → no κ needed for the simulation. (The later real-corpus spike uses operator hand-labels + behavioral signals; agreement reported there.)

## 2. Map family (blocker #2) — frozen

Exactly the proposed architecture, no variants:

```
z₀ = W_in · x                      W_in ∈ ℝ^{2×d}
z_{n+1} = (A(z_n ⊙ z_n) + c_bias) / (‖z_n‖² − R_pole²)
```

- `A ∈ ℝ^{2×2}`, `c_bias ∈ ℝ²`, `R_pole = 1.0`.
- **Escape criterion:** `T_escape = min{ n : ‖z_n‖ > R_thresh }`, `R_thresh = 10`, `N_max = 15` (primary, pre-registered; the 5–50 sweep is sensitivity diagnostic only — final reporting uses 15, no post-hoc selection).
- Router decision: class by thresholding T_escape into 4 bins with thresholds fit on train split only.
- Input dims: d = 32 (primary) and d = 2 (diagnostic). For d→2 projection in trained arms, W_in is learned; in random arms, W_in ~ N(0, 1/d). PCA is NOT used (objection #11).

## 3. Training surrogate (blocker #3) — frozen

T_escape is discrete; gradients use the smooth surrogate
`G(x) = log‖z_{N_max}‖` (computed with pole-clamped denominator `max(‖z‖² − R², 10⁻³)` for numerical stability),
trained with ordinal hinge loss: class k targets `G ∈ [g_k, g_{k+1})` with fixed grid `g = {−2, 0, 2, 4, ∞}`. No other surrogate may be substituted after seeing results.

## 4. Arms (objection B) — 6 total

| # | Arm | Params |
|---|---|---|
| 1 | Rational map, A & W_in random (pure reservoir) | 0 trained |
| 2 | Rational map, A, c_bias, W_in trained via §3 | p ≈ 2d+6 |
| 3 | Logistic regression | p = 4(d+1) |
| 4 | **MLP 2-layer, parameter-matched to arm 2** (hidden width chosen so total params ≈ arm 2) | ≈ arm 2 |
| 5 | kNN, k ∈ {5, 15} (report both) | 0 |
| 6 | Random features (width 64) + ridge | floor for "generic nonlinearity" |

Training budget: **equal FLOPs** across trained arms (counted analytically); additionally report full loss-vs-FLOPs curves, not just endpoints.

## 5. Metrics

1. Macro-F1 (4 classes) + per-class confusion matrices (Regime B is the primary table).
2. **Conditional stability** (objection #5): among paraphrase pairs where at least one member is correctly routed, % receiving the same route. Report the (stability, accuracy) pair — never aggregated into one number. A constant classifier scores 100% raw stability; conditional stability exposes it.
3. T_escape separation: macro one-vs-rest AUC (objection #7) + per-class histograms.
4. Chaos diagnostic: local Lyapunov exponent `λ(z₀) = (1/n) Σ log‖J_f(z_k)‖` distribution per class (objection #8) — not ∂route/∂z₀.

## 6. Paraphrase ε (objection #6) — calibrated, not invented

ε is set from the empirical distance distribution of real paraphrase pairs (PAWS or MRPC) in a normalized sentence-embedding space: ε₅₀ = median, ε₉₀ = p90 of ‖z₁−z₂‖/‖z₁‖. Expected order: 0.2–0.45 of the norm (cosine 0.80–0.95), NOT 1–5%. If no embedding model is run, use ε ∈ {0.20, 0.45} as declared fallback and label it as such.

## 7. Anti-self-deception controls

- **Label permutation** (objection #9): full pipeline on shuffled labels; any arm scoring >chance+2σ invalidates the run (leakage).
- **Split** (objection #10): primary split is by-cluster (agglomerative, cosine 0.9); random split reported only to quantify inflation.
- 10 seeds; all tables report mean ± σ across seeds.
- Commit hash + master seed in the first line of the report.

## 8. Verdict (objection #13, #15) — arithmetic, pre-agreed

The rational map (arm 2) **wins** only if ALL hold in Regime B, by-cluster split:
1. macro-F1(arm 2) − macro-F1(arm 4, MLP-matched) > 2·max(σ₂, σ₄) AND paired t-test p < 0.01 across seeds. (Beating logistic regression alone proves nonlinearity, not dynamics — the bar is the MLP.)
2. Conditional stability(arm 2) ≥ conditional stability(arm 4) − 1pp at ε₅₀.
3. No failure in Regime C: conditional stability at ε₉₀ ≥ 90%. *Justification of 90%: at 10⁶ queries/day, 10% route-flips on paraphrases = 10⁵ misrouted queries/day — already generous; below that the router is operationally unusable regardless of accuracy.*

**B and C do not average: failing either one = loss** (objection #15). Tie or unclear = loss (Ockham). Arm 1 (random reservoir) is diagnostic only and cannot win.

## 9. Deliverables

Reproducible code + per-cell tables (6 arms × 3 regimes × 4 metrics, mean±σ) + T_escape histograms + loss-vs-FLOPs curves + confusion matrices (Regime B) + basin visualization (Regime A, d=2 only — the single figure where fractal intuition is legitimate) + permutation-control results. Prose without per-cell numbers does not count as a result.
