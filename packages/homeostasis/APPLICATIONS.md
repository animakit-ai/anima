# Aplicaciones — @animakit/homeostasis

Dónde aporta valor un estado homeostático (stress × dopamine) con sigmoide
Yerkes-Dodson, set-point alostático, marcadores somáticos y un bandit Thompson
de 3 brazos auto-ajustable. Evidencia de cada claim en [`BENCHMARKS.md`](./BENCHMARKS.md).

---

## La tesis: carga ≠ conteo

Un rate-limit cuenta **requests**. Homeostasis integra la **carga real**:

```
carga = volumen + complejidad(appraisal: relevancia × (1−coping)) + latencia + fallos
```

Una tarea difícil o que falla estresa más que diez triviales. El valor unificador:
**una sola señal de control adaptativa** que reemplaza una pila de umbrales
hand-tuned (rate limits, topes de reintento, circuit breakers, switches de modo) —
y que **ajusta su propia agresividad** vía el bandit. No es un framework: es la capa
de decisión "qué tan fuerte trabajar / aceptar / qué estrategia usar".

Encaja donde corre JS/TS (0 deps, 0 I/O, core ops sub-µs, serializable): backends,
edge gateways, dispositivos con Node. *No* en MCU bare-metal en C — aunque el
algoritmo (pura aritmética) se porta trivialmente.

---

## A. Era de la IA — agentes y sistemas

1. **Gobernanza de costo en loops agénticos.** Agentes autónomos (ReAct, multi-step,
   always-on) acumulan carga por fallos/reintentos/pasos complejos. La sigmoide
   **descarta sub-tareas triviales bajo presión protegiendo las importantes** en vez
   de chocar contra rate-limits o disparar el gasto. → Evidencia: `regulation.ts` §3
   (en panic, trivial 4.1% vs importante 11.5%).

2. **Circuit breaker biológico.** Fallos de tools/APIs suben el estrés → backoff con
   **curva de recuperación refractaria** (`T(t)=T_base+ΔT·e^(−t/τ)`), no un breaker
   binario. Se cura solo (recuperación en 5→30 ticks, §3).

3. **Auto-tuning del modo de operación.** Elegir sin humano entre estrategias: tier de
   modelo, profundidad de RAG, debate-vs-directo. El bandit converge al óptimo de forma
   fiable. → Evidencia: `bandit-convergence.ts` §4 (100% con señal de producción) +
   producción real (Beta(71,10) tras ~16 días de exploración).

4. **Orquestación multi-agente / swarms.** Cada worker con su estado homeostático; el
   orquestador rutea trabajo a los "en calma" y deja recuperarse a los "estresados".
   Balanceo por estado interno, no por largo de cola.

5. **Control de tono/UX (valence).** Agentes de cara al cliente que modulan el tono
   desde el **estado acumulado del hilo** (no el sentimiento de un mensaje suelto).
   Es una señal de control, no "sentimientos".

6. **Edge-AI / TinyML.** Decidir *correr el modelo local vs diferir/offload* según
   carga acumulada + batería. Puente directo entre homeostasis e "IA en el dispositivo".

---

## B. IoT y edge

1. **Backpressure con prioridad en el gateway.** Un gateway que agrega muchos sensores
   recibe ráfagas; descarta telemetría rutinaria bajo carga pero **garantiza las
   alarmas** (la sigmoide con prioridad de §3 mapea directo: lectura rutinaria =
   trivial; alarma de seguridad = alta prioridad → pasa aunque esté en panic).

2. **Presupuesto de batería/energía (allostasis).** El set-point alostático ya se mueve
   por hora del día / contexto anticipado = punto de operación consciente de energía.
   Batería baja o de noche → baja el set-point (hace menos); en red o pico → lo sube.
   Allostasis = regulación *anticipatoria*, justo lo que quiere el power management.

3. **Estrategia de muestreo/transmisión por dispositivo (bandit).** Cada nodo elige:
   frecuencia de muestreo, transmitir-ya vs batch, local vs nube. El bandit converge a
   la mejor estrategia **por dispositivo** según conectividad/batería reales, sin tunear
   a mano cada nodo — clave en flotas de miles.

4. **Pronóstico de carga (`predictLoad()` — ya existe).** Forecast de eventos esperados
   y hora pico desde el historial con timestamps → predecir picos de sensores y
   pre-asignar duty cycle. Función exportada, no hipotética.

5. **Circuit breaker para conectividad inestable.** Transmisiones fallidas suben estrés
   → backoff refractario (no martillar un uplink caído) con recuperación biológica.
   Load-aware y auto-curable, mejor que reintentos de intervalo fijo.

6. **Salud de flota en una señal.** El `mode` (zen/flow/panic) de cada nodo = resumen
   compacto de "qué tan estresado está" → balanceo a nivel flota y mantenimiento
   predictivo. El snapshot serializable es diminuto y viaja barato.

---

## Límites honestos

- **Es una lib JS/TS**, no un binario embebido: tier gateway/Node, no MCU en C.
- **Es una capa de control, no un framework**: decide cuánta carga aceptar / qué
  estrategia — el muestreo, la transmisión o la llamada al LLM siguen siendo tuyos.
- **El bandit necesita señal por período**: con 1 señal ruidosa/noche la fiabilidad
  baja a ~83% (§4); con la carga real de un día (M≫1) llega a 100%.
