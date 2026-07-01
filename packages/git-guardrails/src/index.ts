// @animakit/git-guardrails
// Human-in-the-loop confirmation for AI agents with git/shell access.
// <1ms decision layer, 0 runtime deps. Extracted from 53 production sprints.
//
// ── Usage ────────────────────────────────────────────────────────────────────
//
//   import { isCommandSafe, runShell, executeGitAction,
//            formatConfirmationPrompt, executeConfirmedGitAction } from '@animakit/git-guardrails';
//
//   // Shell safety (pure, <1ms)
//   const check = isCommandSafe('git status', '/home/user/repo');
//   if (!check.safe) throw new Error(check.reason);
//   const result = await runShell('git status', { cwd: '/home/user/repo' });
//
//   // Git guardrails (human-in-the-loop)
//   const action = await executeGitAction({ action: 'commit', repoPath: '/home/user/repo', message: 'feat: ...' });
//   if (action.requiresConfirmation) {
//     const prompt = formatConfirmationPrompt(action.confirmationDetails!);
//     // → send prompt to Telegram/Slack/CLI, wait for human OK
//     const output = await executeConfirmedGitAction(action.confirmationPayload!);
//   }

// ── Layer 1 — Shell safety (pure, <1ms) ──────────────────────────────────────
export {
  isCommandSafe,
  isPathAllowed,
  DEFAULT_BLOCKED_PATTERNS,
  type ShellSafetyConfig,
  type SafetyCheckResult,
} from './shell-safety.js';

// ── Layer 2 — Shell execution (async, no safety checks inside) ───────────────
export {
  runShell,
  type ShellResult,
  type RunShellOptions,
} from './shell-runner.js';

// ── Layer 3 — Git guardrails (decision + confirmed execution) ─────────────────
export {
  executeGitAction,
  executeConfirmedGitAction,
  detectSensitiveFiles,
  detectAgentInstructionFiles,
  shellEscape,
  DEFAULT_SENSITIVE_PATTERNS,
  DEFAULT_AGENT_INSTRUCTION_PATTERNS,
  type GitAction,
  type GitActionParams,
  type GitConfirmationPayload,
  type GitActionResult,
  type SensitiveFileConfig,
  type AgentInstructionFileConfig,
} from './git-guardrails.js';

// ── Presentation — optional, formats confirmationDetails as text ───────────────
export {
  formatConfirmationPrompt,
  type FormatPromptOptions,
} from './presentation.js';

// ── Presets ───────────────────────────────────────────────────────────────────
export { presets } from './presets.js';
