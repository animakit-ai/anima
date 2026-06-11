// ══════════════════════════════════════════
// ComplexityScorer — Pure function, 0 LLM tokens, ~0ms
// Estimates query complexity on 5 signals for routing optimization.
// Feeds: dynamic DEBATE_THRESHOLD, model tier selection, TraceCollector.
// ══════════════════════════════════════════

export type ComplexityTier = 'micro' | 'small' | 'medium' | 'large';

export interface ComplexitySignals {
    length:          number;  // 0-1  normalized character count
    domain:          number;  // 0-1  technical/domain keyword density
    structure:       number;  // 0-1  conjunction/subordination density
    reasoning:       number;  // 0-1  causal/conditional language density
    contextRequired: number;  // 0-1  anaphoric reference density
}

export interface ComplexityResult {
    score:   number;           // 0-1 weighted composite
    signals: ComplexitySignals;
    tier:    ComplexityTier;
}

// ── Signal weights (must sum to 1.0) ──────────────────────────────
const W_LENGTH  = 0.20;
const W_DOMAIN  = 0.25;
const W_STRUCT  = 0.20;
const W_REASON  = 0.20;
const W_CONTEXT = 0.15;

// ── Tier thresholds ───────────────────────────────────────────────
const TIER_MICRO_MAX  = 0.25;  // < 0.25  → micro  (deepseek-chat, fast)
const TIER_SMALL_MAX  = 0.45;  // < 0.45  → small  (deepseek-chat)
const TIER_MEDIUM_MAX = 0.65;  // < 0.65  → medium (claude-haiku or equivalent)
//                              // ≥ 0.65  → large  (keep agent default model)

// ── Domain vocabulary (both ES and EN, as Anima receives bilingual input) ──
const DOMAIN_KEYWORDS: string[] = [
    // Technical
    'implementar', 'arquitectura', 'algoritmo', 'sistema', 'api', 'base de datos',
    'integración', 'backend', 'frontend', 'deployment', 'docker', 'kubernetes',
    'pipeline', 'webhook', 'autenticación', 'escalabilidad', 'rendimiento', 'latencia',
    'microservicio', 'endpoint', 'protocolo', 'cifrado', 'seguridad', 'certificado',
    // Legal / tax
    'contrato', 'tributario', 'fiscal', 'retención', 'iva', 'declaración',
    'régimen', 'obligación', 'normativa', 'reglamento', 'estatuto', 'jurídico',
    'retefuente', 'dian', 'rut', 'nit', 'facturación electrónica', 'nomina',
    'cesantías', 'cámara de comercio', 'primas', 'seguridad social',
    // Business / strategy
    'estrategia', 'modelo de negocio', 'competencia', 'mercado', 'posicionamiento',
    'diferenciación', 'ventaja competitiva', 'go-to-market', 'roadmap', 'producto',
    'mrr', 'arr', 'churn', 'ltv', 'cac', 'funnel', 'conversión', 'pipeline comercial',
    'propuesta de valor', 'segmentación', 'retención', 'expansión',
    // Research / analysis
    'análisis', 'investigar', 'evaluar', 'comparar', 'sintetizar', 'revisar',
    'hipótesis', 'conclusión', 'evidencia', 'datos', 'métricas', 'kpis',
    'diagnóstico', 'proyección', 'escenario', 'sensibilidad', 'riesgo',
    // Finance
    'valoración', 'equity', 'flujo de caja', 'balance', 'p&l', 'ebitda',
    'inversión', 'financiamiento', 'deuda', 'capital', 'dividendos',
];

// ── Structural markers (conjunctions, discourse connectors) ────────
const STRUCTURE_MARKERS: string[] = [
    'además', 'sin embargo', 'no obstante', 'por otro lado', 'también',
    'aunque', 'mientras', 'asimismo', 'por consiguiente', 'en consecuencia',
    'dado que', 'a pesar de', 'en cambio', 'por ende', 'de modo que',
    'en primer lugar', 'en segundo lugar', 'finalmente', 'por un lado',
    'en definitiva', 'es decir', 'o sea', 'esto implica', 'lo cual',
    'por su parte', 'cabe destacar', 'de igual manera', 'en este sentido',
    'dicho esto', 'ahora bien', 'con todo', 'a su vez',
];

