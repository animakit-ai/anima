// @animakit/complexity-scorer
// Classify LLM tasks in <1ms with zero tokens — 5 weighted signals → tier.
// Pure functions, 0 deps, 0 I/O. Extracted from Anima's production router.

import { ES_VOCABULARY, EN_VOCABULARY, ANIMA_PRODUCTION_VOCABULARY } from './vocabulary.js';
import type { VocabularySet } from './vocabulary.js';

export type { VocabularySet } from './vocabulary.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type ComplexityTier = 'micro' | 'small' | 'medium' | 'large';

export interface ComplexitySignals {
  /** 0-1 normalized character count */
  length: number;
  /** 0-1 technical/domain keyword density */
  domain: number;
  /** 0-1 discourse connector density */
  structure: number;
  /** 0-1 causal/conditional language density */
  reasoning: number;
  /** 0-1 anaphoric reference density */
  contextRequired: number;
}

export interface ComplexityResult {
  /** 0-1 weighted composite */
  score: number;
  signals: ComplexitySignals;
  tier: ComplexityTier;
}

export interface VocabularyOverride<T> {
  /** Append to the base vocabulary */
  extend?: T[];
  /** Replace the base vocabulary entirely */
  replace?: T[];
}

export interface ComplexityScorerConfig {
  /** Signal weights — must sum to 1.0 (±0.001). Default: Anima production weights. */
  weights?: ComplexitySignals;
  /** Upper bounds for micro/small/medium. Default: 0.25 / 0.45 / 0.65 */
  tierThresholds?: { micro: number; small: number; medium: number };
  vocabulary?: {
    domainKeywords?: VocabularyOverride<string>;
    structureMarkers?: VocabularyOverride<string>;
    reasoningPatterns?: VocabularyOverride<RegExp>;
    contextPatterns?: VocabularyOverride<RegExp>;
  };
  /** Base vocabulary. Default: 'bilingual' (EN+ES). */
  language?: 'en' | 'es' | 'bilingual';
  /**
   * Keyword matching strategy.
   * 'word' (default): whole-word, diacritic-insensitive — 'rut' will NOT match "rutina",
   *   and "retencion" (no accent) WILL match 'retención'.
   * 'substring': legacy behavior of the original production scorer (plain
   *   lowercase `includes`) — kept for exact replication via presets.animaProduction.
   */
  matching?: 'word' | 'substring';
  /** Hit counts where reasoning/context signals saturate at 1.0. Default: 4 / 3 */
  saturation?: { reasoning?: number; context?: number };
  /**
   * Length signal curve: sorted [maxChars, value] breakpoints, then a linear tail.
   * Default replicates production: <30→0.03 ... <1000→0.82, then +1 per 4000 chars.
   */
  lengthCurve?: {
    breakpoints: Array<[maxChars: number, value: number]>;
    tail: { start: number; base: number; growthPer: number };
  };
}

// ── Defaults (Anima production constants) ───────────────────────────────────

const DEFAULT_WEIGHTS: ComplexitySignals = {
  length: 0.2,
  domain: 0.25,
  structure: 0.2,
  reasoning: 0.2,
  contextRequired: 0.15,
};

