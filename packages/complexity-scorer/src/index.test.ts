import { describe, it, expect } from 'vitest';
import { scoreComplexity, createScorer, presets } from './index.js';

describe('tiers — representative messages', () => {
  it('trivial greeting → micro', () => {
    const r = scoreComplexity('hola, ¿cómo vas?');
    expect(r.tier).toBe('micro');
    expect(r.score).toBeLessThan(0.25);
  });

  it('simple factual question → micro/small', () => {
    const r = scoreComplexity('¿qué hora es en Bogotá?');
    expect(['micro', 'small']).toContain(r.tier);
  });

  it('complex strategic Spanish message → medium or large', () => {
    const r = scoreComplexity(
      'Necesito que analices la estrategia de posicionamiento frente a la competencia, ' +
        'dado que el mercado cambió. Sin embargo, antes quiero entender qué factores afectan ' +
        'nuestra propuesta de valor y cuál sería el impacto en el churn y el MRR si subimos precios. ' +
        'Además, considera la retención de clientes actuales y, por otro lado, el costo de adquisición. ' +
        'Explica por qué cada escenario es viable y qué pasaría si la conversión cae un 20%.',
    );
    expect(['medium', 'large']).toContain(r.tier);
    expect(r.signals.domain).toBeGreaterThan(0);
    expect(r.signals.reasoning).toBeGreaterThan(0);
    expect(r.signals.structure).toBeGreaterThan(0);
  });

  it('complex English message → NOT micro (the monolingual bias fix)', () => {
    const r = scoreComplexity(
      'I need you to analyze our market positioning strategy against the competition, ' +
        'given that the landscape changed. However, first I want to understand what factors ' +
        'affect our value proposition and what would be the impact on churn and MRR if we raise ' +
        'prices. Furthermore, consider retention of current customers and, on the other hand, ' +
        'acquisition cost. Explain why each scenario is viable and what happens if conversion drops 20%.',
    );
    expect(['medium', 'large']).toContain(r.tier);
    expect(r.signals.domain).toBeGreaterThan(0);
    expect(r.signals.reasoning).toBeGreaterThan(0);
  });
});

describe('word matching — false positive fixes (D1)', () => {
  const anima = createScorer({ language: 'es', matching: 'word', vocabulary: presets.animaProduction.vocabulary! });

  it("'rut' does not fire inside 'rutina'", () => {
    expect(anima('mi rutina de las mañanas').signals.domain).toBe(0);
  });

  it("'iva' does not fire inside 'derivada' or 'activa'", () => {
    expect(anima('la derivada quedó activa').signals.domain).toBe(0);
  });

  it("'api' does not fire inside 'capital'... unless 'capital' is itself a keyword", () => {
    // 'capital' IS a domain keyword — it should fire as exactly one hit, not two
    const r = anima('necesito capital');
    expect(r.signals.domain).toBeGreaterThan(0);
    const rNone = anima('me gusta el capibara'); // no keyword at all
    expect(rNone.signals.domain).toBe(0);
  });

  it('real keyword still fires as whole word', () => {
    expect(anima('¿cómo va el RUT de la empresa?').signals.domain).toBeGreaterThan(0);
  });

  it('diacritic-insensitive: "retencion" (no accent) matches "retención"', () => {
    expect(anima('calcula la retencion en la fuente').signals.domain).toBeGreaterThan(0);
  });

  it('legacy substring mode reproduces the original false positive', () => {
    const legacy = scoreComplexity('mi rutina de las mañanas', presets.animaProduction);
    expect(legacy.signals.domain).toBeGreaterThan(0); // 'rut' inside 'rutina' — by design
  });
});

describe('multi-word phrases', () => {
  it('matches "base de datos" as a phrase in word mode', () => {
    const r = scoreComplexity('migra la base de datos al nuevo servidor');
    expect(r.signals.domain).toBeGreaterThan(0);
  });

  it('matches "cash flow" in English', () => {
    const r = scoreComplexity('project the cash flow for Q3');
    expect(r.signals.domain).toBeGreaterThan(0);
  });
});