// ── Reasoning / causal markers ────────────────────────────────────
const REASONING_PATTERNS: RegExp[] = [
    /\bporque\b/i,
    /\bdado que\b/i,
    /\bsi\b.{0,20}\bentonces\b/i,
    /\bimplica\b/i,
    /\bpor lo tanto\b/i,
    /\ba raíz de\b/i,
    /\bcomo resultado\b/i,
    /\blo que significa\b/i,
    /\bpor qué\b/i,
    /\bcuál es la razón\b/i,
    /\bqué factores\b/i,
    /\bcómo afecta\b/i,
    /\bqué pasaría si\b/i,
    /\bcuál sería el impacto\b/i,
    /\banaliza\b/i,
    /\brazona\b/i,
    /\bexplica por qué\b/i,
    /\bquiero entender\b/i,
    /\bcausa\b.*\befecto\b/i,
];

// ── Anaphoric / context-requiring references ───────────────────────
const CONTEXT_PATTERNS: RegExp[] = [
    /\b(esto|eso|aquello|ello)\b/i,
    /\bdicho\b/i,
    /\bmencionado\b/i,
    /\bel mismo\b|\bla misma\b|\blos mismos\b|\blas mismas\b/i,
    /\bante esto\b/i,
    /\bcomo te dec[íi]a\b/i,
    /\bsiguiendo con\b/i,
    /\brespecto a lo\b/i,
    /\bsobre lo anterior\b/i,
    /\bcon base en eso\b/i,
    /\beso que (dij|mencion|coment)/i,
    /\blo que (dij|mencion|pregunt)/i,
];

// ─────────────────────────────────────────────────────────────────
// Signal computations
// ─────────────────────────────────────────────────────────────────

function lengthSignal(text: string): number {
    const chars = text.length;
    if (chars < 30)   return 0.03;
    if (chars < 80)   return 0.12;
    if (chars < 200)  return 0.30;
    if (chars < 400)  return 0.50;
    if (chars < 700)  return 0.68;
    if (chars < 1000) return 0.82;
    return Math.min(1.0, 0.82 + (chars - 1000) / 4000);
}

function domainSignal(text: string): number {
    const lower = text.toLowerCase();
    const wordCount = Math.max(lower.split(/\s+/).length, 1);
    let hits = 0;
    for (const kw of DOMAIN_KEYWORDS) {
        if (lower.includes(kw)) hits++;
    }
    if (hits === 0) return 0;
    // Normalize by sqrt(words) so dense short messages don't dominate
    return Math.min(1.0, hits / Math.sqrt(wordCount));
}

function structureSignal(text: string): number {
    const lower = text.toLowerCase();
    const wordCount = Math.max(lower.split(/\s+/).length, 1);
    let hits = 0;
    for (const marker of STRUCTURE_MARKERS) {
        if (lower.includes(marker)) hits++;
    }
    if (hits === 0) return 0;
    return Math.min(1.0, hits / Math.sqrt(Math.max(wordCount, 5)));
}

function reasoningSignal(text: string): number {
    let hits = 0;
    for (const pattern of REASONING_PATTERNS) {
        if (pattern.test(text)) hits++;
    }
    if (hits === 0) return 0;
    return Math.min(1.0, hits / 4); // saturate at 4 reasoning markers
}

function contextSignal(text: string): number {
    let hits = 0;
    for (const pattern of CONTEXT_PATTERNS) {
        if (pattern.test(text)) hits++;
    }
    if (hits === 0) return 0;
    return Math.min(1.0, hits / 3); // saturate at 3 anaphoric references
}

function tierFromScore(score: number): ComplexityTier {
    if (score < TIER_MICRO_MAX)  return 'micro';
    if (score < TIER_SMALL_MAX)  return 'small';
    if (score < TIER_MEDIUM_MAX) return 'medium';
    return 'large';
}

// ─────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────

/**
 * Scores query complexity on 5 weighted signals.
 * Pure function — no I/O, no LLM, ~0ms.
 *
 * Used by:
 *   - RouterEngine: adjusts DEBATE_THRESHOLD dynamically
 *   - Agent.handle(): selects model tier before LLM call
 *   - TraceCollector: logs complexity for learning loop
 */
export function scoreComplexity(message: string): ComplexityResult {
    const signals: ComplexitySignals = {
        length:          lengthSignal(message),
        domain:          domainSignal(message),
        structure:       structureSignal(message),
        reasoning:       reasoningSignal(message),
        contextRequired: contextSignal(message),
    };

    const score =
        W_LENGTH  * signals.length  +
        W_DOMAIN  * signals.domain  +
        W_STRUCT  * signals.structure +
        W_REASON  * signals.reasoning +
        W_CONTEXT * signals.contextRequired;

    return {
        score: +score.toFixed(4),
        signals,
        tier: tierFromScore(score),
    };
}
