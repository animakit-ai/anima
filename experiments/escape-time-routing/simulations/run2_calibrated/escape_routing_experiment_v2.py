"""
Escape-time routing vs baselines — Corrida 2 (calibrada).
Corrige degeneraciones detectadas en Corrida 1:
  - Régimen B' con subespacios no-ortogonales (cos=0.7)
  - Inicialización de A en rango dinámico no trivial
  - Gate de validez sobre AUC_T del fractal entrenado
"""
import numpy as np
import hashlib, json, time
from scipy import stats
from sklearn.linear_model import LogisticRegression
from sklearn.neighbors import KNeighborsClassifier
from sklearn.neural_network import MLPClassifier
from sklearn.metrics import f1_score, roc_auc_score

# ---------- PRE-REGISTRO v2 ----------
PREREG = {
    "version": "v2_calibrated",
    "n_seeds": 10, "d": 32, "n_classes_cplx": 4, "n_topics": 8,
    "n_train": 2000, "n_test": 1000,
    "sigma_topic": 3.0, "sigma_cplx": 1.0,
    "subspace_cos": 0.7,                  # NUEVO: no-ortogonalidad
    "R_pole": 1.0, "R_thresh": 10.0, "N_max": 15,
    "eps_list": [0.20, 0.45],
    "knn_k": 15,
    "mlp_hidden": 64,
    "train_steps_fractal": 300,
    "A_init_scale": 1.0,                  # NUEVO: era 0.1 en v1
    "stability_threshold": 0.90,
    "verdict_margin_sigmas": 2.0,
    "verdict_pvalue": 0.01,
    "auc_validity_gate": 0.55,            # NUEVO: gate
}
PREREG_HASH = hashlib.sha256(json.dumps(PREREG, sort_keys=True).encode()).hexdigest()[:12]

DEVIATIONS = [
    "D1: Familia racional = Mobius-cuadratica f(z)=(z^2+c1)/(z+c2).",
    "D2: ε calibrado con fallback {0.20, 0.45}.",
    "D3: kNN reportado con k=15.",
    "D4: removido kwarg multi_class de LogisticRegression (sklearn >=1.7).",
    "D5 [v2]: U_cplx no ortogonal a U_topic; coseno=0.7 (corrige B trivializado en v1).",
    "D6 [v2]: A_init_scale=1.0 (era 0.1 en v1; v1 produjo c≈0 y dinamica degenerada).",
    "D7 [v2]: gate de validez AUC_T>=0.55 antes de emitir veredicto principal.",
]

# ---------- DATOS ----------
def make_data(seed, regime, cfg):
    rng = np.random.default_rng(seed)
    d, n_tr, n_te = cfg["d"], cfg["n_train"], cfg["n_test"]
    K_c, K_t = cfg["n_classes_cplx"], cfg["n_topics"]
    n = n_tr + n_te
    Q, _ = np.linalg.qr(rng.standard_normal((d, d)))
    U_topic = Q[:, :K_t]
    U_cplx_ortho = Q[:, K_t:K_t+K_c]
    # NUEVO: mezclar U_cplx con U_topic para forzar no-ortogonalidad
    cos = cfg["subspace_cos"]
    sin = np.sqrt(1 - cos**2)
    # Para cada columna de U_cplx, mezclar con una dirección aleatoria de U_topic
    mix_dir = U_topic[:, rng.integers(0, K_t, K_c)]
    U_cplx = cos * mix_dir + sin * U_cplx_ortho
    U_cplx /= np.linalg.norm(U_cplx, axis=0, keepdims=True) + 1e-9

    t_idx = rng.integers(0, K_t, n)
    c_idx = rng.integers(0, K_c, n)
    if regime == "A":
        s_t, s_c = 1.0, 3.0
        # En A mantenemos ortogonalidad para que sea sanity check limpio
        U_cplx_use = U_cplx_ortho
    elif regime == "B":
        s_t, s_c = cfg["sigma_topic"], cfg["sigma_cplx"]
        U_cplx_use = U_cplx  # mezclado
    else:  # C
        s_t, s_c = cfg["sigma_topic"], cfg["sigma_cplx"]
        U_cplx_use = U_cplx
    X = s_t * U_topic[:, t_idx].T + s_c * U_cplx_use[:, c_idx].T + 0.1*rng.standard_normal((n, d))
    return X[:n_tr], c_idx[:n_tr], X[n_tr:], c_idx[n_tr:]

def paraphrase(X, eps, seed):
    rng = np.random.default_rng(seed + 9999)
    delta = rng.standard_normal(X.shape)
    delta /= np.linalg.norm(delta, axis=1, keepdims=True) + 1e-9
    norms = np.linalg.norm(X, axis=1, keepdims=True)
    return X + eps * norms * delta

# ---------- MAPA RACIONAL ----------
def rational_map(z, c1, c2, R_pole=1.0):
    denom = z + c2
    denom = np.where(np.abs(denom) < 1e-3, 1e-3 + 0j, denom)
    return (z*z + c1) / denom

