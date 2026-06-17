// AppraisalEngine — Cognitive Appraisal Theory (Lazarus / Scherer).
//
// Emotions arise not from events but from the cognitive appraisal of whether
// an event is relevant to the agent's goals. Implements Scherer's GRID model
// (4 appraisal dimensions):
//   novelty   — is this new or repetitive information?
//   relevance — does it affect the user's active goals?
//   coping    — can the agent handle it well? (perceived competence)
//   agency    — who controls the situation?
//
// Output: contextual stress/dopamine deltas — not just by event cost.
//
// Pure — 0 I/O, 0 LLM. <1ms.

import {
  ES_APPRAISAL_VOCABULARY,
  EN_APPRAISAL_VOCABULARY,
  bilingualAppraisalVocabulary,
  type AppraisalVocabulary,
} from './vocabulary.js';

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

export interface VocabularyOverride {
  /** Append to the base list. */
  extend?: string[];
  /** Replace the base list entirely. */
  replace?: string[];
}

export interface AppraisalConfig {
  vocabulary?: {
    highCopingDomains?: VocabularyOverride;
    lowCopingDomains?: VocabularyOverride;
    externalAgencySignals?: VocabularyOverride;
  };
  /** Base vocabulary. Default: 'bilingual' (EN+ES). */
  language?: 'en' | 'es' | 'bilingual';
}

// ── Vocabulary resolution ────────────────────────────────────────────────────

function resolveBaseVocabulary(language: 'en' | 'es' | 'bilingual'): AppraisalVocabulary {
  if (language === 'es') return ES_APPRAISAL_VOCABULARY;
  if (language === 'en') return EN_APPRAISAL_VOCABULARY;
  return bilingualAppraisalVocabulary();
}

function mergeList(base: string[], override?: VocabularyOverride): string[] {
  if (override?.replace) return [...new Set(override.replace.map((s) => s.toLowerCase()))];
  if (override?.extend) return [...new Set([...base, ...override.extend].map((s) => s.toLowerCase()))];
  return [...new Set(base.map((s) => s.toLowerCase()))];
}

// ── Scoring ──────────────────────────────────────────────────────────────────

function scoreNovelty(message: string, recentContext: string): number {
  const msgWords = new Set(message.toLowerCase().match(/\b\w{5,}\b/g) ?? []);
  const historyWords = new Set(recentContext.toLowerCase().match(/\b\w{5,}\b/g) ?? []);
  const overlap = [...msgWords].filter((w) => historyWords.has(w)).length;
  const novelRatio = msgWords.size > 0 ? 1 - Math.min(overlap / msgWords.size, 1) : 0.5;
  return Math.max(0.2, Math.min(0.9, novelRatio));
}

function scoreRelevance(message: string, goals: string[]): number {
  if (goals.length === 0) return 0.5;
  const msgLower = message.toLowerCase();
  const matchingGoals = goals.filter((goal) => {
    const goalWords = goal.toLowerCase().match(/\b\w{4,}\b/g) ?? [];
    return goalWords.some((w) => msgLower.includes(w));
  });
  return Math.min(0.3 + (matchingGoals.length / goals.length) * 0.7, 1.0);
}

function scoreCoping(message: string, vocab: AppraisalVocabulary): number {
  const msgLower = message.toLowerCase();
  const highHits = vocab.highCopingDomains.filter((kw) => msgLower.includes(kw)).length;
  const lowHits = vocab.lowCopingDomains.filter((kw) => msgLower.includes(kw)).length;
  if (lowHits > 0) return Math.max(0.2, 0.5 - lowHits * 0.15);
  if (highHits > 0) return Math.min(0.9, 0.6 + highHits * 0.1);
  return 0.6;
}

function detectAgency(message: string, vocab: AppraisalVocabulary): 'self' | 'other' | 'circumstance' {
  const msgLower = message.toLowerCase();
  const externalHits = vocab.externalAgencySignals.filter((sig) => msgLower.includes(sig)).length;
  if (externalHits >= 2) return 'other';
  if (externalHits === 1) return 'circumstance';
  return 'self';
}