describe('signals — ranges and structure', () => {
  const samples = [
    '',
    'ok',
    'hola',
    '¿qué hora es?',
    'explícame por qué el sistema falla cuando hay mucha latencia en la api',
    'a'.repeat(5000),
    '🚀🚀🚀',
    'porque porque porque porque porque',
  ];

  it('score and all signals always within [0,1]', () => {
    for (const s of samples) {
      const r = scoreComplexity(s);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
      for (const v of Object.values(r.signals)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('is deterministic', () => {
    const msg = 'analiza el impacto del churn en el MRR porque necesitamos decidir';
    expect(scoreComplexity(msg)).toEqual(scoreComplexity(msg));
  });

  it('empty string → micro with near-zero score', () => {
    const r = scoreComplexity('');
    expect(r.tier).toBe('micro');
    expect(r.score).toBeLessThan(0.05);
  });
});

describe('tier thresholds', () => {
  it('respects custom thresholds', () => {
    const strict = createScorer({ tierThresholds: { micro: 0.05, small: 0.1, medium: 0.15 } });
    const r = strict('explícame la arquitectura del sistema porque no entiendo cómo afecta la latencia');
    expect(r.tier).toBe('large');
  });

  it('rejects unordered thresholds', () => {
    expect(() => createScorer({ tierThresholds: { micro: 0.5, small: 0.4, medium: 0.6 } })).toThrow();
  });
});

describe('config validation and merging', () => {
  it('rejects weights that do not sum to 1', () => {
    expect(() =>
      createScorer({
        weights: { length: 0.5, domain: 0.5, structure: 0.5, reasoning: 0, contextRequired: 0 },
      }),
    ).toThrow(/sum to 1/);
  });

  it('vocabulary.extend adds without removing the base', () => {
    const s = createScorer({
      language: 'en',
      vocabulary: { domainKeywords: { extend: ['kubernetes-operator'] } },
    });
    expect(s('deploy the kubernetes-operator').signals.domain).toBeGreaterThan(0);
    expect(s('check the database').signals.domain).toBeGreaterThan(0); // base still there
  });

  it('vocabulary.replace removes the base', () => {
    const s = createScorer({
      language: 'en',
      vocabulary: { domainKeywords: { replace: ['foobarium'] } },
    });
    expect(s('check the database').signals.domain).toBe(0);
    expect(s('we need more foobarium').signals.domain).toBeGreaterThan(0);
  });

  it('custom saturation changes reasoning ceiling', () => {
    const s = createScorer({ saturation: { reasoning: 1 } });
    const r = s('explain why because of the trade-offs');
    expect(r.signals.reasoning).toBe(1);
  });
});

describe('presets.animaProduction — legacy replication', () => {
  it('reproduces the original scorer output shape on a production-like message', () => {
    const r = scoreComplexity(
      '¿Cuál es el impacto de la retefuente en la facturación electrónica ante la DIAN?',
      presets.animaProduction,
    );
    expect(r.signals.domain).toBeGreaterThan(0);
    expect(['small', 'medium', 'large']).toContain(r.tier);
  });

  it('English text scores near zero on lexical signals (documented limitation)', () => {
    const r = scoreComplexity('analyze the market strategy because of churn', presets.animaProduction);
    expect(r.signals.reasoning).toBe(0); // ES-only patterns
  });
});

describe('English anaphora — no bare-pronoun false positives (D5)', () => {
  it('plain English sentence with "that" does not fire contextRequired', () => {
    const r = scoreComplexity('I think that the weather is nice today', { language: 'en' });
    expect(r.signals.contextRequired).toBe(0);
  });

  it('compound anaphora does fire', () => {
    const r = scoreComplexity('following up on what you said earlier', { language: 'en' });
    expect(r.signals.contextRequired).toBeGreaterThan(0);
  });
});
