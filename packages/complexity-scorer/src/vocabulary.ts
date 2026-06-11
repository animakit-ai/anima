// Vocabulary sets for the lexical signals.
// All matching is diacritic-insensitive in 'word' mode — keep entries accented
// for readability; the matcher normalizes both sides.

export interface VocabularySet {
  domainKeywords: string[];
  structureMarkers: string[];
  reasoningPatterns: RegExp[];
  contextPatterns: RegExp[];
}

// ── Spanish base (generalized from Anima production, deduplicated) ──────────

export const ES_VOCABULARY: VocabularySet = {
  domainKeywords: [
    // Technical
    'implementar', 'arquitectura', 'algoritmo', 'sistema', 'api', 'base de datos',
    'integración', 'backend', 'frontend', 'deployment', 'docker', 'kubernetes',
    'pipeline', 'webhook', 'autenticación', 'escalabilidad', 'rendimiento', 'latencia',
    'microservicio', 'endpoint', 'protocolo', 'cifrado', 'seguridad', 'certificado',
    // Legal / tax (generic)
    'contrato', 'tributario', 'fiscal', 'retención', 'declaración',
    'régimen', 'obligación', 'normativa', 'reglamento', 'estatuto', 'jurídico',
    'nómina', 'cumplimiento', 'auditoría',
    // Business / strategy
    'estrategia', 'modelo de negocio', 'competencia', 'mercado', 'posicionamiento',
    'diferenciación', 'ventaja competitiva', 'go-to-market', 'roadmap', 'producto',
    'mrr', 'arr', 'churn', 'ltv', 'cac', 'funnel', 'conversión', 'pipeline comercial',
    'propuesta de valor', 'segmentación', 'expansión',
    // Research / analysis
    'análisis', 'investigar', 'evaluar', 'comparar', 'sintetizar', 'revisar',
    'hipótesis', 'conclusión', 'evidencia', 'datos', 'métricas', 'kpis',
    'diagnóstico', 'proyección', 'escenario', 'sensibilidad', 'riesgo',
    // Finance
    'valoración', 'equity', 'flujo de caja', 'balance', 'p&l', 'ebitda',
    'inversión', 'financiamiento', 'deuda', 'capital', 'dividendos',
  ],
  structureMarkers: [
    'además', 'sin embargo', 'no obstante', 'por otro lado', 'también',
    'aunque', 'mientras', 'asimismo', 'por consiguiente', 'en consecuencia',
    'dado que', 'a pesar de', 'en cambio', 'por ende', 'de modo que',
    'en primer lugar', 'en segundo lugar', 'finalmente', 'por un lado',
    'en definitiva', 'es decir', 'o sea', 'esto implica', 'lo cual',
    'por su parte', 'cabe destacar', 'de igual manera', 'en este sentido',
    'dicho esto', 'ahora bien', 'con todo', 'a su vez',
  ],
  reasoningPatterns: [
    /\bporque\b/i,
    /\bdado que\b/i,
    /\bsi\b.{0,20}\bentonces\b/i,
    /\bimplica\b/i,
    /\bpor lo tanto\b/i,
    /\ba ra[íi]z de\b/i,
    /\bcomo resultado\b/i,
    /\blo que significa\b/i,
    /\bpor qu[ée]\b/i,
    /\bcu[áa]l es la raz[óo]n\b/i,
    /\bqu[ée] factores\b/i,
    /\bc[óo]mo afecta\b/i,
    /\bqu[ée] pasar[íi]a si\b/i,
    /\bcu[áa]l ser[íi]a el impacto\b/i,
    /\banaliza\b/i,
    /\brazona\b/i,
    /\bexplica por qu[ée]\b/i,
    /\bquiero entender\b/i,
    /\bcausa\b.*\befecto\b/i,
  ],
  contextPatterns: [
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
  ],
};

// ── English base ─────────────────────────────────────────────────────────────
// Note: context patterns deliberately avoid bare `this|that|it` — in English
// those are conjunctions/expletives and would fire on nearly every sentence.
// Only compound anaphora are used.

