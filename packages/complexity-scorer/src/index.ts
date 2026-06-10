// @animakit/complexity-scorer
// Classify LLM tasks in <1ms with zero tokens.
// Extraction target: Anima_core/src/router/ComplexityScorer.ts (see SPEC.md)
//
// Public API (per SPEC.md §3) — implementation lands in Week 2-3.

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

export interface VocabularyOverride<T> {
  extend?: T[];
  replace?: T[];
}

export interface ComplexityScorerConfig {
  /** Signal weights — must sum to 1.0. Default: Anima production weights. */
  weights?: ComplexitySignals;
  /** Tier thresholds (micro/small/medium → large). Default: 0.25 / 0.45 / 0.65 */
  tierThresholds?: { micro: number; small: number; medium: number };
  vocabulary?: {
    domainKeywords?: VocabularyOverride<string>;
    structureMarkers?: VocabularyOverride<string>;
    reasoningPatterns?: VocabularyOverride<RegExp>;
    contextPatterns?: VocabularyOverride<RegExp>;
  };
  /** Base vocabulary. Default: 'bilingual' (generic EN+ES). */
  language?: 'en' | 'es' | 'bilingual';
}

/**
 * Create a scorer with fixed config — precompiles vocabulary once (hot path).
 */
export function createScorer(_config: ComplexityScorerConfig): (message: string) => ComplexityResult {
  throw new Error('@animakit/complexity-scorer: not yet implemented — extraction in progress (see SPEC.md)');
}

/**
 * Main entry — stateless, pure. <1ms, 0 tokens, 0 LLM calls.
 */
export function scoreComplexity(_message: string, _config?: ComplexityScorerConfig): ComplexityResult {
  throw new Error('@animakit/complexity-scorer: not yet implemented — extraction in progress (see SPEC.md)');
}