// Default thresholds calibrated against 50 blind operator labels on real
// production traffic (grid search + leave-one-out CV: 52% exact, 82% within
// ±1 tier, under-routing 38% vs 54% with the original production thresholds).
// The original production thresholds (0.25/0.45/0.65) live in presets.animaProduction.
const DEFAULT_THRESHOLDS = { micro: 0.18, small: 0.215, medium: 0.395 };
const PRODUCTION_THRESHOLDS = { micro: 0.25, small: 0.45, medium: 0.65 };
const DEFAULT_SATURATION = { reasoning: 4, context: 3 };
const DEFAULT_LENGTH_CURVE: NonNullable<ComplexityScorerConfig['lengthCurve']> = {
  breakpoints: [
    [30, 0.03],
    [80, 0.12],
    [200, 0.3],
    [400, 0.5],
    [700, 0.68],
    [1000, 0.82],
  ],
  tail: { start: 1000, base: 0.82, growthPer: 4000 },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Lowercase + strip combining diacritics (qué→que, retención→retencion). */
function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function dedupe(list: string[]): string[] {
  return [...new Set(list)];
}

function mergeStrings(base: string[], override?: VocabularyOverride<string>): string[] {
  if (override?.replace) return dedupe(override.replace);
  if (override?.extend) return dedupe([...base, ...override.extend]);
  return dedupe(base);
}

function mergeRegexes(base: RegExp[], override?: VocabularyOverride<RegExp>): RegExp[] {
  if (override?.replace) return [...override.replace];
  if (override?.extend) return [...base, ...override.extend];
  return [...base];
}

function resolveBaseVocabulary(language: 'en' | 'es' | 'bilingual'): VocabularySet {
  if (language === 'es') return ES_VOCABULARY;
  if (language === 'en') return EN_VOCABULARY;
  return {
    domainKeywords: [...ES_VOCABULARY.domainKeywords, ...EN_VOCABULARY.domainKeywords],
    structureMarkers: [...ES_VOCABULARY.structureMarkers, ...EN_VOCABULARY.structureMarkers],
    reasoningPatterns: [...ES_VOCABULARY.reasoningPatterns, ...EN_VOCABULARY.reasoningPatterns],
    contextPatterns: [...ES_VOCABULARY.contextPatterns, ...EN_VOCABULARY.contextPatterns],
  };
}

/**
 * Compile a keyword list into a single whole-word alternation regex over
 * normalized text. One regex pass replaces N `includes()` scans (hot path).
 * Longer alternatives first so multi-word phrases win over their prefixes.
 */
function compileWordMatcher(keywords: string[]): RegExp | null {
  if (keywords.length === 0) return null;
  const escaped = keywords
    .map((k) => escapeRegex(normalize(k)))
    .sort((a, b) => b.length - a.length)
    .join('|');
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${escaped})(?![\\p{L}\\p{N}])`, 'giu');
}

// ── Signal computations ──────────────────────────────────────────────────────

function lengthSignal(text: string, curve: NonNullable<ComplexityScorerConfig['lengthCurve']>): number {
  const chars = text.length;
  for (const [max, value] of curve.breakpoints) {
    if (chars < max) return value;
  }
  const { start, base, growthPer } = curve.tail;
  return Math.min(1.0, base + (chars - start) / growthPer);
}

interface CompiledLexicon {
  wordMatcher: RegExp | null;     // 'word' mode
  rawKeywords: string[];          // 'substring' mode (legacy)
}

function countKeywordHits(
  normalized: string,
  plainLower: string,
  lex: CompiledLexicon,
  mode: 'word' | 'substring',
): number {
  if (mode === 'substring') {
    let hits = 0;
    for (const kw of lex.rawKeywords) {
      if (plainLower.includes(kw)) hits++;
    }
    return hits;
  }
  if (!lex.wordMatcher) return 0;
  lex.wordMatcher.lastIndex = 0;
  const seen = new Set<string>();
  for (const m of normalized.matchAll(lex.wordMatcher)) {
    seen.add(m[0]);
  }
  return seen.size;
}

function countRegexHits(text: string, patterns: RegExp[]): number {
  let hits = 0;
  for (const p of patterns) {
    if (p.test(text)) hits++;
  }
  return hits;
}

// ── Scorer factory ───────────────────────────────────────────────────────────

/**
 * Creates a scorer with a fixed config — vocabulary is merged and compiled
 * once, so the returned function is cheap to call per message (hot path).
 */
export function createScorer(config: ComplexityScorerConfig = {}): (message: string) => ComplexityResult {
  const weights = config.weights ?? DEFAULT_WEIGHTS;
  const wSum =
    weights.length + weights.domain + weights.structure + weights.reasoning + weights.contextRequired;
  if (Math.abs(wSum - 1.0) > 0.001) {
    throw new Error(`complexity-scorer: weights must sum to 1.0 (got ${wSum.toFixed(4)})`);
  }

  const t = config.tierThresholds ?? DEFAULT_THRESHOLDS;
  if (!(t.micro < t.small && t.small < t.medium)) {
    throw new Error('complexity-scorer: tierThresholds must satisfy micro < small < medium');
  }

  const saturation = {
    reasoning: config.saturation?.reasoning ?? DEFAULT_SATURATION.reasoning,
    context: config.saturation?.context ?? DEFAULT_SATURATION.context,
  };
  const curve = config.lengthCurve ?? DEFAULT_LENGTH_CURVE;
  const mode = config.matching ?? 'word';

  const base = resolveBaseVocabulary(config.language ?? 'bilingual');
  const domainKeywords = mergeStrings(base.domainKeywords, config.vocabulary?.domainKeywords);
  const structureMarkers = mergeStrings(base.structureMarkers, config.vocabulary?.structureMarkers);
  const reasoningPatterns = mergeRegexes(base.reasoningPatterns, config.vocabulary?.reasoningPatterns);
  const contextPatterns = mergeRegexes(base.contextPatterns, config.vocabulary?.contextPatterns);

  const domainLex: CompiledLexicon = {
    wordMatcher: compileWordMatcher(domainKeywords),
    rawKeywords: domainKeywords.map((k) => k.toLowerCase()),
  };
  const structureLex: CompiledLexicon = {
    wordMatcher: compileWordMatcher(structureMarkers),
    rawKeywords: structureMarkers.map((k) => k.toLowerCase()),
  };

  function tierFromScore(score: number): ComplexityTier {
    if (score < t.micro) return 'micro';
    if (score < t.small) return 'small';
    if (score < t.medium) return 'medium';
    return 'large';
  }

  return function score(message: string): ComplexityResult {
    const plainLower = message.toLowerCase();
    const normalized = mode === 'word' ? normalize(message) : plainLower;
    const wordCount = Math.max(plainLower.split(/\s+/).length, 1);

    const domainHits = countKeywordHits(normalized, plainLower, domainLex, mode);
    const structureHits = countKeywordHits(normalized, plainLower, structureLex, mode);
    const reasoningHits = countRegexHits(message, reasoningPatterns);
    const contextHits = countRegexHits(message, contextPatterns);

    const signals: ComplexitySignals = {
      length: lengthSignal(message, curve),
      domain: domainHits === 0 ? 0 : Math.min(1.0, domainHits / Math.sqrt(wordCount)),
      structure: structureHits === 0 ? 0 : Math.min(1.0, structureHits / Math.sqrt(Math.max(wordCount, 5))),
      reasoning: reasoningHits === 0 ? 0 : Math.min(1.0, reasoningHits / saturation.reasoning),
      contextRequired: contextHits === 0 ? 0 : Math.min(1.0, contextHits / saturation.context),
    };

    const composite =
      weights.length * signals.length +
      weights.domain * signals.domain +
      weights.structure * signals.structure +
      weights.reasoning * signals.reasoning +
      weights.contextRequired * signals.contextRequired;

    return {
      score: +composite.toFixed(4),
      signals,
      tier: tierFromScore(composite),
    };
  };
}

// ── Default scorer (lazy singleton over default config) ─────────────────────

let defaultScorer: ((message: string) => ComplexityResult) | undefined;

/**
 * Scores message complexity on 5 weighted signals.
 * Pure — no I/O, no LLM, <1ms. Uses the default bilingual config; pass a
 * config for one-off custom scoring, or use createScorer() on hot paths.
 */
export function scoreComplexity(message: string, config?: ComplexityScorerConfig): ComplexityResult {
  if (config) return createScorer(config)(message);
  defaultScorer ??= createScorer();
  return defaultScorer(message);
}

// ── Presets ──────────────────────────────────────────────────────────────────

export const presets: {
  /** Generic Spanish-only base */
  es: ComplexityScorerConfig;
  /** Generic English-only base */
  en: ComplexityScorerConfig;
  /** EN+ES — the default */
  bilingual: ComplexityScorerConfig;
  /**
   * The EXACT configuration running in Anima's production agent: Colombian
   * tax/legal + SaaS vocabulary (Spanish), legacy substring matching.
   * Use it as a reference for building your own domain vocabulary.
   */
  animaProduction: ComplexityScorerConfig;
} = {
  es: { language: 'es' },
  en: { language: 'en' },
  bilingual: { language: 'bilingual' },
  animaProduction: {
    language: 'es',
    matching: 'substring',
    tierThresholds: PRODUCTION_THRESHOLDS,
    vocabulary: {
      domainKeywords: { replace: ANIMA_PRODUCTION_VOCABULARY.domainKeywords },
      structureMarkers: { replace: ANIMA_PRODUCTION_VOCABULARY.structureMarkers },
      reasoningPatterns: { replace: ANIMA_PRODUCTION_VOCABULARY.reasoningPatterns },
      contextPatterns: { replace: ANIMA_PRODUCTION_VOCABULARY.contextPatterns },
    },
  },
};
