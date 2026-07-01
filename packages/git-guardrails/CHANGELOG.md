# @animakit/git-guardrails

## 0.1.0

### Minor Changes

- Initial release of `@animakit/git-guardrails` — a human-in-the-loop shell and git safety layer for AI agents, extracted from Anima's production agent (53 sprints).

  - `isCommandSafe()` — pure, <1ms check against configurable blocked shell patterns (sudo, rm -rf /, curl|bash, etc.). Extend or replace the default set.
  - `isPathAllowed()` — pure check whether a path starts with any of a list of allowed directories.
  - `runShell()` — thin async wrapper over `child_process.spawn`. No safety checks inside — the caller decides when to verify. Configurable env (removes the hardcoded `HOME=/home/anima` from Anima Body).
  - `detectSensitiveFiles()` — scans `git status --short` output for sensitive file patterns (.env, .pem, .key, etc.). Aborts commit flow when triggered.
  - `detectAgentInstructionFiles()` — scans git status for agent instruction/config files (CLAUDE.md, AGENTS.md, .cursorrules, .claude/settings.json, etc.). Does NOT abort — only marks self-modification risk in `confirmationDetails`.
  - `executeGitAction()` — decision layer: read-only actions (clone/pull/status/log) execute immediately; write actions (commit/push/pr) always return `requiresConfirmation: true` with structured `confirmationDetails` and `confirmationPayload`.
  - `executeConfirmedGitAction()` — executes commit/push/pr after human confirmation.
  - `formatConfirmationPrompt()` — optional presentation layer: converts `confirmationDetails` to human-readable text, bilingual (en/es), markdown or plain.
  - `presets` — production-exact pattern sets from Anima Body: `blockedShellPatterns`, `sensitiveFilePatterns`, `animaProductionAllowedDirs`, `agentInstructionFilePatterns`.
  - Zero runtime dependencies (Node built-ins only: `child_process`, `fs`, `path`).
  - Apache-2.0 license (see LICENSE flag in release notes).
