"""
Escape-time routing vs baselines — Corrida 3 (canónica + B válido).
Implementa spec PREREGISTRATION.md §2 con input-por-z0 y mapa fijo global.
Régimen B reformulado: complejidad codificada radialmente (no-lineal).
"""
import numpy as np
import hashlib, json, time
from scipy import stats
from sklearn.linear_model import LogisticRegression
from sklearn.neighbors import KNeighborsClassifier
from sklearn.neural_network import MLPClassifier
from sklearn.metrics import f1_score, roc_auc_score

PREREG = {
    "version": "v3_canonical",
    "n_seeds": 10, "d": 32, "n_classes_cplx": 4, "n_topics": 8,
    "n_train": 2000, "n_test": 1000,
    "sigma_topic": 1.0,
    "radius_step": 1.0,                   # NUEVO: paso radial por clase
    "R_pole": 1.0, "R_thresh": 10.0, "N_max": 15,
    "eps_list": [0.20, 0.45],
    "knn_k": 15, "mlp_hidden": 64,
    "train_steps_fractal": 300,
    "stability_threshold": 0.90,
    "verdict_margin_sigmas": 2.0,
    "verdict_pvalue": 0.01,
    "auc_validity_gate": 0.55,
    "logreg_validity_band": [0.40, 0.80], # NUEVO: gate sobre logreg(B)
    "families": ["canonical","mandelbrot","newton_cubic"],
}
PREREG_HASH = hashlib.sha256(json.dumps(PREREG, sort_keys=True).encode()).hexdigest()[:12]

DEVIATIONS = [
    "D1 [v3]: mapa CANONICO segun PREREGISTRATION.md §2: z0=W_in·x, A y c_bias globales, mapa fijo.",
    "D2: ε fallback {0.20, 0.45}.",
    "D3: kNN k=15.",
    "D4: sklearn>=1.7 sin multi_class.",
    "D8 [v3]: Régimen B reformulado con codificacion radial no-lineal (v1/v2 trivializaban logreg).",
    "D9 [v3]: sondeo paralelo de familias {canonical, mandelbrot, newton_cubic} como diagnostico.",
    "D10 [v3]: gate de validez sobre logreg(B) ∈ [0.4, 0.8]; fuera de banda = régimen invalido.",
]

# ---------- DATOS ----------
def make_data(seed, regime, cfg):
    rng = np.random.default_rng(seed)
    d, n_tr, n_te = cfg["d"], cfg["n_train"], cfg["n_test"]
    K_c, K_t = cfg["n_classes_cplx"], cfg["n_topics"]
    n = n_tr + n_te
    Q, _ = np.linalg.qr(rng.standard_normal((d, d)))
    U_topic = Q[:, :K_t]

    t_idx = rng.integers(0, K_t, n)
    c_idx = rng.integers(0, K_c, n)

    if regime == "A":
        # Separable lineal: sanity check
        U_cplx = Q[:, K_t:K_t+K_c]
        X = 1.0*U_topic[:,t_idx].T + 3.0*U_cplx[:,c_idx].T + 0.1*rng.standard_normal((n,d))
    elif regime == "B":
        # NUEVO: codificación RADIAL dentro de cada cluster de tema
        # x = U_topic[t] + r(c) * u(θ) + η  con r(c) = (c+1)*radius_step
        topic_centers = cfg["sigma_topic"] * U_topic[:, t_idx].T   # (n,d)
        radii = (c_idx + 1) * cfg["radius_step"]                    # (n,)
        # dirección aleatoria u ⊥ al subespacio de temas (queda en el complemento)
        u_dir = rng.standard_normal((n, d))
        # Proyectar fuera del subespacio de temas
        proj = u_dir @ U_topic @ U_topic.T
        u_dir = u_dir - proj
        u_dir /= np.linalg.norm(u_dir, axis=1, keepdims=True) + 1e-9
        X = topic_centers + radii[:, None] * u_dir + 0.1*rng.standard_normal((n,d))
    else:  # C: igual a B
        topic_centers = cfg["sigma_topic"] * U_topic[:, t_idx].T
        radii = (c_idx + 1) * cfg["radius_step"]
        u_dir = rng.standard_normal((n, d))
        proj = u_dir @ U_topic @ U_topic.T
        u_dir = u_dir - proj
        u_dir /= np.linalg.norm(u_dir, axis=1, keepdims=True) + 1e-9
        X = topic_centers + radii[:, None] * u_dir + 0.1*rng.standard_normal((n,d))

    return X[:n_tr], c_idx[:n_tr], X[n_tr:], c_idx[n_tr:]

