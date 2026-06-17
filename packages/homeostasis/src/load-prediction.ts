// Load prediction — anticipate future demand from interaction history.
//
// Models the environment as a player with a historical strategy, letting the
// caller pre-warm the agent's state before a predicted peak instead of only
// reacting. Extracted from PatternLearner.predict() with all I/O removed: the
// caller pre-loads the history; this function never queries a database.
//
// Pure — 0 I/O, 0 LLM. <1ms for 10k records.

import type { HomeoMode } from './types.js';

export interface HistoryRecord {
  /** ISO timestamp (UTC). */
  timestamp: string;
  /** Stress at that moment [0,1]. */
  stress: number;
  /** true if the interaction was reactive (vs proactive by the agent). */
  reactive: boolean;
}

export interface LoadPrediction {
  /** Messages expected within the forecast window (historical average). */
  expectedEvents: number;
  /** Expected stress over the forecast window [0,1]. */
  expectedStress: number;
  /** Recommended mode to start the period in. */
  recommendedMode: HomeoMode;
  /** Day of week with the highest historical load (0=Sunday). */
  peakDayOfWeek: number;
  /** Hour of day with the highest historical load (0-23, local). */
  peakHourLocal: number;
  /** Days of history used in the computation. */
  daysOfHistory: number;
  /** true if daysOfHistory >= minReliableDays. */
  reliable: boolean;
}

export interface LoadPredictionConfig {
  minReliableDays?: number; // default 7
  forecastWindowHours?: number; // default 3
  /** Caller's timezone offset from UTC, in hours (e.g. -5 for Bogotá). Default: 0. */
  utcOffsetHours?: number;
}

const DEFAULT_MIN_RELIABLE_DAYS = 7;
const DEFAULT_FORECAST_WINDOW_HOURS = 3;

function toLocalHour(date: Date, offset: number): number {
  return ((date.getUTCHours() + offset) % 24 + 24) % 24;
}

function localDayOfWeek(date: Date, offset: number): number {
  const localHourUnwrapped = date.getUTCHours() + offset;
  let dayShift = 0;
  if (localHourUnwrapped < 0) dayShift = -1;
  else if (localHourUnwrapped >= 24) dayShift = +1;
  return ((date.getUTCDay() + dayShift) % 7 + 7) % 7;
}

/**
 * Analyzes pre-loaded history and returns a load prediction for the next
 * window, or null if the history is empty.
 * Pure — no side effects.
 */
export function predictLoad(
  history: HistoryRecord[],
  config: LoadPredictionConfig = {},
): LoadPrediction | null {
  if (history.length === 0) return null;

  const minReliableDays = config.minReliableDays ?? DEFAULT_MIN_RELIABLE_DAYS;
  const windowHours = config.forecastWindowHours ?? DEFAULT_FORECAST_WINDOW_HOURS;
  const offset = config.utcOffsetHours ?? 0;

  const parsed = history.map((r) => ({ ...r, date: new Date(r.timestamp) }));

  // ── Unique active days ─────────────────────────────────────────────────────
  const uniqueDays = new Set(parsed.map((r) => r.timestamp.slice(0, 10)));
  const daysOfHistory = uniqueDays.size;

  // ── Distribution by local hour ─────────────────────────────────────────────
  const hourCounts: Record<number, number> = {};
  for (let h = 0; h < 24; h++) hourCounts[h] = 0;
  for (const r of parsed) hourCounts[toLocalHour(r.date, offset)]!++;

  // ── Distribution by local day of week ──────────────────────────────────────
  const dayCounts: Record<number, number> = {};
  for (let d = 0; d < 7; d++) dayCounts[d] = 0;
  for (const r of parsed) dayCounts[localDayOfWeek(r.date, offset)]!++;

  // ── Peak hour and peak day ─────────────────────────────────────────────────
  const peakHourLocal = Number(
    Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10,
  );
  const peakDayOfWeek = Number(
    Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 1,
  );

  // ── Expected events over the next window ───────────────────────────────────
  const nowLocal = toLocalHour(new Date(), offset);
  let expectedEvents = 0;
  for (let o = 0; o < windowHours; o++) {
    const h = (nowLocal + o) % 24;
    expectedEvents += Math.round((hourCounts[h] ?? 0) / Math.max(daysOfHistory, 1));
  }

  // ── Expected stress over the next window ───────────────────────────────────
  const windowRows = parsed.filter((r) => {
    const diff = (toLocalHour(r.date, offset) - nowLocal + 24) % 24;
    return diff < windowHours;
  });
  const avgStress =
    windowRows.length > 0
      ? windowRows.reduce((s, r) => s + r.stress, 0) / windowRows.length
      : 0.1;
  const expectedStress = Math.min(1, avgStress);

  const recommendedMode: HomeoMode =
    expectedStress >= 0.8 ? 'panic' : expectedStress >= 0.3 ? 'flow' : 'zen';

  return {
    expectedEvents,
    expectedStress: +expectedStress.toFixed(3),
    recommendedMode,
    peakDayOfWeek,
    peakHourLocal,
    daysOfHistory,
    reliable: daysOfHistory >= minReliableDays,
  };
}
