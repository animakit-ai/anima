// Allostasis — dynamic set-point regulation (Sterling & Eyer, 1988).
//
// Classic homeostasis keeps a fixed set-point. Allostasis moves the set-point
// based on anticipated context: the system adjusts its "normal" stress level
// *before* the stressor arrives, not after.
//
//   target = baseTarget + Σ deltas(fepMode, κ, CE̊, recentIgnitions, hour)
//   target ∈ [minTarget, maxTarget]
//
// Reference: Sterling & Eyer (1988). "Allostasis: a new paradigm to explain
//   arousal pathology." Handbook of Life Stress, Cognition and Health.
//
// Pure — 0 I/O, 0 LLM, <0.1ms.

// ── Input ────────────────────────────────────────────────────────────────────

export interface AllostaticInput {
  /** "Anticipated free energy" mode: 'zen' | 'alert' | 'active' | 'urgent' */
  fepMode: string;
  /** Criticality index κ (e.g. from @animakit/causal-emergence). null if unavailable. */
  kappa: number | null;
  /** Average Causal Emergence CE̊. null if unavailable. */
  ceScore: number | null;
  /** How many of the last N interactions triggered "ignition" (high salience). */
  recentIgnitions: number;
  /** Agent's local hour (0-23) — for time-of-day deltas. */
  hourLocal: number;
}

// ── Result ───────────────────────────────────────────────────────────────────

export interface AllostaticResult {
  /** Dynamic set-point ∈ [minTarget, maxTarget] */
  target: number;
  /** Breakdown of active deltas */
  deltas: Record<string, number>;
  /** Interpretation */
  label: string;
}

export interface HourlyPeriod {
  /** Inclusive start hour (0-23). If startHour > endHour, the period wraps midnight. */
  startHour: number;
  /** Exclusive end hour (0-23). */
  endHour: number;
  delta: number;
  label: string;
}

export interface AllostaticConfig {
  baseTarget?: number; // default 0.10
  minTarget?: number; // default 0.10
  maxTarget?: number; // default 0.55
  /** Deltas by hour of day. Default: a Bogotá-style work schedule. */
  hourlyPeriods?: HourlyPeriod[];
}

// ── Defaults (Anima production values) ──────────────────────────────────────

const DEFAULT_BASE_TARGET = 0.1;
const DEFAULT_MIN_TARGET = 0.1;
const DEFAULT_MAX_TARGET = 0.55;

/** Default schedule: morning peak (9-13), productive afternoon (14-18), night (22-6). */
export const DEFAULT_HOURLY_PERIODS: HourlyPeriod[] = [
  { startHour: 9, endHour: 13, delta: +0.06, label: 'hora_pico_manana' },
  { startHour: 14, endHour: 18, delta: +0.04, label: 'hora_tarde' },
  { startHour: 22, endHour: 6, delta: -0.08, label: 'hora_noche' },
];

function hourInPeriod(hour: number, p: HourlyPeriod): boolean {
  if (p.startHour <= p.endHour) {
    return hour >= p.startHour && hour < p.endHour;
  }
  // wraps midnight (e.g. 22..6)
  return hour >= p.startHour || hour < p.endHour;
}

// ── Main function ───────────────────────────────────────────────────────────

/**
 * Computes the allostatic set-point for the current decay cycle.
 * Pure — no side effects.
 */
export function computeAllostaticTarget(
  input: AllostaticInput,
  config: AllostaticConfig = {},
): AllostaticResult {
  const baseTarget = config.baseTarget ?? DEFAULT_BASE_TARGET;
  const minTarget = config.minTarget ?? DEFAULT_MIN_TARGET;
  const maxTarget = config.maxTarget ?? DEFAULT_MAX_TARGET;
  const hourlyPeriods = config.hourlyPeriods ?? DEFAULT_HOURLY_PERIODS;

  const deltas: Record<string, number> = {};

  // ── FEP mode — anticipates future demand ──────────────────────────────────
  if (input.fepMode === 'urgent') {
    deltas['fep_urgent'] = +0.14;
  } else if (input.fepMode === 'active') {
    deltas['fep_active'] = +0.08;
  } else if (input.fepMode === 'alert') {
    deltas['fep_alert'] = +0.04;
  }
  // zen → no delta (base)

  // ── Criticality κ — system regime ─────────────────────────────────────────
  if (input.kappa !== null) {
    if (input.kappa < 0.3) {
      // Very subcritical: rigid system → needs arousal
      deltas['kappa_rigid'] = +0.05;
    } else if (input.kappa > 0.72) {
      // Supercritical: chaotic system → needs calm to stabilize
      deltas['kappa_chaotic'] = -0.04;
    }
  }

  // ── Causal Emergence CE̊ ────────────────────────────────────────────────────
  if (input.ceScore !== null) {
    if (input.ceScore < 0.35) {
      // Micro dominates: macro level has no causal power → needs arousal
      deltas['ce_micro_dominant'] = +0.04;
    } else if (input.ceScore > 0.7) {
      // Macro strongly dominant: well regulated, don't overload
      deltas['ce_macro_strong'] = -0.02;
    }
  }

  // ── Recent ignition ────────────────────────────────────────────────────────
  if (input.recentIgnitions >= 3) {
    // Already fully activated — lower target to avoid overload
    deltas['recent_ignitions'] = -0.06;
  } else if (input.recentIgnitions >= 2) {
    deltas['recent_ignitions'] = -0.03;
  }

  // ── Hour of day ────────────────────────────────────────────────────────────
  for (const period of hourlyPeriods) {
    if (hourInPeriod(input.hourLocal, period)) {
      deltas[period.label] = period.delta;
      break; // first matching period wins
    }
  }

  // ── Final target ───────────────────────────────────────────────────────────
  const totalDelta = Object.values(deltas).reduce((a, b) => a + b, 0);
  const raw = baseTarget + totalDelta;
  const target = +Math.min(maxTarget, Math.max(minTarget, raw)).toFixed(3);

  // ── Label ──────────────────────────────────────────────────────────────────
  const label =
    target >= 0.42
      ? 'high alert — system primed for intense demand'
      : target >= 0.28
        ? 'moderate alert — elevated operating state'
        : target >= 0.18
          ? 'normal operating state'
          : 'active quiet — system at anticipated rest';

  return { target, deltas, label };
}
