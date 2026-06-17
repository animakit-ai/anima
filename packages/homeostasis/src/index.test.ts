import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  HomeostasisEngine,
  computeAllostaticTarget,
  DEFAULT_HOURLY_PERIODS,
  AppraisalEngine,
  HOMEOSTATIC_PROFILES,
  getProfile,
  updateBanditState,
  predictLoad,
  computeEmotionalState,
  presets,
  ES_APPRAISAL_VOCABULARY,
  EN_APPRAISAL_VOCABULARY,
  ANIMA_PRODUCTION_APPRAISAL_VOCABULARY,
  type BanditState,
  type HistoryRecord,
} from './index.js';
import { computeEmotionalState as computeEmotionalStateSub } from './valence.js';

// Deterministic RNG (mulberry32) for sigmoid/bandit sampling in tests.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('HomeostasisEngine — construction & getters', () => {
  it('starts at resting defaults', () => {
    const h = new HomeostasisEngine();
    expect(h.stress).toBe(0.1);
    expect(h.dopamine).toBe(0.5);
    expect(h.mode).toBe('zen');
    expect(h.allostaticTarget).toBe(0.1);
    expect(h.activeConstraints).toEqual([]);
    expect(h.somaticEMA).toEqual({ stress: 0.1, dopamine: 0.5 });
  });

  it('seeds from a snapshot', () => {
    const h = new HomeostasisEngine(
      {},
      {
        stress: 0.7,
        dopamine: 0.2,
        allostaticTarget: 0.4,
        lastVetoAt: '2026-06-14T00:00:00.000Z',
        activeConstraints: ['no X'],
        somaticEMA: { stress: 0.6, dopamine: 0.3 },
      },
    );
    expect(h.stress).toBe(0.7);
    expect(h.mode).toBe('flow');
    expect(h.activeConstraints).toEqual(['no X']);
    expect(h.somaticEMA.dopamine).toBe(0.3);
  });

  it('exposes emotional state through the engine getter', () => {
    const h = new HomeostasisEngine({}, { stress: 0.9, dopamine: 0.9 });
    expect(h.emotionalState.emotion).toBe('excited');
  });

  it('respects custom valence thresholds via config', () => {
    const h = new HomeostasisEngine({ valence: { thresholds: { arousalHigh: 0.95 } } }, { stress: 0.6, dopamine: 0.5 });
    expect(h.emotionalState.arousal_zone).not.toBe('high');
  });
});

describe('HomeostasisEngine — fully custom config', () => {
  it('honors every overridable option', () => {
    const h = new HomeostasisEngine({
      decay: { stressRate: 0.5, dopamineRate: 0.5, dopamineTarget: 0.4 },
      modeThresholds: { flow: 0.2, panic: 0.6 },
      acceptance: { panicThreshold: 0.5, sigmoidK: 5 },
      veto: { baseThreshold: 0.7, deltaT: 0.2, tauMs: 1000 },
      deltas: {
        stress: { pipelineError: 0.3 },
        dopamine: { pipelineSuccess: 0.2, pipelineError: -0.2 },
      },
      somaticBias: {
        roles: { A: { stressWeight: 1, dopamineWeight: 0 } },
        maxBias: 0.2,
        emaAlpha: 0.5,
        flowZone: { min: 0.1, max: 0.7 },
      },
      valence: { thresholds: { arousalHigh: 0.4 } },
      rng: () => 0.5,
    });
    // custom mode thresholds
    h.addStress(0.15); // 0.25 ≥ flow(0.2)
    expect(h.mode).toBe('flow');
    // custom veto base
    expect(h.getEffectiveVetoThreshold()).toBe(0.7);
    // custom failure deltas
    const f = new HomeostasisEngine({ deltas: { stress: { pipelineError: 0.3 }, dopamine: { pipelineError: -0.2 } } });
    f.recordInteraction({ success: false, responseTimeMs: 0 });
    expect(f.stress).toBeCloseTo(0.4, 10);
    expect(f.dopamine).toBeCloseTo(0.3, 10);
    // custom success delta
    const s = new HomeostasisEngine({ deltas: { dopamine: { pipelineSuccess: 0.2 } } });
    s.recordInteraction({ success: true, responseTimeMs: 0 });
    expect(s.dopamine).toBeCloseTo(0.7, 10);
    // custom emaAlpha used in tick
    const e = new HomeostasisEngine(
      { somaticBias: { roles: { A: { stressWeight: 1, dopamineWeight: 0 } }, emaAlpha: 0.5 } },
      { stress: 0.5, dopamine: 0.5, somaticEMA: { stress: 0.1, dopamine: 0.5 } },
    );
    e.tick(0.5);
    expect(e.somaticEMA.stress).toBeCloseTo(0.3, 5); // 0.1 + 0.5*(0.5-0.1)
  });
});

