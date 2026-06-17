// HomeostasisEngine — Yerkes-Dodson digital state machine.
// Implements dS/dt = α·I(t) − β·P(t) − γ·(S − target).
//
// A stateful, in-memory, fully serializable internal state (stress × dopamine)
// that modulates whether an agent accepts or defers a task, its affective tone,
// per-role behavioral biases (somatic markers), and a self-regulating set-point.
//
// 0 I/O, 0 LLM. Persistence is the caller's responsibility (toJSON / fromJSON).

import { computeEmotionalState, type EmotionalState, type ValenceConfig } from './valence.js';
import type { HomeoMode } from './types.js';
import type { AppraisalResult } from './appraisal.js';
import type { HomeostaticProfile } from './profiles.js';

export type { HomeoMode } from './types.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface SomaticRoleWeights {
  /** How much normalized stress biases this role. */
  stressWeight: number;
  /** How much normalized dopamine biases this role. */
  dopamineWeight: number;
}

export interface SomaticBiasConfig {
  /** Per-role weights applied to normalized stress/dopamine. */
  roles: Record<string, SomaticRoleWeights>;
  /** Maximum absolute bias magnitude. Default: 0.08 */
  maxBias?: number;
  /** EMA smoothing factor for the somatic signal. Default: 0.05 */
  emaAlpha?: number;
  /** Stress range in which bias is active. Default: { min: 0.15, max: 0.65 } */
  flowZone?: { min: number; max: number };
}

export interface HomeostasisConfig {
  /** Natural decay rates toward the set-point (γ, γd). Default: Anima production. */
  decay?: {
    stressRate?: number; // default 0.05
    dopamineRate?: number; // default 0.02
    dopamineTarget?: number; // default 0.5
  };
  /** Mode thresholds for zen/flow/panic. Default: 0.3 / 0.8 */
  modeThresholds?: { flow: number; panic: number };
  /** Task-acceptance sigmoid (P_accept). Default: panicThreshold=0.8, sigmoidK=10 */
  acceptance?: { panicThreshold?: number; sigmoidK?: number };
  /** Giant Fiber System — refractory veto period. Default: Anima production. */
  veto?: { baseThreshold?: number; deltaT?: number; tauMs?: number };
  /** Somatic markers (Damasio) — per-role biases. Optional. */
  somaticBias?: SomaticBiasConfig;
  /** Custom deltas for recordInteraction(). Default: Anima production. */
  deltas?: {
    stress?: { pipelineError?: number };
    dopamine?: { pipelineSuccess?: number; pipelineError?: number };
  };
  /** Thresholds for the affective state (forwarded to computeEmotionalState). */
  valence?: ValenceConfig;
  /** Random source for the acceptance sigmoid. Default: Math.random. */
  rng?: () => number;
}

export interface HomeostasisSnapshot {
  stress: number;
  dopamine: number;
  mode: HomeoMode;
  allostaticTarget: number;
  lastVetoAt: string | null;
  activeConstraints: string[];
  somaticEMA: { stress: number; dopamine: number };
}

// ── Resolved defaults ────────────────────────────────────────────────────────

const D = {
  stressRate: 0.05,
  dopamineRate: 0.02,
  dopamineTarget: 0.5,
  flow: 0.3,
  panic: 0.8,
  panicThreshold: 0.8,
  sigmoidK: 10,
  vetoBase: 0.65,
  vetoDeltaT: 0.25,
  vetoTauMs: 20 * 60 * 1000,
  maxBias: 0.08,
  emaAlpha: 0.05,
  flowMin: 0.15,
  flowMax: 0.65,
  pipelineErrorStress: 0.1,
  pipelineSuccessDopamine: 0.05,
  pipelineErrorDopamine: -0.05,
  baseTarget: 0.1, // resting set-point when no allostatic target is supplied
} as const;

