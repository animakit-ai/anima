# ANIMA — Agentic Neuro-Inspired Memory Architecture

> Battle-tested cognitive architecture for LLM agents — extracted from 53 sprints in production.

I ran an AI agent in production for 53 sprints. I saw exactly where standard agent architecture fails: routing wastes tokens, memory rots over time, the agent doesn't know when to stop. The solutions came from neurobiology — evolution already solved these problems. Here they are, extracted as tools.

## Packages

| Package | What it does | Status |
|---|---|---|
| [`@animakit/complexity-scorer`](packages/complexity-scorer) | Classify LLM tasks in <1ms, 0 tokens — before you ever call an LLM | 🚧 |
| `@animakit/homeostasis` | Stress/dopamine state for agents — cost control through biology, not rate limits | planned |
| `@animakit/git-guardrails` | Human-in-the-loop confirmation for agents with git/shell access | planned |
| `@animakit/debate` | Multi-agent debate with a measurable integration score (Φ̂) | planned |
| `@animakit/presence-aware` | Calendar + Slack signals → "can my agent interrupt right now?" | planned |
| `@animakit/neuromorphic-router` | Deterministic agent routing in <1ms with veto + lateral inhibition | planned |
| `@animakit/sleep-cycle` | Nightly memory consolidation — RAG memory degrades; sleep fixes that | planned |

More coming — see each package's `SPEC.md` for design docs.

## Principles

- **Zero/minimal dependencies.** Most packages have none.
- **Benchmarks are gates, not marketing.** Every claim in a README is reproducible from `benchmarks/` — measured on real production data.
- **Battle-tested defaults.** Every package ships `presets.animaProduction` — the exact configuration running in the production agent these were extracted from.
- **Composition over coupling.** Packages accept each other's outputs as plain inputs; use one, or use the stack.

## License

MIT © Justine Serna Aza
