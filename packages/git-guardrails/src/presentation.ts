// ══════════════════════════════════════════════════════════════════════════════
// @animakit/git-guardrails — Presentation layer
// Converts structured confirmationDetails into human-readable text.
// Bilingual (en/es), markdown or plain. Separated from decision logic so the
// caller can use any channel (Telegram, Slack, CLI, etc.).
// ══════════════════════════════════════════════════════════════════════════════

import type { GitActionResult } from './git-guardrails.js';

export interface FormatPromptOptions {
  /** Default: 'en' */
  language?: 'en' | 'es';
  /**
   * 'markdown' — uses *bold* and _italic_ (Telegram/Slack style).
   * 'plain'    — plain text, no markup.
   * Default: 'markdown'
   */
  format?: 'markdown' | 'plain';
}

type ConfirmationDetails = NonNullable<GitActionResult['confirmationDetails']>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function bold(text: string, format: 'markdown' | 'plain'): string {
  return format === 'markdown' ? `*${text}*` : text;
}

function italic(text: string, format: 'markdown' | 'plain'): string {
  return format === 'markdown' ? `_${text}_` : text;
}

function code(text: string, format: 'markdown' | 'plain'): string {
  return format === 'markdown' ? `\`\`\`\n${text}\n\`\`\`` : text;
}

// ── Strings ───────────────────────────────────────────────────────────────────

const STRINGS = {
  en: {
    commit: {
      header: (repo: string) => `Confirm commit in ${repo}?`,
      message: 'Message',
      changes: 'Changes',
      confirm: (fmt: 'markdown' | 'plain') =>
        fmt === 'markdown' ? 'Reply *YES* to confirm.' : 'Reply YES to confirm.',
    },
    push: {
      header: (repo: string) => `Confirm push in ${repo}?`,
      pending: 'Pending commits',
      confirm: (fmt: 'markdown' | 'plain') =>
        fmt === 'markdown' ? 'Reply *YES* to confirm.' : 'Reply YES to confirm.',
    },
    pr: {
      header: (repo: string) => `Confirm creating a PR in ${repo}?`,
      title: 'Title',
      confirm: (fmt: 'markdown' | 'plain') =>
        fmt === 'markdown' ? 'Reply *YES* to confirm.' : 'Reply YES to confirm.',
    },
    agentWarn: '⚠️ WARNING: This commit modifies agent instruction/permission files (self-modification risk):',
  },
  es: {
    commit: {
      header: (repo: string) => `¿Confirmas el commit en ${repo}?`,
      message: 'Mensaje',
      changes: 'Cambios',
      confirm: (fmt: 'markdown' | 'plain') =>
        fmt === 'markdown' ? 'Responde *SI* para confirmar.' : 'Responde SI para confirmar.',
    },
    push: {
      header: (repo: string) => `¿Confirmas el push en ${repo}?`,
      pending: 'Commits pendientes',
      confirm: (fmt: 'markdown' | 'plain') =>
        fmt === 'markdown' ? 'Responde *SI* para confirmar.' : 'Responde SI para confirmar.',
    },
    pr: {
      header: (repo: string) => `¿Confirmas crear un PR en ${repo}?`,
      title: 'Título',
      confirm: (fmt: 'markdown' | 'plain') =>
        fmt === 'markdown' ? 'Responde *SI* para confirmar.' : 'Responde SI para confirmar.',
    },
    agentWarn: '⚠️ ADVERTENCIA: Este commit modifica archivos de instrucciones/permisos del agente (riesgo de auto-modificación):',
  },
} as const;

// ── formatConfirmationPrompt ──────────────────────────────────────────────────

/**
 * Converts confirmationDetails into a human-readable confirmation prompt.
 * Ready to send via Telegram, Slack, CLI, etc.
 *
 * Highlights agent instruction file changes with a visible warning when
 * `agentInstructionFilesChanged` is non-empty.
 */
export function formatConfirmationPrompt(
  details: ConfirmationDetails,
  options?: FormatPromptOptions,
): string {
  const lang = options?.language ?? 'en';
  const fmt = options?.format ?? 'markdown';
  const s = STRINGS[lang];
  const lines: string[] = [];

  // Extract a short repo name from the full path for display
  const repoName = details.repoPath.split('/').pop() ?? details.repoPath;

  switch (details.action) {
    case 'commit': {
      const cs = s.commit;
      lines.push(bold(cs.header(repoName), fmt));
      lines.push('');

      // Agent instruction file warning (BEFORE the normal details)
      if (details.agentInstructionFilesChanged && details.agentInstructionFilesChanged.length > 0) {
        lines.push(s.agentWarn);
        for (const f of details.agentInstructionFilesChanged) {
          lines.push(`  • ${f}`);
        }
        lines.push('');
      }

      lines.push(`${cs.message}: ${italic(`"${details.message ?? ''}"`, fmt)}`);
      lines.push('');

      if (details.diffPreview) {
        lines.push(`${cs.changes}:`);
        lines.push(code(details.diffPreview, fmt));
        lines.push('');
      }

      lines.push(cs.confirm(fmt));
      break;
    }

    case 'push': {
      const ps = s.push;
      lines.push(bold(ps.header(repoName), fmt));
      lines.push('');
      lines.push(`${ps.pending}:`);
      lines.push(code(details.pendingCommits ?? 'none detected', fmt));
      lines.push('');
      lines.push(ps.confirm(fmt));
      break;
    }

    case 'pr': {
      const prs = s.pr;
      lines.push(bold(prs.header(repoName), fmt));
      lines.push('');
      lines.push(`${prs.title}: ${italic(`"${details.prTitle ?? ''}"`, fmt)}`);
      lines.push('');
      lines.push(prs.confirm(fmt));
      break;
    }
  }

  return lines.join('\n');
}
