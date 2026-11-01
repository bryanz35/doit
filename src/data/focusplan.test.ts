import { test } from "node:test";
import assert from "node:assert/strict";
import type { FocusDay, FocusKind, FocusOutcome } from "../types";
import { FOCUS_DEFAULTS, focusPrefs, nextKind } from "./focusplan.ts";

const day = (...sessions: [FocusKind, FocusOutcome][]): FocusDay => ({
  from: "2026-10-30T04:00:00Z",
  to: "2026-10-31T04:00:00Z",
  pomodoros: sessions.filter(([k, o]) => k === "work" && o === "completed").length,
  focusedSeconds: 0,
  sessions: sessions.map(([kind, outcome], i) => ({
    id: `s${i}`,
    kind,
    outcome,
    startedAt: "2026-10-30T13:00:00Z",
    endedAt: "2026-10-30T13:25:00Z",
    plannedSeconds: 1500,
    pausedSeconds: 0,
    remainingSeconds: 0,
    elapsedSeconds: 1500,
    interruptions: [],
  })),
});

test("unset, garbage and out-of-range settings fall back to defaults", () => {
  assert.deepEqual(focusPrefs({}), FOCUS_DEFAULTS);
  const prefs = focusPrefs({
    "focus.workMinutes": "50",
    "focus.shortBreakMinutes": "abc",
    "focus.longBreakMinutes": "999",
    "focus.longBreakEvery": "2.5",
  });
  assert.equal(prefs.workMinutes, 50);
  assert.equal(prefs.shortBreakMinutes, FOCUS_DEFAULTS.shortBreakMinutes);
  assert.equal(prefs.longBreakMinutes, FOCUS_DEFAULTS.longBreakMinutes);
  assert.equal(prefs.longBreakEvery, FOCUS_DEFAULTS.longBreakEvery);
});

test("a break follows only a completed pomodoro, long on every Nth", () => {
  const p = FOCUS_DEFAULTS;
  assert.equal(nextKind(null, p), "work");
  assert.equal(nextKind(day(["work", "abandoned"]), p), "work");
  assert.equal(nextKind(day(["work", "completed"]), p), "short-break");
  assert.equal(nextKind(day(["work", "completed"], ["short-break", "completed"]), p), "work");
  const four = day(
    ["work", "completed"],
    ["work", "completed"],
    ["work", "completed"],
    ["work", "completed"],
  );
  assert.equal(nextKind(four, p), "long-break");
});
