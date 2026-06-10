# Contributing

Thanks for your interest! This monorepo uses **pnpm** + **changesets**.

## Setup

```bash
pnpm install
pnpm build
pnpm test
```

## Workflow

1. Branch from `main`.
2. Make your change inside `packages/<pkg>`.
3. Add tests — coverage gates are enforced per package.
4. Run `pnpm changeset` and describe your change (patch/minor/major).
5. Open a PR. CI runs typecheck + build + tests; benchmarks are gates — a performance regression blocks release.

## Design rules

- Zero/minimal runtime dependencies. If you need a dependency, open an issue first.
- Pure functions over stateful classes where possible; no internal timers or I/O — callers control scheduling and persistence (`tick()` / `toJSON()` patterns).
- Every package keeps its design doc in `SPEC.md` — API changes update the SPEC in the same PR.
- Bilingual-friendly: vocabularies are configurable (`extend`/`replace`), defaults are EN+ES.
