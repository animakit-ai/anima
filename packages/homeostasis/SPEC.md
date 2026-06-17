# SPEC: @animakit/homeostasis

---

## 1. Problema que resuelve

La mayoría de frameworks de agentes son **stateless entre turnos**: cada mensaje se procesa con la misma "intensidad", sin importar cuántas tareas hay en cola, cuántos errores acaban de ocurrir, o qué hora es. El resultado es un agente que no sabe cuándo está sobrecargado, no modula su tono según el contexto, y necesita rate-limits manuales para no gastar de más.

`homeostasis` le da a un agente un **estado interno persistente** (stress × dopamine), modelado sobre 100+ años de psicología — Yerkes-Dodson (1908), Allostasis (Sterling & Eyer 1988), el Circumplex de Russell (1980), y un bandit Thompson Sampling de 3 brazos que se auto-ajusta cada noche. Ese estado:

- modula si el agente **acepta o difiere** una tarea (sigmoide de aceptación),
- modula el **tono** de la respuesta (estado afectivo bidimensional),
- modula **biases de comportamiento** entre sub-agentes/roles (somatic markers, Damasio),
- y se **auto-regula** sin rate-limits hardcodeados — el set-point de "calma" se mueve según el contexto anticipado (allostasis).

Todo esto en <1µs, 0 tokens, 0 llamadas a LLM, completamente serializable (`toJSON`/`fromJSON`).

---

## 2. Fuente en Anima Core

`Anima_core/src/homeostasis/` — 1,424 líneas en 6 archivos:

| Archivo | Líneas | Estado de extracción |
|---|---|---|
| `HomeostasisEngine.ts` | 502 | **Acoplado** — I/O a Supabase, dep circular con `ConsciousnessTracker`, contexto de negocio hardcodeado |
| `AppraisalEngine.ts` | 247 | **Vocabulario hardcodeado** — mismo problema que `complexity-scorer` (keywords en español) + dependencia de tipo `IntentionType` del router |
| `PatternLearner.ts` | 327 | **Mixto** — Thompson Sampling es función pura (0 I/O); `predict()` consulta Supabase directo con schema de Anima |
| `AllostaticRegulator.ts` | 132 | **Limpio** — ya es función pura, 0 deps. Solo renombrar campos a vocabulario genérico |
| `HomeostaticProfiles.ts` | 64 | **Limpio** — genérico, sin cambios estructurales |
| `ValenceSpace.ts` | 152 | **Limpio** — pura, pero labels/tone solo en español → necesita versión bilingüe. Sub-export `@animakit/homeostasis/valence` (decisión ya tomada) |

**Este es el paquete más grande de Phase 1 y el más acoplado arquitectónicamente.** A diferencia de `complexity-scorer` (que solo necesitaba generalizar vocabulario), aquí el trabajo principal es **desacoplar I/O y dependencias circulares** — el vocabulario es un problema secundario (solo en `AppraisalEngine`).

### Los 4 puntos de acoplamiento a resolver

1. **`HomeostasisEngine.sync()` / `.persist()`** → llaman directo a `getSystemStatus`, `patchSystemStatus`, `getRecentBusinessState` de `SupabaseClient`. Además `sync()` construye un `_businessContext` en español con MRR/clientes/churn (Sprint 21) — 100% específico de Anima.
2. **`HomeostasisEngine.startDecayLoop()`** → hace un `require()` perezoso de `ConsciousnessTracker` para leer `kappa`, `ce_score`, `recentIgnitions` y alimentar `computeAllostaticTarget()`. Esto es una dependencia cruzada con el futuro paquete `causal-emergence`.
3. **`AppraisalEngine`** → importa `IntentionType` de `../router/IntentionParser.js` (solo usa 2 valores: `'venting'` y `'action_planning'`), y tiene 3 listas hardcodeadas en español: `HIGH_COPING_DOMAINS` (~21 términos), `LOW_COPING_DOMAINS` (~9), `EXTERNAL_AGENCY_SIGNALS` (~10).
4. **`PatternLearner.predict()`** → query directo a `interaction_metrics` en Supabase con columnas específicas (`stress_at_moment`, `is_sistema1`). El método `evaluateRewardAndUpdate()` (Thompson Sampling, líneas 237-302) es 100% puro — sin tocar DB.

---

## 3. API pública

