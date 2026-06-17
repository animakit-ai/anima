// Bandit — Thompson Sampling over a 3-arm Beta-Bernoulli bandit.
//
// Extracted as a pure function from Anima's PatternLearner. The caller is the
// I/O orchestrator: it builds the episodes for the period (day / sprint), calls
// updateBanditState(), and persists the returned state. No DB, no scheduling.
//
// Thompson Sampling with exact Beta sampling for integer parameters:
//   Beta(α,β) sampled via Gamma(α,1) / (Gamma(α,1) + Gamma(β,1))
//   Gamma(α,1) = -Σ ln(Uᵢ) for α Uniform(0,1) draws — exact for integer α.
//
// Pure (given an rng) — 0 I/O, 0 LLM, <0.05ms.

export interface ArmBetaParams {
  alpha: number;
  beta: number;
}

export interface BanditState {
  activeArm: 0 | 1 | 2;
  armsBetaParams: {
    '0': ArmBetaParams;
    '1': ArmBetaParams;
    '2': ArmBetaParams;
  };
}

/** A generic episode of one period under an active arm. */
export interface BanditEpisode {
  activeArm: 0 | 1 | 2;
  /** true = positive outcome under this arm, false = negative, null = no signal (ignored). */
  outcome: boolean | null;
  /** Optional: predictive accuracy of the period [0,1] — adjusts the reward. */
  confidenceScore?: number | null;
}

/** Random source for sampling. Default: Math.random. Inject for deterministic tests. */
export type Rng = () => number;

/** Gamma(α, 1) = -Σ ln(Uᵢ) for α draws — exact for integer α. */
function sampleGamma(alpha: number, rng: Rng): number {
  let sum = 0;
  const n = Math.max(1, Math.round(alpha));
  for (let i = 0; i < n; i++) {
    sum -= Math.log(rng() || 1e-10); // avoid ln(0)
  }
  return sum;
}

/** Beta(α, β) via a ratio of Gammas — exact distribution for integer parameters. */
function sampleBeta(alpha: number, beta: number, rng: Rng): number {
  const x = sampleGamma(alpha, rng);
  const y = sampleGamma(beta, rng);
  return x / (x + y);
}

/**
 * Evaluates the reward for the active arm from this period's episodes, updates
 * its Beta(α,β), then samples all three arms to pick the arm for next period.
 *
 * Reward rule: among episodes of the active arm with a non-null outcome, if the
 * majority (≥50%) are positive → R=1, else R=0. If there are no episodes for the
 * active arm, or none carry a signal, the Beta params are left untouched and only
 * the next arm is re-sampled. An optional confidenceScore overrides the reward at
 * the extremes (≥0.7 rescues a 0; <0.4 forces a 0).
 *
 * Pure given `rng` — returns a new state, never mutates the input.
 */
export function updateBanditState(
  episodes: BanditEpisode[],
  state: BanditState,
  rng: Rng = Math.random,
): BanditState {
  const newState: BanditState = {
    activeArm: state.activeArm,
    armsBetaParams: {
      '0': { ...state.armsBetaParams['0'] },
      '1': { ...state.armsBetaParams['1'] },
      '2': { ...state.armsBetaParams['2'] },
    },
  };

  const armKey = String(state.activeArm) as '0' | '1' | '2';
  const armEpisodes = episodes.filter((e) => e.activeArm === state.activeArm);
  const signalled = armEpisodes.filter((e) => e.outcome !== null);

  if (signalled.length > 0) {
    const successCount = signalled.filter((e) => e.outcome === true).length;
    let R: 0 | 1 = successCount / signalled.length >= 0.5 ? 1 : 0;

    // Confidence adjustment (predictive accuracy of the period).
    const confidences = armEpisodes
      .map((e) => e.confidenceScore)
      .filter((c): c is number => c != null);
    if (confidences.length > 0) {
      const avgConf = confidences.reduce((a, b) => a + b, 0) / confidences.length;
      if (avgConf >= 0.7 && R === 0) R = 1; // rescue an arm that predicts well
      if (avgConf < 0.4) R = 0; // penalize regardless of the rest
    }

    if (R === 1) {
      newState.armsBetaParams[armKey].alpha += 1;
    } else {
      newState.armsBetaParams[armKey].beta += 1;
    }
  }

  // Sample all three arms; the highest draw governs next period.
  let winner: 0 | 1 | 2 = 0;
  let best = -Infinity;
  for (const key of ['0', '1', '2'] as const) {
    const { alpha, beta } = newState.armsBetaParams[key];
    const draw = sampleBeta(alpha, beta, rng);
    if (draw > best) {
      best = draw;
      winner = Number(key) as 0 | 1 | 2;
    }
  }
  newState.activeArm = winner;

  return newState;
}