// Somatic normalization reference points (production constants).
const SOMATIC_STRESS_CENTER = 0.3;
const SOMATIC_STRESS_HALFWIDTH = 0.35;
const SOMATIC_DOPAMINE_CENTER = 0.5;
const SOMATIC_DOPAMINE_HALFWIDTH = 0.5;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

interface ResolvedConfig {
  decay: { stressRate: number; dopamineRate: number; dopamineTarget: number };
  modeThresholds: { flow: number; panic: number };
  acceptance: { panicThreshold: number; sigmoidK: number };
  veto: { baseThreshold: number; deltaT: number; tauMs: number };
  deltas: {
    stress: { pipelineError: number };
    dopamine: { pipelineSuccess: number; pipelineError: number };
  };
  valence: ValenceConfig;
  rng: () => number;
  somaticBias?: SomaticBiasConfig;
}

// ── Engine ───────────────────────────────────────────────────────────────────

export class HomeostasisEngine {
  private _stress: number;
  private _dopamine: number;
  private _mode: HomeoMode;
  private _allostaticTarget: number;
  private _lastVetoAt: Date | null;
  private _activeConstraints: string[];
  private _somaticEMA: { stress: number; dopamine: number };
  private _stressMult = 1.0;

  private readonly cfg: ResolvedConfig;

  constructor(config: HomeostasisConfig = {}, snapshot?: Partial<HomeostasisSnapshot>) {
    this.cfg = {
      decay: {
        stressRate: config.decay?.stressRate ?? D.stressRate,
        dopamineRate: config.decay?.dopamineRate ?? D.dopamineRate,
        dopamineTarget: config.decay?.dopamineTarget ?? D.dopamineTarget,
      },
      modeThresholds: {
        flow: config.modeThresholds?.flow ?? D.flow,
        panic: config.modeThresholds?.panic ?? D.panic,
      },
      acceptance: {
        panicThreshold: config.acceptance?.panicThreshold ?? D.panicThreshold,
        sigmoidK: config.acceptance?.sigmoidK ?? D.sigmoidK,
      },
      veto: {
        baseThreshold: config.veto?.baseThreshold ?? D.vetoBase,
        deltaT: config.veto?.deltaT ?? D.vetoDeltaT,
        tauMs: config.veto?.tauMs ?? D.vetoTauMs,
      },
      deltas: {
        stress: { pipelineError: config.deltas?.stress?.pipelineError ?? D.pipelineErrorStress },
        dopamine: {
          pipelineSuccess: config.deltas?.dopamine?.pipelineSuccess ?? D.pipelineSuccessDopamine,
          pipelineError: config.deltas?.dopamine?.pipelineError ?? D.pipelineErrorDopamine,
        },
      },
      valence: config.valence ?? {},
      rng: config.rng ?? Math.random,
      ...(config.somaticBias ? { somaticBias: config.somaticBias } : {}),
    };

    this._stress = snapshot?.stress ?? D.baseTarget;
    this._dopamine = snapshot?.dopamine ?? D.dopamineTarget;
    this._allostaticTarget = snapshot?.allostaticTarget ?? D.baseTarget;
    this._lastVetoAt = snapshot?.lastVetoAt ? new Date(snapshot.lastVetoAt) : null;
    this._activeConstraints = snapshot?.activeConstraints ? [...snapshot.activeConstraints] : [];
    this._somaticEMA = snapshot?.somaticEMA
      ? { ...snapshot.somaticEMA }
      : { stress: this._stress, dopamine: this._dopamine };
    this._mode = snapshot?.mode ?? this.calcMode(this._stress);
  }

  // ── Getters ──────────────────────────────────────────────────────────────
  get stress(): number {
    return this._stress;
  }
  get dopamine(): number {
    return this._dopamine;
  }
  get mode(): HomeoMode {
    return this._mode;
  }
  get allostaticTarget(): number {
    return this._allostaticTarget;
  }
  get activeConstraints(): string[] {
    return [...this._activeConstraints];
  }
  get somaticEMA(): { stress: number; dopamine: number } {
    return { ...this._somaticEMA };
  }
  get emotionalState(): EmotionalState {
    return computeEmotionalState(this._stress, this._dopamine, this.cfg.valence);
  }