describe('HomeostasisEngine — modifiers & mode', () => {
  it('addStress clamps and updates mode through flow→panic', () => {
    const h = new HomeostasisEngine();
    h.addStress(0.25);
    expect(h.mode).toBe('flow'); // 0.35
    h.addStress(0.6);
    expect(h.mode).toBe('panic'); // 0.95
    h.addStress(5);
    expect(h.stress).toBe(1); // clamped
  });

  it('addDopamine clamps low', () => {
    const h = new HomeostasisEngine();
    h.addDopamine(-5);
    expect(h.dopamine).toBe(0);
  });

  it('setProfile scales subsequent stress deltas', () => {
    const h = new HomeostasisEngine();
    h.setProfile(getProfile(2)); // Proactive, stressMult 0.5
    h.addStress(0.2);
    expect(h.stress).toBeCloseTo(0.2, 10); // 0.1 + 0.2*0.5
  });
});

describe('HomeostasisEngine — task acceptance', () => {
  it('always accepts below the panic threshold', () => {
    const h = new HomeostasisEngine();
    expect(h.evaluateTaskAcceptance(0)).toBe(true);
  });

  it('uses the injected rng above the threshold', () => {
    const accept = new HomeostasisEngine({ rng: () => 0 }, { stress: 0.9, dopamine: 0.5 });
    expect(accept.evaluateTaskAcceptance(1)).toBe(true); // rng 0 <= pAccept
    const reject = new HomeostasisEngine({ rng: () => 1 }, { stress: 0.95, dopamine: 0.5 });
    expect(reject.evaluateTaskAcceptance(0.1)).toBe(false);
  });
});

describe('HomeostasisEngine — recordInteraction', () => {
  it('success without appraisal adds dopamine', () => {
    const h = new HomeostasisEngine();
    h.recordInteraction({ success: true, responseTimeMs: 0 });
    expect(h.dopamine).toBeCloseTo(0.55, 10);
  });

  it('success with appraisal applies appraisal deltas + half bonus + latency', () => {
    const h = new HomeostasisEngine();
    h.recordInteraction({
      success: true,
      responseTimeMs: 120_000, // → latency stress 0.05
      appraisal: {
        novelty: 0.5,
        relevance: 0.7,
        coping: 0.8,
        agency: 'self',
        valence: 'positive',
        stressDelta: 0.02,
        dopamineDelta: 0.1,
        label: 'x',
      },
    });
    expect(h.dopamine).toBeCloseTo(0.5 + 0.1 + 0.025, 10);
    expect(h.stress).toBeCloseTo(0.1 + 0.02 + 0.05, 10);
  });

  it('success with appraisal having zero deltas skips them but keeps bonus', () => {
    const h = new HomeostasisEngine();
    h.recordInteraction({
      success: true,
      responseTimeMs: 100, // latency < 0.01 → no stress
      appraisal: {
        novelty: 0, relevance: 0, coping: 0, agency: 'self', valence: 'neutral',
        stressDelta: 0, dopamineDelta: 0, label: 'x',
      },
    });
    expect(h.stress).toBe(0.1);
    expect(h.dopamine).toBeCloseTo(0.525, 10);
  });

  it('failure adds stress and removes dopamine', () => {
    const h = new HomeostasisEngine();
    h.recordInteraction({ success: false, responseTimeMs: 0 });
    expect(h.stress).toBeCloseTo(0.2, 10);
    expect(h.dopamine).toBeCloseTo(0.45, 10);
  });
});

