# @animakit/homeostasis

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
