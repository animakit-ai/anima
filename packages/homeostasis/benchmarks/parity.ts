// Golden-master parity gate — MANDATORY before publishing.
// Run: node --import tsx benchmarks/parity.ts
//
// Asserts the extracted package reproduces, byte-for-byte, the behavior of the
// ORIGINAL Anima production code for every behavior-preserving function. The
// originals are copied verbatim below (logger calls stripped — they do not
// affect outputs). Functions with an intentionally changed API (HomeostasisEngine
// tick() vs startDecayLoop(), updateBanditState() reward derivation) are NOT
// parity targets — they are documented design changes (see SPEC §3).

import {
  computeAllostaticTarget,
  computeEmotionalState,
  AppraisalEngine,
  presets,
} from '../src/index.js';

// ════════════════════════════════════════════════════════════════════════════
// ORIGINAL — AllostaticRegulator.computeAllostaticTarget (Anima_core, verbatim)
// ════════════════════════════════════════════════════════════════════════════
function originalAllostatic(input: {
  fepMode: string;
  kappa: number | null;
  ce_score: number | null;
  recentIgnitions: number;
  hourBogota: number;
}) {
  const BASE_TARGET = 0.1, MIN_TARGET = 0.1, MAX_TARGET = 0.55;
  const deltas: Record<string, number> = {};
  if (input.fepMode === 'urgent') deltas['fep_urgent'] = +0.14;
  else if (input.fepMode === 'active') deltas['fep_active'] = +0.08;
  else if (input.fepMode === 'alert') deltas['fep_alert'] = +0.04;
  if (input.kappa !== null) {
    if (input.kappa < 0.3) deltas['kappa_rigid'] = +0.05;
    else if (input.kappa > 0.72) deltas['kappa_chaotic'] = -0.04;
  }
  if (input.ce_score !== null) {
    if (input.ce_score < 0.35) deltas['ce_micro_dominant'] = +0.04;
    else if (input.ce_score > 0.7) deltas['ce_macro_strong'] = -0.02;
  }
  if (input.recentIgnitions >= 3) deltas['recent_ignitions'] = -0.06;
  else if (input.recentIgnitions >= 2) deltas['recent_ignitions'] = -0.03;
  const h = input.hourBogota;
  if (h >= 9 && h < 13) deltas['hora_pico_manana'] = +0.06;
  else if (h >= 14 && h < 18) deltas['hora_tarde'] = +0.04;
  else if (h >= 22 || h < 6) deltas['hora_noche'] = -0.08;
  const totalDelta = Object.values(deltas).reduce((a, b) => a + b, 0);
  const target = +Math.min(MAX_TARGET, Math.max(MIN_TARGET, BASE_TARGET + totalDelta)).toFixed(3);
  return { target, deltas };
}

// ════════════════════════════════════════════════════════════════════════════
// ORIGINAL — ValenceSpace.computeEmotionalState (Anima_core, verbatim)
// ════════════════════════════════════════════════════════════════════════════
function originalValence(stress: number, dopamine: number) {
  const AROUSAL_HIGH = 0.52, AROUSAL_LOW = 0.28, VALENCE_POS = 0.08, VALENCE_NEG = -0.08;
  const arousal = Math.max(0, Math.min(1, stress));
  const valence = Math.max(-1, Math.min(1, (dopamine - 0.5) * 2));
  const arousal_zone = arousal >= AROUSAL_HIGH ? 'high' : arousal <= AROUSAL_LOW ? 'low' : 'medium';
  const valence_zone = valence > VALENCE_POS ? 'positive' : valence < VALENCE_NEG ? 'negative' : 'neutral';
  let emotion: string;
  if (arousal_zone === 'high') emotion = valence_zone === 'positive' ? 'excited' : valence_zone === 'negative' ? 'anxious' : 'alert';
  else if (arousal_zone === 'low') emotion = valence_zone === 'positive' ? 'content' : valence_zone === 'negative' ? 'low' : 'calm';
  else emotion = valence_zone === 'positive' ? 'engaged' : valence_zone === 'negative' ? 'tense' : 'focused';
  return { emotion, arousal_zone, valence_zone, arousal: +arousal.toFixed(3), valence: +valence.toFixed(3) };
}

// ════════════════════════════════════════════════════════════════════════════
// ORIGINAL — AppraisalEngine.evaluate (Anima_core, verbatim, logger stripped)
// ════════════════════════════════════════════════════════════════════════════
const O_HIGH = ['estrategia','estratégico','plan','negocio','ventas','cliente','producto','mvp','arquitectura','código','técnico','sistema','inversión','financiero','legal','contrato','dian','tributar','equipo','proceso','decisión','análisis'];
const O_LOW = ['urgente','crisis','emergencia','falla','error crítico','demanda','juicio','embargo','accidente','pérdida total'];
const O_EXT = ['el cliente','el inversor','la dian','el banco','el gobierno','nos rechazaron','no aprobaron','cancelaron','me bloquearon','depende de ellos','están esperando'];