describe('HomeostasisEngine — tick / decay', () => {
  it('decays stress toward a provided allostatic target', () => {
    const h = new HomeostasisEngine({}, { stress: 0.8, dopamine: 0.5 });
    h.tick(0.1);
    expect(h.stress).toBeLessThan(0.8);
    expect(h.stress).toBeGreaterThan(0.1);
    expect(h.allostaticTarget).toBe(0.1);
  });

  it('decays stress upward toward a higher target', () => {
    const h = new HomeostasisEngine({}, { stress: 0.1, dopamine: 0.5 });
    h.tick(0.5);
    expect(h.stress).toBeGreaterThan(0.1);
  });

  it('decays dopamine toward target from both directions', () => {
    const high = new HomeostasisEngine({}, { stress: 0.1, dopamine: 0.9 });
    high.tick();
    expect(high.dopamine).toBeLessThan(0.9);
    const low = new HomeostasisEngine({}, { stress: 0.1, dopamine: 0.1 });
    low.tick();
    expect(low.dopamine).toBeGreaterThan(0.1);
  });

  it('is a no-op near the set-points but still updates EMA', () => {
    const h = new HomeostasisEngine({}, { stress: 0.1, dopamine: 0.5, somaticEMA: { stress: 0.9, dopamine: 0.1 } });
    h.tick();
    expect(h.stress).toBe(0.1);
    expect(h.dopamine).toBe(0.5);
    expect(h.somaticEMA.stress).toBeLessThan(0.9); // EMA moved toward 0.1
  });

  it('keeps the previous target when none is supplied', () => {
    const h = new HomeostasisEngine({}, { stress: 0.8, dopamine: 0.5, allostaticTarget: 0.3 });
    h.tick();
    expect(h.allostaticTarget).toBe(0.3);
  });
});

describe('HomeostasisEngine — Giant Fiber veto', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns base threshold with no veto', () => {
    const h = new HomeostasisEngine();
    expect(h.getEffectiveVetoThreshold()).toBe(0.65);
  });

  it('raises then decays the threshold after a veto', () => {
    vi.setSystemTime(new Date('2026-06-14T00:00:00Z'));
    const h = new HomeostasisEngine();
    h.recordVeto(['legal A']);
    expect(h.getEffectiveVetoThreshold()).toBeCloseTo(0.9, 5); // base + deltaT
    vi.setSystemTime(new Date('2026-06-14T00:20:00Z')); // one tau later
    expect(h.getEffectiveVetoThreshold()).toBeCloseTo(0.65 + 0.25 / Math.E, 5);
  });

  it('merges constraints and caps at 10', () => {
    const h = new HomeostasisEngine();
    h.recordVeto(['a', 'b']);
    h.recordVeto(['b', 'c']); // dedup b
    expect(h.activeConstraints).toEqual(['a', 'b', 'c']);
    const many = Array.from({ length: 15 }, (_, i) => `c${i}`);
    const h2 = new HomeostasisEngine();
    h2.recordVeto(many);
    expect(h2.activeConstraints).toHaveLength(10);
  });

  it('recordVeto defaults to no constraints', () => {
    const h = new HomeostasisEngine();
    h.recordVeto();
    expect(h.activeConstraints).toEqual([]);
  });
});

describe('HomeostasisEngine — somatic bias', () => {
  it('returns not_configured when no somaticBias', () => {
    const h = new HomeostasisEngine();
    expect(h.getSomaticBias()).toEqual({ biases: {}, active: false, reason: 'not_configured' });
  });

  it('is inactive in the panic zone', () => {
    const h = new HomeostasisEngine(
      { somaticBias: presets.animaProductionRoles },
      { stress: 0.9, dopamine: 0.5, somaticEMA: { stress: 0.9, dopamine: 0.5 } },
    );
    const r = h.getSomaticBias();
    expect(r.active).toBe(false);
    expect(r.reason).toBe('panic_zone');
    expect(r.biases['JEFE']).toBe(0);
  });

  it('is inactive in deep zen', () => {
    const h = new HomeostasisEngine(
      { somaticBias: presets.animaProductionRoles },
      { stress: 0.05, dopamine: 0.5, somaticEMA: { stress: 0.05, dopamine: 0.5 } },
    );
    expect(h.getSomaticBias().reason).toBe('deep_zen');
  });

  it('produces per-role biases in the flow zone, never biasing OFICIAL', () => {
    const h = new HomeostasisEngine(
      { somaticBias: presets.animaProductionRoles },
      { stress: 0.4, dopamine: 0.8, somaticEMA: { stress: 0.4, dopamine: 0.8 } },
    );
    const r = h.getSomaticBias();
    expect(r.active).toBe(true);
    expect(r.reason).toBe('flow_zone');
    expect(r.biases['OFICIAL']).toBe(0);
    expect(r.biases['JEFE']).toBeGreaterThan(0); // stress above center
    expect(r.biases['NEGOCIADOR']).toBeLessThan(0); // negative dopamine weight, high dopamine
    expect(Math.abs(r.biases['VIGIA']!)).toBeLessThanOrEqual(0.08); // clamped to maxBias
  });
});