def paraphrase(X, eps, seed):
    rng = np.random.default_rng(seed + 9999)
    delta = rng.standard_normal(X.shape)
    delta /= np.linalg.norm(delta, axis=1, keepdims=True) + 1e-9
    norms = np.linalg.norm(X, axis=1, keepdims=True)
    return X + eps * norms * delta

# ---------- MAPAS RACIONALES (canónico + sondeo) ----------
# Spec canónica: z_{n+1} = (A·(z⊙z) + c_bias) / (|z|² - R_pole²)
# z ∈ C^k; aquí trabajamos en C^1 (k=1) para mantener pipeline simple.
# A: escalar complejo global, c_bias: complejo global, R_pole real.

def map_canonical(z, A_glob, c_bias, R_pole):
    denom = np.abs(z)**2 - R_pole**2
    denom = np.where(np.abs(denom) < 1e-3, np.sign(denom + 1e-9)*1e-3, denom)
    return (A_glob * z*z + c_bias) / denom

def map_mandelbrot(z, A_glob, c_bias, R_pole):
    # c_bias actúa como constante global (variante con z0 cargando el input)
    return z*z + c_bias

def map_newton_cubic(z, A_glob, c_bias, R_pole):
    # f(z) = z - (z^3 - 1)/(3z^2); divergencia cuando z->0
    z2 = z*z
    z2 = np.where(np.abs(z2) < 1e-3, 1e-3 + 0j, z2)
    return z - (z*z2 - 1.0) / (3.0*z2)

MAPS = {"canonical": map_canonical, "mandelbrot": map_mandelbrot, "newton_cubic": map_newton_cubic}

def escape_features(X, W_in, A_glob, c_bias, family, N_max=15, R_thresh=10.0, R_pole=1.0):
    # z0 = W_in · x  (proyección a C: parte real e imaginaria)
    z0_re = X @ W_in[:, 0]
    z0_im = X @ W_in[:, 1]
    z = z0_re + 1j*z0_im
    fmap = MAPS[family]
    T = np.full(z.shape, N_max, dtype=float)
    escaped = np.zeros(z.shape, dtype=bool)
    log_growth = np.zeros(z.shape, dtype=float)
    for n in range(1, N_max+1):
        z_new = fmap(z, A_glob, c_bias, R_pole)
        # acumular log|f'| aproximado por |z_new - z| (proxy de Lyapunov)
        log_growth += np.log(np.abs(z_new - z) + 1e-9) / N_max
        z = z_new
        absz = np.abs(z)
        newly = (~escaped) & (absz > R_thresh)
        T[newly] = n
        escaped |= newly
    logz = np.log(np.abs(z) + 1e-9)
    return np.stack([T, logz, log_growth, np.real(z), np.imag(z)], axis=1)

