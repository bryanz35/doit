/** The pomodoro plan: timer lengths from settings, and which session comes next.
 *
 *  Settings are opaque strings in the backend and a missing key means
 *  "default", so the defaults live here. Pure, so it is tested in
 *  focusplan.test.ts. */

import type { FocusDay, FocusKind } from "../types";

export interface FocusPrefs {
  workMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  /** A long break replaces every Nth short one. */
  longBreakEvery: number;
  dailyGoalMinutes: number;
}

/** Settings keys, `focus.<field>`. */
export const FOCUS_DEFAULTS: FocusPrefs = {
  workMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
  dailyGoalMinutes: 180,
};

/** Bounds per field. Session lengths match the backend's 1 min – 4 h. */
export const FOCUS_LIMITS: Record<keyof FocusPrefs, [number, number]> = {
  workMinutes: [1, 240],
  shortBreakMinutes: [1, 240],
  longBreakMinutes: [1, 240],
  longBreakEvery: [1, 12],
  dailyGoalMinutes: [0, 1440],
};

/** Read the focus prefs out of the settings map; an unset, unparsable or
 *  out-of-range value falls back to its default. */
export function focusPrefs(settings: Record<string, string>): FocusPrefs {
  const prefs = { ...FOCUS_DEFAULTS };
  for (const key of Object.keys(prefs) as (keyof FocusPrefs)[]) {
    const raw = settings[`focus.${key}`];
    const value = raw === undefined ? NaN : Number(raw);
    const [min, max] = FOCUS_LIMITS[key];
    if (Number.isInteger(value) && value >= min && value <= max) prefs[key] = value;
  }
  return prefs;
}

export function minutesFor(kind: FocusKind, prefs: FocusPrefs): number {
  return kind === "work"
    ? prefs.workMinutes
    : kind === "short-break"
      ? prefs.shortBreakMinutes
      : prefs.longBreakMinutes;
}

/** What to offer after the day's last session: a break after a completed
 *  pomodoro (long on every `longBreakEvery`th), work otherwise. */
export function nextKind(day: FocusDay | null, prefs: FocusPrefs): FocusKind {
  const last = day?.sessions[day.sessions.length - 1];
  if (!last || last.kind !== "work" || last.outcome !== "completed") return "work";
  return day.pomodoros % prefs.longBreakEvery === 0 ? "long-break" : "short-break";
}

/** Pomodoros it takes to reach the daily goal, at least one. */
export function plannedSessions(prefs: FocusPrefs): number {
  return Math.max(1, Math.ceil(prefs.dailyGoalMinutes / prefs.workMinutes));
}
