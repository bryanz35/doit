// Node re-reads TZ on change; set before any Date is built so the DST case is real.
process.env.TZ = "America/New_York";

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Task } from "../types";
import { segmentsByDate } from "./blocks.ts";
import { atMinutes } from "./instants.ts";

const task = (startAt: string, endAt: string): Task => ({
  id: "t",
  title: "t",
  status: "todo",
  tags: [],
  dependsOn: [],
  blocks: [{ id: "b", taskId: "t", startAt, endAt }],
});

/** Draw a 10:00–11:00 block on `day`; it must come back at minutes 600–660. */
function drawnAt(day: string) {
  const [seg] = segmentsByDate([task(atMinutes(day, 600), atMinutes(day, 660))], [day]).get(day)!;
  return [seg.from, seg.to];
}

test("a block sits at its wall-clock time on an ordinary day", () => {
  assert.deepEqual(drawnAt("2026-10-30"), [600, 660]);
});

test("a block sits at its wall-clock time on DST days", () => {
  assert.deepEqual(drawnAt("2026-11-01"), [600, 660]); // fall back, 25-hour day
  assert.deepEqual(drawnAt("2026-03-08"), [600, 660]); // spring forward, 23-hour day
});

test("a block crossing midnight splits into a head and a tail", () => {
  const t = task(atMinutes("2026-10-30", 23 * 60), atMinutes("2026-10-31", 60));
  const byDate = segmentsByDate([t], ["2026-10-30", "2026-10-31"]);
  const [head] = byDate.get("2026-10-30")!;
  const [tail] = byDate.get("2026-10-31")!;
  assert.deepEqual([head.from, head.to, head.whole], [23 * 60, 24 * 60, false]);
  assert.deepEqual([tail.from, tail.to, tail.whole], [0, 60, false]);
});