def fractal_train(Xtr, ytr, cfg, family, A_trainable=True, seed=0):
    rng = np.random.default_rng(seed)
    d = Xtr.shape[1]
    W_in = rng.standard_normal((d, 2)) / np.sqrt(d)
    A_glob = (rng.standard_normal() + 1j*rng.standard_normal()) * 0.5
    c_bias = (rng.standard_normal() + 1j*rng.standard_normal()) * 0.5

    if not A_trainable:
        F = escape_features(Xtr, W_in, A_glob, c_bias, family, cfg["N_max"], cfg["R_thresh"], cfg["R_pole"])
        clf = LogisticRegression(max_iter=500).fit(F, ytr)
        return ("frac", W_in, A_glob, c_bias, family, clf)

    # Entrenamiento: gradiente FD sobre W_in (matriz global de entrada)
    lr = 0.05
    targets = (ytr - ytr.mean()) / (ytr.std() + 1e-9)
    for step in range(cfg["train_steps_fractal"]):
        F = escape_features(Xtr[:200], W_in, A_glob, c_bias, family, cfg["N_max"], cfg["R_thresh"], cfg["R_pole"])
        G = F[:, 1]
        loss_base = np.mean((G - targets[:200])**2)
        eps_fd = 1e-2
        grad = np.zeros_like(W_in)
        for i in range(W_in.shape[0]):
            for j in range(W_in.shape[1]):
                W_in[i,j] += eps_fd
                Gp = escape_features(Xtr[:200], W_in, A_glob, c_bias, family, cfg["N_max"], cfg["R_thresh"], cfg["R_pole"])[:,1]
                lp = np.mean((Gp - targets[:200])**2)
                W_in[i,j] -= eps_fd
                grad[i,j] = (lp - loss_base) / eps_fd
        W_in -= lr * grad
        if step % 50 == 0: lr *= 0.7

    F = escape_features(Xtr, W_in, A_glob, c_bias, family, cfg["N_max"], cfg["R_thresh"], cfg["R_pole"])
    clf = LogisticRegression(max_iter=500).fit(F, ytr)
    return ("frac", W_in, A_glob, c_bias, family, clf)

def fractal_predict(model, X, cfg):
    _, W_in, A_glob, c_bias, family, clf = model
    F = escape_features(X, W_in, A_glob, c_bias, family, cfg["N_max"], cfg["R_thresh"], cfg["R_pole"])
    return clf.predict(F), F

# ---------- BRAZOS ----------
def build_arms(Xtr, ytr, cfg, seed, family):
    K = int(ytr.max()+1)
    arms = {}
    arms["1_frac_random"]  = fractal_train(Xtr, ytr, cfg, family, A_trainable=False, seed=seed)
    arms["2_frac_trained"] = fractal_train(Xtr, ytr, cfg, family, A_trainable=True,  seed=seed)
    arms["3_logreg"] = LogisticRegression(max_iter=1000).fit(Xtr, ytr)
    centroids = np.stack([Xtr[ytr==k].mean(0) for k in range(K)])
    arms["4_centroid"] = ("cent", centroids)
    arms["5_mlp"] = MLPClassifier(hidden_layer_sizes=(cfg["mlp_hidden"],), max_iter=400, random_state=seed).fit(Xtr, ytr)
    arms["6_knn"] = KNeighborsClassifier(n_neighbors=cfg["knn_k"]).fit(Xtr, ytr)
    return arms

def predict(name, model, X, cfg):
    if name.startswith("1_") or name.startswith("2_"):
        return fractal_predict(model, X, cfg)
    if name == "4_centroid":
        _, C = model
        d2 = ((X[:,None,:]-C[None,:,:])**2).sum(-1)
        return d2.argmin(1), None
    return model.predict(X), None

def metric_f1(y, yhat): return f1_score(y, yhat, average="macro")

def metric_stability(name, model, Xte, yte, eps, cfg, seed):
    Xp = paraphrase(Xte, eps, seed)
    y1,_ = predict(name, model, Xte, cfg)
    y2,_ = predict(name, model, Xp,  cfg)
    return float(np.mean((y1==y2) & (y1==yte)))

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

# ---------- LOOP por familia ----------
def run_family(family, cfg):
    arms_names = ["1_frac_random","2_frac_trained","3_logreg","4_centroid","5_mlp","6_knn"]
    regimes = ["A","B","C"]
    metrics = ["F1","Stab@eps90","AUC_T","Lyapunov"]
    results = np.full((cfg["n_seeds"], len(arms_names), len(regimes), len(metrics)), np.nan)
    t0 = time.time()
    for s in range(cfg["n_seeds"]):
        for ri, reg in enumerate(regimes):
            Xtr, ytr, Xte, yte = make_data(s, reg, cfg)
            arms = build_arms(Xtr, ytr, cfg, seed=s, family=family)
            for ai, name in enumerate(arms_names):
                model = arms[name]
                yhat,_ = predict(name, model, Xte, cfg)
                results[s, ai, ri, 0] = metric_f1(yte, yhat)
                results[s, ai, ri, 1] = metric_stability(name, model, Xte, yte, eps=cfg["eps_list"][1], cfg=cfg, seed=s)
                results[s, ai, ri, 2] = metric_tescape_auc(name, model, Xte, yte, cfg)
                results[s, ai, ri, 3] = metric_lyapunov(name, model, Xte, cfg)
        print(f"  [{family}] seed {s+1}/{cfg['n_seeds']} done  ({time.time()-t0:.0f}s)", flush=True)
    return results, arms_names, regimes, metrics

