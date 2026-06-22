# @animakit/homeostasis

> Give your agent a mood — modeled on 100 years of psychology. Stress curves (Yerkes-Dodson 1908), affect mapping (Russell 1980), allostatic regulation (Sterling & Eyer 1988), and a self-tuning 3-arm bandit. **Sub-µs core ops, every op <1ms, 0 tokens, fully serializable.**

![license](https://img.shields.io/npm/l/@animakit/homeostasis) ![types](https://img.shields.io/npm/types/@animakit/homeostasis)

Most agent frameworks are **stateless between turns**: every message is processed with the same intensity, no matter how many tasks are queued, how many errors just happened, or what time it is. The result is an agent that doesn't know when it's overloaded, doesn't modulate its tone, and needs hand-tuned rate limits to avoid overspending.

`homeostasis` gives an agent a **persistent internal state** (stress × dopamine) that:

- modulates whether it **accepts or defers** a task (acceptance sigmoid),
- modulates the **tone** of its responses (2D affective state),
- modulates **behavioral biases** across sub-agents/roles (somatic markers, Damasio),
- and **self-regulates** without hard-coded rate limits — the "calm" set-point moves with anticipated context (allostasis).

All of it with **sub-microsecond core ops** (every op p99 < 1ms), **0 tokens, 0 LLM calls**, fully serializable (`toJSON`/`fromJSON`). Extracted from [Anima](https://github.com/animakit-ai/anima)'s production agent — 53 sprints of real traffic. See [BENCHMARKS.md](./BENCHMARKS.md) for the numbers.

> "Cost control through biology, not rate limits."

## Install

```bash
npm i @animakit/homeostasis
```

## Quickstart

```ts
import { HomeostasisEngine } from '@animakit/homeostasis';

const homeo = new HomeostasisEngine();

// An error just happened → stress rises.
homeo.recordInteraction({ success: false, responseTimeMs: 800 });

// Should we take on this low-priority task right now?
if (homeo.evaluateTaskAcceptance(0.3)) {
  // ...do the work
}

// What tone should the agent take? (inject into your system prompt)
console.log(homeo.emotionalState.tone_instruction_en);
// → "Calm, resolving tone. There is pressure — help reduce it ..."

// Decay back toward the set-point on your own schedule (e.g. every 60s).
setInterval(() => homeo.tick(), 60_000);

// Persist anywhere — the engine is 100% in-memory.
await db.save(homeo.toJSON());
```

## Why this exists

The engine is a digital **Yerkes-Dodson** state machine: `dS/dt = α·I(t) − β·P(t) − γ·(S − target)`. Stress rises with events, decays toward a set-point, and gates task acceptance through a sigmoid — so an overloaded agent naturally sheds low-priority work instead of melting down. Battle-tested across 53 production sprints.

> "500 million years of evolution already solved the problems your agent framework is struggling with."

## API

### `HomeostasisEngine` (core, stateful, serializable)

```ts
const h = new HomeostasisEngine(config?, snapshot?);

h.stress; h.dopamine; h.mode;       // 'zen' | 'flow' | 'panic'
h.allostaticTarget; h.emotionalState;

h.addStress(delta); h.addDopamine(delta);
h.evaluateTaskAcceptance(priority?);          // P_accept(S) sigmoid
h.recordInteraction({ success, responseTimeMs, appraisal? });
h.tick(allostaticTarget?);                     // natural decay — caller owns scheduling

h.getEffectiveVetoThreshold();                 // refractory circuit-breaker T(t) = T_base + ΔT·e^(−t/τ)
h.recordVeto(constraints?);
h.getSomaticBias();                            // per-role bias (only when somaticBias is configured)
h.setProfile(profile);

h.toJSON(); HomeostasisEngine.fromJSON(snapshot, config?);
```

### Allostasis — dynamic set-point (Sterling & Eyer 1988)

```ts
import { computeAllostaticTarget } from '@animakit/homeostasis';

const { target } = computeAllostaticTarget({
  fepMode: 'active', kappa: 0.5, ceScore: 0.5, recentIgnitions: 1, hourLocal: 10,
});
homeo.tick(target); // decay toward an anticipated set-point, not a fixed one
```

`kappa` and `ceScore` are optional numeric inputs (e.g. from `@animakit/causal-emergence`); pass `null` when unavailable.

### Appraisal — cognitive evaluation (Lazarus / Scherer)

```ts
import { AppraisalEngine } from '@animakit/homeostasis';

const appraisal = new AppraisalEngine(); // bilingual EN+ES by default
const result = appraisal.evaluate('I need a go-to-market strategy for the product', {
  intentionHint: 'action_planning',
  goals: ['product launch'],
});
homeo.recordInteraction({ success: true, responseTimeMs: 1200, appraisal: result });
```

### Profiles & 3-arm bandit (Thompson Sampling)

```ts
import { updateBanditState, getProfile } from '@animakit/homeostasis';

// Once per period (night/sprint), learn which profile fits your usage pattern:
const next = updateBanditState(episodes, banditState);
homeo.setProfile(getProfile(next.activeArm)); // Conservative | Balanced | Proactive
```

`updateBanditState` accepts an optional `rng` for deterministic tests; sampling is exact Beta(α,β) via a Gamma ratio.

### Load prediction (no I/O)

```ts
import { predictLoad } from '@animakit/homeostasis';

const p = predictLoad(history, { utcOffsetHours: -5 }); // you pre-load the history; it never queries a DB
```

## Vocabulary — `presets.bilingual` vs `presets.animaProduction`

`AppraisalEngine` ships a generic **bilingual (EN+ES)** vocabulary by default. `presets.animaProduction` exposes the *exact* vocabulary running in production (Colombian tax/legal + SaaS) as a reference for building your own:

```ts
import { AppraisalEngine, presets } from '@animakit/homeostasis';

const a = new AppraisalEngine({ language: 'es', vocabulary: presets.animaProduction });
// or extend the defaults:
const b = new AppraisalEngine({ vocabulary: { highCopingDomains: { extend: ['kubernetes', 'terraform'] } } });
```

## Roles & somatic bias

When you configure `somaticBias`, the engine biases each role/sub-agent by the smoothed (EMA) stress/dopamine signal — but only inside the *flow zone* (predictability is preserved at the extremes). `presets.animaProductionRoles` reproduces how Anima biases its 5 sub-agents:

```ts
const h = new HomeostasisEngine({ somaticBias: presets.animaProductionRoles });
h.getSomaticBias(); // { biases: { JEFE, VIGIA, ARQUITECTO, OFICIAL, NEGOCIADOR }, active, reason }
```

> **OFICIAL is never biased** (`weight = 0`) — legal decisions stay outside the affective bias.

## `@animakit/homeostasis/valence`

The Russell-circumplex affect mapper is also a standalone sub-module — any app with a 2D "mood" score (arousal × valence) can use it:

```ts
import { computeEmotionalState } from '@animakit/homeostasis/valence';

const s = computeEmotionalState(0.4, 0.6);
// { emotion: 'engaged', label_en, label_es, tone_instruction_en, tone_instruction_es, ... }
```

## Design notes

- **`tick()` replaces the original's internal `setInterval`** — the caller owns scheduling; no hidden loops, no circular dependencies. Compute a dynamic set-point with `computeAllostaticTarget()` and pass it in.
- **`toJSON()`/`fromJSON()` replace `sync()`/`persist()`** — the engine is 100% in-memory; persistence (Postgres, Redis, a file) is yours.
- **Pure & deterministic** — every module is pure (given an `rng` where sampling is involved); 0 LLM calls, 0 network, 0 hidden state.

## License

MIT © Justine Serna
