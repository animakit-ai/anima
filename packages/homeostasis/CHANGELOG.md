# @animakit/homeostasis

## 0.1.1

### Patch Changes

- edfd1ed: Honest performance claim + verified regulation & self-tuning benchmarks.

  - Corrected the "<1µs" claim (README + npm description) to "sub-µs core ops, every op p99 < 1ms" — measured: core state ops (`addStress`/`tick`/`evaluateTaskAcceptance`) are 0.2–0.5µs, while `AppraisalEngine.evaluate` (7.5µs) and `predictLoad` (920µs) are above 1µs but well under 1ms.
  - New `benchmarks/regulation.ts` — proves "self-regulates without hard-coded rate limits": under an adversarial flood the engine enters panic, sheds low-priority work while protecting high-priority work (in proportion to priority), and recovers via decay alone. Deterministic (seeded), pre-registered gates.
  - New `benchmarks/bandit-convergence.ts` — proves the self-tuning bandit finds the best arm reliably (not by luck): 200 seeds, cold start from the worst arm, 100% convergence at production-like signal.
  - Added `BENCHMARKS.md` (all verified numbers) and `APPLICATIONS.md` (agentic + IoT/edge use cases).

  No API or behavior changes.

## 0.1.0

### Minor Changes

- f316cff: Initial release of `@animakit/homeostasis` — a stress/dopamine homeostatic state machine for LLM agents, extracted from Anima's production agent (53 sprints).

  - `HomeostasisEngine` — Yerkes-Dodson core: stress × dopamine, task-acceptance sigmoid, refractory veto (Giant Fiber System), somatic markers, `tick()` decay, and full `toJSON`/`fromJSON` serialization (0 I/O).
  - `computeAllostaticTarget()` — dynamic set-point regulation (Sterling & Eyer 1988), with configurable hourly schedule.
  - `AppraisalEngine` — cognitive appraisal (Lazarus/Scherer) with bilingual EN+ES vocabulary and `extend`/`replace` overrides.
  - `updateBanditState()` — pure 3-arm Thompson Sampling with injectable RNG.
  - `predictLoad()` — pure, history-driven load prediction (no DB).
  - `@animakit/homeostasis/valence` sub-export — Russell circumplex affect mapping, bilingual labels and tone directives.
  - `presets.bilingual` / `presets.animaProduction` / `presets.animaProductionRoles`.

  Verified: 100% line/statement/function coverage (68 tests), p99 < 1ms on all core ops, and a golden-master parity gate of 3,609 comparisons with 0 divergences against the original production code.