  private calcMode(stress: number): HomeoMode {
    if (stress >= this.cfg.modeThresholds.panic) return 'panic';
    if (stress >= this.cfg.modeThresholds.flow) return 'flow';
    return 'zen';
  }

  // ── State modifiers ────────────────────────────────────────────────────────

  /** Increases stress by an event delta (α·I(t)), scaled by the active profile's stressMult. */
  addStress(delta: number): void {
    this._stress = clamp01(this._stress + delta * this._stressMult);
    this._mode = this.calcMode(this._stress);
  }

  /** Adjusts dopamine by an event delta (β·P(t)). */
  addDopamine(delta: number): void {
    this._dopamine = clamp01(this._dopamine + delta);
  }

  // ── Task acceptance (Yerkes-Dodson sigmoid) ────────────────────────────────
  /**
   * P_accept(S) = 1 / (1 + e^(k·(S − S_crit))) · priority
   * Returns true if the system accepts the task. Below the panic threshold it
   * always accepts.
   */
  evaluateTaskAcceptance(priority = 0.5): boolean {
    const { panicThreshold, sigmoidK } = this.cfg.acceptance;
    if (this._stress < panicThreshold) return true;
    const pAccept = (1 / (1 + Math.exp(sigmoidK * (this._stress - panicThreshold)))) * priority;
    return this.cfg.rng() <= pAccept;
  }

  // ── Post-interaction update ────────────────────────────────────────────────
  /**
   * Applies deltas after an interaction. On success with an appraisal, the
   * appraisal deltas replace the defaults (plus a half success bonus); latency
   * always adds a little stress. On failure, applies the pipeline-error deltas.
   */
  recordInteraction(options: {
    success: boolean;
    responseTimeMs: number;
    appraisal?: AppraisalResult;
  }): void {
    const { dopamine, stress } = this.cfg.deltas;
    if (options.success) {
      if (options.appraisal) {
        if (options.appraisal.stressDelta !== 0) this.addStress(options.appraisal.stressDelta);
        if (options.appraisal.dopamineDelta !== 0) this.addDopamine(options.appraisal.dopamineDelta);
        this.addDopamine(dopamine.pipelineSuccess * 0.5);
      } else {
        this.addDopamine(dopamine.pipelineSuccess);
      }
      const latencyStress = Math.min(options.responseTimeMs / 120_000, 0.05);
      if (latencyStress > 0.01) this.addStress(latencyStress);
    } else {
      this.addStress(stress.pipelineError);
      this.addDopamine(dopamine.pipelineError);
    }
  }

  // ── Natural decay tick (γ) ─────────────────────────────────────────────────
  /**
   * Advances one decay tick (dS/dt, dD/dt toward the set-point). The caller owns
   * scheduling (setInterval, cron, etc.) — there is no internal loop. If
   * `allostaticTarget` is provided it becomes the new stress set-point; otherwise
   * stress decays toward the previous target. Compute the dynamic target with
   * computeAllostaticTarget() from './allostasis'.
   */
  tick(allostaticTarget?: number): void {
    if (allostaticTarget !== undefined) this._allostaticTarget = allostaticTarget;

    const { stressRate, dopamineRate, dopamineTarget } = this.cfg.decay;
    const sTarget = this._allostaticTarget;

    if (Math.abs(this._stress - sTarget) > 0.002) {
      this._stress =
        this._stress > sTarget
          ? Math.max(sTarget, this._stress - stressRate * (this._stress - sTarget))
          : Math.min(sTarget, this._stress + stressRate * (sTarget - this._stress));
      this._mode = this.calcMode(this._stress);
    }

    if (Math.abs(this._dopamine - dopamineTarget) > 0.005) {
      this._dopamine =
        this._dopamine > dopamineTarget
          ? Math.max(dopamineTarget, this._dopamine - dopamineRate * (this._dopamine - dopamineTarget))
          : Math.min(dopamineTarget, this._dopamine + dopamineRate * (dopamineTarget - this._dopamine));
    }

    this.updateSomaticEMA();
  }

