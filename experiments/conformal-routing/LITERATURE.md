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

## Condiciones para el pre-registro 3b (no antes de)

- [ ] Leer RACER y RouteNLP completos — confirmar qué supervisión usan y ajustar claim
- [ ] 0.1.0 publicado (las 50 etiquetas son insumo del punto b)
- [ ] Gates ya definidos: cobertura empírica ≥ nominal − 2pp en holdout TEMPORAL (no aleatorio); baseline = router conformal naïve sin homeostasis Y MLP sobre señales del scorer; veredicto numérico pre-acordado
- [ ] Walkthrough del dataflow real (no diagrama conceptual) como sección obligatoria del pre-registro
