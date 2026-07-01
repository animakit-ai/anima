// ══════════════════════════════════════════════════════════════════════════════
// @animakit/git-guardrails — Shell execution layer
// Thin async wrapper over child_process. No safety checks inside — caller decides.
// Extracted from Anima Body's ShellRunner.ts, generalized (no Anima-specific config).
// ══════════════════════════════════════════════════════════════════════════════

import { spawn } from 'child_process';
import { mkdirSync } from 'fs';

// ── Public interfaces ─────────────────────────────────────────────────────────

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export interface RunShellOptions {
  /** Working directory. Created if it does not exist. */
  cwd?: string;
  /** Milliseconds before SIGTERM. Default: 60_000. */
  timeoutMs?: number;
  /**
   * Extra environment variables merged with process.env.
   * Use this to set HOME, PATH, etc. — replaces the hardcoded HOME=/home/anima
   * that Anima Body's ShellRunner used.
   */
  env?: Record<string, string>;
}

// ── runShell ──────────────────────────────────────────────────────────────────

/**
 * Executes `command` via `/bin/sh -c` (POSIX) or `cmd /c` (Windows).
 *
 * Intentionally does NOT call isCommandSafe() internally — the caller decides
 * when/whether to apply the guardrail, keeping the safety boundary explicit.
 *
 * Creates `cwd` if it does not already exist (mkdirSync recursive).
 */
export function runShell(command: string, options: RunShellOptions = {}): Promise<ShellResult> {
  const cwd = options.cwd ?? process.cwd();
  const timeoutMs = options.timeoutMs ?? 60_000;
  const env = options.env ? { ...process.env, ...options.env } : process.env;
  const start = Date.now();

  mkdirSync(cwd, { recursive: true });

  return new Promise((resolve, reject) => {
    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'cmd' : '/bin/sh';
    const shellFlag = isWindows ? '/c' : '-c';

    const proc = spawn(shell, [shellFlag, command], { cwd, env });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`Command timed out (${timeoutMs}ms): ${command}`));
    }, timeoutMs);

    proc.on('close', (code: number | null) => {
      clearTimeout(timer);
      const durationMs = Date.now() - start;
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code ?? 1,
        durationMs,
      });
    });

    proc.on('error', (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