```typescript
// ════════════════════════════════════════════════════════
// Core — HomeostasisEngine (Yerkes-Dodson state machine)
// ════════════════════════════════════════════════════════

export type HomeoMode = 'zen' | 'flow' | 'panic';

export interface HomeostasisConfig {
  /** Tasas de decaimiento natural hacia el set-point (γ, γd). Default: producción Anima. */
  decay?: {
    stressRate?: number;       // default 0.05
    dopamineRate?: number;     // default 0.02
    dopamineTarget?: number;   // default 0.5
  };
  /** Umbrales de modo zen/flow/panic. Default: 0.3 / 0.8 */
  modeThresholds?: { flow: number; panic: number };
  /** Sigmoide de aceptación de tareas (P_accept). Default: S_CRIT=0.8, k=10 */
  acceptance?: { panicThreshold?: number; sigmoidK?: number };
  /** Giant Fiber System — período refractario del veto. Default: producción Anima */
  veto?: { baseThreshold?: number; deltaT?: number; tauMs?: number };
  /** Marcadores somáticos (Damasio) — biases por rol/sub-agente. Opcional. */
  somaticBias?: {
    roles: Record<string, { stressWeight: number; dopamineWeight: number }>;
    maxBias?: number;   // default 0.08
    emaAlpha?: number;  // default 0.05
    flowZone?: { min: number; max: number }; // default { min: 0.15, max: 0.65 }
  };
  /** Deltas custom para recordInteraction(). Default: producción Anima */
  deltas?: {
    stress?: Record<string, number>;
    dopamine?: Record<string, number>;
  };
}

export interface HomeostasisSnapshot {
  stress: number;
  dopamine: number;
  mode: HomeoMode;
  allostaticTarget: number;
  lastVetoAt: string | null;
  activeConstraints: string[];
  somaticEMA: { stress: number; dopamine: number };
}

/** Motor principal — stateful, in-memory, serializable. 0 I/O. */
export class HomeostasisEngine {
  constructor(config?: HomeostasisConfig, snapshot?: Partial<HomeostasisSnapshot>);

  get stress(): number;
  get dopamine(): number;
  get mode(): HomeoMode;
  /** Set-point alostático actual — ver computeAllostaticTarget() */
  get allostaticTarget(): number;
  /** Estado afectivo bidimensional — ver @animakit/homeostasis/valence */
  get emotionalState(): EmotionalState;

  addStress(delta: number): void;
  addDopamine(delta: number): void;

  /** P_accept(S) = 1 / (1 + e^(k·(S - S_crit))) · priority */
  evaluateTaskAcceptance(priority?: number): boolean;

  /**
   * Aplica deltas tras una interacción: éxito/fallo, latencia, y opcionalmente
   * un AppraisalResult (de AppraisalEngine) que reemplaza los deltas por defecto.
   */
  recordInteraction(options: {
    success: boolean;
    responseTimeMs: number;
    appraisal?: AppraisalResult;
  }): void;

  /**
   * Avanza un tick de decaimiento natural (dS/dt, dD/dt hacia el set-point).
   * El caller controla el scheduling (setInterval, cron, etc.) — sin loops internos.
   * `allostaticTarget` es opcional — si se omite, decae hacia el target anterior.
   * Calcular el target dinámico con computeAllostaticTarget() (ver abajo).
   */
  tick(allostaticTarget?: number): void;

  // ── Giant Fiber System (veto / circuit breaker con período refractario) ──
  /** T(t) = T_base + ΔT × e^(-t/τ) */
  getEffectiveVetoThreshold(): number;
  recordVeto(constraints?: string[]): void;
  get activeConstraints(): string[];

  // ── Somatic markers (Damasio) — solo si somaticBias está configurado ──
  getSomaticBias(): { biases: Record<string, number>; active: boolean; reason: string };

  /** Aplica un perfil del bandit (ver HOMEOSTATIC_PROFILES) */
  setProfile(profile: HomeostaticProfile): void;

  // ── Serialización — persistencia es responsabilidad del caller ──
  toJSON(): HomeostasisSnapshot;
  static fromJSON(snapshot: HomeostasisSnapshot, config?: HomeostasisConfig): HomeostasisEngine;
}

// ════════════════════════════════════════════════════════
// Allostasis — set-point dinámico (Sterling & Eyer 1988)
// Ya es función pura en el original — solo se generalizan nombres de campos.
// ════════════════════════════════════════════════════════

export interface AllostaticInput {
  /** Modo de "energía libre anticipada": 'zen' | 'alert' | 'active' | 'urgent' */
  fepMode: string;
  /** Índice de criticidad κ (de @animakit/causal-emergence). null si no disponible. */
  kappa: number | null;
  /** Causal Emergence CE̊ promedio. null si no disponible. */
  ceScore: number | null;
  /** Cuántas de las últimas N interacciones dispararon "ignición" (alta saliencia) */
  recentIgnitions: number;
  /** Hora local del agente (0-23) — para deltas de horario laboral */
  hourLocal: number;
}

export interface AllostaticResult {
  /** Set-point dinámico ∈ [minTarget, maxTarget] */
  target: number;
  deltas: Record<string, number>;
  label: string;
}

export interface AllostaticConfig {
  baseTarget?: number;  // default 0.10
  minTarget?: number;   // default 0.10
  maxTarget?: number;   // default 0.55
  /** Deltas por hora del día. Default: horario laboral Bogotá (9-13 pico, 22-6 noche) */
  hourlyPeriods?: Array<{ startHour: number; endHour: number; delta: number; label: string }>;
}

/** Pura — sin efectos secundarios. <0.1ms */
export function computeAllostaticTarget(input: AllostaticInput, config?: AllostaticConfig): AllostaticResult;

// ════════════════════════════════════════════════════════
// Appraisal — evaluación cognitiva del evento (Lazarus/Scherer)
// Mismo patrón de vocabulario extend/replace que complexity-scorer.
// ════════════════════════════════════════════════════════

export interface AppraisalResult {
  novelty: number;
  relevance: number;
  coping: number;
  agency: 'self' | 'other' | 'circumstance';
  valence: 'positive' | 'negative' | 'neutral';
  stressDelta: number;
  dopamineDelta: number;
  label: string;
}

export interface AppraisalConfig {
  vocabulary?: {
    highCopingDomains?: { extend?: string[]; replace?: string[] };
    lowCopingDomains?: { extend?: string[]; replace?: string[] };
    externalAgencySignals?: { extend?: string[]; replace?: string[] };
  };
  /** Default: 'bilingual' (EN+ES genérico) */
  language?: 'en' | 'es' | 'bilingual';
}

export class AppraisalEngine {
  constructor(config?: AppraisalConfig);

  /**
   * @param message      — mensaje recibido
   * @param options.intentionHint — hint de intención del caller (e.g. 'venting' | 'action_planning').
   *                                 String genérico — el caller mapea su propia taxonomía de intenciones.
   * @param options.goals — metas activas del usuario (para scoreRelevance)
   * @param options.recentContext — historial reciente (para scoreNovelty)
   */
  evaluate(message: string, options?: {
    intentionHint?: string;
    goals?: string[];
    recentContext?: string;
  }): AppraisalResult;

  /** Formatea el appraisal como contexto inyectable (solo si valence !== 'neutral') */
  static formatContext(appraisal: AppraisalResult): string;
}

// ════════════════════════════════════════════════════════
// Profiles — 3-arm bandit (Conservative/Balanced/Proactive)
// Genérico, sin cambios estructurales.
// ════════════════════════════════════════════════════════

export interface HomeostaticProfile {
  arm: 0 | 1 | 2;
  name: string;
  /** Multiplicador para umbrales de iniciativa proactiva del caller (e.g. FEP) */
  fepThresholdMult: number;
  /** Multiplicador aplicado a deltas de stress en recordInteraction() */
  stressMult: number;
}

export const HOMEOSTATIC_PROFILES: HomeostaticProfile[]; // [Conservative, Balanced, Proactive]
export function getProfile(arm: number): HomeostaticProfile;

// ════════════════════════════════════════════════════════
// Bandit — Thompson Sampling (extraído de PatternLearner, función pura)
// ════════════════════════════════════════════════════════

export interface ArmBetaParams { alpha: number; beta: number; }

export interface BanditState {
  activeArm: 0 | 1 | 2;
  armsBetaParams: { '0': ArmBetaParams; '1': ArmBetaParams; '2': ArmBetaParams };
}

/** Episodio genérico de un período (día/sprint) bajo un arm activo */
export interface BanditEpisode {
  activeArm: 0 | 1 | 2;
  /** true = resultado positivo bajo este arm, false = negativo, null = sin señal (no actualiza) */
  outcome: boolean | null;
  /** Opcional: precisión predictiva del período [0,1] — ajusta el reward (ver AgentConfigEvolver) */
  confidenceScore?: number | null;
}

/** Pura — Thompson Sampling vía Beta(α,β) exacto (Gamma ratio). <0.05ms */
export function updateBanditState(episodes: BanditEpisode[], state: BanditState): BanditState;

// ════════════════════════════════════════════════════════
// Load prediction (extraído de PatternLearner.predict — sin I/O)
// El caller provee el historial; el paquete no consulta ninguna DB.
// ════════════════════════════════════════════════════════

export interface HistoryRecord {
  timestamp: string; // ISO
  stress: number;
  /** true si la interacción fue reactiva (vs proactiva del agente) */
  reactive: boolean;
}

export interface LoadPrediction {
  expectedEvents: number;
  expectedStress: number;
  recommendedMode: HomeoMode;
  peakDayOfWeek: number;   // 0=domingo
  peakHourLocal: number;   // 0-23
  daysOfHistory: number;
  reliable: boolean; // daysOfHistory >= minReliableDays
}

export interface LoadPredictionConfig {
  minReliableDays?: number;  // default 7
  forecastWindowHours?: number; // default 3
  utcOffsetHours?: number; // default 0 — caller especifica su timezone
}

/** Pura — recibe historial pre-cargado por el caller. <1ms para 10k registros. */
export function predictLoad(history: HistoryRecord[], config?: LoadPredictionConfig): LoadPrediction | null;

// ════════════════════════════════════════════════════════
// Presets
// ════════════════════════════════════════════════════════

export const presets: {
  /** Vocabulario genérico EN+ES para AppraisalEngine — default */
  bilingual: AppraisalConfig['vocabulary'];
  /** Vocabulario EXACTO en producción en Anima (legal/fiscal CO + SaaS) */
  animaProduction: AppraisalConfig['vocabulary'];
  /** Config de somaticBias EXACTA en producción — los 5 roles de Anima
   *  (JEFE, VIGIA, ARQUITECTO, OFICIAL, NEGOCIADOR) con sus pesos originales */
  animaProductionRoles: HomeostasisConfig['somaticBias'];
};
```

