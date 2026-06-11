# Conformal routing — literature scan (paso 3a)

**Fecha:** 10-jun-2026. **Propósito:** acotar el claim ANTES de pre-registrar (lección del experimento escape-time). Lectura superficial vía búsqueda — los 4 papers core requieren lectura completa antes del pre-registro 3b.

## Papers encontrados (overlap directo)

| Paper | Año | Qué hace | Overlap con nuestra idea |
|---|---|---|---|
| [RACER — Risk-Aware Calibrated Efficient Routing](https://arxiv.org/pdf/2603.06616) | 2026 | Control de riesgo conformal post-hoc para *cualquier* router determinista multi-LLM | **Alto** — el mecanismo CRC-sobre-router ya existe. Potencialmente complementario: nuestro scorer es el "deterministic router" que RACER asume |
| [RouteNLP — Closed-Loop LLM Routing with Conformal Cascading](https://arxiv.org/html/2604.23577v1) | 2026 | Cascading conformal con lazo cerrado, co-optimización con destilación, piloto 8 semanas | **El más cercano.** Verificar: ¿qué supervisión usa el lazo? (benchmark/LLM-judge vs feedback humano implícito) |
| [Conformal Arbitrage](https://arxiv.org/html/2506.00911v1) | 2025 | Balance riesgo-controlado de objetivos en competencia (costo vs accuracy), API-level | Medio — establece el framing costo-calidad con CRC |
| [Proactive Routing to Interpretable Surrogates](https://arxiv.org/html/2603.14623) | 2026 | Gate clasificador + calibración Clopper-Pearson, garantías distribution-free | Medio — gate de seguridad, no tiers de complejidad |
| [Linear Expectation Constraint for Selective Prediction and Routing](https://arxiv.org/pdf/2512.01556) | 2025 | Routing con control de false-discovery | Medio |
| [kNN Beats Complex Learned Routers](https://arxiv.org/pdf/2505.12601) | 2025 | Baselines simples ganan a routers aprendidos complejos | Bajo overlap, **alta munición**: valida nuestra tesis anti-sofisticación (y ecoa nuestro anti-resultado fractal) |
| [Randomized/Bootstrapped CRC for LLMs](https://arxiv.org/pdf/2509.23007) | 2025 | Varianza de CRC en LLMs | Técnica de soporte |

## Veredicto sobre el claim

❌ Muerto: "first router with conformal guarantees" — RACER/RouteNLP/Conformal Arbitrage lo ocupan.

✅ **Claim refinado (pendiente de confirmar leyendo RACER y RouteNLP completos):**

> "First **open-source, npm-installable** routing layer that self-calibrates conformal risk guarantees from **implicit production feedback** (operator corrections — zero annotation cost), with **physiologically-modulated risk budgets** (homeostatic α) and **SPRT-guarded recalibration** against drift."

Los 3 diferenciales que probablemente sobreviven:
1. **Supervisión por correcciones implícitas** (edit_distance/correction_type de un operador real) en vez de benchmarks o LLM-judge — si RouteNLP usa judge/benchmark, este ángulo es nuestro.
2. **α homeostático** — riesgo como variable fisiológica del agente; con el caveat de Opus: el claim es "garantía adaptativa auditada por estado" (95% en base / 85% en panic), nunca "garantía constante".
3. **Empaque**: open-source componible (`scorer` + capa conformal + `sprt-evolution`), no paper-ware. RACER incluso podría citarse como validación del paradigma.

## Respuestas al walkthrough técnico (punto 4 de la revisión de Opus)

**a) ¿El SPRT existente testea la hipótesis correcta para drift conformal?**
No tal cual — `AgentConfigEvolver` testea gaps de calidad por (agente, modo, tier) para ajustes de keywords. PERO la maquinaria es reutilizable directamente: el drift de cobertura es un Bernoulli (indicador de miscobertura por mensaje), y el SPRT de Wald sobre Bernoulli es exactamente lo que el módulo ya computa (log-likelihood-ratio acumulado, umbrales log(19)/log(0.2)). Se define el par de hipótesis nuevo: H0: miscobertura ≤ α+ε vs H1: > α+ε. **Es una instancia nueva del mismo motor, no un sistema nuevo.**

**b) ¿Los logs tienen el formato (features, ruta, calidad) que CRC necesita?**
Casi. `daily_logs` tiene: `user_message` (→ features recomputables en replay, el scorer es determinista), `routing_mode`/`agent_used` (ruta), `correction_type` + `edit_distance_ratio` (proxy de calidad). **Gap real:** el proxy de calidad es ruidoso (no toda respuesta sin corrección fue buena — a veces el operador no corrige por cansancio). Mitigación: usar las 50 etiquetas humanas del 0.1.0 para medir la correlación corrección↔calidad-real y reportar esa fidelidad como parte del pre-registro. Si la correlación es débil, el conjunto de calibración necesita curación — eso se sabe ANTES de prometer cobertura.

**c) ¿α homeostático continuo o discreto?**
**Discreto por diseño**: 3 modos (zen/flow/panic) → 3 budgets α pre-calibrados, cada uno con su propio conjunto de calibración (CRC condicional por grupo — variante limpia y estándar). Evita las complicaciones de α continuo y hace el claim auditable: una tabla de 3 filas (modo, α nominal, cobertura empírica) en el README.

## 3a.2 — Lectura profunda (CERRADO 10-jun-2026)

Matriz de decisión sobre los 4 papers con overlap (criterio binario por dimensión diferenciadora):

| Paper | Supervisión de calibración | Drift / recalibración | α adaptativo | Open-source |
|---|---|---|---|---|
| **RACER** | Labels de benchmark fijo (oracle de corrección sobre GSM8K/MMLU/CMMLU/ARC) | ❌ No — asume intercambiabilidad, sin estrategia temporal | ❌ Fijo ("user-specified") | Repo anónimo (pre-publicación) |
| **RouteNLP** | **Logs de escalación** (self-confidence del cascade) — la auditoría humana del piloto fue retrospectiva, NO alimenta el loop | ⚠️ Recalibración **manual semanal**; drift estadístico declarado como *future work* ("online threshold adaptation") | ❌ Fijo (α=0.05) | ✅ GitHub |
| **Proactive Routing** | Labels de degradación del surrogate (|y−g(x)|−|y−f(x)| ≤ τ) | ❌ "Under covariate shift the guarantee formally breaks" (reconocido) | ❌ Fijo | ? |
| **Conformal Arbitrage** | Benchmarks (TruthfulQA/MMLU, PKU-SafeRLHF) — lectura de abstract | — | — | — |

**Veredicto del claim: SOBREVIVE en las 3 dimensiones.**

1. **Supervisión por correcciones implícitas del operador**: nadie la usa. RACER = benchmarks; RouteNLP = escalación por self-confidence (que mide la inseguridad del modelo barato, NO la calidad juzgada por el humano — son señales distintas: un modelo puede estar confiado Y equivocado, que es exactamente lo que la corrección humana captura); Proactive = degradación de surrogate.
2. **Drift con control estadístico (SPRT)**: nadie lo tiene. RouteNLP lo nombra explícitamente como future work — **estaríamos implementando el future work del paper más cercano**, con maquinaria (Wald) que ya corre en producción en Anima.
3. **α adaptativo por estado (homeostático, discreto por modo)**: nadie. Los cuatro usan α fijo.

Claim final para el pre-registro 3b:

> "An open-source routing layer that (i) calibrates conformal risk guarantees from implicit operator corrections — zero annotation cost, a supervision source no prior router uses; (ii) guards calibration validity with sequential statistical drift detection (SPRT), the stated future work of the closest prior system; and (iii) adapts the risk budget to agent state via discrete, auditable per-mode calibration."

Riesgo residual bajo: Conformal Arbitrage y los 2 papers de soporte (Linear Expectation, Bootstrapped CRC) solo se leyeron a nivel abstract — se citan como related work y la variante CRC se elige tras leer Bootstrapped CRC (puede aportar la técnica de varianza). Ninguno toca las 3 dimensiones del claim.

## Condiciones para el pre-registro 3b

- [x] ~~Leer RACER y RouteNLP completos~~ — CERRADO, claim confirmado (matriz arriba)
- [ ] 0.1.0 publicado (las 50 etiquetas son insumo de la fidelidad corrección↔calidad)
- [ ] Leer Bootstrapped CRC para elegir variante (técnica, no claim)
- [ ] **Baseline obligatoria (presión de Opus, aceptada): kNN + CRC vanilla sin homeostasis ni SPRT.** Si el sistema completo no le gana en cobertura empírica bajo drift o en costo total bajo presión de presupuesto, no hay feature insignia — hay overhead. Las baselines logreg/MLP quedan como secundarias.
- [ ] Gates: cobertura empírica ≥ nominal − 2pp en holdout TEMPORAL (no aleatorio); veredicto numérico pre-acordado
- [ ] Walkthrough del dataflow real (no diagrama conceptual) como sección obligatoria
- [ ] Citar RouteNLP como el sistema previo más cercano y RACER como validación del paradigma; citar kNN-beats-routers correctamente: "kNN gana en accuracy estacionaria sin garantías — nosotros añadimos garantías y drift, y por eso kNN+CRC es nuestra baseline, no nuestra víctima"