function computeDeltas(a: {
  novelty: number;
  relevance: number;
  coping: number;
  agency: 'self' | 'other' | 'circumstance';
}): { stressDelta: number; dopamineDelta: number; valence: 'positive' | 'negative' | 'neutral' } {
  const { novelty, relevance, coping, agency } = a;
  let stressDelta = 0;
  let dopamineDelta = 0;

  if (relevance > 0.5) {
    if (coping >= 0.65) {
      // Energizing challenge: relevant AND within competence.
      dopamineDelta += relevance * coping * 0.12;
      stressDelta -= relevance * 0.03;
    } else {
      // Threat: relevant but low coping.
      stressDelta += relevance * (1 - coping) * 0.15;
      dopamineDelta -= relevance * (1 - coping) * 0.05;
    }
  }

  if (agency === 'other') {
    stressDelta += 0.04;
    dopamineDelta -= 0.02;
  } else if (agency === 'circumstance') {
    stressDelta += 0.02;
  }

  if (novelty > 0.6 && coping >= 0.5) {
    dopamineDelta += novelty * 0.03;
  }

  stressDelta = Math.round(stressDelta * 1000) / 1000;
  dopamineDelta = Math.round(dopamineDelta * 1000) / 1000;

  const valence: 'positive' | 'negative' | 'neutral' =
    dopamineDelta > 0.008 ? 'positive' : stressDelta > 0.015 ? 'negative' : 'neutral';

  return { stressDelta, dopamineDelta, valence };
}

// ── Engine ───────────────────────────────────────────────────────────────────

export class AppraisalEngine {
  private readonly vocab: AppraisalVocabulary;

  constructor(config: AppraisalConfig = {}) {
    const base = resolveBaseVocabulary(config.language ?? 'bilingual');
    this.vocab = {
      highCopingDomains: mergeList(base.highCopingDomains, config.vocabulary?.highCopingDomains),
      lowCopingDomains: mergeList(base.lowCopingDomains, config.vocabulary?.lowCopingDomains),
      externalAgencySignals: mergeList(
        base.externalAgencySignals,
        config.vocabulary?.externalAgencySignals,
      ),
    };
  }

  /**
   * Appraises a message across 4 cognitive dimensions and returns contextual
   * homeostasis deltas.
   *
   * @param message — the received message
   * @param options.intentionHint — generic intention hint from the caller
   *   (e.g. 'venting' | 'action_planning'); the caller maps its own taxonomy.
   * @param options.goals — active user goals (for relevance scoring)
   * @param options.recentContext — recent history (for novelty scoring)
   */
  evaluate(
    message: string,
    options: { intentionHint?: string; goals?: string[]; recentContext?: string } = {},
  ): AppraisalResult {
    const novelty = scoreNovelty(message, options.recentContext ?? '');
    const relevance = scoreRelevance(message, options.goals ?? []);
    const coping = scoreCoping(message, this.vocab);
    const agency = detectAgency(message, this.vocab);

    // Intention adjustment: venting lowers perceived coping; planning raises it.
    const effectiveCoping =
      options.intentionHint === 'venting'
        ? Math.min(coping, 0.45)
        : options.intentionHint === 'action_planning'
          ? Math.max(coping, 0.65)
          : coping;

    const { stressDelta, dopamineDelta, valence } = computeDeltas({
      novelty,
      relevance,
      coping: effectiveCoping,
      agency,
    });

    const copingLabel =
      effectiveCoping >= 0.65
        ? 'high competence'
        : effectiveCoping >= 0.45
          ? 'medium competence'
          : 'low competence';
    const relevanceLabel =
      relevance >= 0.6 ? 'high goal relevance' : relevance >= 0.35 ? 'medium relevance' : 'low relevance';
    const label = `${relevanceLabel} · ${copingLabel} · control ${agency}`;

    return {
      novelty,
      relevance,
      coping: effectiveCoping,
      agency,
      valence,
      stressDelta,
      dopamineDelta,
      label,
    };
  }

  /** Formats the appraisal as injectable context (only when valence !== 'neutral'). */
  static formatContext(appraisal: AppraisalResult): string {
    if (appraisal.valence === 'neutral') return '';
    const icon = appraisal.valence === 'positive' ? '⚡' : '⚠️';
    return [
      `=== ${icon} COGNITIVE APPRAISAL ===`,
      `Appraisal: ${appraisal.label}`,
      appraisal.valence === 'positive'
        ? `Energizing event — adjustment: dopamine +${(appraisal.dopamineDelta * 100).toFixed(1)}%`
        : `Load event — adjustment: stress +${(appraisal.stressDelta * 100).toFixed(1)}%`,
    ].join('\n');
  }
}
