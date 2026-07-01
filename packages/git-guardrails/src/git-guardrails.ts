// ══════════════════════════════════════════════════════════════════════════════
// @animakit/git-guardrails — Git guardrails layer
// Decision + execution. Extracted from Anima Body's GitWorker.ts, generalized:
//   - `params.repo` + `config.REPOS_DIR` → caller-supplied `repoPath` (absolute)
//   - confirmationPrompt string (Telegram-markdown ES) → confirmationDetails (structured)
//   - confirmationPayload: Record<string,unknown> → GitConfirmationPayload (discriminated union)
// ══════════════════════════════════════════════════════════════════════════════

import type { RunShellOptions, ShellResult } from './shell-runner.js';

// ── Default patterns (EXACT production sets from Anima Body) ──────────────────

/**
 * Default sensitive file pattern (verbatim from Anima Body GitWorker.ts, extended to match
 * filenames that *contain* the sensitive keywords as well as just extensions).
 */
export const DEFAULT_SENSITIVE_PATTERNS: readonly RegExp[] = [
  /\.(env|pem|key|pfx|p12|secret)$|^\.env$/i,
  /credentials/i,
  /\.token$/i,
] as const;

/**
 * Default agent instruction file patterns.
 * Covers the major agentic coding tools of 2025-2026.
 */
export const DEFAULT_AGENT_INSTRUCTION_PATTERNS: readonly RegExp[] = [
  /^CLAUDE\.md$/i,
  /^AGENTS\.md$/i,
  /^GEMINI\.md$/i,
  /^\.cursorrules$/i,
  /^\.cursor\/rules\//i,
  /^\.windsurfrules$/i,
  /^\.clinerules$/i,
  /^\.github\/copilot-instructions\.md$/i,
  /^mcp\.json$/i,
  /^\.mcp\.json$/i,
  /^\.claude\/settings\.json$/i,
  /^\.claude\/settings\.local\.json$/i,
] as const;

// ── Public types ──────────────────────────────────────────────────────────────

export type GitAction = 'clone' | 'pull' | 'status' | 'log' | 'commit' | 'push' | 'pr';

export interface GitActionParams {
  action: GitAction;
  /**
   * Absolute path to the repository.
   * The caller resolves this path — the package makes no assumptions about
   * directory layout. Replaces the `params.repo + config.REPOS_DIR` pattern
   * from Anima Body, which was specific to Anima's file structure.
   */
  repoPath: string;
  /** Required for 'clone'. */
  repoUrl?: string;
  /** Commit message for 'commit'. Default: 'chore: automated commit'. */
  message?: string;
  /** PR title for 'pr'. Default: 'Automated changes'. */
  prTitle?: string;
  /** PR body for 'pr'. */
  prBody?: string;
}

export type GitConfirmationPayload =
  | { action: 'commit'; repoPath: string; message: string }
  | { action: 'push'; repoPath: string }
  | { action: 'pr'; repoPath: string; title: string; body: string };

export interface GitActionResult {
  /** Direct output — only populated for read-only actions (status/log/pull/clone). */
  output: string;
  requiresConfirmation: boolean;
  /**
   * Structured details for the caller to build their own confirmation prompt.
   * Use formatConfirmationPrompt() to render this as human-readable text.
   */
  confirmationDetails?: {
    action: 'commit' | 'push' | 'pr';
    repoPath: string;
    message?: string;
    /** `git diff --stat HEAD` output (truncated to 800 chars). commit only. */
    diffPreview?: string;
    /** `git log origin/HEAD..HEAD --oneline` output. push only. */
    pendingCommits?: string;
    prTitle?: string;
    prBody?: string;
    /**
     * Paths of agent instruction/config files touched by this commit.
     * Non-empty → the confirmation prompt should highlight self-modification risk.
     * See detectAgentInstructionFiles().
     */
    agentInstructionFilesChanged?: string[];
  };
  /** Pass directly to executeConfirmedGitAction() after human OK. */
  confirmationPayload?: GitConfirmationPayload;
}

export interface SensitiveFileConfig {
  patterns?: { extend?: RegExp[]; replace?: RegExp[] };
}

export interface AgentInstructionFileConfig {
  patterns?: { extend?: RegExp[]; replace?: RegExp[] };
}

// ── Utility functions ─────────────────────────────────────────────────────────

