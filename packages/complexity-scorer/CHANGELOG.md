# @animakit/complexity-scorer

## 0.1.0

### Minor Changes

- First real release — the production scorer, extracted and improved:

  - Word-boundary, diacritic-insensitive matching by default (fixes substring false positives like 'rut' in "rutina"); legacy substring mode preserved in `presets.animaProduction`
  - Bilingual EN+ES vocabulary with `extend`/`replace` configuration
  - Default tier thresholds calibrated against 50 blind operator labels on real production traffic (LOO CV: 52% exact, 82% within one tier; under-routing reduced from 54% to 38%)
  - Full config surface: weights, thresholds, saturation, length curve, matching mode
  - Reproducible benchmark suite: latency (p99 = 86µs), production-corpus replay, precision validation, threshold calibration
  - 25 tests, 100% statement coverage, coverage gates in CI

## 0.0.1

### Patch Changes

- Initial scaffold release — public API surface and types per SPEC.md. Implementation lands in the next minor; functions currently throw `not yet implemented`.