def escape_features(X, A, N_max=15, R_thresh=10.0):
    c = X @ A
    c1 = c[:, 0] + 1j*c[:, 1]
    c2 = c[:, 2] + 1j*c[:, 3]
    z = np.zeros_like(c1)
    T = np.full(c1.shape, N_max, dtype=float)
    escaped = np.zeros(c1.shape, dtype=bool)
    for n in range(1, N_max+1):
        z = rational_map(z, c1, c2)
        absz = np.abs(z)
        newly = (~escaped) & (absz > R_thresh)
        T[newly] = n
        escaped |= newly
    logz = np.log(np.abs(z) + 1e-9)
    lyap = logz / max(1, N_max)
    return np.stack([T, logz, lyap, np.real(c1), np.imag(c1)], axis=1)

def fractal_classifier_train(Xtr, ytr, cfg, A_trainable=True, seed=0):
    rng = np.random.default_rng(seed)
    d = Xtr.shape[1]
    # NUEVO: escala de inicialización calibrada
    A = rng.standard_normal((d, 4)) * cfg["A_init_scale"] / np.sqrt(d)
    if not A_trainable:
        F = escape_features(Xtr, A, cfg["N_max"], cfg["R_thresh"])
        clf = LogisticRegression(max_iter=500).fit(F, ytr)
        return ("frac", A, clf)
    lr = 0.05
    for step in range(cfg["train_steps_fractal"]):
        F = escape_features(Xtr, A, cfg["N_max"], cfg["R_thresh"])
        G = F[:, 1]
        eps_fd = 1e-2
        grad = np.zeros_like(A)
        targets = (ytr - ytr.mean()) / (ytr.std()+1e-9)
        loss_base = np.mean((G - targets)**2)
        for i in range(A.shape[0]):
            for j in range(A.shape[1]):
                A[i,j] += eps_fd
                Gp = escape_features(Xtr[:200], A, cfg["N_max"], cfg["R_thresh"])[:,1]
                lp = np.mean((Gp - targets[:200])**2)
                A[i,j] -= eps_fd
                grad[i,j] = (lp - loss_base) / eps_fd
        A -= lr * grad
        if step % 50 == 0: lr *= 0.7
    F = escape_features(Xtr, A, cfg["N_max"], cfg["R_thresh"])
    clf = LogisticRegression(max_iter=500).fit(F, ytr)
    return ("frac", A, clf)

def fractal_predict(model, X, cfg):
    _, A, clf = model
    F = escape_features(X, A, cfg["N_max"], cfg["R_thresh"])
    return clf.predict(F), F

# ---------- BRAZOS ----------
def build_arms(Xtr, ytr, cfg, seed):
    K = int(ytr.max()+1)
    arms = {}
    arms["1_frac_random"]  = fractal_classifier_train(Xtr, ytr, cfg, A_trainable=False, seed=seed)
    arms["2_frac_trained"] = fractal_classifier_train(Xtr, ytr, cfg, A_trainable=True,  seed=seed)
    arms["3_logreg"] = LogisticRegression(max_iter=1000).fit(Xtr, ytr)
    centroids = np.stack([Xtr[ytr==k].mean(0) for k in range(K)])
    arms["4_centroid"] = ("cent", centroids)
    arms["5_mlp"] = MLPClassifier(hidden_layer_sizes=(cfg["mlp_hidden"],),
                                  max_iter=400, random_state=seed).fit(Xtr, ytr)
    arms["6_knn"] = KNeighborsClassifier(n_neighbors=cfg["knn_k"]).fit(Xtr, ytr)
    return arms

def predict(name, model, X, cfg):
    if name.startswith("1_") or name.startswith("2_"):
        yhat, F = fractal_predict(model, X, cfg)
        return yhat, F
    if name == "4_centroid":
        _, C = model
        d = ((X[:,None,:]-C[None,:,:])**2).sum(-1)
        return d.argmin(1), -d
    yhat = model.predict(X)
    return yhat, None

# ---------- MÉTRICAS ----------
def metric_f1(y, yhat): return f1_score(y, yhat, average="macro")

def metric_stability(name, model, Xte, yte, eps, cfg, seed):
    Xp = paraphrase(Xte, eps, seed)
    y1,_ = predict(name, model, Xte, cfg)
    y2,_ = predict(name, model, Xp,  cfg)
    same = (y1 == y2)
    correct = (y1 == yte)
    return float(np.mean(same & correct))

def metric_tescape_auc(name, model, Xte, yte, cfg):
    if not (name.startswith("1_") or name.startswith("2_")): return np.nan
    _, F = predict(name, model, Xte, cfg)
    T = F[:, 0]
    K = int(yte.max()+1)
    aucs = []
    for k in range(K):
        yk = (yte == k).astype(int)
        if yk.sum()==0 or yk.sum()==len(yk): continue
        try: aucs.append(roc_auc_score(yk, T))
        except: pass
    return float(np.mean(aucs)) if aucs else np.nan