/**
 * Escapes a string for safe use as a single-quoted shell argument.
 * Verbatim from Anima Body GitWorker.ts.
 */
export function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Parses `git status --short` output and returns file paths that match sensitive
 * patterns (.env, .pem, .key, .pfx, .p12, .secret, .credentials, .token).
 *
 * Throws an Error when called during commit — the caller (executeGitAction) aborts
 * the confirmation flow before returning requiresConfirmation.
 */
export function detectSensitiveFiles(
  gitStatusOutput: string,
  config?: SensitiveFileConfig,
): string[] {
  const patterns: readonly RegExp[] =
    config?.patterns?.replace ??
    [...DEFAULT_SENSITIVE_PATTERNS, ...(config?.patterns?.extend ?? [])];

  return gitStatusOutput
    .split('\n')
    .map((l) => l.slice(3).trim())
    .filter((f) => f.length > 0 && patterns.some((p) => p.test(f)));
}

/**
 * Scans `git status --short` output and returns paths that match agent
 * instruction/config file patterns (CLAUDE.md, AGENTS.md, .cursorrules, etc.).
 *
 * Unlike detectSensitiveFiles(), this does NOT abort the commit — it only informs,
 * because these files are normally versioned. The caller decides what to do with the
 * list (typically: highlight it in the confirmation prompt as self-modification risk).
 */
export function detectAgentInstructionFiles(
  gitStatusOutput: string,
  config?: AgentInstructionFileConfig,
): string[] {
  const patterns: readonly RegExp[] =
    config?.patterns?.replace ??
    [...DEFAULT_AGENT_INSTRUCTION_PATTERNS, ...(config?.patterns?.extend ?? [])];

  return gitStatusOutput
    .split('\n')
    .map((l) => l.slice(3).trim())
    .filter((f) => f.length > 0 && patterns.some((p) => p.test(f)));
}

// ── executeGitAction ──────────────────────────────────────────────────────────

type RunShellFn = (command: string, options?: RunShellOptions) => Promise<ShellResult>;

/**
 * Decides what to do with a git action.
 *
 * - clone/pull/status/log → executes immediately, requiresConfirmation=false
 * - commit/push/pr → ALWAYS requiresConfirmation=true, with structured confirmationDetails
 * - commit → throws Error if detectSensitiveFiles() finds sensitive files
 * - commit → populates confirmationDetails.agentInstructionFilesChanged if agent
 *   instruction files are touched (does NOT abort — only informs)
 *
 * The `shell` option allows injecting a mock runShell for testing.
 */
