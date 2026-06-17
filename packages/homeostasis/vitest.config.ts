import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      include: ['src/**'],
      // types.ts is type-only (no runtime code); test file excluded by default.
      exclude: ['src/types.ts'],
      thresholds: { statements: 95, functions: 95, lines: 95, branches: 95 },
    },
  },
});