def metric_lyapunov(name, model, Xte, cfg):
    if not (name.startswith("1_") or name.startswith("2_")): return np.nan
    _, F = predict(name, model, Xte, cfg)
    return float(np.mean(F[:, 2]))

# ---------- LOOP ----------
def run():
    cfg = PREREG
    arms_names = ["1_frac_random","2_frac_trained","3_logreg","4_centroid","5_mlp","6_knn"]
    regimes = ["A","B","C"]
    metrics = ["F1","Stab@eps90","AUC_T","Lyapunov"]
    results = np.full((cfg["n_seeds"], len(arms_names), len(regimes), len(metrics)), np.nan)
    t0 = time.time()
    for s in range(cfg["n_seeds"]):
        for ri, reg in enumerate(regimes):
            Xtr, ytr, Xte, yte = make_data(s, reg, cfg)
            arms = build_arms(Xtr, ytr, cfg, seed=s)
            for ai, name in enumerate(arms_names):
                model = arms[name]
                yhat,_ = predict(name, model, Xte, cfg)
                results[s, ai, ri, 0] = metric_f1(yte, yhat)
                results[s, ai, ri, 1] = metric_stability(name, model, Xte, yte,
                                                        eps=cfg["eps_list"][1], cfg=cfg, seed=s)
                results[s, ai, ri, 2] = metric_tescape_auc(name, model, Xte, yte, cfg)
                results[s, ai, ri, 3] = metric_lyapunov(name, model, Xte, cfg)
        print(f"  seed {s+1}/{cfg['n_seeds']} done  ({time.time()-t0:.0f}s)", flush=True)
    return results, arms_names, regimes, metrics

def report(results, arms_names, regimes, metrics):
    print("\n" + "="*70)
    print(f"PREREG_HASH: {PREREG_HASH}")
    print("DEVIATIONS:")
    for d in DEVIATIONS: print(" ", d)
    print("="*70)
    mean = np.nanmean(results, axis=0)
    std  = np.nanstd (results, axis=0)
    for ri, reg in enumerate(regimes):
        print(f"\n--- Régimen {reg} ---")
        header = f"{'brazo':<18}" + "".join(f"{m:>18}" for m in metrics)
        print(header)
        for ai, name in enumerate(arms_names):
            row = f"{name:<18}"
            for mi, m in enumerate(metrics):
                mu, sd = mean[ai,ri,mi], std[ai,ri,mi]
                row += f"  {mu:6.3f} ± {sd:5.3f}   " if not np.isnan(mu) else f"     n/a         "
            print(row)
    print("\n--- VEREDICTO (Régimen B, F1) ---")
    B = 1; F1 = 0
    f_frac = results[:, 1, B, F1]
    f_mlp  = results[:, 4, B, F1]
    f_log  = results[:, 2, B, F1]
    auc_frac = np.nanmean(results[:, 1, B, 2])
    sigma_max = max(np.nanstd(f_frac), np.nanstd(f_mlp))
    margin = np.nanmean(f_frac) - np.nanmean(f_mlp)
    t, p = stats.ttest_rel(f_frac, f_mlp)
    stab_frac = np.nanmean(results[:, 1, B, 1])
    stab_mlp  = np.nanmean(results[:, 4, B, 1])
    print(f"  F1 fractal-trained: {np.nanmean(f_frac):.3f} ± {np.nanstd(f_frac):.3f}")
    print(f"  F1 MLP-matched   : {np.nanmean(f_mlp):.3f} ± {np.nanstd(f_mlp):.3f}")
    print(f"  F1 logreg        : {np.nanmean(f_log):.3f} ± {np.nanstd(f_log):.3f}")
    print(f"  AUC_T fractal    : {auc_frac:.3f}   (gate validez: >= {PREREG['auc_validity_gate']})")
    print(f"  margen frac-MLP  : {margin:+.3f}   (umbral: 2σ = {2*sigma_max:.3f})")
    print(f"  p-valor pareado  : {p:.4f}   (umbral: {PREREG['verdict_pvalue']})")
    print(f"  estab. frac/MLP  : {stab_frac:.3f} / {stab_mlp:.3f}")
    if auc_frac < PREREG["auc_validity_gate"]:
        print(f"  VEREDICTO: NO CONCLUYENTE (AUC_T < gate; implementacion degenerada)")
    else:
        gana = (margin > 2*sigma_max) and (p < PREREG["verdict_pvalue"]) \
               and (stab_frac >= stab_mlp - 0.01) and (stab_frac >= PREREG["stability_threshold"])
        print(f"  VEREDICTO: {'GANA' if gana else 'PIERDE (Ockham: empate=pierde)'}")
    np.save("results.npy", results)
    print("\nresults.npy guardado.")

if __name__ == "__main__":
    print(f"Pre-registro hash: {PREREG_HASH}")
    res, an, rg, mt = run()
    report(res, an, rg, mt)