function originalAppraisal(message: string, intention: string | undefined, userGoals: string[], wmCtx: string) {
  const msgWords = new Set(message.toLowerCase().match(/\b\w{5,}\b/g) ?? []);
  const histWords = new Set(wmCtx.toLowerCase().match(/\b\w{5,}\b/g) ?? []);
  const overlap = [...msgWords].filter((w) => histWords.has(w)).length;
  const novelty = Math.max(0.2, Math.min(0.9, msgWords.size > 0 ? 1 - Math.min(overlap / msgWords.size, 1) : 0.5));
  let relevance: number;
  if (userGoals.length === 0) relevance = 0.5;
  else {
    const msgLower = message.toLowerCase();
    const matching = userGoals.filter((g) => (g.toLowerCase().match(/\b\w{4,}\b/g) ?? []).some((w) => msgLower.includes(w)));
    relevance = Math.min(0.3 + (matching.length / userGoals.length) * 0.7, 1.0);
  }
  const msgLower = message.toLowerCase();
  const highHits = O_HIGH.filter((k) => msgLower.includes(k)).length;
  const lowHits = O_LOW.filter((k) => msgLower.includes(k)).length;
  let coping = lowHits > 0 ? Math.max(0.2, 0.5 - lowHits * 0.15) : highHits > 0 ? Math.min(0.9, 0.6 + highHits * 0.1) : 0.6;
  const extHits = O_EXT.filter((s) => msgLower.includes(s)).length;
  const agency = extHits >= 2 ? 'other' : extHits === 1 ? 'circumstance' : 'self';
  const effCoping = intention === 'venting' ? Math.min(coping, 0.45) : intention === 'action_planning' ? Math.max(coping, 0.65) : coping;
  let stressDelta = 0, dopamineDelta = 0;
  if (relevance > 0.5) {
    if (effCoping >= 0.65) { dopamineDelta += relevance * effCoping * 0.12; stressDelta -= relevance * 0.03; }
    else { stressDelta += relevance * (1 - effCoping) * 0.15; dopamineDelta -= relevance * (1 - effCoping) * 0.05; }
  }
  if (agency === 'other') { stressDelta += 0.04; dopamineDelta -= 0.02; }
  else if (agency === 'circumstance') stressDelta += 0.02;
  if (novelty > 0.6 && effCoping >= 0.5) dopamineDelta += novelty * 0.03;
  stressDelta = Math.round(stressDelta * 1000) / 1000;
  dopamineDelta = Math.round(dopamineDelta * 1000) / 1000;
  const valence = dopamineDelta > 0.008 ? 'positive' : stressDelta > 0.015 ? 'negative' : 'neutral';
  return { novelty, relevance, coping: effCoping, agency, valence, stressDelta, dopamineDelta };
}

// ════════════════════════════════════════════════════════════════════════════
// Comparison harness
// ════════════════════════════════════════════════════════════════════════════
let total = 0;
let diffs = 0;
function check(label: string, a: unknown, b: unknown): void {
  total++;
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) {
    diffs++;
    if (diffs <= 10) console.log(`  DIFF [${label}]\n    extracted: ${sa}\n    original:  ${sb}`);
  }
}

// ── Allostasis grid ──────────────────────────────────────────────────────────
for (const fepMode of ['zen', 'alert', 'active', 'urgent', 'other']) {
  for (const kappa of [null, 0.1, 0.5, 0.8]) {
    for (const ce of [null, 0.2, 0.5, 0.8]) {
      for (const ign of [0, 1, 2, 3]) {
        for (const hour of [0, 5, 8, 10, 13, 15, 19, 22, 23]) {
          const ext = computeAllostaticTarget({ fepMode, kappa, ceScore: ce, recentIgnitions: ign, hourLocal: hour });
          const orig = originalAllostatic({ fepMode, kappa, ce_score: ce, recentIgnitions: ign, hourBogota: hour });
          check(`allostatic ${fepMode}/${kappa}/${ce}/${ign}/${hour}`, { target: ext.target, deltas: ext.deltas }, orig);
        }
      }
    }
  }
}

// ── Valence grid ─────────────────────────────────────────────────────────────
for (let s = 0; s <= 1.0001; s += 0.05) {
  for (let d = 0; d <= 1.0001; d += 0.05) {
    const ext = computeEmotionalState(s, d);
    const orig = originalValence(s, d);
    check(`valence ${s.toFixed(2)}/${d.toFixed(2)}`, {
      emotion: ext.emotion, arousal_zone: ext.arousal_zone, valence_zone: ext.valence_zone,
      arousal: ext.arousal, valence: ext.valence,
    }, orig);
  }
}

// ── Appraisal grid (animaProduction vocab = original lists) ──────────────────
const appraisal = new AppraisalEngine({ language: 'es', vocabulary: presets.animaProduction });
const MESSAGES = [
  'necesito una estrategia de ventas para el producto',
  'crisis: error crítico y demanda urgente',
  'el cliente y el banco nos rechazaron, depende de ellos',
  'la dian canceló la declaración',
  'hablemos del clima de hoy',
  'arquitectura del sistema y código técnico',
  'ok',
  'el inversor está esperando, no aprobaron la inversión',
];
const GOALS = [[], ['ventas producto'], ['error crisis'], ['inversión']];
const INTENTIONS: (string | undefined)[] = [undefined, 'venting', 'action_planning'];
const CONTEXT = ['', 'estrategia previa de ventas', 'totalmente diferente'];
for (const m of MESSAGES) {
  for (const g of GOALS) {
    for (const it of INTENTIONS) {
      for (const ctx of CONTEXT) {
        const ext = appraisal.evaluate(m, { intentionHint: it, goals: g, recentContext: ctx });
        const orig = originalAppraisal(m, it, g, ctx);
        check(`appraisal "${m.slice(0, 20)}"/${g.length}/${it}/${ctx.length}`, {
          novelty: ext.novelty, relevance: ext.relevance, coping: ext.coping, agency: ext.agency,
          valence: ext.valence, stressDelta: ext.stressDelta, dopamineDelta: ext.dopamineDelta,
        }, orig);
      }
    }
  }
}

console.log(`\n@animakit/homeostasis — golden-master parity vs original Anima code`);
console.log(`  comparisons: ${total}`);
console.log(`  identical:   ${total - diffs}`);
console.log(`  divergences: ${diffs}`);
console.log(`  gate (0 divergences): ${diffs === 0 ? 'PASS ✅' : 'FAIL ❌'}\n`);
process.exit(diffs === 0 ? 0 : 1);
