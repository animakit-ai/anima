// Latency benchmark for @animakit/git-guardrails
// README claim: "<1ms decision layer" — all pure functions must be p99 < 1ms.
// Run: pnpm bench (from package dir)

import {
  isCommandSafe,
  isPathAllowed,
  detectSensitiveFiles,
  detectAgentInstructionFiles,
  shellEscape,
  formatConfirmationPrompt,
  presets,
} from '../src/index.js';

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

function bench(name: string, fn: () => unknown, iterations = 100_000): void {
  // Warmup (JIT)
  for (let i = 0; i < 2_000; i++) fn();

  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);

  const p50 = percentile(times, 50);
  const p95 = percentile(times, 95);
  const p99 = percentile(times, 99);
  const gate = p99 < 1.0 ? 'PASS ✅' : 'FAIL ❌';

  console.log(
    `${name.padEnd(44)} p50=${(p50 * 1000).toFixed(2)}µs  p95=${(p95 * 1000).toFixed(2)}µs  ` +
      `p99=${(p99 * 1000).toFixed(2)}µs  | gate p99<1ms: ${gate}`,
  );
}

console.log('\n@animakit/git-guardrails — latency benchmark (100k iterations)\n');

// ── Shell safety (pure, should be <10µs) ─────────────────────────────────────
bench('isCommandSafe() — safe command', () =>
  isCommandSafe('git status', '/home/user/repo'),
);

bench('isCommandSafe() — blocked (sudo)', () =>
  isCommandSafe('sudo rm -rf /', '/home/user/repo'),
);

bench('isCommandSafe() — with allowedDirs config', () =>
  isCommandSafe('git pull', '/home/user/repo', {
    allowedDirs: ['/home/user'],
  }),
);

bench('isCommandSafe() — with extended patterns', () =>
  isCommandSafe('git pull', '/home/user/repo', {
    blockedPatterns: { extend: [/docker rm/, /kubectl delete/] },
  }),
);

bench('isPathAllowed() — allowed', () =>
  isPathAllowed('/home/user/repos/myproject/file.ts', ['/home/user/repos', '/tmp']),
);

bench('isPathAllowed() — blocked', () =>
  isPathAllowed('/etc/passwd', ['/home/user/repos', '/tmp']),
);

// ── Sensitive file detection ──────────────────────────────────────────────────

const statusSafe = 'M  src/index.ts\nM  README.md\nA  package.json';
const statusSensitive = 'M  src/index.ts\nM  .env\nA  server.key\nM  credentials.json';
const statusAgent = 'M  CLAUDE.md\nM  .cursorrules\nM  src/index.ts';
const statusLarge = Array.from({ length: 50 }, (_, i) =>
  `M  src/file${i}.ts\nA  tests/test${i}.ts`
).join('\n');

bench('detectSensitiveFiles() — no match (clean)', () =>
  detectSensitiveFiles(statusSafe),
);

bench('detectSensitiveFiles() — with matches', () =>
  detectSensitiveFiles(statusSensitive),
);

bench('detectSensitiveFiles() — 50 files, no match', () =>
  detectSensitiveFiles(statusLarge),
);

bench('detectAgentInstructionFiles() — with match', () =>
  detectAgentInstructionFiles(statusAgent),
);

bench('detectAgentInstructionFiles() — no match', () =>
  detectAgentInstructionFiles(statusSafe),
);

// ── Presentation ──────────────────────────────────────────────────────────────

const commitDetails = {
  action: 'commit' as const,
  repoPath: '/home/user/my-repo',
  message: 'feat: implement new feature with comprehensive changes',
  diffPreview: 'src/index.ts | 42 ++++++++++\n tests/index.test.ts | 120 ++++++++++++++++++',
};

const commitDetailsWithAgent = {
  ...commitDetails,
  agentInstructionFilesChanged: ['CLAUDE.md', '.cursorrules'],
};

bench('formatConfirmationPrompt() — commit, en, markdown', () =>
  formatConfirmationPrompt(commitDetails),
);

bench('formatConfirmationPrompt() — commit, es, plain', () =>
  formatConfirmationPrompt(commitDetails, { language: 'es', format: 'plain' }),
);

bench('formatConfirmationPrompt() — with agent warning', () =>
  formatConfirmationPrompt(commitDetailsWithAgent),
);

bench('formatConfirmationPrompt() — push, en', () =>
  formatConfirmationPrompt({
    action: 'push',
    repoPath: '/home/user/my-repo',
    pendingCommits: 'abc1234 feat: something\ndef5678 fix: bug',
  }),
);

// ── shellEscape ───────────────────────────────────────────────────────────────

bench('shellEscape() — simple string', () =>
  shellEscape('feat: new feature with a message'),
);

bench('shellEscape() — with single quotes', () =>
  shellEscape("it's a message with 'quotes' inside"),
);

console.log('');
console.log('All pure decision operations should be p99 < 1ms (sub-µs expected).');
console.log(
  'If any gate fails, check for regex backtracking or excessive string allocation.\n',
);
