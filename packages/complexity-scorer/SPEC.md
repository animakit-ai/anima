# SPEC: @animakit/complexity-scorer

---

## 1. Problema que resuelve

La mayoría de frameworks de agentes envían cada mensaje al mismo modelo (caro), sin importar su complejidad. `complexity-scorer` clasifica un mensaje en un tier de complejidad en <1ms, 0 tokens, 0 llamadas a LLM — para que el caller decida a qué modelo rutear.

---

## 2. Fuente en Anima Core

`Anima_core/src/router/ComplexityScorer.ts` (209 líneas).

**Estado de la extracción: el más limpio de los 14.** Ya es una función pura, 0 dependencias, 0 I/O. El trabajo de extracción NO es desacoplar lógica — es **generalizar el vocabulario**.

Hoy, 4 de los 5 signals dependen de listas hardcodeadas en español, específicas al dominio de Anima (legal/fiscal colombiano + negocio):

| Constante | Líneas | Contenido actual |
|---|---|---|
| `DOMAIN_KEYWORDS` | ~24 | Términos técnicos + DIAN/fiscal colombiano (`retefuente`, `dian`, `rut`, `nit`...) + business/SaaS (`mrr`, `churn`, `cac`...) — todo en español |
| `STRUCTURE_MARKERS` | ~9 | Conectores discursivos en español (`además`, `sin embargo`, `por consiguiente`...) |
| `REASONING_PATTERNS` | ~19 regex | Marcadores causales en español (`porque`, `por lo tanto`, `qué pasaría si`...) |
| `CONTEXT_PATTERNS` | ~12 regex | Referencias anafóricas en español (`esto`, `lo que dijiste`, `respecto a lo`...) |

`lengthSignal()`, `tierFromScore()`, los pesos (`W_LENGTH`...`W_CONTEXT`) y los thresholds de tier son universales — no requieren cambios.

---

## 3. API pública

```typescript
export type ComplexityTier = 'micro' | 'small' | 'medium' | 'large';

export interface ComplexitySignals {
  length: number;
  domain: number;
  structure: number;
  reasoning: number;
  contextRequired: number;
}

export interface ComplexityResult {
  score: number;
  signals: ComplexitySignals;
  tier: ComplexityTier;
}

export interface ComplexityScorerConfig {
  /** Pesos de los 5 signals. Deben sumar 1.0. Default: pesos de producción de Anima. */
  weights?: ComplexitySignals;

  /** Umbrales de tier (micro/small/medium → large). Default: 0.25 / 0.45 / 0.65 */
  tierThresholds?: { micro: number; small: number; medium: number };

  /** Vocabulario de los signals léxicos. 'extend' agrega al default, 'replace' lo sustituye. */
  vocabulary?: {
    domainKeywords?: { extend?: string[]; replace?: string[] };
    structureMarkers?: { extend?: string[]; replace?: string[] };
    reasoningPatterns?: { extend?: RegExp[]; replace?: RegExp[] };
    contextPatterns?: { extend?: RegExp[]; replace?: RegExp[] };
  };

  /** Vocabulario base. Default: 'bilingual' (EN+ES genérico). */
  language?: 'en' | 'es' | 'bilingual';
}

/** Función principal — stateless, pura. */
export function scoreComplexity(message: string, config?: ComplexityScorerConfig): ComplexityResult;

/** Crea un scorer con config fija — evita reconstruir vocabulario en cada llamada (hot path). */
export function createScorer(config: ComplexityScorerConfig): (message: string) => ComplexityResult;

/** Presets exportados */
export const presets: {
  /** Vocabulario genérico EN+ES — default */
  bilingual: ComplexityScorerConfig['vocabulary'];
  /** El vocabulario EXACTO en producción en Anima (legal/fiscal CO + SaaS) — usado como ejemplo en docs */
  animaProduction: ComplexityScorerConfig['vocabulary'];
};
```

**Decisión de diseño — vocabulario `extend` vs `replace`:** el caso común es que el usuario AGREGUE su jerga de dominio (legal, médico, fintech) sin perder los conectores/patrones de razonamiento genéricos, que son universales en cualquier idioma natural. `replace` existe para usuarios que quieran control total o trabajen en un idioma no cubierto por los presets.

**Decisión de diseño — `createScorer()`:** en producción, Anima llama `scoreComplexity()` en cada turno del pipeline (Step 3.6). Si el vocabulario se reconstruye (arrays + regex compilation) en cada llamada, eso es overhead innecesario en el hot path. `createScorer(config)` precompila una vez y devuelve una función ligera — `scoreComplexity()` internamente es `createScorer(defaultConfig)(message)`.

---

## 4. Lo que NO incluye

