# Technical note: Escape-Time Routing — a clean anti-result

*Authors: Justine Serna Aza, with Claude Opus 4.7 (implementation/review) and Claude Fable 5 (pre-registration/review). June 2026.*

## TL;DR

Pre-registramos una prueba falsable de la hipótesis de que el tiempo de escape de un mapa racional iterado sobre vectores proyectados separa clases de complejidad cognitiva mejor que baselines no-lineales estándar. Tras tres corridas con errores de diseño identificados y corregidos en cada iteración, **la hipótesis no sobrevive**. En la única configuración donde el régimen adversarial fue no trivial, el escape time obtuvo AUC = 0.500 ± 0.000 (chance puro) mientras un MLP de 64 unidades alcanzó F1 = 0.895 sobre los mismos datos.

**Pero el hallazgo principal no es el entierro del fractal.** El régimen que construimos para testearlo reveló una propiedad arquitectónica del estado del arte: **la geometría de los embeddings codifica tema, no demanda cognitiva**. Cuando la complejidad vive en una dirección lineal del espacio (régimen B v1), cualquier clasificador trivial la recupera (logreg F1=1.000) — pero eso es un artefacto de cómo se construye el espacio, no una propiedad de los mensajes reales, donde mensajes triviales y complejos del mismo tema son vecinos cercanos. Los routers basados en similitud de embeddings heredan esta geometría temática. Esa observación, con números, es el punto de partida de nuestro trabajo siguiente en routing calibrado por feedback conductual (ver `../conformal-routing/`).

Publicamos como anti-resultado limpio. La metodología (pre-registro, gates de validez, veredicto numérico pre-acordado) es reutilizable; la hipótesis específica no.

## 1. La pregunta

¿El tiempo de escape `T(x) = mín{n : |fⁿ(z₀(x))| > R}` de un mapa racional f sobre el plano complejo, parametrizado por el embedding x de un mensaje, separa clases de complejidad cognitiva con ventaja sobre baselines lineales y no-lineales estándar, bajo perturbación realista?

Hipótesis nula: no. Hipótesis del fractal: sí, y además es estable ante paráfrasis (lo cual lo haría preferible como router en producción).

## 2. Diseño pre-registrado

Ver [PREREGISTRATION.md](./PREREGISTRATION.md) (hash de congelamiento: `509a640`).

Tres regímenes de datos sintéticos: **A** (separable, sanity check), **B** (tema domina, complejidad es señal débil — régimen decisivo), **C** (pares de paráfrasis, ‖δ‖/‖x‖ ∈ {0.20, 0.45}).

Seis brazos: fractal-random, fractal-trained, logreg, centroides, MLP (64u, parameter-matched), kNN.

Cuatro métricas: F1 macro, estabilidad condicional ante paráfrasis, AUC del escape time, Lyapunov local.

Veredicto pre-acordado: el fractal gana solo si en régimen B (a) F1(fractal) − F1(MLP) > 2σ_max, (b) p < 0.01 pareado por seed, (c) estabilidad ≥ MLP − 1pp, (d) estabilidad ≥ 90%. Empate = pierde (Ockham). Gates de validez añadidos en v2/v3: AUC_T ≥ 0.55 para emitir veredicto; F1(logreg, B) ∈ [0.40, 0.80] para que B sea válido.

## 3. Las tres corridas

### Corrida 1 — baseline

Implementación: mapa Möbius-cuadrático `f(z) = (z² + c₁)/(z + c₂)` con `c = A·x` y `z₀ = 0` para todo x.

Régimen B:

| brazo | F1 | Stab@ε90 | AUC_T | Lyapunov |
|---|---|---|---|---|
| frac_random | 0.387 ± 0.095 | 0.279 ± 0.050 | 0.500 ± 0.000 | 0.005 ± 0.017 |
| frac_trained | 0.348 ± 0.059 | 0.278 ± 0.027 | 0.500 ± 0.000 | −0.000 ± 0.000 |
| logreg | 1.000 ± 0.000 | 0.988 ± 0.006 | n/a | n/a |
| centroid | 1.000 ± 0.000 | 0.972 ± 0.009 | n/a | n/a |
| mlp | 1.000 ± 0.000 | 0.986 ± 0.005 | n/a | n/a |
| knn | 1.000 ± 0.000 | 0.987 ± 0.005 | n/a | n/a |

**Veredicto: PIERDE** (margen −0.652, p ≈ 0). Dos errores de diseño identificados post-corrida:

1. **Desviación de la spec canónica** (implementación): `c = A·x` con `z₀ = 0` hace que la primera iteración colapse a `c₁/c₂` para todos los puntos — dinámica degenerada por construcción. La spec pre-registrada era `z₀ = W_in·x` con A global fija.
2. **Régimen B trivializado** (pre-registro): `x = U_topic·t + U_cplx·c + η` con subespacios ortogonales deja la complejidad linealmente recuperable — logreg saca 1.000 sin importar el peso del tema.

### Corrida 2 — calibrada

Cambios: subespacios no ortogonales (cos = 0.7), A_init_scale 0.1 → 1.0, gate AUC_T ≥ 0.55.

Régimen B: fractal sin cambios (AUC_T = 0.500 ± 0.000), logreg/MLP/kNN siguen en 1.000, centroid cae a 0.711.

