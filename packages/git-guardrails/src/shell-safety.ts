// ══════════════════════════════════════════════════════════════════════════════
// @animakit/git-guardrails — Shell safety layer
// Pure functions (<1ms), no I/O. Extracted from Anima Body's ShellRunner.ts.
// ══════════════════════════════════════════════════════════════════════════════

// ── Default blocked patterns (EXACT production set from Anima Body) ───────────

/**
 * Default set of blocked shell command patterns.
 * Extracted verbatim from Anima Body ShellRunner.ts production config.
 */
export const DEFAULT_BLOCKED_PATTERNS: readonly RegExp[] = [
  /\bsudo\b/,
  /rm\s+-rf\s+\//,
  />\s*\/etc/,
  /curl[^|]*\|\s*(bash|sh)/,
  /wget[^|]*\|\s*(bash|sh)/,
  /chmod\s+[0-7]*7[0-7][0-7]/, // chmod 777 / chmod X7X
] as const;

// ── Public interfaces ─────────────────────────────────────────────────────────

export interface ShellSafetyConfig {
  /**
   * Override blocked patterns.
   * - `extend`: appended to DEFAULT_BLOCKED_PATTERNS
   * - `replace`: replaces DEFAULT_BLOCKED_PATTERNS entirely
   */
  blockedPatterns?: { extend?: RegExp[]; replace?: RegExp[] };
  /**
   * Directories whose `startsWith()` must match `cwd`.
   * When provided, `cwd` must start with at least one entry.
   */
  allowedDirs?: string[];
}

export interface SafetyCheckResult {
  safe: boolean;
  reason?: string;
}

// ── isCommandSafe ─────────────────────────────────────────────────────────────

/**
 * Pure — verifies the command against blockedPatterns and cwd against allowedDirs.
 *
 * Decision is always <1ms (regex over short strings). Call this BEFORE runShell();
 * the separation is intentional — it makes the guardrail explicit in calling code.
 */
export function isCommandSafe(
  command: string,
  cwd: string,
  config?: ShellSafetyConfig,
): SafetyCheckResult {
  const patterns: readonly RegExp[] =
    config?.blockedPatterns?.replace ??
    [...DEFAULT_BLOCKED_PATTERNS, ...(config?.blockedPatterns?.extend ?? [])];

  for (const pattern of patterns) {
    if (pattern.test(command)) {
      return { safe: false, reason: `Blocked pattern: ${pattern.source}` };
    }
  }

  if (config?.allowedDirs !== undefined) {
    const inAllowed = config.allowedDirs.some((dir) => cwd.startsWith(dir));
    if (!inAllowed) {
      return { safe: false, reason: `Directory not allowed: ${cwd}` };
    }
  }

  return { safe: true };
}

// ── isPathAllowed ─────────────────────────────────────────────────────────────

/**
 * Pure — returns true if `path` starts with at least one of `allowedDirs`.
 * Extracted from the inline check in TaskExecutor.handleFile() (Anima Body).
 */
export function isPathAllowed(path: string, allowedDirs: string[]): boolean {
  return allowedDirs.some((dir) => path.startsWith(dir));
}
