import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      include: ['src/**'],
      // index.ts is a re-export barrel (no runtime logic).
      // shell-runner.ts is I/O-only (child_process); tested via integration through mock shell.
      exclude: ['src/index.ts', 'src/shell-runner.ts'],
      thresholds: { statements: 95, functions: 95, lines: 95, branches: 90 },
    },
  },
});