export const EN_VOCABULARY: VocabularySet = {
  domainKeywords: [
    // Technical
    'implement', 'architecture', 'algorithm', 'system', 'api', 'database',
    'integration', 'backend', 'frontend', 'deployment', 'docker', 'kubernetes',
    'pipeline', 'webhook', 'authentication', 'scalability', 'performance', 'latency',
    'microservice', 'endpoint', 'protocol', 'encryption', 'security', 'certificate',
    // Legal / tax
    'contract', 'tax', 'fiscal', 'withholding', 'compliance', 'regulation',
    'statute', 'legal', 'payroll', 'liability', 'audit', 'jurisdiction',
    // Business / strategy
    'strategy', 'business model', 'competition', 'market', 'positioning',
    'differentiation', 'competitive advantage', 'go-to-market', 'roadmap', 'product',
    'mrr', 'arr', 'churn', 'ltv', 'cac', 'funnel', 'conversion', 'sales pipeline',
    'value proposition', 'segmentation', 'retention', 'expansion',
    // Research / analysis
    'analysis', 'investigate', 'evaluate', 'compare', 'synthesize', 'review',
    'hypothesis', 'conclusion', 'evidence', 'data', 'metrics', 'kpis',
    'diagnosis', 'projection', 'scenario', 'sensitivity', 'risk',
    // Finance
    'valuation', 'equity', 'cash flow', 'balance sheet', 'p&l', 'ebitda',
    'investment', 'financing', 'debt', 'capital', 'dividends',
  ],
  structureMarkers: [
    'however', 'moreover', 'nevertheless', 'on the other hand', 'also',
    'although', 'while', 'furthermore', 'therefore', 'consequently',
    'given that', 'despite', 'in contrast', 'thus', 'so that',
    'first of all', 'secondly', 'finally', 'on one hand',
    'in conclusion', 'that is', 'in other words', 'this implies', 'which means',
    'additionally', 'meanwhile', 'in this sense', 'that said', 'in turn',
  ],
  reasoningPatterns: [
    /\bbecause\b/i,
    /\bgiven that\b/i,
    /\bif\b.{0,25}\bthen\b/i,
    /\bimplies\b/i,
    /\btherefore\b/i,
    /\bas a result\b/i,
    /\bwhich means\b/i,
    /\bwhy\b/i,
    /\bwhat( is|'s) the reason\b/i,
    /\bwhat factors\b/i,
    /\bhow does\b.{0,30}\baffect\b/i,
    /\bwhat (would happen|happens) if\b/i,
    /\bwhat( is|'s| would be) the impact\b/i,
    /\banalyze\b/i,
    /\breason through\b/i,
    /\bexplain why\b/i,
    /\bi want to understand\b/i,
    /\bcause\b.*\beffect\b/i,
    /\btrade-?offs?\b/i,
  ],
  contextPatterns: [
    /\bas i (said|mentioned)\b/i,
    /\bas (we|you) (discussed|mentioned|said)\b/i,
    /\bthe same (one|thing|issue)\b/i,
    /\bregarding (that|what)\b/i,
    /\babout what (you|we|i) (said|discussed)\b/i,
    /\bfollowing up on\b/i,
    /\bthe aforementioned\b/i,
    /\bbased on that\b/i,
    /\bfrom (before|earlier|last time)\b/i,
    /\bthe previous (one|point|message)\b/i,
    /\bwhat you (said|suggested|proposed)\b/i,
    /\bcontinuing (with|from)\b/i,
  ],
};

// ── Anima production vocabulary — verbatim from the production scorer ───────
// This is the EXACT configuration running in Anima's production agent
// (Colombian tax/legal + business SaaS domain, Spanish). Shipped as social
// proof and as a reference for building your own domain vocabulary.
//
// Replication fidelity (verified over 353 real production messages,
// benchmarks/parity-vs-original.ts): 99.7% identical tiers. The single known
// deviation: the original accidentally lists 'retención' twice and therefore
// double-counts it; we deduplicate vocabularies on merge and count it once.
// We document the bug rather than replicate it. Cross-list overlaps
// ('dado que' in both structure and reasoning) ARE preserved.

export const ANIMA_PRODUCTION_VOCABULARY: VocabularySet = {
  domainKeywords: [
    'implementar', 'arquitectura', 'algoritmo', 'sistema', 'api', 'base de datos',
    'integración', 'backend', 'frontend', 'deployment', 'docker', 'kubernetes',
    'pipeline', 'webhook', 'autenticación', 'escalabilidad', 'rendimiento', 'latencia',
    'microservicio', 'endpoint', 'protocolo', 'cifrado', 'seguridad', 'certificado',
    'contrato', 'tributario', 'fiscal', 'retención', 'iva', 'declaración',
    'régimen', 'obligación', 'normativa', 'reglamento', 'estatuto', 'jurídico',
    'retefuente', 'dian', 'rut', 'nit', 'facturación electrónica', 'nomina',
    'cesantías', 'cámara de comercio', 'primas', 'seguridad social',
    'estrategia', 'modelo de negocio', 'competencia', 'mercado', 'posicionamiento',
    'diferenciación', 'ventaja competitiva', 'go-to-market', 'roadmap', 'producto',
    'mrr', 'arr', 'churn', 'ltv', 'cac', 'funnel', 'conversión', 'pipeline comercial',
    'propuesta de valor', 'segmentación', 'retención', 'expansión',
    'análisis', 'investigar', 'evaluar', 'comparar', 'sintetizar', 'revisar',
    'hipótesis', 'conclusión', 'evidencia', 'datos', 'métricas', 'kpis',
    'diagnóstico', 'proyección', 'escenario', 'sensibilidad', 'riesgo',
    'valoración', 'equity', 'flujo de caja', 'balance', 'p&l', 'ebitda',
    'inversión', 'financiamiento', 'deuda', 'capital', 'dividendos',
  ],
  structureMarkers: [...ES_VOCABULARY.structureMarkers],
  reasoningPatterns: [...ES_VOCABULARY.reasoningPatterns],
  contextPatterns: [...ES_VOCABULARY.contextPatterns],
};
