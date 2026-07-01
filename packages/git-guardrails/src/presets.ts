// ══════════════════════════════════════════════════════════════════════════════
// @animakit/git-guardrails — Presets
// Production-exact patterns from Anima Body (53 sprints).
// Import these as a starting point — extend or replace via config.
// ══════════════════════════════════════════════════════════════════════════════

import { DEFAULT_BLOCKED_PATTERNS } from './shell-safety.js';
import {
  DEFAULT_SENSITIVE_PATTERNS,
  DEFAULT_AGENT_INSTRUCTION_PATTERNS,
} from './git-guardrails.js';

/**
 * Production-exact presets from Anima Body.
 */
export const presets: {
  /**
   * Blocked shell command patterns — EXACT production set from Anima Body ShellRunner.ts.
   * Covers: sudo, rm -rf /, redirect to /etc, curl|bash, wget|bash, chmod 777.
   */
  blockedShellPatterns: RegExp[];
  /**
   * Sensitive file patterns — EXACT production set from Anima Body GitWorker.ts.
   * Covers: .env, .pem, .key, .pfx, .p12, .secret, .credentials, .token.
   */
  sensitiveFilePatterns: RegExp[];
  /**
   * Example allowed dirs from Anima Body production (REPOS_DIR, WORK_DIR, SCRIPTS_DIR, /tmp).
   * These are Anima-specific paths — replace with your own directory structure.
   * Provided as a reference for the allowedDirs config shape.
   */
  animaProductionAllowedDirs: string[];
  /**
   * Agent instruction/config file patterns — covers the major agentic coding tools
   * of 2025-2026: Claude Code (CLAUDE.md, .claude/settings.*), Cursor (.cursorrules,
   * .cursor/rules/**), Windsurf (.windsurfrules), Cline (.clinerules), GitHub Copilot
   * (.github/copilot-instructions.md), OpenAI Codex/generic (AGENTS.md, GEMINI.md),
   * MCP config (mcp.json, .mcp.json).
   */
  agentInstructionFilePatterns: RegExp[];
} = {
  blockedShellPatterns: [...DEFAULT_BLOCKED_PATTERNS],
  sensitiveFilePatterns: [...DEFAULT_SENSITIVE_PATTERNS],
  animaProductionAllowedDirs: [
    '/home/anima/repos',    // REPOS_DIR — replace with your actual path
    '/home/anima/work',     // WORK_DIR  — replace with your actual path
    '/home/anima/scripts',  // SCRIPTS_DIR — replace with your actual path
    '/tmp',
  ],
  agentInstructionFilePatterns: [...DEFAULT_AGENT_INSTRUCTION_PATTERNS],
};
