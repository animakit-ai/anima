# @animakit/git-guardrails

> Agents that can `git push` need a human in the loop. This is that loop — a <1ms decision layer for shell + git safety, 0 deps.

[![npm version](https://img.shields.io/npm/v/@animakit/git-guardrails)](https://www.npmjs.com/package/@animakit/git-guardrails)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@animakit/git-guardrails)](https://bundlephobia.com/package/@animakit/git-guardrails)
[![zero deps](https://img.shields.io/badge/deps-0-brightgreen)](https://www.npmjs.com/package/@animakit/git-guardrails?activeTab=dependencies)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)

---

## Why this exists

> *Extracted from 53 sprints of running an AI agent in production.*

An AI agent with shell and git access is, by definition, dangerous. Most agent frameworks give "all or nothing" access — either the agent can't touch the system, or it can do whatever it wants.

`git-guardrails` is the decision layer that sits between "the agent wants to do X" and "X executes":

- **Shell safety** — allowlist of directories + blocklist of dangerous patterns (`sudo`, `rm -rf /`, `curl | bash`, `chmod 777`, etc.) — decision in <1ms, before touching `child_process`.
- **Git write operations** — `commit`, `push`, `pr` **always** return `requiresConfirmation: true` with structured details for your confirmation prompt. No exception.
- **Sensitive files** — before a commit, scans `git status` against patterns (`.env`, `.pem`, `.key`, `credentials`, `token`...) and **aborts** if found.
- **Agent instruction files** — if a commit touches `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `.claude/settings.json`, or other files governing the agent's own behavior, `confirmationDetails` marks it explicitly. This is the "agent modifying itself" case — a self-modification vector specific to the agentic era.

**Production stat (Table 2):** *(see [SPEC.md §6](./SPEC.md) — numbers to be populated from real production log)*

| Metric | Value |
|---|---|
| Sprints analyzed | 53 |
| Git commit confirmation rate | 100% by design |
| Sensitive file aborts | TODO (from production log) |
| Shell commands blocked | TODO (from production log) |

---

## Quickstart

```bash
npm install @animakit/git-guardrails
# or
pnpm add @animakit/git-guardrails
```

```typescript
import {
  isCommandSafe,
  runShell,
  executeGitAction,
  formatConfirmationPrompt,
  executeConfirmedGitAction,
  presets,
} from '@animakit/git-guardrails';

// ── Shell safety (pure, <1ms) ─────────────────────────────────────────────

const check = isCommandSafe('npm run build', '/home/user/repo', {
  allowedDirs: ['/home/user/repos', '/tmp'],
});
if (!check.safe) throw new Error(`Blocked: ${check.reason}`);

const result = await runShell('npm run build', { cwd: '/home/user/repo' });

// ── Git guardrails (human-in-the-loop) ───────────────────────────────────

const action = await executeGitAction({
  action: 'commit',
  repoPath: '/home/user/repo',
  message: 'feat: add payment processing',
});

if (action.requiresConfirmation) {
  // Build the confirmation prompt for Telegram / Slack / CLI
  const prompt = formatConfirmationPrompt(action.confirmationDetails!, {
    language: 'en',
    format: 'markdown',
  });
  // → Send prompt to human, wait for OK
  // → On confirmation:
  const output = await executeConfirmedGitAction(action.confirmationPayload!);
  console.log(output); // "Commit created: [main abc1234] feat: add payment processing"
}
```

---

## Confirmation flow

```
Agent wants to commit/push/pr
         │
         ▼
  executeGitAction()
         │
         ├── detectSensitiveFiles() → found → throw Error (abort)
         │
         ├── detectAgentInstructionFiles() → found → mark in confirmationDetails
         │                                            (does NOT abort)
         │
         └── requiresConfirmation: true
                    │
                    ▼
          formatConfirmationPrompt()
                    │
                    ▼
          Human receives prompt (Telegram/Slack/CLI)
                    │
                    ▼
          Human replies OK
                    │
                    ▼
        executeConfirmedGitAction()
                    │
                    ▼
              ✅ Done
```

---

## API Reference

### Layer 1 — Shell safety (pure, <1ms)

#### `isCommandSafe(command, cwd, config?)`

Checks a shell command against blocked patterns and optionally validates the working directory.

```typescript
isCommandSafe('sudo apt install vim', '/home/user')
// → { safe: false, reason: 'Blocked pattern: \\bsudo\\b' }

isCommandSafe('git status', '/home/user/repo', {
  allowedDirs: ['/home/user'],
  blockedPatterns: { extend: [/docker rm/] },
})
// → { safe: true }
```

**Config options:**
- `blockedPatterns.extend` — adds to the default set
- `blockedPatterns.replace` — replaces the default set entirely
- `allowedDirs` — if provided, `cwd` must start with one of these

#### `isPathAllowed(path, allowedDirs)`

Pure check — returns `true` if `path` starts with any of `allowedDirs`.

---

### Layer 2 — Shell execution

#### `runShell(command, options?)`

Executes via `/bin/sh -c` (POSIX) or `cmd /c` (Windows). Creates `cwd` if it doesn't exist.

Intentionally does NOT call `isCommandSafe()` — the caller decides when to apply the guardrail, keeping it explicit.

```typescript
const result = await runShell('git log --oneline -5', {
  cwd: '/home/user/repo',
  timeoutMs: 30_000,
  env: { HOME: '/home/myuser' },  // injectable — no hardcoded paths
});
// → { stdout: '...', stderr: '...', exitCode: 0, durationMs: 47 }
```

---

### Layer 3 — Git guardrails

#### `executeGitAction(params, config?)`

The main decision function.

| Action | Behavior |
|---|---|
| `clone`, `pull`, `status`, `log` | Executes immediately, `requiresConfirmation: false` |
| `commit`, `push`, `pr` | Always `requiresConfirmation: true` |
| `commit` + sensitive files | Throws `Error` — **never** reaches `requiresConfirmation` |
| `commit` + agent instruction files | Sets `confirmationDetails.agentInstructionFilesChanged` — does not abort |

```typescript
const result = await executeGitAction(
  { action: 'commit', repoPath: '/abs/path/to/repo', message: 'feat: ...' },
  {
    gitTimeoutMs: 30_000,
    shell: myMockShell,  // injectable for testing
    sensitiveFiles: { patterns: { extend: [/my-secrets/] } },
  }
);
```

#### `executeConfirmedGitAction(payload, config?)`

Executes after human confirmation. Requires `gh` CLI in PATH for `'pr'`.

#### `detectSensitiveFiles(gitStatusOutput, config?)`

Scans `git status --short` output. Returns matched file paths.

#### `detectAgentInstructionFiles(gitStatusOutput, config?)`

Scans `git status --short` for agent instruction/config files. Returns matched paths. Does NOT abort.

#### `shellEscape(s)`

Escapes a string for safe use as a single-quoted shell argument.

---

### Presentation — `formatConfirmationPrompt(details, options?)`

Converts `confirmationDetails` to human-readable text. Optional — you can build your own prompt from the raw `confirmationDetails` object.

```typescript
const prompt = formatConfirmationPrompt(action.confirmationDetails!, {
  language: 'es',      // 'en' | 'es', default: 'en'
  format: 'markdown',  // 'markdown' | 'plain', default: 'markdown'
});
```

When `agentInstructionFilesChanged` is non-empty, renders a visible `⚠️ WARNING` before the normal details.

---

### Presets

```typescript
import { presets } from '@animakit/git-guardrails';

// Production-exact patterns from Anima Body (53 sprints):
presets.blockedShellPatterns        // sudo, rm -rf /, curl|bash, etc.
presets.sensitiveFilePatterns       // .env, .pem, .key, .pfx, .p12, etc.
presets.agentInstructionFilePatterns // CLAUDE.md, AGENTS.md, .cursorrules, etc.
presets.animaProductionAllowedDirs  // Reference paths — replace with your own

// Use as base + extend:
isCommandSafe(cmd, cwd, {
  blockedPatterns: { extend: presets.blockedShellPatterns },
  allowedDirs: ['/my/repos', '/tmp'],
});
```

**Agent instruction patterns covered:**
`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursorrules`, `.cursor/rules/**`, `.windsurfrules`, `.clinerules`, `.github/copilot-instructions.md`, `mcp.json`, `.mcp.json`, `.claude/settings.json`, `.claude/settings.local.json`

---

## vs Alternatives

Researched before launch (June 2026) to avoid claiming "nothing else exists."

| Tool | What it is | Why it's different |
|---|---|---|
| **`agentpreflight`** (npm) | In-process, zero-dep function called before an agent tool call; has git rules (blocks `push --force`) and secret detection | Does I/O (not pure <1ms); blocks/warns rather than returning structured `confirmationDetails` for the caller to build their own human-in-the-loop flow; detects secrets by content pattern, not explicit file-name list; no directory allowlist for shell. **The closest competitor — cited by name.** |
| **Boucle framework** (`bash-guard`+`git-safe`+`file-guard`) | Same 3 conceptual pillars | Bundle of bash/PowerShell scripts installed via curl into `~/.claude/hooks/`, tied exclusively to Claude Code's PreToolUse protocol — not an npm library, not framework-agnostic |
| **ggshield** (GitGuardian) | Now has agent-aware hooks for Cursor/Claude Code/Codex | External CLI process invoked via per-tool hooks — not an in-process importable function |
| Claude Code / Cursor / Windsurf / Aider / Open Interpreter / LangGraph / AutoGPT | Each has own permission/confirmation system | Locked into the product's config or requires running inside their SDK — not extractable to a custom agent |
| Microsoft Agent 365, Permit.io, CalypsoAI, Lakera | Fleet governance in production | SaaS/platform with account and backend — not an inline function with zero setup |
| Guardrails AI | LLM output validation (JSON, toxicity, PII) | Different layer — doesn't touch shell commands or git |
| git-secrets / gitleaks / talisman | Secret scanning | Git hooks for humans, not importable functions inside an agent loop |

**The gap `git-guardrails` fills:** a framework-agnostic, zero-dep, in-process library that returns *structured data* (not just allow/block) so your agent can route to a human-in-the-loop confirmation channel of your choice — Telegram, Slack, CLI, Discord, email — without any coupling to a specific channel or agent runtime.

---

## Design decisions

**Why `repoPath` instead of `repo` + `REPOS_DIR`?**
The original Anima Body GitWorker resolved `join(config.REPOS_DIR, params.repo)` — coupling it to Anima's specific directory structure. The package receives a caller-supplied absolute `repoPath`, making it usable in any project layout.

**Why `runShell()` doesn't call `isCommandSafe()` automatically?**
Keeping them separate makes the safety boundary explicit in calling code — aligned with the philosophy "this is the human-in-the-loop, make it visible." You can see exactly where the guardrail is applied.

**Why structured `confirmationDetails` instead of a pre-built prompt string?**
The original GitWorker built a Spanish Telegram-markdown string inline in each `case`. The package returns raw data (`message`, `diffPreview`, `pendingCommits`, `agentInstructionFilesChanged`) so you can render it for any channel and language. `formatConfirmationPrompt()` is optional.

---

## License

Apache-2.0 — see [LICENSE](./LICENSE).

> **Note for monorepo maintainers:** The sibling packages (`@animakit/homeostasis`, `@animakit/complexity-scorer`) are MIT-licensed. `@animakit/git-guardrails` ships under Apache-2.0 per the original SPEC. Please confirm whether this should be harmonized to MIT before publishing.