```typescript
// ════════════════════════════════════════════════════════
// Sub-export: @animakit/homeostasis/valence
// ValenceSpace — Russell Circumplex (1980). Ya es pura.
// Cambio: labels y tone_instruction bilingües (EN+ES).
// ════════════════════════════════════════════════════════

export type EmotionName =
  | 'excited' | 'alert' | 'anxious'
  | 'engaged' | 'focused' | 'tense'
  | 'content' | 'calm' | 'low';

export interface EmotionalState {
  emotion: EmotionName;
  label_en: string;
  label_es: string;
  tone_instruction_en: string;
  tone_instruction_es: string;
  arousal_zone: 'high' | 'medium' | 'low';
  valence_zone: 'positive' | 'neutral' | 'negative';
  arousal: number;  // [0,1] — normalmente = stress
  valence: number;  // [-1,1] — normalmente = (dopamine - 0.5) * 2
}

export interface ValenceConfig {
  /** Default: AROUSAL_HIGH=0.52, AROUSAL_LOW=0.28, VALENCE_POS=0.08, VALENCE_NEG=-0.08 */
  thresholds?: { arousalHigh?: number; arousalLow?: number; valencePos?: number; valenceNeg?: number };
}

/** Pura — sin efectos secundarios. <0.05ms */
export function computeEmotionalState(stress: number, dopamine: number, config?: ValenceConfig): EmotionalState;
```