export async function executeGitAction(
  params: GitActionParams,
  config?: {
    sensitiveFiles?: SensitiveFileConfig;
    agentInstructionFiles?: AgentInstructionFileConfig;
    gitTimeoutMs?: number;
    shell?: RunShellFn;
  },
): Promise<GitActionResult> {
  // Lazy import to avoid pulling child_process into pure-function code paths
  const shell: RunShellFn =
    config?.shell ??
    /* v8 ignore next */
    (await import('./shell-runner.js').then((m) => m.runShell));

  const { repoPath } = params;
  const timeout = config?.gitTimeoutMs ?? 60_000;

  switch (params.action) {
    case 'clone': {
      if (!params.repoUrl) throw new Error('repoUrl is required for clone');
      const r = await shell(`git clone "${params.repoUrl}" "${repoPath}"`, {
        cwd: repoPath.split('/').slice(0, -1).join('/') || '.',
        timeoutMs: timeout,
      });
      if (r.exitCode !== 0) throw new Error(`Clone failed: ${r.stderr}`);
      return { output: `Repo cloned at ${repoPath}`, requiresConfirmation: false };
    }

    case 'pull': {
      const r = await shell('git pull --rebase --autostash', { cwd: repoPath });
      return { output: r.stdout || 'Already up to date.', requiresConfirmation: false };
    }

    case 'status': {
      const r = await shell('git status --short && git log --oneline -5', { cwd: repoPath });
      return { output: r.stdout || 'Clean repository.', requiresConfirmation: false };
    }

    case 'log': {
      const r = await shell('git log --oneline -10', { cwd: repoPath });
      return { output: r.stdout, requiresConfirmation: false };
    }

    case 'commit': {
      // Check for changes
      const statusR = await shell('git status --short', { cwd: repoPath });
      if (!statusR.stdout) {
        return { output: 'No changes to commit.', requiresConfirmation: false };
      }

      // Abort if sensitive files detected
      const sensitiveFiles = detectSensitiveFiles(statusR.stdout, config?.sensitiveFiles);
      if (sensitiveFiles.length > 0) {
        throw new Error(
          `Sensitive files detected — commit aborted: ${sensitiveFiles.join(', ')}`,
        );
      }

      // Check for agent instruction files (does NOT abort)
      const agentFiles = detectAgentInstructionFiles(statusR.stdout, config?.agentInstructionFiles);

      const diffR = await shell('git diff --stat HEAD', { cwd: repoPath });
      const message = params.message ?? 'chore: automated commit';

      const confirmationPayload: GitConfirmationPayload = {
        action: 'commit',
        repoPath,
        message,
      };

      return {
        output: '',
        requiresConfirmation: true,
        confirmationDetails: {
          action: 'commit',
          repoPath,
          message,
          diffPreview: diffR.stdout.slice(0, 800),
          ...(agentFiles.length > 0 ? { agentInstructionFilesChanged: agentFiles } : {}),
        },
        confirmationPayload,
      };
    }

    case 'push': {
      const pendingR = await shell('git log origin/HEAD..HEAD --oneline', {
        cwd: repoPath,
      }).catch(() => ({ stdout: '' } as ShellResult));

      const confirmationPayload: GitConfirmationPayload = {
        action: 'push',
        repoPath,
      };

      return {
        output: '',
        requiresConfirmation: true,
        confirmationDetails: {
          action: 'push',
          repoPath,
          pendingCommits: pendingR.stdout || 'none detected',
        },
        confirmationPayload,
      };
    }

    case 'pr': {
      const title = params.prTitle ?? 'Automated changes';
      const body = params.prBody ?? 'PR created automatically.';

      const confirmationPayload: GitConfirmationPayload = {
        action: 'pr',
        repoPath,
        title,
        body,
      };

      return {
        output: '',
        requiresConfirmation: true,
        confirmationDetails: {
          action: 'pr',
          repoPath,
          prTitle: title,
          prBody: body,
        },
        confirmationPayload,
      };
    }

    /* v8 ignore next 3 */
    default: {
      const _exhaustive: never = params.action;
      throw new Error(`Unknown git action: ${String(_exhaustive)}`);
    }
  }
}

// ── executeConfirmedGitAction ─────────────────────────────────────────────────

/**
 * Executes commit/push/pr AFTER human confirmation.
 * Requires `gh` CLI to be installed in PATH for 'pr'.
 * The `shell` option allows injecting a mock runShell for testing.
 */
export async function executeConfirmedGitAction(
  payload: GitConfirmationPayload,
  config?: { gitTimeoutMs?: number; shell?: RunShellFn },
): Promise<string> {
  const shell: RunShellFn =
    config?.shell ??
    /* v8 ignore next */
    (await import('./shell-runner.js').then((m) => m.runShell));

  const timeout = config?.gitTimeoutMs ?? 60_000;

  switch (payload.action) {
    case 'commit': {
      await shell('git add -A', { cwd: payload.repoPath });
      const safeMsg = shellEscape(payload.message);
      const r = await shell(`git commit -m ${safeMsg}`, { cwd: payload.repoPath });
      if (r.exitCode !== 0) throw new Error(`Commit failed: ${r.stderr}`);
      return `Commit created:\n\`${r.stdout.split('\n')[0]}\``;
    }

    case 'push': {
      const r = await shell('git push', {
        cwd: payload.repoPath,
        timeoutMs: timeout,
      });
      if (r.exitCode !== 0) throw new Error(`Push failed: ${r.stderr}`);
      return `Push completed:\n${r.stdout}`;
    }

    case 'pr': {
      const safeTitle = shellEscape(payload.title);
      const safeBody = shellEscape(payload.body);
      const r = await shell(`gh pr create --title ${safeTitle} --body ${safeBody}`, {
        cwd: payload.repoPath,
        timeoutMs: timeout,
      });
      if (r.exitCode !== 0) throw new Error(`PR creation failed: ${r.stderr}`);
      return `PR created:\n${r.stdout}`;
    }

    /* v8 ignore next 3 */
    default: {
      const _exhaustive: never = payload;
      throw new Error(`Unknown confirmed action: ${String((_exhaustive as { action: string }).action)}`);
    }
  }
}