describe('HomeostasisEngine — serialization', () => {
  it('round-trips through toJSON/fromJSON without loss', () => {
    const h = new HomeostasisEngine({}, { stress: 0.6, dopamine: 0.3, allostaticTarget: 0.25 });
    h.recordVeto(['c1']);
    const snap = h.toJSON();
    const restored = HomeostasisEngine.fromJSON(snap);
    expect(restored.toJSON()).toEqual(snap);
    expect(restored.stress).toBe(0.6);
    expect(restored.activeConstraints).toEqual(['c1']);
  });

  it('serializes a null lastVetoAt', () => {
    expect(new HomeostasisEngine().toJSON().lastVetoAt).toBeNull();
  });
});

describe('computeAllostaticTarget', () => {
  const base = { fepMode: 'zen', kappa: null, ceScore: null, recentIgnitions: 0, hourLocal: 7 };

  it('returns the base target with no active deltas', () => {
    const r = computeAllostaticTarget(base);
    expect(r.target).toBe(0.1);
    expect(r.deltas).toEqual({});
    expect(r.label).toContain('rest');
  });

  it('applies all fep modes', () => {
    expect(computeAllostaticTarget({ ...base, fepMode: 'urgent' }).deltas['fep_urgent']).toBe(0.14);
    expect(computeAllostaticTarget({ ...base, fepMode: 'active' }).deltas['fep_active']).toBe(0.08);
    expect(computeAllostaticTarget({ ...base, fepMode: 'alert' }).deltas['fep_alert']).toBe(0.04);
  });

  it('applies kappa regimes', () => {
    expect(computeAllostaticTarget({ ...base, kappa: 0.1 }).deltas['kappa_rigid']).toBe(0.05);
    expect(computeAllostaticTarget({ ...base, kappa: 0.9 }).deltas['kappa_chaotic']).toBe(-0.04);
    expect(computeAllostaticTarget({ ...base, kappa: 0.5 }).deltas['kappa_rigid']).toBeUndefined();
  });

  it('applies CE̊ regimes', () => {
    expect(computeAllostaticTarget({ ...base, ceScore: 0.2 }).deltas['ce_micro_dominant']).toBe(0.04);
    expect(computeAllostaticTarget({ ...base, ceScore: 0.8 }).deltas['ce_macro_strong']).toBe(-0.02);
    expect(computeAllostaticTarget({ ...base, ceScore: 0.5 }).deltas['ce_micro_dominant']).toBeUndefined();
  });

  it('applies recent ignition tiers', () => {
    expect(computeAllostaticTarget({ ...base, recentIgnitions: 3 }).deltas['recent_ignitions']).toBe(-0.06);
    expect(computeAllostaticTarget({ ...base, recentIgnitions: 2 }).deltas['recent_ignitions']).toBe(-0.03);
  });

  it('applies the default hourly schedule incl. wrap-around night', () => {
    expect(computeAllostaticTarget({ ...base, hourLocal: 10 }).deltas['hora_pico_manana']).toBe(0.06);
    expect(computeAllostaticTarget({ ...base, hourLocal: 15 }).deltas['hora_tarde']).toBe(0.04);
    expect(computeAllostaticTarget({ ...base, hourLocal: 23 }).deltas['hora_noche']).toBe(-0.08);
    expect(computeAllostaticTarget({ ...base, hourLocal: 3 }).deltas['hora_noche']).toBe(-0.08);
  });

  it('clamps to max and reports label tiers', () => {
    // Reaches the high-alert tier (≥0.42) via a raised base, and clamps at max.
    const high = computeAllostaticTarget(
      { fepMode: 'urgent', kappa: 0.1, ceScore: 0.2, recentIgnitions: 0, hourLocal: 10 },
      { baseTarget: 0.4, maxTarget: 0.55 },
    );
    expect(high.target).toBe(0.55); // 0.4 + 0.29 clamped to 0.55
    expect(high.label).toContain('high alert');
    const mid = computeAllostaticTarget({ ...base, fepMode: 'urgent', kappa: 0.1, ceScore: 0.2, recentIgnitions: 0, hourLocal: 10 });
    expect(mid.label).toContain('moderate'); // 0.39
    const normal = computeAllostaticTarget({ ...base, fepMode: 'alert', hourLocal: 10 });
    expect(normal.label).toContain('normal'); // 0.20
  });

  it('honors a custom config', () => {
    const r = computeAllostaticTarget(
      { ...base, hourLocal: 12 },
      { baseTarget: 0.2, minTarget: 0.2, maxTarget: 0.9, hourlyPeriods: [{ startHour: 11, endHour: 14, delta: 0.3, label: 'custom' }] },
    );
    expect(r.deltas['custom']).toBe(0.3);
    expect(r.target).toBeCloseTo(0.5, 5);
  });

  it('exposes the default hourly periods', () => {
    expect(DEFAULT_HOURLY_PERIODS).toHaveLength(3);
  });
});