  private updateSomaticEMA(): void {
    const a = this.cfg.somaticBias?.emaAlpha ?? D.emaAlpha;
    this._somaticEMA.stress += a * (this._stress - this._somaticEMA.stress);
    this._somaticEMA.dopamine += a * (this._dopamine - this._somaticEMA.dopamine);
  }

  // ── Giant Fiber System (refractory veto) ───────────────────────────────────
  /** Effective veto threshold: T(t) = T_base + ΔT × e^(−t/τ). */
  getEffectiveVetoThreshold(): number {
    const { baseThreshold, deltaT, tauMs } = this.cfg.veto;
    if (!this._lastVetoAt) return baseThreshold;
    const elapsed = Date.now() - this._lastVetoAt.getTime();
    return baseThreshold + deltaT * Math.exp(-elapsed / tauMs);
  }

  /** Records that a veto fired, starting the refractory period. Merges constraints (max 10). */
  recordVeto(constraints: string[] = []): void {
    this._lastVetoAt = new Date();
    this._activeConstraints = [...new Set([...this._activeConstraints, ...constraints])].slice(0, 10);
  }

  // ── Somatic markers (Damasio) ──────────────────────────────────────────────
  /**
   * Per-role bias from the smoothed somatic signal. Active only inside the flow
   * zone; returns zeroed biases (active=false) outside it or when unconfigured.
   */
  getSomaticBias(): { biases: Record<string, number>; active: boolean; reason: string } {
    const sb = this.cfg.somaticBias;
    if (!sb) return { biases: {}, active: false, reason: 'not_configured' };

    const zero: Record<string, number> = {};
    for (const role of Object.keys(sb.roles)) zero[role] = 0;

    const s = this._somaticEMA.stress;
    const d = this._somaticEMA.dopamine;
    const flowMin = sb.flowZone?.min ?? D.flowMin;
    const flowMax = sb.flowZone?.max ?? D.flowMax;
    if (s > flowMax) return { biases: zero, active: false, reason: 'panic_zone' };
    if (s < flowMin) return { biases: zero, active: false, reason: 'deep_zen' };

    const M = sb.maxBias ?? D.maxBias;
    const sNorm = (s - SOMATIC_STRESS_CENTER) / SOMATIC_STRESS_HALFWIDTH;
    const dNorm = (d - SOMATIC_DOPAMINE_CENTER) / SOMATIC_DOPAMINE_HALFWIDTH;
    const clamp = (v: number): number => Math.max(-M, Math.min(M, v));

    const biases: Record<string, number> = {};
    for (const [role, w] of Object.entries(sb.roles)) {
      biases[role] = clamp((sNorm * w.stressWeight + dNorm * w.dopamineWeight) * M);
    }
    return { biases, active: true, reason: 'flow_zone' };
  }

  // ── Profile ────────────────────────────────────────────────────────────────
  /** Applies a bandit profile (its stressMult scales addStress). */
  setProfile(profile: HomeostaticProfile): void {
    this._stressMult = profile.stressMult;
  }

  // ── Serialization ──────────────────────────────────────────────────────────
  toJSON(): HomeostasisSnapshot {
    return {
      stress: this._stress,
      dopamine: this._dopamine,
      mode: this._mode,
      allostaticTarget: this._allostaticTarget,
      lastVetoAt: this._lastVetoAt ? this._lastVetoAt.toISOString() : null,
      activeConstraints: [...this._activeConstraints],
      somaticEMA: { ...this._somaticEMA },
    };
  }

  static fromJSON(snapshot: HomeostasisSnapshot, config?: HomeostasisConfig): HomeostasisEngine {
    return new HomeostasisEngine(config, snapshot);
  }
}
