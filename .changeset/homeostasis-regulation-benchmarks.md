---
"@animakit/homeostasis": patch
---

Honest performance claim + verified regulation & self-tuning benchmarks.

- Corrected the "<1µs" claim (README + npm description) to "sub-µs core ops, every op p99 < 1ms" — measured: core state ops (`addStress`/`tick`/`evaluateTaskAcceptance`) are 0.2–0.5µs, while `AppraisalEngine.evaluate` (7.5µs) and `predictLoad` (920µs) are above 1µs but well under 1ms.
- New `benchmarks/regulation.ts` — proves "self-regulates without hard-coded rate limits": under an adversarial flood the engine enters panic, sheds low-priority work while protecting high-priority work (in proportion to priority), and recovers via decay alone. Deterministic (seeded), pre-registered gates.
- New `benchmarks/bandit-convergence.ts` — proves the self-tuning bandit finds the best arm reliably (not by luck): 200 seeds, cold start from the worst arm, 100% convergence at production-like signal.
- Added `BENCHMARKS.md` (all verified numbers) and `APPLICATIONS.md` (agentic + IoT/edge use cases).

No API or behavior changes.