**Decisión de diseño — `tick()` reemplaza `startDecayLoop()`:** el original corre un `setInterval` de 60s que internamente hace `require()` de `ConsciousnessTracker` para recalcular el target alostático. En el paquete extraído, el motor no programa nada ni conoce `ConsciousnessTracker` — el caller llama `tick(allostaticTarget?)` en su propio scheduler, calculando `allostaticTarget` con `computeAllostaticTarget()` usando datos de `@animakit/causal-emergence` (o cualquier otra fuente). Esto rompe la dependencia circular del original sin perder funcionalidad.

**Decisión de diseño — `toJSON()`/`fromJSON()` reemplazan `sync()`/`persist()`:** el motor es 100% in-memory. El caller decide dónde y cómo persistir el snapshot (Postgres, Redis, archivo JSON, etc.). El `_businessContext` de Sprint 21 (MRR/clientes/churn en español) NO se extrae — es lógica de negocio de Anima; el caller puede construir su propio string de contexto a partir de `stress`/`dopamine`/`emotionalState`/`allostaticTarget`.

**Decisión de diseño — `somaticBias` genérico por roles configurables:** el original hardcodea 5 roles (JEFE, VIGIA, ARQUITECTO, OFICIAL, NEGOCIADOR) con fórmulas específicas (`sNorm * M`, `dNorm * M * 0.7`, etc.). El paquete generaliza esto a `Record<string, {stressWeight, dopamineWeight}>` — cada rol define cuánto le afecta el estrés normalizado y la dopamina normalizada. `presets.animaProductionRoles` reproduce exactamente los 5 roles y pesos originales (incluyendo OFICIAL con weight=0 — "nunca sesgar decisiones legales", un detalle que vale la pena destacar en el README).