- Selección de modelo — el scorer devuelve `tier`, el caller decide qué modelo usar para cada tier (eso es responsabilidad de `neuromorphic-router` o del propio usuario)
- Llamadas a LLM, async, I/O
- Detección de idioma — el preset `bilingual` cubre EN+ES simultáneamente sin detección (los regex/keywords de ambos idiomas se evalúan siempre)
- Aprendizaje/adaptación de pesos — eso es `AgentConfigEvolver` (→ `sprt-evolution`, paquete separado). `complexity-scorer` es determinista y estático por diseño.

---

## 5. Dependencias

0. Igual que el original.

---

## 6. Benchmark

Tres tablas para el README, todas con datos verificables:

**Tabla 1 — Latencia:**
```
scoreComplexity() sobre 10,000 mensajes reales (anonimizados de agent_traces)
→ p50, p95, p99 en microsegundos
```

**Tabla 2 — Distribución de tiers en producción real:**
```
% de mensajes que cayeron en micro / small / medium / large
(datos de 53 sprints de agent_traces — el "battle-tested" claim con números)
```

**Tabla 3 — La tabla que se viraliza — costo con pricing real de Junio 2026:**
```
1,000 mensajes reales, routing por tier:
  micro/small  → Ollama local (qwen3:14b, $0)         o MAI-Code-1-Flash
  medium       → Claude Fable 5 ($10/$50 por M tokens)
  large        → Claude Mythos 5

vs.

1,000 mensajes, todos a Mythos 5 (naive)

→ costo total naive vs costo total con scorer, % de ahorro
```

La Tabla 3 es la que va en el primer tweet thread y en el blog post de homeostasis (Semana 5) — necesita datos reales de Anima, no sintéticos. Acción: extraer una muestra de 1,000 mensajes de `agent_traces` (anonimizados) antes de Semana 3.

---

## 7. Narrativa del README

**Hook (primera línea):**
> Classify LLM tasks in <1ms with zero tokens — before you ever call an LLM.

**Estructura del README:**
1. Hook + badges (npm version, bundle size, zero deps, coverage)
2. Tabla 3 del benchmark (costo) — primero, antes de cualquier explicación
3. Quickstart de 5 líneas de código
4. "Why this exists" — battle-tested en producción, 53 sprints, link a `agent_traces` distribution (Tabla 2)
5. API reference completa
6. Sección "Vocabulario" — explica `presets.bilingual` vs `presets.animaProduction`, cómo extender

**Sección "Vocabulario" — el ángulo de marketing:**
> `presets.animaProduction` is the *exact* configuration running in Anima's production agent — Colombian tax/legal terminology, business/SaaS vocabulary, all of it. Use it as a reference for building your own domain vocabulary.

Esto convierte el preset en prueba social directa: "esto es literalmente lo que corre en producción".

---

## 8. Contenido de lanzamiento

- **Blog post:** post corto (800-1200 palabras) enfocado solo en el scorer — "5 signals, <1ms, 0 tokens: how Anima routes 70% of messages away from expensive models". El post largo de homeostasis (Semana 5) construye sobre este.
- **Twitter/X:** thread de 8-10 tweets con la Tabla 3 (costo) como imagen/tabla central
- **LinkedIn:** post corto con el benchmark de costo, framing "ROI inmediato"
- **HN:** "Show HN: @animakit/complexity-scorer — classify LLM tasks in <1ms, 0 tokens, 0 deps"

---

## Checklist de extracción

- [ ] Copiar `ComplexityScorer.ts` al nuevo paquete
- [ ] Separar `lengthSignal`, `tierFromScore`, pesos, thresholds (universales — sin cambios)
- [ ] Construir `presets.bilingual`: traducir/expandir `STRUCTURE_MARKERS`, `REASONING_PATTERNS`, `CONTEXT_PATTERNS` a inglés, mantener versión española como parte del bilingual set
- [ ] Mover `DOMAIN_KEYWORDS`, `STRUCTURE_MARKERS`, `REASONING_PATTERNS`, `CONTEXT_PATTERNS` actuales (tal cual, en español, dominio Anima) a `presets.animaProduction`
- [ ] Implementar `createScorer(config)` con merge de `extend`/`replace`
- [ ] `scoreComplexity = createScorer(defaultConfig)`
- [ ] Tests: 100% coverage, incluir casos bilingües
- [ ] Extraer muestra de 1,000 mensajes de `agent_traces` para Tabla 2 y Tabla 3 (anonimizar `userId`, contenido de mensajes si es necesario)
- [ ] Benchmark script (`benchmarks/latency.ts`, `benchmarks/cost-comparison.ts`)
- [ ] README siguiendo la estructura de la sección 7