describe('AppraisalEngine', () => {
  it('defaults to bilingual and energizes a relevant, high-coping message', () => {
    const a = new AppraisalEngine();
    const r = a.evaluate('necesito una estrategia de ventas para el producto', { goals: ['ventas producto'] });
    expect(r.valence).toBe('positive');
    expect(r.coping).toBeGreaterThan(0.6);
    expect(r.label).toContain('competence');
  });

  it('detects a threat with low coping', () => {
    const a = new AppraisalEngine({ language: 'es' });
    const r = a.evaluate('crisis: error crítico, demanda urgente', { goals: ['error'] });
    expect(r.valence).toBe('negative');
    expect(r.stressDelta).toBeGreaterThan(0);
  });

  it('detects external and circumstantial agency', () => {
    const a = new AppraisalEngine({ language: 'es' });
    expect(a.evaluate('el cliente y el banco nos rechazaron').agency).toBe('other');
    expect(a.evaluate('el cliente decidió').agency).toBe('circumstance');
    expect(a.evaluate('voy a planear esto').agency).toBe('self');
  });

  it('applies intention hints', () => {
    const a = new AppraisalEngine({ language: 'es' });
    const venting = a.evaluate('estrategia de negocio importante', { intentionHint: 'venting', goals: ['negocio'] });
    expect(venting.coping).toBeLessThanOrEqual(0.45);
    const planning = a.evaluate('hablemos del clima de hoy', { intentionHint: 'action_planning' });
    expect(planning.coping).toBeGreaterThanOrEqual(0.65);
  });

  it('supports english base and novelty', () => {
    const a = new AppraisalEngine({ language: 'en' });
    const r = a.evaluate('design a scalable architecture system for the product', {
      goals: ['architecture'],
      recentContext: 'totally unrelated previous chatter',
    });
    expect(r.novelty).toBeGreaterThan(0.2);
    expect(r.coping).toBeGreaterThan(0.6);
  });

  it('extends and replaces vocabulary', () => {
    const extended = new AppraisalEngine({ language: 'en', vocabulary: { highCopingDomains: { extend: ['quantumwidget'] } } });
    expect(extended.evaluate('build the quantumwidget', { goals: ['quantumwidget'] }).coping).toBeGreaterThan(0.6);
    const replaced = new AppraisalEngine({ vocabulary: { lowCopingDomains: { replace: ['zzscary'] } } });
    expect(replaced.evaluate('this is zzscary and relevant', { goals: ['zzscary'] }).coping).toBeLessThan(0.5);
  });

  it('returns neutral with no goals and benign content', () => {
    const r = new AppraisalEngine().evaluate('ok');
    expect(r.relevance).toBe(0.5);
    expect(r.valence).toBe('neutral');
  });

  it('formatContext is empty for neutral and renders for charged states', () => {
    const a = new AppraisalEngine({ language: 'es' });
    const neutral = a.evaluate('ok');
    expect(AppraisalEngine.formatContext(neutral)).toBe('');
    const pos = a.evaluate('estrategia de ventas del producto', { goals: ['ventas producto'] });
    expect(AppraisalEngine.formatContext(pos)).toContain('⚡');
    const neg = a.evaluate('crisis error crítico demanda', { goals: ['crisis error'] });
    expect(AppraisalEngine.formatContext(neg)).toContain('⚠️');
  });
});

