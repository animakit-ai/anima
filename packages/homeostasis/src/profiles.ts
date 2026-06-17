// HomeostaticProfiles — the 3 arms of the Multi-Armed Bandit.
//
// Thompson Sampling (see ./bandit.ts) picks one profile each night to govern
// the system for the next period, based on the previous period's outcome.
//
// Each profile exposes two multipliers:
//   fepThresholdMult — scales the caller's proactive-initiative thresholds
//                      (e.g. an FEP engine): how readily the agent speaks first.
//   stressMult       — scales the stress deltas in recordInteraction():
//                      how many chained operations the agent tolerates.

export interface HomeostaticProfile {
  arm: 0 | 1 | 2;
  name: string;
  /**
   * Multiplies the caller's proactive-initiative (e.g. FEP) thresholds.
   * > 1.0 → higher thresholds → less proactive (quieter)
   * < 1.0 → lower thresholds → more proactive
   */
  fepThresholdMult: number;
  /**
   * Multiplies the stress deltas applied in recordInteraction().
   * > 1.0 → stress rises faster → accepts fewer chained tasks
   * < 1.0 → stress rises slower → endures more operations
   */
  stressMult: number;
}

export const HOMEOSTATIC_PROFILES: HomeostaticProfile[] = [
  {
    arm: 0,
    name: 'Conservative',
    // FEP thresholds +25%: only large surprises or long silences trigger initiative.
    fepThresholdMult: 1.25,
    // Stress accumulates 1.8x faster → the system "tires" sooner.
    stressMult: 1.8,
  },
  {
    arm: 1,
    name: 'Balanced',
    // Baseline — no modification.
    fepThresholdMult: 1.0,
    stressMult: 1.0,
  },
  {
    arm: 2,
    name: 'Proactive',
    // FEP thresholds -20%: small doubts or slight silence trigger proactive contact.
    fepThresholdMult: 0.8,
    // Stress accumulates 0.5x slower → endures more chained operations.
    stressMult: 0.5,
  },
];

/** Returns the profile for an arm index (fallback = Balanced). */
export function getProfile(arm: number): HomeostaticProfile {
  return HOMEOSTATIC_PROFILES.find((p) => p.arm === arm) ?? HOMEOSTATIC_PROFILES[1]!;
}
