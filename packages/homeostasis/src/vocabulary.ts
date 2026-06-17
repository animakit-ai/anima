// Vocabulary sets for the cognitive-appraisal signals (AppraisalEngine).
// Matching is plain lowercase substring (phrases like "the client" must match
// mid-sentence), mirroring the original production behavior.

export interface AppraisalVocabulary {
  /** Domains the agent handles well → high coping → energizing. */
  highCopingDomains: string[];
  /** Domains of low competence / high uncertainty → low coping → some stress. */
  lowCopingDomains: string[];
  /** Phrases signalling external control (agency = other). */
  externalAgencySignals: string[];
}

// ── Spanish base (generalized from Anima production) ─────────────────────────

export const ES_APPRAISAL_VOCABULARY: AppraisalVocabulary = {
  highCopingDomains: [
    'estrategia',
    'estratégico',
    'plan',
    'negocio',
    'ventas',
    'cliente',
    'producto',
    'mvp',
    'arquitectura',
    'código',
    'técnico',
    'sistema',
    'inversión',
    'financiero',
    'legal',
    'contrato',
    'proceso',
    'decisión',
    'análisis',
    'equipo',
  ],
  lowCopingDomains: [
    'urgente',
    'crisis',
    'emergencia',
    'falla',
    'error crítico',
    'demanda',
    'juicio',
    'accidente',
    'pérdida total',
  ],
  externalAgencySignals: [
    'el cliente',
    'el inversor',
    'el banco',
    'el gobierno',
    'nos rechazaron',
    'no aprobaron',
    'cancelaron',
    'me bloquearon',
    'depende de ellos',
    'están esperando',
  ],
};

// ── English base ────────────────────────────────────────────────────────────

export const EN_APPRAISAL_VOCABULARY: AppraisalVocabulary = {
  highCopingDomains: [
    'strategy',
    'strategic',
    'plan',
    'business',
    'sales',
    'client',
    'customer',
    'product',
    'mvp',
    'architecture',
    'code',
    'technical',
    'system',
    'investment',
    'financial',
    'legal',
    'contract',
    'process',
    'decision',
    'analysis',
    'team',
  ],
  lowCopingDomains: [
    'urgent',
    'crisis',
    'emergency',
    'failure',
    'critical error',
    'lawsuit',
    'trial',
    'accident',
    'total loss',
  ],
  externalAgencySignals: [
    'the client',
    'the investor',
    'the bank',
    'the government',
    'they rejected',
    'they did not approve',
    'they cancelled',
    'they blocked me',
    'depends on them',
    'they are waiting',
  ],
};

// ── Anima production (the EXACT lists running in production) ──────────────────
// Includes Colombian tax/legal + SaaS terms. Use as a reference for your own.

export const ANIMA_PRODUCTION_APPRAISAL_VOCABULARY: AppraisalVocabulary = {
  highCopingDomains: [
    'estrategia',
    'estratégico',
    'plan',
    'negocio',
    'ventas',
    'cliente',
    'producto',
    'mvp',
    'arquitectura',
    'código',
    'técnico',
    'sistema',
    'inversión',
    'financiero',
    'legal',
    'contrato',
    'dian',
    'tributar',
    'equipo',
    'proceso',
    'decisión',
    'análisis',
  ],
  lowCopingDomains: [
    'urgente',
    'crisis',
    'emergencia',
    'falla',
    'error crítico',
    'demanda',
    'juicio',
    'embargo',
    'accidente',
    'pérdida total',
  ],
  externalAgencySignals: [
    'el cliente',
    'el inversor',
    'la dian',
    'el banco',
    'el gobierno',
    'nos rechazaron',
    'no aprobaron',
    'cancelaron',
    'me bloquearon',
    'depende de ellos',
    'están esperando',
  ],
};

export function bilingualAppraisalVocabulary(): AppraisalVocabulary {
  return {
    highCopingDomains: [
      ...ES_APPRAISAL_VOCABULARY.highCopingDomains,
      ...EN_APPRAISAL_VOCABULARY.highCopingDomains,
    ],
    lowCopingDomains: [
      ...ES_APPRAISAL_VOCABULARY.lowCopingDomains,
      ...EN_APPRAISAL_VOCABULARY.lowCopingDomains,
    ],
    externalAgencySignals: [
      ...ES_APPRAISAL_VOCABULARY.externalAgencySignals,
      ...EN_APPRAISAL_VOCABULARY.externalAgencySignals,
    ],
  };
}