describe('profiles', () => {
  it('has three arms', () => {
    expect(HOMEOSTATIC_PROFILES).toHaveLength(3);
  });
  it('getProfile returns the match or balanced fallback', () => {
    expect(getProfile(0).name).toBe('Conservative');
    expect(getProfile(99).name).toBe('Balanced');
  });
});

describe('updateBanditState', () => {
  const fresh = (): BanditState => ({
    activeArm: 1,
    armsBetaParams: { '0': { alpha: 1, beta: 1 }, '1': { alpha: 1, beta: 1 }, '2': { alpha: 1, beta: 1 } },
  });

  it('rewards the active arm on a positive majority', () => {
    const s = updateBanditState([{ activeArm: 1, outcome: true }, { activeArm: 1, outcome: true }], fresh(), mulberry32(1));
    expect(s.armsBetaParams['1'].alpha).toBe(2);
  });

  it('penalizes the active arm on a negative majority', () => {
    const s = updateBanditState([{ activeArm: 1, outcome: false }], fresh(), mulberry32(1));
    expect(s.armsBetaParams['1'].beta).toBe(2);
  });

  it('ignores null-outcome and other-arm episodes', () => {
    const s = updateBanditState(
      [{ activeArm: 1, outcome: null }, { activeArm: 0, outcome: true }],
      fresh(),
      mulberry32(1),
    );
    expect(s.armsBetaParams['1']).toEqual({ alpha: 1, beta: 1 });
    expect(s.armsBetaParams['0']).toEqual({ alpha: 1, beta: 1 });
  });

  it('rescues a failing arm with high confidence and penalizes with low confidence', () => {
    const rescued = updateBanditState([{ activeArm: 1, outcome: false, confidenceScore: 0.9 }], fresh(), mulberry32(2));
    expect(rescued.armsBetaParams['1'].alpha).toBe(2);
    const penalized = updateBanditState([{ activeArm: 1, outcome: true, confidenceScore: 0.1 }], fresh(), mulberry32(2));
    expect(penalized.armsBetaParams['1'].beta).toBe(2);
  });

  it('does not mutate the input state', () => {
    const s = fresh();
    updateBanditState([{ activeArm: 1, outcome: true }], s, mulberry32(3));
    expect(s.armsBetaParams['1'].alpha).toBe(1);
  });

  it('selects a winning arm deterministically given a seeded rng', () => {
    const skewed: BanditState = {
      activeArm: 0,
      armsBetaParams: { '0': { alpha: 1, beta: 1 }, '1': { alpha: 1, beta: 1 }, '2': { alpha: 50, beta: 1 } },
    };
    const s = updateBanditState([], skewed, mulberry32(5));
    expect(s.activeArm).toBe(2);
  });

  it('defaults rng to Math.random when omitted', () => {
    const s = updateBanditState([{ activeArm: 1, outcome: true }], fresh());
    expect([0, 1, 2]).toContain(s.activeArm);
  });
});