def report_family(family, results, arms_names, regimes, metrics, cfg):
    print(f"\n{'#'*70}\n# FAMILIA: {family}\n{'#'*70}")
    mean = np.nanmean(results, axis=0); std = np.nanstd(results, axis=0)
    for ri, reg in enumerate(regimes):
        print(f"\n--- Régimen {reg} ---")
        header = f"{'brazo':<18}" + "".join(f"{m:>18}" for m in metrics)
        print(header)
        for ai, name in enumerate(arms_names):
            row = f"{name:<18}"
            for mi, _ in enumerate(metrics):
                mu, sd = mean[ai,ri,mi], std[ai,ri,mi]
                row += f"  {mu:6.3f} ± {sd:5.3f}   " if not np.isnan(mu) else "     n/a         "
            print(row)
    # Validez del régimen B vía logreg
    logreg_B = np.nanmean(results[:, 2, 1, 0])
    lo, hi = cfg["logreg_validity_band"]
    valid_B = lo <= logreg_B <= hi
    print(f"\n  Régimen B validez: logreg F1 = {logreg_B:.3f}  (banda válida: [{lo}, {hi}])  -> {'VÁLIDO' if valid_B else 'INVÁLIDO'}")
    if not valid_B:
        print(f"  VEREDICTO [{family}]: NO EMITIDO (régimen B fuera de banda).")
        return
    # Gate AUC fractal
    auc_frac = np.nanmean(results[:, 1, 1, 2])
    if auc_frac < cfg["auc_validity_gate"]:
        print(f"  VEREDICTO [{family}]: NO CONCLUYENTE (AUC_T={auc_frac:.3f} < {cfg['auc_validity_gate']}; implementación degenerada).")
        return
    # Veredicto formal
    f_frac = results[:, 1, 1, 0]; f_mlp = results[:, 4, 1, 0]
    sigma_max = max(np.nanstd(f_frac), np.nanstd(f_mlp))
    margin = np.nanmean(f_frac) - np.nanmean(f_mlp)
    _, p = stats.ttest_rel(f_frac, f_mlp)
    stab_frac = np.nanmean(results[:, 1, 1, 1]); stab_mlp = np.nanmean(results[:, 4, 1, 1])
    gana = (margin > 2*sigma_max) and (p < cfg["verdict_pvalue"]) \
           and (stab_frac >= stab_mlp - 0.01) and (stab_frac >= cfg["stability_threshold"])
    print(f"  F1 frac/MLP: {np.nanmean(f_frac):.3f} / {np.nanmean(f_mlp):.3f}   margen: {margin:+.3f} (2σ={2*sigma_max:.3f})")
    print(f"  p={p:.4f}  AUC_T={auc_frac:.3f}  estab frac/MLP: {stab_frac:.3f}/{stab_mlp:.3f}")
    print(f"  VEREDICTO [{family}]: {'GANA' if gana else 'PIERDE (Ockham)'}")

if __name__ == "__main__":
    print(f"Pre-registro hash: {PREREG_HASH}")
    print("DEVIATIONS:")
    for d in DEVIATIONS: print(" ", d)
    all_results = {}
    for fam in PREREG["families"]:
        print(f"\n{'='*70}\nCorriendo familia: {fam}\n{'='*70}")
        res, an, rg, mt = run_family(fam, PREREG)
        all_results[fam] = res
        report_family(fam, res, an, rg, mt, PREREG)
    np.savez("results_v3.npz", **all_results)
    print("\nresults_v3.npz guardado (3 familias).")