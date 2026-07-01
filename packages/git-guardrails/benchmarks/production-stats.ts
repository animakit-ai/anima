// Production stats benchmark for @animakit/git-guardrails
// Corresponds to SPEC.md §6 Table 2 and Table 3.
//
// TODO: Pull real anonymized data from Anima Body logs (53 sprints).
// These numbers need to come from the production event log — do not fabricate.
// The structure below is ready to receive real data.
//
// How to populate:
//   1. Query the Anima Body task log (SQLite) for all GIT and SHELL tasks
//      across the 53 sprints (date range: approx 2024-12 to 2026-06).
//   2. For each SHELL task, check if the command would have been blocked
//      by each blockedShellPattern — count per pattern.
//   3. For each GIT commit task, check if detectSensitiveFiles() would have
//      triggered — count aborts vs total commits.
//   4. Fill in the PRODUCTION_DATA structure below and remove the TODO markers.
//
// Run: pnpm bench:stats

import { presets } from '../src/index.js';

// ── Placeholder data structure ────────────────────────────────────────────────
// Replace these with real anonymized numbers from the production log.

interface PatternBlockStat {
  patternSource: string;
  exampleCommandAnonymized: string; // TODO: pull from log
  totalBlocks: number;              // TODO: pull from log
}

interface ProductionStats {
  sprintCount: number;
  gitActions: {
    total: number;           // TODO
    clone: number;           // TODO
    pull: number;            // TODO
    status: number;          // TODO
    log: number;             // TODO
    commit: number;          // TODO — 100% should have requiresConfirmation=true
    push: number;            // TODO
    pr: number;              // TODO
    confirmationRate: string; // TODO: should be "100%" by design
    sensitiveFileAborts: number; // TODO: how many commits were aborted
    agentInstructionFilesWarnings: number; // TODO: how many triggered the new warning
  };
  shellActions: {
    total: number;           // TODO
    blocked: number;         // TODO
    blockRate: string;       // TODO: e.g. "0.3%"
    byPattern: PatternBlockStat[]; // one entry per blocked pattern
  };
  sensitiveFilePatternHits: {
    pattern: string;
    exampleFileAnonymized: string; // TODO
    totalHits: number;             // TODO
  }[];
}

// TODO: populate with real data from Anima Body production log
const PRODUCTION_DATA: ProductionStats = {
  sprintCount: 53,
  gitActions: {
    total: 0,      // TODO
    clone: 0,      // TODO
    pull: 0,       // TODO
    status: 0,     // TODO
    log: 0,        // TODO
    commit: 0,     // TODO
    push: 0,       // TODO
    pr: 0,         // TODO
    confirmationRate: 'TODO',
    sensitiveFileAborts: 0, // TODO
    agentInstructionFilesWarnings: 0, // TODO
  },
  shellActions: {
    total: 0,    // TODO
    blocked: 0,  // TODO
    blockRate: 'TODO',
    byPattern: presets.blockedShellPatterns.map((p) => ({
      patternSource: p.source,
      exampleCommandAnonymized: 'TODO: pull from production log',
      totalBlocks: 0, // TODO
    })),
  },
  sensitiveFilePatternHits: presets.sensitiveFilePatterns.map((p) => ({
    pattern: p.source,
    exampleFileAnonymized: 'TODO: pull from production log',
    totalHits: 0, // TODO
  })),
};

// ── Display ───────────────────────────────────────────────────────────────────

console.log('\n@animakit/git-guardrails — Production Stats (53 sprints)\n');
console.log('NOTE: All numbers are TODO — populate from Anima Body production log.');
console.log('See the comment at the top of this file for instructions.\n');

console.log(`Sprints analyzed: ${PRODUCTION_DATA.sprintCount}`);
console.log('');

console.log('── Table 2: Guardrails activated in production ──────────────────────');
console.log(`Git actions total:          ${PRODUCTION_DATA.gitActions.total}`);
console.log(`  clone:                    ${PRODUCTION_DATA.gitActions.clone}`);
console.log(`  pull:                     ${PRODUCTION_DATA.gitActions.pull}`);
console.log(`  status:                   ${PRODUCTION_DATA.gitActions.status}`);
console.log(`  log:                      ${PRODUCTION_DATA.gitActions.log}`);
console.log(`  commit:                   ${PRODUCTION_DATA.gitActions.commit}`);
console.log(`  push:                     ${PRODUCTION_DATA.gitActions.push}`);
console.log(`  pr:                       ${PRODUCTION_DATA.gitActions.pr}`);
console.log(`Commit confirmation rate:   ${PRODUCTION_DATA.gitActions.confirmationRate}`);
console.log(`  (should be 100% by design — commit/push/pr always require human OK)`);
console.log(`Sensitive file aborts:      ${PRODUCTION_DATA.gitActions.sensitiveFileAborts}`);
console.log(`Agent instruction warnings: ${PRODUCTION_DATA.gitActions.agentInstructionFilesWarnings}`);
console.log('');
console.log(`Shell actions total:        ${PRODUCTION_DATA.shellActions.total}`);
console.log(`Shell actions blocked:      ${PRODUCTION_DATA.shellActions.blocked} (${PRODUCTION_DATA.shellActions.blockRate})`);
console.log('');

console.log('── Table 3: Blocked patterns catalog ───────────────────────────────');
for (const entry of PRODUCTION_DATA.shellActions.byPattern) {
  console.log(`Pattern: /${entry.patternSource}/`);
  console.log(`  Example (anonymized): ${entry.exampleCommandAnonymized}`);
  console.log(`  Total blocks: ${entry.totalBlocks}`);
}
console.log('');

console.log('── Sensitive file pattern hits ──────────────────────────────────────');
for (const entry of PRODUCTION_DATA.sensitiveFilePatternHits) {
  console.log(`Pattern: /${entry.pattern}/`);
  console.log(`  Example (anonymized): ${entry.exampleFileAnonymized}`);
  console.log(`  Total hits: ${entry.totalHits}`);
}
console.log('');