describe('predictLoad', () => {
  function buildHistory(days: number, hour: number): HistoryRecord[] {
    const out: HistoryRecord[] = [];
    for (let d = 0; d < days; d++) {
      const date = new Date(Date.UTC(2026, 5, 1 + d, hour, 0, 0));
      out.push({ timestamp: date.toISOString(), stress: 0.5, reactive: true });
    }
    return out;
  }

  it('returns null for empty history', () => {
    expect(predictLoad([])).toBeNull();
  });

  it('finds the peak hour and reports reliability', () => {
    const r = predictLoad(buildHistory(8, 14))!;
    expect(r.peakHourLocal).toBe(14);
    expect(r.daysOfHistory).toBe(8);
    expect(r.reliable).toBe(true);
  });

  it('marks short history as unreliable', () => {
    expect(predictLoad(buildHistory(3, 9))!.reliable).toBe(false);
  });

  it('applies a utc offset to the local hour', () => {
    const r = predictLoad(buildHistory(8, 2), { utcOffsetHours: -5 })!; // 02:00 UTC → 21:00 prev day
    expect(r.peakHourLocal).toBe(21);
  });

  it('shifts the day of week across midnight in both directions', () => {
    // Negative offset rolls the local day back; positive offset rolls it forward.
    const back = predictLoad(buildHistory(8, 1), { utcOffsetHours: -5 })!; // 01:00 UTC → 20:00 prev day
    const fwd = predictLoad(buildHistory(8, 22), { utcOffsetHours: 5 })!; // 22:00 UTC → 03:00 next day
    expect(back.peakDayOfWeek).toBeGreaterThanOrEqual(0);
    expect(fwd.peakDayOfWeek).toBeGreaterThanOrEqual(0);
    expect(fwd.peakHourLocal).toBe(3);
  });

  it('recommends modes by expected stress', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 5, 20, 9, 0, 0)));
    const calm = predictLoad(
      [{ timestamp: new Date(Date.UTC(2026, 5, 19, 9, 0, 0)).toISOString(), stress: 0.1, reactive: true }],
    )!;
    expect(calm.recommendedMode).toBe('zen');
    const busy = predictLoad(
      [{ timestamp: new Date(Date.UTC(2026, 5, 19, 9, 0, 0)).toISOString(), stress: 0.9, reactive: true }],
    )!;
    expect(busy.recommendedMode).toBe('panic');
    vi.useRealTimers();
  });

  it('falls back to default stress when nothing is in the window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 5, 20, 0, 0, 0)));
    const r = predictLoad(buildHistory(8, 12), { forecastWindowHours: 1 })!;
    expect(r.expectedStress).toBeCloseTo(0.1, 5);
    vi.useRealTimers();
  });
});

describe('valence', () => {
  it('maps all nine affective states', () => {
    expect(computeEmotionalState(0.9, 0.9).emotion).toBe('excited');
    expect(computeEmotionalState(0.9, 0.5).emotion).toBe('alert');
    expect(computeEmotionalState(0.9, 0.1).emotion).toBe('anxious');
    expect(computeEmotionalState(0.4, 0.9).emotion).toBe('engaged');
    expect(computeEmotionalState(0.4, 0.5).emotion).toBe('focused');
    expect(computeEmotionalState(0.4, 0.1).emotion).toBe('tense');
    expect(computeEmotionalState(0.1, 0.9).emotion).toBe('content');
    expect(computeEmotionalState(0.1, 0.5).emotion).toBe('calm');
    expect(computeEmotionalState(0.1, 0.1).emotion).toBe('low');
  });

  it('is bilingual', () => {
    const s = computeEmotionalState(0.1, 0.5);
    expect(s.label_en).toBe('calm');
    expect(s.label_es).toBe('serena');
    expect(s.tone_instruction_en.length).toBeGreaterThan(0);
    expect(s.tone_instruction_es.length).toBeGreaterThan(0);
  });

  it('clamps inputs and honors custom thresholds', () => {
    const s = computeEmotionalState(5, 5);
    expect(s.arousal).toBe(1);
    expect(s.valence).toBe(1);
    const custom = computeEmotionalState(0.4, 0.5, { thresholds: { arousalHigh: 0.3 } });
    expect(custom.arousal_zone).toBe('high');
  });

  it('is the same function as the sub-export', () => {
    expect(computeEmotionalStateSub(0.5, 0.5).emotion).toBe(computeEmotionalState(0.5, 0.5).emotion);
  });
});

describe('presets & exported vocabularies', () => {
  it('expose appraisal vocabularies', () => {
    expect(ES_APPRAISAL_VOCABULARY.highCopingDomains.length).toBeGreaterThan(0);
    expect(EN_APPRAISAL_VOCABULARY.highCopingDomains.length).toBeGreaterThan(0);
    expect(ANIMA_PRODUCTION_APPRAISAL_VOCABULARY.externalAgencySignals).toContain('la dian');
  });

  it('bilingual and animaProduction presets are usable configs', () => {
    expect(presets.bilingual.highCopingDomains?.replace?.length).toBeGreaterThan(0);
    expect(presets.animaProduction.highCopingDomains?.replace).toContain('dian');
    expect(presets.animaProductionRoles.roles['OFICIAL']).toEqual({ stressWeight: 0, dopamineWeight: 0 });
  });
});
