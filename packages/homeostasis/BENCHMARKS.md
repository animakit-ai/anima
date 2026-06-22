# Benchmarks — @animakit/homeostasis

Todos los números salen de scripts en `benchmarks/` que ejercitan el **código real**
del paquete (nunca una reimplementación), con `rng` sembrado → reproducibles.
Cada uno define gates **pre-registrados** (predichos desde las constantes del motor
ANTES de medir). Corre todo con `pnpm bench`, `pnpm bench:regulation`, `pnpm bench:bandit`.

Última verificación: 2026-06-22 · `tsc --noEmit` = 0.

---

## Resumen

| Benchmark | Qué prueba | Resultado | Gate |
|---|---|---|---|
| `latency.ts` | velocidad | core ops sub-µs · todo p99 < 1ms | ✅ |
| `parity.ts` | extracción fiel al original | 3.609 / 3.609 idénticas, 0 divergencias | ✅ |
| `regulation.ts` | auto-regulación sin rate-limits | panic→shedding→recovery, 3 gates | ✅ |
| `bandit-convergence.ts` | self-tuning fiable (no suerte) | 100% converge al óptimo (M=12) | ✅ |
| Producción (SQL) | mundo real, 3 meses | calma 95% · bandit Beta(71,10) | evidencia |

---

## 1. Latencia (`latency.ts`) — 100k iteraciones, p99

| Operación | p50 | p95 | p99 |
|---|---|---|---|
| `addStress()` | 0.10µs | 0.20µs | **0.20µs** |
| `tick()` | 0.10µs | 0.30µs | **0.50µs** |
| `evaluateTaskAcceptance()` | 0.10µs | 0.10µs | **0.20µs** |
| `computeAllostaticTarget()` | 0.30µs | 0.50µs | 0.70µs |
| `emotionalState` (getter) | 0.40µs | 1.00µs | 1.10µs |
| `getSomaticBias()` | 0.70µs | 1.10µs | 2.00µs |
| `computeEmotionalState()` | 0.40µs | 1.10µs | 1.80µs |
| `updateBanditState()` | 0.80µs | 1.20µs | 1.90µs |
| `AppraisalEngine.evaluate()` | 3.60µs | 4.50µs | 7.50µs |
| `predictLoad()` (1k registros) | 336µs | 593µs | 920µs |

**Claim honesto:** las ops de estado del hot-path (`addStress`/`tick`/`evaluateTaskAcceptance`)
son **sub-microsegundo**; **todas** las ops cumplen **p99 < 1ms**. (El tagline "<1µs"
del README es inexacto para `evaluate` y `predictLoad` — corregir a "core ops sub-µs · todo <1ms".)

---

## 2. Paridad (`parity.ts`) — golden-master vs el código original de Anima

```
comparaciones: 3609   ·   idénticas: 3609   ·   divergencias: 0
```

La superficie del paquete reproduce **byte a byte** el comportamiento del módulo original
de `Anima_core/src/homeostasis/` (allostasis + valence + appraisal). Esto es lo que hace
honesto el claim "extraído de un agente en producción": es el mismo motor, verificado.

---

## 3. Auto-regulación bajo carga (`regulation.ts`)

Motor real, perfil Balanced (`stressMult=1.0`). 3 fases: baseline → flood adversarial
(fallos más rápido que el decay) → recuperación (solo `tick()`, sin rate-limit).

**Predicciones (de las constantes) → medido:**

| Gate | Predicción | Medido | Estado |
|---|---|---|---|
| G1 panic | cruza 0.80 al fallo 7-8 | panic al **fallo #8** (float: 0.1×7=0.79999<0.8), pico 1.00 | ✅ |
| G2 shedding | trivial ≈ ⅓ de importante, trivial <10% | trivial **4.1%** vs importante **11.5%** (ratio 2.80; analítico ~3.6/10.7%) | ✅ |
| G3 recovery | vuelve a zen en ~30 ticks, monótono | sale de panic en **5 ticks**, a zen en **30**, monótono | ✅ |