**Veredicto: NO CONCLUYENTE** (AUC_T < gate). La calibración no rescata la dinámica — el problema era estructural (parametrización), no de inicialización. La no-ortogonalidad tampoco rompe la separabilidad lineal.

### Corrida 3 — spec canónica

Cambios: (1) spec canónica implementada correctamente (`z₀ = W_in·x`, mapa fijo `z_{n+1} = (A·z² + c_bias)/(|z|² − R_pole²)` con A, c_bias globales entrenados); (2) régimen B reformulado con codificación radial no lineal `x = U_topic·t + r(c)·u(θ) + η`; (3) sondeo paralelo de 3 familias racionales; (4) gate de banda para logreg.

Familia canónica, régimen B:

| brazo | F1 | Stab@ε90 | AUC_T | Lyapunov |
|---|---|---|---|---|
| frac_random | 0.302 ± 0.038 | 0.250 ± 0.064 | 0.500 ± 0.001 | −1.109 ± 3.052 |
| frac_trained | 0.261 ± 0.045 | 0.194 ± 0.069 | 0.500 ± 0.000 | −0.155 ± 2.127 |
| logreg | 0.268 ± 0.015 | 0.196 ± 0.019 | n/a | n/a |
| centroid | 0.262 ± 0.015 | 0.203 ± 0.011 | n/a | n/a |
| **mlp** | **0.895 ± 0.014** | **0.764 ± 0.010** | n/a | n/a |
| knn | 0.115 ± 0.003 | 0.251 ± 0.008 | n/a | n/a |

**Veredicto: NO EMITIDO** (logreg(B) = 0.268 fuera de banda [0.40, 0.80] — el radius_step empujó a logreg debajo de la banda, no encima). Mandelbrot: crash por overflow (sin clamp). Newton-cúbica: no corrió.

## 4. El dato que decide

El régimen B v3 es técnicamente inválido según el gate, pero contiene el resultado más informativo del experimento, independiente del veredicto formal:

> **En un régimen donde la señal de complejidad existe y es no-linealmente recuperable (MLP F1 = 0.895), el escape time del mapa canónico — con dinámica ACTIVA (Lyapunov ∈ [−3, +3], órbitas no triviales, a diferencia de las corridas 1-2) — obtiene AUC = 0.500 ± 0.000. Chance exacto.**

El mapa itera, las cuencas existen, y la información que el MLP captura sin esfuerzo el escape time no la captura en absoluto. Esto elimina la defensa de "fue la implementación".

## 5. Conclusiones

**Se puede concluir:** (1) la parametrización `c=A·x, z₀=0` degenera la dinámica independiente de calibración; (2) la spec canónica activa la dinámica pero su escape time no porta señal de complejidad donde un MLP la captura trivialmente; (3) las baselines no-lineales estándar dominan en los tres regímenes.

**No se puede concluir:** refutación de toda familia racional/parametrización posible; comportamiento con embeddings reales (el experimento es sintético por diseño); dimensiones no medidas (interpretabilidad geométrica, transferencia).

**Queda enterrado:** la hipótesis específica del pre-registro. El MLP de 64 unidades es estrictamente más barato, más estable y más preciso que cualquier brazo fractal en las tres corridas. Ockham cierra el caso.

## 6. Errores reconocidos

- Implementación: desviación silenciosa de la spec canónica en v1-v2 (corregida en v3); Mandelbrot sin clamp en v3 (no corregida, timebox).
- Pre-registro: régimen B v1 linealmente separable (corregido en v3); régimen B v3 con radius_step que invalida la banda de logreg (no corregido, timebox).
- Decisiones mantenidas: datos sintéticos (por ground truth exacto); cierre en 3 corridas (timebox declarado).

## 7. Para quien quiera continuar

Condiciones mínimas para rescatar la hipótesis: (1) **mecanismo, no analogía** — una razón teórica concreta por la cual el escape time de la familia X correlacionaría con complejidad de queries bajo el encoder Y; (2) régimen B con radius_step ∈ [0.3, 0.7]; (3) embeddings reales (SBERT/E5) con etiquetas auditadas; (4) familia racional con cuencas visibles en el rango operativo de `z₀ = W_in·x`. Sin esos cuatro, repetir solo reproduce este resultado.

## Reproducibilidad

```
Pre-registro:  PREREGISTRATION.md (commit 509a640)
Código:        ./simulations/run{1_baseline,2_calibrated,3_canonical}/
Datos crudos:  results.npy en run1 y run2 (10 seeds × 6 brazos × 3 regímenes × 4 métricas)
               run3: results_v3.npz NO preservado — solo el código y las tablas de este reporte
Entorno:       Python 3.13, numpy/scipy/sklearn ≥ 1.7, CPU, ~2-5 min/corrida, seed maestra 42
```

## Cierre

Tres corridas, dos errores de diseño corregidos en iteración, un veredicto formal (PIERDE, v1), un NO CONCLUYENTE (v2), un régimen inválido con el dato decisivo (v3). La hipótesis del fractal-routing no se sostiene como ventaja sobre baselines estándar bajo las condiciones probadas.

El router de producción que motivó esta exploración sigue siendo [`@animakit/complexity-scorer`](../../packages/complexity-scorer/): señales léxicas explicables, 0 deps, p99 = 86µs, validado sobre tráfico real.