---

## 4. Lo que NO incluye

- **Persistencia** — `toJSON()`/`fromJSON()` son la interfaz; Supabase/Postgres/Redis es responsabilidad del caller.
- **FreeEnergyEngine / mensajería proactiva** — `fepThresholdMult` es solo un número que el perfil expone; el motor que decide CUÁNDO hablar primero (FEP) no es parte de este paquete.
- **Cálculo de κ (criticality) y CE̊ (causal emergence)** — `computeAllostaticTarget()` los recibe como inputs numéricos opcionales; calcularlos es responsabilidad de `@animakit/causal-emergence`.
- **Contexto de negocio (MRR, churn, pipeline)** — Sprint 21 de `HomeostasisEngine.sync()`, 100% específico de Anima/Cloution, no se extrae.
- **`IntentionType` del router** — `AppraisalEngine.evaluate()` recibe un `intentionHint?: string` genérico en su lugar; el caller mapea su propia taxonomía.
- **Llamadas a LLM, async por diseño** — `predictLoad()` recibe el historial pre-cargado; no hace queries.
- **Aprendizaje/evolución de pesos más allá del bandit de 3 arms** — eso es `AgentConfigEvolver` (→ `sprt-evolution`, paquete separado).

---

## 5. Dependencias

0. Igual que el original (una vez removido Supabase, el require perezoso de `ConsciousnessTracker`, y el import de `IntentionType`).

---

## 6. Benchmark

**Tabla 1 — Latencia:**
```
HomeostasisEngine.tick() / addStress() / evaluateTaskAcceptance()
computeAllostaticTarget() / computeEmotionalState() / updateBanditState()
→ p50, p95, p99 en nanosegundos/microsegundos, 100k iteraciones
```

**Tabla 2 — Auto-regulación en producción real:**
```
Serie temporal de stress/dopamine de system_status (53 sprints)
→ % de tiempo en zen / flow / panic
→ "El sistema se auto-regula sin rate-limits manuales — nunca pasa
   más de N horas seguidas en panic"
```

**Tabla 3 — Convergencia del bandit Thompson Sampling:**
```
Historial real de active_arm + arms_beta_params (53 sprints / noches)
→ qué arm ganó cada noche, evolución de Beta(α,β) por arm
→ "El sistema aprendió en N noches que el perfil X funciona mejor
   para este patrón de uso — sin intervención manual"
```

La Tabla 2 es la más fuerte para el ángulo "Cost control through biology, not rate limits" — convierte el copy de `POSITIONING.md` en un gráfico verificable.

---

## 7. Narrativa del README

**Hook (primera línea):**
> Give your agent a mood — modeled on 100 years of psychology. Stress curves (Yerkes-Dodson 1908), affect mapping (Russell 1980), allostatic regulation (Sterling & Eyer 1988), and a self-tuning 3-arm bandit. <1µs, 0 tokens, fully serializable.

