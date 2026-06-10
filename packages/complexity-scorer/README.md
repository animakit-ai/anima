# @animakit/complexity-scorer

> Classify LLM tasks in <1ms with zero tokens — before you ever call an LLM.

Part of [ANIMA](https://github.com/animakit-ai/anima) — *Agentic Neuro-Inspired Memory Architecture*. Battle-tested cognitive architecture for LLM agents, extracted from 53 sprints in production.

## Status: 🚧 under extraction

This release reserves the package and publishes the typed API surface (see [SPEC.md](https://github.com/animakit-ai/anima/blob/main/packages/complexity-scorer/SPEC.md)). The implementation — extracted from the production scorer that routes a real business agent's traffic — lands in the next minor, together with reproducible benchmarks on real production data.

## What's coming

```ts
import { scoreComplexity } from '@animakit/complexity-scorer';

const { tier, score, signals } = scoreComplexity('Refactor the auth module and explain the tradeoffs');
// tier: 'micro' | 'small' | 'medium' | 'large' — route to the right model, skip the expensive one
```

- 5 weighted signals (length, domain, structure, reasoning, context) — pure function, 0 deps, 0 I/O
- Configurable vocabulary (`extend`/`replace`), bilingual EN+ES defaults
- `presets.animaProduction` — the exact config running in production
- Benchmarks as gates: p99 < 1ms or it doesn't ship

## License

MIT © Justine Serna Aza
