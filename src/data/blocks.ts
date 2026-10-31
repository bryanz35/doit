/** Laying calendar blocks out on the local-day hour grid. Pure, so it runs
 *  under `node --test` (see blocks.test.ts) — hence the `.ts` import. */

import type { Task, TaskBlock } from "../types";
import { atMinutes, dateOf, minutesOf } from "./instants.ts";

export const MINUTES_PER_DAY = 24 * 60;

/** One block's share of one local day, in minutes past that day's midnight.
 *  A block that runs past midnight produces a segment on each day it touches,
 *  so the grid can draw both halves without the block itself being split. */
export interface Segment {
  block: TaskBlock;
  task: Task;
  date: string;
  from: number;
  to: number;
  /** False on the tail of a block that started the day before — the tail is not
   *  draggable or resizable, since its own edges are not on this day. */
  whole: boolean;
  lane: number;
  lanes: number;
}

/** Blocks overlap only across different tasks (the backend forbids two blocks on
 *  one task from covering the same minute), but when they do the column has to
 *  split. Greedy lane packing over a run of mutually overlapping segments. */
function withLanes(segments: Segment[]): Segment[] {
  const sorted = [...segments].sort((a, b) => a.from - b.from || a.to - b.to);
  let cluster: Segment[] = [];
  let clusterEnd = -1;
  const closeCluster = () => {
    const lanes = cluster.reduce((most, seg) => Math.max(most, seg.lane + 1), 1);
    for (const seg of cluster) seg.lanes = lanes;
    cluster = [];
  };
  for (const seg of sorted) {
    if (seg.from >= clusterEnd) closeCluster();
    clusterEnd = Math.max(clusterEnd, seg.to);
    const taken = new Set(cluster.filter((other) => other.to > seg.from).map((o) => o.lane));
    while (taken.has(seg.lane)) seg.lane += 1;
    cluster.push(seg);
  }
  closeCluster();
  return sorted;
}

/** Every block that touches one of `days`, bucketed by local date.
 *  Instants are canonical UTC, so the overlap test is a plain string compare.
 *
 *  `from`/`to` are wall-clock minutes (`minutesOf`), not minutes elapsed since
 *  midnight: the grid and `atMinutes` both speak wall clock, and on a DST day
 *  the two differ by an hour after the switch. */
export function segmentsByDate(tasks: Task[], days: string[]): Map<string, Segment[]> {
  const byDate = new Map<string, Segment[]>();
  for (const date of days) {
    const dayStart = atMinutes(date, 0);
    const dayEnd = atMinutes(date, MINUTES_PER_DAY);
    const found: Segment[] = [];
    for (const task of tasks) {
      for (const block of task.blocks) {
        if (block.startAt >= dayEnd || block.endAt <= dayStart) continue;
        const from = block.startAt <= dayStart ? 0 : minutesOf(block.startAt);
        const to =
          block.endAt >= dayEnd || dateOf(block.endAt) !== date
            ? MINUTES_PER_DAY
            : minutesOf(block.endAt);
        found.push({
          block,
          task,
          date,
          from,
          to,
          whole: block.startAt >= dayStart && block.endAt <= dayEnd,
          lane: 0,
          lanes: 1,
        });
      }
    }
    byDate.set(date, withLanes(found));
  }
  return byDate;
}
