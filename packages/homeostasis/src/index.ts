// @animakit/homeostasis
// Give your LLM agent a mood — modeled on 100 years of psychology.
// Yerkes-Dodson stress curves (1908), Russell affect mapping (1980), allostatic
// regulation (Sterling & Eyer 1988), and a self-tuning 3-arm bandit.
// <1µs, 0 tokens, 0 I/O, fully serializable. Extracted from Anima's production agent.

import {
  ANIMA_PRODUCTION_APPRAISAL_VOCABULARY,
  bilingualAppraisalVocabulary,
} from './vocabulary.js';
import type { AppraisalConfig } from './appraisal.js';
import type { SomaticBiasConfig } from './engine.js';

// ── Core engine ──────────────────────────────────────────────────────────────
export {
  HomeostasisEngine,
  type HomeostasisConfig,
  type HomeostasisSnapshot,
  type SomaticBiasConfig,
  type SomaticRoleWeights,
} from './engine.js';
export type { HomeoMode } from './types.js';

// ── Allostasis ───────────────────────────────────────────────────────────────
export {
  computeAllostaticTarget,
  DEFAULT_HOURLY_PERIODS,
  type AllostaticInput,
  type AllostaticResult,
  type AllostaticConfig,
  type HourlyPeriod,
} from './allostasis.js';

// ── Appraisal ────────────────────────────────────────────────────────────────
export {
  AppraisalEngine,
  type AppraisalResult,
  type AppraisalConfig,
  type VocabularyOverride,
} from './appraisal.js';
export {
  type AppraisalVocabulary,
  ES_APPRAISAL_VOCABULARY,
  EN_APPRAISAL_VOCABULARY,
  ANIMA_PRODUCTION_APPRAISAL_VOCABULARY,
} from './vocabulary.js';

// ── Profiles ─────────────────────────────────────────────────────────────────
export { HOMEOSTATIC_PROFILES, getProfile, type HomeostaticProfile } from './profiles.js';

// ── Bandit ───────────────────────────────────────────────────────────────────
export {
  updateBanditState,
  type BanditState,
  type BanditEpisode,
  type ArmBetaParams,
  type Rng,
} from './bandit.js';

// ── Load prediction ──────────────────────────────────────────────────────────
export {
  predictLoad,
  type HistoryRecord,
  type LoadPrediction,
  type LoadPredictionConfig,
} from './load-prediction.js';

// ── Valence (also available as @animakit/homeostasis/valence) ────────────────
export {
  computeEmotionalState,
  type EmotionName,
  type EmotionalState,
  type ValenceConfig,
} from './valence.js';

// ── Presets ──────────────────────────────────────────────────────────────────

export const presets: {
  /** Generic EN+ES appraisal vocabulary — the default. */
  bilingual: NonNullable<AppraisalConfig['vocabulary']>;
  /** The EXACT appraisal vocabulary running in Anima (Colombian tax/legal + SaaS). */
  animaProduction: NonNullable<AppraisalConfig['vocabulary']>;
  /**
   * The EXACT somaticBias config running in production — Anima's 5 sub-agents
   * (JEFE, VIGIA, ARQUITECTO, OFICIAL, NEGOCIADOR) with their original weights.
   * Note: OFICIAL has zero weight — legal decisions are never biased by affect.
   */
  animaProductionRoles: SomaticBiasConfig;
} = {
  bilingual: (() => {
    const v = bilingualAppraisalVocabulary();
    return {
      highCopingDomains: { replace: v.highCopingDomains },
      lowCopingDomains: { replace: v.lowCopingDomains },
      externalAgencySignals: { replace: v.externalAgencySignals },
    };
  })(),
  animaProduction: {
    highCopingDomains: { replace: ANIMA_PRODUCTION_APPRAISAL_VOCABULARY.highCopingDomains },
    lowCopingDomains: { replace: ANIMA_PRODUCTION_APPRAISAL_VOCABULARY.lowCopingDomains },
    externalAgencySignals: { replace: ANIMA_PRODUCTION_APPRAISAL_VOCABULARY.externalAgencySignals },
  },
  animaProductionRoles: {
    roles: {
      JEFE: { stressWeight: 1, dopamineWeight: 0 }, // high stress → conservatism
      VIGIA: { stressWeight: 0, dopamineWeight: 0.7 }, // high dopamine → exploration
      ARQUITECTO: { stressWeight: 0, dopamineWeight: 0.7 }, // high dopamine → exploration
      OFICIAL: { stressWeight: 0, dopamineWeight: 0 }, // never bias legal decisions
      NEGOCIADOR: { stressWeight: 0, dopamineWeight: -0.5 }, // low dopamine → seek stimulus
    },
    maxBias: 0.08,
    emaAlpha: 0.05,
    flowZone: { min: 0.15, max: 0.65 },
  },
};