**Estructura del README:**
1. Hook + badges
2. Tabla 2 del benchmark (auto-regulación) — el gráfico de stress/dopamine real es la prueba visual más fuerte
3. Quickstart de 5-8 líneas: crear engine, `addStress`, `evaluateTaskAcceptance`, leer `emotionalState`
4. "Why this exists" — battle-tested, 53 sprints, Tabla 3 (bandit convergence)
5. API reference completa (Core / Allostasis / Appraisal / Profiles / Bandit / Load Prediction)
6. Sección "Vocabulario" (AppraisalEngine) — `presets.bilingual` vs `presets.animaProduction`, mismo ángulo que `complexity-scorer`
7. Sección "Roles & somatic bias" — `presets.animaProductionRoles` como ejemplo de cómo Anima sesga sus 5 sub-agentes, con la nota "OFICIAL nunca se sesga — las decisiones legales quedan fuera del bias afectivo"
8. Sub-paquete `@animakit/homeostasis/valence` — documentado como módulo independiente reusable (cualquier app con un score de "ánimo" 2D puede usarlo)

**Frases del banco de copy (`POSITIONING.md`) a usar:**
- "Your agent doesn't know when to stop. Yerkes-Dodson (1908) does."
- "Cost control through biology, not rate limits."
- "500 million years of evolution already solved the problems your agent framework is struggling with."

---

## 8. Contenido de lanzamiento

- **Blog post:** "I gave my AI agent stress and dopamine — here's what happened over 53 sprints" (1500-2000 palabras). Ancla narrativa para el blog largo de homeostasis (Semana 5) — este post es la versión corta/técnica que sale primero.
- **Twitter/X:** thread de 8-12 tweets, imagen central = gráfico de la Tabla 2 (serie temporal stress/dopamine real con zonas zen/flow/panic sombreadas)
- **LinkedIn:** post framing "Mi agente no necesita rate-limits — tiene un sistema nervioso. Esto es lo que pasó en 53 sprints."
- **HN:** "Show HN: @animakit/homeostasis — Yerkes-Dodson stress modeling for LLM agents, <1µs, 0 deps"

---

## Checklist de extracción

- [ ] Copiar los 6 archivos a `packages/homeostasis/src/`
- [ ] **Desacoplar persistencia**: reemplazar `sync()`/`persist()` por `toJSON()`/`fromJSON()`; remover `_businessContext` (Sprint 21)
- [ ] **Desacoplar `ConsciousnessTracker`**: reemplazar `startDecayLoop()` (setInterval + require perezoso) por `tick(allostaticTarget?)` — el caller calcula el target con `computeAllostaticTarget()`
- [ ] **Generalizar `AllostaticRegulator`**: renombrar `hourBogota`→`hourLocal`, `ce_score`→`ceScore`; mover deltas de horario a `AllostaticConfig.hourlyPeriods` (default = valores de producción)
- [ ] **Generalizar `AppraisalEngine`**: implementar `vocabulary.{extend,replace}` para `HIGH_COPING_DOMAINS`/`LOW_COPING_DOMAINS`/`EXTERNAL_AGENCY_SIGNALS`; reemplazar `IntentionType` por `intentionHint?: string`
- [ ] **Separar `PatternLearner`**: extraer `evaluateRewardAndUpdate()` → `updateBanditState()` (pura); reescribir `predict()` → `predictLoad(history, config)` sin queries a Supabase
- [ ] **Generalizar somatic bias**: `somaticBias.roles: Record<string, {stressWeight, dopamineWeight}>`; crear `presets.animaProductionRoles` con los 5 roles originales (incluyendo OFICIAL = 0)
- [ ] **Bilingue `ValenceSpace`**: agregar `label_en`/`tone_instruction_en` junto a `label_es`/`tone_instruction_es`
- [ ] Construir `presets.bilingual` y `presets.animaProduction` (vocabulario AppraisalEngine) — mismo patrón que `complexity-scorer`
- [ ] Tests: 100% coverage, incluir snapshot round-trip (`toJSON`→`fromJSON`), casos bilingües, y bandit convergence determinístico (seed de RNG para tests)
- [ ] Extraer muestra anonimizada de `system_status` (serie temporal stress/dopamine + active_arm history, 53 sprints) para Tabla 2 y Tabla 3
- [ ] Benchmark scripts (`benchmarks/latency.ts`, `benchmarks/regulation.ts`, `benchmarks/bandit-convergence.ts`)
- [ ] README siguiendo la estructura de la sección 7