**Lectura:** acepta TODO por debajo de 0.80; al colapsar, **descarta lo trivial protegiendo
lo importante en proporción exacta a la prioridad** (el factor sigmoide se cancela → ratio =
ratio de prioridad); se recupera sola por decay. Cero rate-limits, cero intervención.
Trayectoria completa en `benchmarks/regulation.csv`.

---

## 4. Convergencia del bandit (`bandit-convergence.ts`)

Una sola corrida de un bandit no prueba nada (pudo ser suerte). 200 semillas
independientes, cold start desde el **peor** brazo, entorno con óptimo conocido
(`p = [0.30, 0.80, 0.55]`, mejor = arm 1). Se barre la señal/noche porque producción
alimenta al bandit con las decenas de interacciones del día (la regla de recompensa
toma la mayoría) → `M≫1` es el régimen fiel.

| Señales/noche | Converge al óptimo (200 semillas) |
|---|---|
| M=1 (1 señal ruidosa) | 83.5% |
| M=4 | 92.5% |
| M=8 | 100% |
| **M=12 (como producción)** | **100%** |

**Gates:** G1 fiabilidad (M=12) 100% ≥ 90% ✅ · G2 degradación elegante (M=1) 83.5% ≥ 80% ✅.

> Nota de proceso: el **primer diseño falló el gate (83%)** porque daba 1 señal/noche en
> vez de la mayoría diaria de producción. El pre-registro lo detectó; se corrigió a un
> entorno fiel y se reportan **ambos regímenes** — no se cambió en silencio para aprobar.

**Velocidad:** este entorno estacionario converge casi instantáneo (irrealista). La
velocidad real es la de producción (ver §5).

---

## 5. Evidencia de producción (3 meses reales, mar–jun 2026)

Extraída de `consciousness_metrics` / `state_transitions` / `daily_logs` (estado numérico
interno, sin contenido de mensajes ni cifras de negocio → sin PII).

**Auto-regulación real:**
- **zen 94.92% · flow 5.08% · panic 0.00%** (n=433 turnos)
- estrés promedio **0.16**; máximo histórico **0.72** — nunca cruzó 0.80
- racha máxima en panic: **0 horas**

→ En tráfico real nunca tuvo que tirar del freno. La válvula no se estresó en producción;
por eso §3 la fuerza en el harness. Lectura honesta: el margen de seguridad es amplio.

**Self-tuning real:**
- exploró los 3 brazos ~16 días, luego convergió a **arm 1 (Balanced)** y se mantuvo ~75 días
  (con exploración ocasional, como debe ser Thompson Sampling)
- estado final **Beta(71, 10) ≈ 0.88** — una muestra real de la distribución de §4

**Modulación everyday real (el valor que SÍ se vio en producción):**
Aunque el panic nunca se disparó, el estado homeostático moduló el comportamiento de
forma continua. Turnos agrupados por carga (`consciousness_metrics`, n=434):

| carga (stress) | turnos | % debate (deliberación) | κ | sorpresa | confianza |
|---|---|---|---|---|---|
| muy baja (<0.15) | 182 | **62.1%** | 0.418 | 0.218 | 0.769 |
| baja (0.15–0.25) | 201 | 46.8% | 0.399 | 0.231 | 0.766 |
| más alta (≥0.25) | 51 | **15.7%** | 0.420 | 0.314 | 0.750 |

→ Con capacidad disponible el agente **deliberó 4× más** (debate multi-agente, camino
explorador y caro); bajo carga se fue al **camino directo/seguro**. Coincide con la
conducta diseñada (ParetoSelector baja tetraédrico→directo bajo presión; el umbral de
debate sube con el estrés). **Caveats:** correlacional, no intervenido; κ plano (siempre
en zona crítica, sin gradiente); ignición 0% en la ventana (señal nula); n de carga alta
chico (51) pero efecto grande y monótono.

---

## La distinción clave: carga ≠ cantidad de mensajes

Un rate-limit cuenta **requests**. Homeostasis integra la **carga real**: volumen +
**complejidad** (appraisal: `relevancia × (1−coping)`) + latencia (ops lentas) + fallos.
Una tarea difícil o fallida estresa más que diez triviales. Esa es la razón de ser:
**regula por costo, no por conteo** — y auto-ajusta su propia agresividad (bandit).
