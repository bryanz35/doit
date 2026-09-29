/** Screen 1b — week view with the unscheduled tray. Variation 2b — month density.
 *  Below NARROW_QUERY the seven columns get too thin to read, so Week falls back to
 *  a single-day grid and the density switch offers only Day and Month.
 *
 *  Two different things are drawn here, and they are not the same thing:
 *
 *  - `due` is a deadline — a date with no time. Dated tasks sit in the all-day
 *    strip (Week/Day) or in month cells, never on the hour grid. Dropping a chip
 *    on a day sets `due` through `updateTask`.
 *  - A **block** is when the user actually sits down to the task: a real span
 *    with a start and an end, drawn on the hour grid. Dropping a chip on an hour
 *    column creates one, dragging a block moves it, its bottom edge resizes it,
 *    and its × unschedules it (`addBlock` / `updateBlock` / `deleteBlock`).
 *    Holding Shift while dropping a block copies it instead of moving it: the
 *    original stays put and a second block is added to the same task.
 *
 *  The tray is open tasks with no blocks — having a deadline is not the same as
 *  having made time for it, so a dated-but-unblocked task still waits there. */

import type { CSSProperties, DragEvent, PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../data/store";
import type { Task, TaskBlock } from "../types";
import { atMinutes, clockOf, durationMinutes } from "../data/instants";
import { Kbd, Segmented, formatMinutes } from "../components/primitives";
import { TaskDetail } from "../components/TaskDetail";

const DENSITIES = ["Day", "Week", "Month"] as const;
type Density = (typeof DENSITIES)[number];

const DOW = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const NARROW_QUERY = "(max-width: 960px)";

/** Month cells show this many chips before collapsing the rest into "+N more". */
const MONTH_CHIP_LIMIT = 3;
/** The load bar under a month date measures estimates against this ceiling. */
const DAY_CAPACITY_MINUTES = 8 * 60;

/** The grid opens on 09:00–16:00 as in the mockup, but grows to cover whatever
 *  blocks the visible days actually hold — a block outside the window would
 *  otherwise be invisible and unreachable. */
const DEFAULT_START_HOUR = 9;
const DEFAULT_END_HOUR = 16;
const HOUR_PX = 88;

/** Everything on the hour grid snaps to this, in minutes: drags, drops, resizes. */
const SNAP = 15;
/** Length of a block made from a task with no estimate, and the floor a resize
 *  cannot go below. */
const DEFAULT_BLOCK_MINUTES = 60;
const MIN_BLOCK_MINUTES = 15;
const MAX_BLOCK_MINUTES = 8 * 60;
const MINUTES_PER_DAY = 24 * 60;

const snap = (minutes: number) => Math.round(minutes / SNAP) * SNAP;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** Minutes past local midnight, re-read every 30s so the now-line creeps. */
function useNowMinutes() {
  const read = () => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  };
  const [minutes, setMinutes] = useState(read);
  useEffect(() => {
    const timer = window.setInterval(() => setMinutes(read()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return minutes;
}

// ── dates ────────────────────────────────────────────────────────────
// Everything is a local YYYY-MM-DD string, the shape the `due` column stores.
// Dates are built with the (y, m, d) constructor so no UTC conversion sneaks in.
// Block instants are UTC and convert through src/data/instants.ts.

function parseIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toIso(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function addDays(iso: string, days: number): string {
  const date = parseIso(iso);
  date.setDate(date.getDate() + days);
  return toIso(date);
}

/** Same day-of-month in another month, clamped so 31 Jan + 1 month is 28/29 Feb. */
function addMonths(iso: string, months: number): string {
  const date = parseIso(iso);
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(date.getDate(), lastDay));
  return toIso(target);
}

/** Monday of the week containing `iso`. */
function startOfWeek(iso: string): string {
  const offset = (parseIso(iso).getDay() + 6) % 7; // Sunday is 0 in JS
  return addDays(iso, -offset);
}

function weekOf(iso: string): string[] {
  const monday = startOfWeek(iso);
  return DOW.map((_, index) => addDays(monday, index));
}

/** Whole Monday-start weeks covering the month containing `iso`. */
function monthWeeks(iso: string): string[][] {
  const date = parseIso(iso);
  const first = toIso(new Date(date.getFullYear(), date.getMonth(), 1));
  const last = toIso(new Date(date.getFullYear(), date.getMonth() + 1, 0));
  const weeks: string[][] = [];
  for (let monday = startOfWeek(first); monday <= last; monday = addDays(monday, 7)) {
    weeks.push(weekOf(monday));
  }
  return weeks;
}

const dowIndex = (iso: string) => (parseIso(iso).getDay() + 6) % 7;
const isWeekend = (iso: string) => dowIndex(iso) > 4;
const dayOfMonth = (iso: string) => parseIso(iso).getDate();
const monthName = (iso: string) => MONTHS[parseIso(iso).getMonth()];

/** "10 – 16 August", or "28 September – 4 October" across a month boundary. */
function weekTitle(days: string[]): string {
  const first = days[0];
  const last = days[days.length - 1];
  return monthName(first) === monthName(last)
    ? `${dayOfMonth(first)} – ${dayOfMonth(last)} ${monthName(last)}`
    : `${dayOfMonth(first)} ${monthName(first)} – ${dayOfMonth(last)} ${monthName(last)}`;
}

// ── blocks on the grid ───────────────────────────────────────────────

/** One block's share of one local day, in minutes past that day's midnight.
 *  A block that runs past midnight produces a segment on each day it touches,
 *  so the grid can draw both halves without the block itself being split. */
interface Segment {
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
 *  Instants are canonical UTC, so the overlap test is a plain string compare. */
function segmentsByDate(tasks: Task[], days: string[]): Map<string, Segment[]> {
  const byDate = new Map<string, Segment[]>();
  for (const date of days) {
    const dayStart = atMinutes(date, 0);
    const dayEnd = atMinutes(date, MINUTES_PER_DAY);
    const found: Segment[] = [];
    for (const task of tasks) {
      for (const block of task.blocks) {
        if (block.startAt >= dayEnd || block.endAt <= dayStart) continue;
        const from = Math.max(0, durationMinutes(dayStart, block.startAt));
        const to = Math.min(MINUTES_PER_DAY, durationMinutes(dayStart, block.endAt));
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

/** How long a block made from this task should be. */
function blockLengthFor(task: Task): number {
  const estimate = task.estimateMinutes;
  if (estimate === undefined) return DEFAULT_BLOCK_MINUTES;
  return clamp(snap(estimate) || MIN_BLOCK_MINUTES, MIN_BLOCK_MINUTES, MAX_BLOCK_MINUTES);
}

// ── drag ─────────────────────────────────────────────────────────────

/** What is in flight on the HTML5 drag: a task from the tray, the due strip or a
 *  month cell. A block already on the grid is *not* dragged this way — see
 *  `useBlockMove` below for why. */
interface DragItem {
  task: Task;
}

/** The tray chip is 236px wide — the width of the sidebar — so the browser's default
 *  drag image dwarfs the day column it is dropped into. Render a column-sized proxy
 *  instead and hand that to setDragImage. */
function setChipDragImage(event: DragEvent, task: Task) {
  // WebKit only starts a drag that carries data
  event.dataTransfer.setData("text/plain", task.id);
  event.dataTransfer.effectAllowed = "move";
  const proxy = document.createElement("div");
  proxy.className = "month-chip month-chip-task cal-drag-proxy";
  proxy.textContent = task.title;
  document.body.appendChild(proxy);
  event.dataTransfer.setDragImage(proxy, 8, 8);
  // the proxy only needs to survive the snapshot the browser takes this frame
  window.setTimeout(() => proxy.remove(), 0);
}

/** Shared by every drop target (all-day cells, hour columns, month cells). */
interface DragState {
  item: DragItem | null;
  task: Task | null;
  hoverDate: string | null;
  /** Snapped start minute under the cursor, set only over an hour column. */
  hoverMinutes: number | null;
  /** Minutes the dragged thing would occupy once dropped. */
  length: number;
  startTask: (event: DragEvent, task: Task) => void;
  end: () => void;
  /** Date-only targets: the all-day strip and month cells. */
  dayProps: (date: string) => {
    onDragEnter: (event: DragEvent) => void;
    onDragOver: (event: DragEvent) => void;
    onDrop: (event: DragEvent) => void;
  };
  /** Hour columns: the drop carries a time, read off the cursor's Y. */
  columnProps: (date: string) => {
    onDragEnter: (event: DragEvent) => void;
    onDragOver: (event: DragEvent) => void;
    onDrop: (event: DragEvent) => void;
  };
  /** Put on the grid root: clears the outline when the drag leaves the grid, and
   *  makes cell contents transparent to drag events while a drag is in flight. */
  surfaceProps: {
    className: string;
    onDragLeave: (event: DragEvent) => void;
  };
}

interface DragHandlers {
  /** Dropped on a bare date: set the deadline. */
  onDropOnDay: (task: Task, date: string) => void;
  /** Dropped at a time: give the task a block there. */
  onDropAt: (task: Task, date: string, startMinutes: number) => void;
}

function useCalendarDrag(handlers: DragHandlers, minutesAt: (event: DragEvent) => number): DragState {
  const [item, setItem] = useState<DragItem | null>(null);
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const [hoverMinutes, setHoverMinutes] = useState<number | null>(null);

  const end = () => {
    setItem(null);
    setHoverDate(null);
    setHoverMinutes(null);
  };

  const length = item ? blockLengthFor(item.task) : 0;

  /** Where the dropped block would start, kept inside the day. */
  const startFor = (event: DragEvent) =>
    clamp(snap(minutesAt(event)), 0, MINUTES_PER_DAY - length);

  return {
    item,
    task: item?.task ?? null,
    hoverDate,
    hoverMinutes,
    length,
    startTask: (event, task) => {
      setChipDragImage(event, task);
      setItem({ task });
    },
    end,
    dayProps: (date) => ({
      // Entering a day is the only thing that moves the outline: dragover fires
      // many times a second and its relatedTarget-based leave counterpart is
      // unreliable, so clearing per cell made the outline blink.
      onDragEnter: (event) => {
        if (!item) return;
        event.preventDefault();
        setHoverMinutes(null);
        setHoverDate((current) => (current === date ? current : date));
      },
      onDragOver: (event) => {
        if (!item) return;
        // a drop target has to swallow dragover, or the browser rejects the drop
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      },
      onDrop: (event) => {
        event.preventDefault();
        if (item && item.task.due !== date) handlers.onDropOnDay(item.task, date);
        end();
      },
    }),
    columnProps: (date) => ({
      onDragEnter: (event) => {
        if (!item) return;
        event.preventDefault();
        setHoverDate((current) => (current === date ? current : date));
        setHoverMinutes(startFor(event));
      },
      onDragOver: (event) => {
        if (!item) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const next = startFor(event);
        // only a change past the snap grid re-renders the ghost
        setHoverMinutes((current) => (current === next ? current : next));
      },
      onDrop: (event) => {
        event.preventDefault();
        if (item) handlers.onDropAt(item.task, date, startFor(event));
        end();
      },
    }),
    surfaceProps: {
      className: item ? "cal-dragging" : "",
      onDragLeave: (event) => {
        // only a leave out of the grid itself clears the outline
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setHoverDate(null);
        setHoverMinutes(null);
      },
    },
  };
}

/** A resize in flight: one edge of the block is following the pointer while the
 *  other stays put. Committed on pointer-up, so a drag across the grid is one
 *  `update_block`, not thirty — and an intermediate span that would collide with
 *  a neighbour never reaches the backend.
 *
 *  `from`/`to` are the live span; `origFrom`/`origTo` are what it was, so a drag
 *  that ends where it started sends nothing. */
interface Resize {
  block: TaskBlock;
  date: string;
  edge: "start" | "end";
  from: number;
  to: number;
  origFrom: number;
  origTo: number;
}

/** A block being moved across the grid, pointer by pointer.
 *
 *  Blocks deliberately do **not** use HTML5 drag-and-drop, though the tray and
 *  due chips do. In the Linux webview (WebKitGTK) a native drag is unusable for
 *  this gesture: Shift+drag is taken as "extend the text selection" so the drag
 *  never starts, and the modifier bits on drag events latch, so once Shift has
 *  been pressed every later drop still claims it. Pointer events have neither
 *  problem, they already carry this file's resize, and the gesture is a
 *  same-surface move — none of what DnD buys (cross-window drops, a drag image)
 *  applies.
 *
 *  `date`/`start` are where the block would land; `origDate`/`origStart` are
 *  where it came from, so a gesture that ends where it began sends nothing.
 *  `moved` stays false until the pointer passes MOVE_THRESHOLD_PX, which keeps
 *  a plain click on a block a click. */
interface Move {
  block: TaskBlock;
  task: Task;
  /** Minutes into the block where it was taken hold of. */
  grab: number;
  length: number;
  date: string;
  start: number;
  origDate: string;
  origStart: number;
  /** Shift is down: the drop duplicates the block instead of moving it. */
  copy: boolean;
  moved: boolean;
}

/** Below this, the gesture is still a click and no block has moved. */
const MOVE_THRESHOLD_PX = 4;

/** Whether Shift is down right now, tracked from the key events themselves.
 *
 *  The move gesture reads `shiftKey` off its own pointer events, which is the
 *  honest answer for a pointer event — but the webview has already been caught
 *  latching that bit on drag events (press Shift once and every later drag calls
 *  itself a copy), so the copy also has to be corroborated by a key that is
 *  actually down. Both or it is a plain move.
 *
 *  `getModifierState` rather than `key === "Shift"`, so a key pressed while
 *  Shift is already held reports it too. */
function useShiftHeld() {
  const held = useRef(false);
  useEffect(() => {
    const read = (event: KeyboardEvent) => {
      held.current = event.getModifierState("Shift");
    };
    window.addEventListener("keydown", read, true);
    window.addEventListener("keyup", read, true);
    return () => {
      window.removeEventListener("keydown", read, true);
      window.removeEventListener("keyup", read, true);
    };
  }, []);
  return held;
}

// ── page ─────────────────────────────────────────────────────────────

export function CalendarPage() {
  const {
    tasks, loaded, error, today, selectTask, selectedTaskId, taskById,
    updateTask, addBlock, updateBlock, deleteBlock,
  } = useApp();
  const selected = taskById(selectedTaskId);
  /** Clicking the task whose detail pane is already open closes it — a chip or a
   *  block is a toggle, not a one-way door. */
  const toggleSelect = (id: string | null) =>
    selectTask(id !== null && id === selectedTaskId ? null : id);
  const [density, setDensity] = useState<Density>("Week");
  // The date the view is anchored on: the day Day shows, the week Week shows, the
  // month Month shows. Stepping moves it by one of whichever unit is on screen.
  const [anchor, setAnchor] = useState(today);
  const narrow = useMediaQuery(NARROW_QUERY);

  // The chosen density is kept, so widening the window restores Week.
  const view: Density = narrow && density === "Week" ? "Day" : density;
  const options = narrow ? DENSITIES.filter((option) => option !== "Week") : DENSITIES;

  const step = (delta: number) =>
    setAnchor((current) =>
      view === "Month"
        ? addMonths(current, delta)
        : addDays(current, view === "Week" ? delta * 7 : delta),
    );

  const days = view === "Day" ? [anchor] : weekOf(anchor);
  const weeks = monthWeeks(anchor);
  const visibleDays = view === "Month" ? weeks.flat() : days;
  const rangeStart = visibleDays[0];
  const rangeEnd = visibleDays[visibleDays.length - 1];

  const segments = useMemo(() => segmentsByDate(tasks, visibleDays), [tasks, visibleDays.join()]);
  const segmentsOn = (date: string) => segments.get(date) ?? [];

  // The hour window has to cover the blocks that are actually there, or a block
  // at 07:00 would be drawn above the top of the grid and be unreachable.
  let startHour = DEFAULT_START_HOUR;
  let endHour = DEFAULT_END_HOUR;
  for (const list of segments.values()) {
    for (const seg of list) {
      startHour = Math.min(startHour, Math.floor(seg.from / 60));
      endHour = Math.max(endHour, Math.ceil(seg.to / 60));
    }
  }

  // Column geometry, shared by the drop handlers and the resize handler: both
  // need "which minute is this Y", and both measure against the same rect.
  const minutesAtY = (clientY: number, rect: DOMRect) =>
    startHour * 60 + ((clientY - rect.top) / HOUR_PX) * 60;

  const drag = useCalendarDrag(
    {
      onDropOnDay: (task, date) => updateTask(task.id, { due: date }),
      onDropAt: (task, date, startMinutes) => {
        const length = blockLengthFor(task);
        addBlock(task.id, atMinutes(date, startMinutes), atMinutes(date, startMinutes + length));
      },
    },
    (event) => minutesAtY(event.clientY, event.currentTarget.getBoundingClientRect()),
  );

  // Resize lives here rather than in the block, so the pointer can leave the
  // block it started on without the drag dying with it.
  const [resize, setResize] = useState<Resize | null>(null);
  const resizeRect = useRef<DOMRect | null>(null);
  // A resize or a move ends as a click on the block it happened to, and that
  // click would toggle the detail pane shut on the very task being dragged. The
  // block's click handler consumes this first — pointerup always precedes click,
  // so the flag is set in time.
  const justDragged = useRef(false);

  const startResize = (event: ReactPointerEvent, seg: Segment, edge: "start" | "end") => {
    const column = (event.currentTarget as HTMLElement).closest(".cal-col");
    if (!column) return;
    // Suppress the native drag the block would otherwise start from this press —
    // pulling an edge is a resize, not a move.
    event.preventDefault();
    event.stopPropagation();
    resizeRect.current = column.getBoundingClientRect();
    justDragged.current = true;
    setResize({
      block: seg.block,
      date: seg.date,
      edge,
      from: seg.from,
      to: seg.to,
      origFrom: seg.from,
      origTo: seg.to,
    });
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const moveResize = (event: ReactPointerEvent) => {
    const rect = resizeRect.current;
    if (!resize || !rect) return;
    const at = snap(minutesAtY(event.clientY, rect));
    // The edge being dragged moves; the other one pins the span, and neither can
    // cross it — a resize can shrink a block to 15 minutes but never invert it.
    const next =
      resize.edge === "end"
        ? { from: resize.from, to: clamp(at, resize.from + MIN_BLOCK_MINUTES, MINUTES_PER_DAY) }
        : { from: clamp(at, 0, resize.to - MIN_BLOCK_MINUTES), to: resize.to };
    setResize((current) =>
      current && (current.from !== next.from || current.to !== next.to)
        ? { ...current, ...next }
        : current,
    );
  };

  const endResize = () => {
    if (!resize) return;
    const { block, date, from, to, origFrom, origTo } = resize;
    setResize(null);
    resizeRect.current = null;
    if (from !== origFrom || to !== origTo) {
      updateBlock(block.id, atMinutes(date, from), atMinutes(date, to));
    }
  };

  // Moving a block. Like the resize it lives here, not in the block: the pointer
  // has to be able to leave the block — and its column — without the gesture
  // dying, and the commit belongs next to the other mutations.
  const [move, setMove] = useState<Move | null>(null);
  /** Where the press landed, to tell a click from the start of a move. */
  const pressAt = useRef<{ x: number; y: number } | null>(null);
  const shiftHeld = useShiftHeld();
  const copying = (event: ReactPointerEvent) => event.shiftKey && shiftHeld.current;

  const startMove = (event: ReactPointerEvent, seg: Segment) => {
    if (event.button !== 0) return;
    // Without this the press begins a text selection instead — which is what
    // Shift+press does in WebKit, and it swallows the gesture whole.
    event.preventDefault();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    pressAt.current = { x: event.clientX, y: event.clientY };
    setMove({
      block: seg.block,
      task: seg.task,
      grab: snap(((event.clientY - rect.top) / HOUR_PX) * 60),
      length: seg.to - seg.from,
      date: seg.date,
      start: seg.from,
      origDate: seg.date,
      origStart: seg.from,
      copy: copying(event),
      moved: false,
    });
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  /** The hour column under the pointer, whichever day it belongs to — the
   *  pointer is captured by the block, so hit-testing is how the gesture crosses
   *  columns. `elementsFromPoint` rather than `elementFromPoint`: the block
   *  itself sits on top of the column it is over. */
  const columnUnder = (clientX: number, clientY: number) => {
    for (const el of document.elementsFromPoint(clientX, clientY)) {
      const col = (el as HTMLElement).closest?.("[data-cal-date]");
      if (col) return col as HTMLElement;
    }
    return null;
  };

  const moveMove = (event: ReactPointerEvent) => {
    if (!move) return;
    const press = pressAt.current;
    const moved =
      move.moved ||
      (press !== null &&
        Math.hypot(event.clientX - press.x, event.clientY - press.y) > MOVE_THRESHOLD_PX);
    const column = columnUnder(event.clientX, event.clientY);
    const date = column?.dataset.calDate ?? move.date;
    const rect = column?.getBoundingClientRect();
    const start = rect
      ? clamp(
          snap(minutesAtY(event.clientY, rect) - move.grab),
          0,
          MINUTES_PER_DAY - move.length,
        )
      : move.start;
    // Re-read every time, so letting go of Shift mid-gesture goes back to a move.
    const copy = copying(event);
    setMove((current) =>
      current &&
      (current.moved !== moved ||
        current.date !== date ||
        current.start !== start ||
        current.copy !== copy)
        ? { ...current, moved, date, start, copy }
        : current,
    );
  };

  const endMove = () => {
    if (!move) return;
    const { block, task, date, start, length, origDate, origStart, copy, moved } = move;
    setMove(null);
    pressAt.current = null;
    if (!moved) return; // a press that never travelled is a click on the block
    justDragged.current = true;
    if (!copy && date === origDate && start === origStart) return;
    const startAt = atMinutes(date, start);
    const endAt = atMinutes(date, start + length);
    // A copy laid over its own original would overlap it, which the backend
    // refuses on one task — so a copy that never travelled is dropped too.
    if (copy) {
      if (date === origDate && start === origStart) return;
      addBlock(task.id, startAt, endAt);
    } else {
      updateBlock(block.id, startAt, endAt);
    }
  };

  /** True once per gesture, for the click that gesture is about to produce. */
  const consumeDragClick = () => {
    const dragged = justDragged.current;
    justDragged.current = false;
    return dragged;
  };

  const byDate = new Map<string, Task[]>();
  for (const task of tasks) {
    if (!task.due) continue;
    const bucket = byDate.get(task.due);
    if (bucket) bucket.push(task);
    else byDate.set(task.due, [task]);
  }
  const tasksOn = (date: string) => byDate.get(date) ?? [];

  // A deadline is not a plan: a task stays in the tray until it has a block.
  const unscheduled = tasks.filter((task) => task.status !== "done" && task.blocks.length === 0);
  const dueInRange = tasks.filter(
    (task) =>
      task.status !== "done" && task.due && task.due >= rangeStart && task.due <= rangeEnd,
  );
  const sumEstimates = (list: Task[]) =>
    list.reduce((sum, task) => sum + (task.estimateMinutes ?? 0), 0);
  const rangeSegments = visibleDays.flatMap(segmentsOn);
  const blockedMinutes = rangeSegments.reduce((sum, seg) => sum + (seg.to - seg.from), 0);

  const title =
    view === "Day"
      ? `${DOW[dowIndex(anchor)].slice(0, 1)}${DOW[dowIndex(anchor)].slice(1).toLowerCase()} ${dayOfMonth(anchor)} ${monthName(anchor)}`
      : view === "Week"
        ? weekTitle(days)
        : `${monthName(anchor)} ${parseIso(anchor).getFullYear()}`;
  const unit = view === "Day" ? "day" : view === "Week" ? "week" : "month";

  const chipProps = { drag, selectTask: toggleSelect, selectedTaskId, today };

  return (
    <>
      <header className="topbar">
        <h4>{title}</h4>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            type="button"
            className="btn btn-secondary btn-icon"
            aria-label={`Previous ${unit}`}
            onClick={() => step(-1)}
          >
            ‹
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-icon"
            aria-label={`Next ${unit}`}
            onClick={() => step(1)}
          >
            ›
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setAnchor(today)}>
            Today
          </button>
        </div>
        <div className="topbar-right">
          {/* TODO(backend): real sync status from the calendar integration. */}
          <span className="tag tag-neutral meta cal-sync">Google Calendar synced 4m ago</span>
          <Segmented options={options} value={view} onChange={setDensity} />
        </div>
      </header>

      {error && (
        <div className="banner" role="alert">
          {error}
        </div>
      )}

      <div className="body">
        <aside className="cal-side">
          <h6 style={{ margin: 0, color: "var(--color-neutral-700)" }}>
            Unscheduled{loaded ? ` · ${unscheduled.length}` : ""}
          </h6>
          <p className="text-muted" style={{ fontSize: 11, margin: 0 }}>
            Drop on the hour grid to make time for it; on a day header strip to set its due date.
          </p>
          {!loaded ? (
            <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
              Loading tasks…
            </p>
          ) : unscheduled.length === 0 ? (
            <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
              Every open task has time on the calendar.
            </p>
          ) : (
            unscheduled.map((task) => (
              <div
                key={task.id}
                className={[
                  "chip",
                  drag.task?.id === task.id ? "chip-dragging" : "",
                  selectedTaskId === task.id ? "chip-selected" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                draggable
                onDragStart={(event) => drag.startTask(event, task)}
                onDragEnd={drag.end}
                onClick={() => toggleSelect(task.id)}
              >
                {task.title}
                <div className="text-muted" style={{ fontSize: 11 }}>
                  {drag.task?.id === task.id
                    ? "dragging…"
                    : [
                        formatMinutes(task.estimateMinutes),
                        task.due ? `due ${task.due.slice(5)}` : null,
                        task.list,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                </div>
              </div>
            ))
          )}
          <div style={{ marginTop: "auto", paddingTop: 12, borderTop: "2px solid var(--color-divider)" }}>
            <div className="text-muted" style={{ fontSize: 11, marginBottom: 6 }}>
              This {unit}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span>Blocked · {rangeSegments.length}</span>
              <span style={{ color: "var(--color-accent-700)" }}>
                {formatMinutes(blockedMinutes)}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span>Due · {dueInRange.length}</span>
              <span>{formatMinutes(sumEstimates(dueInRange))}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span>Unscheduled · {unscheduled.length}</span>
              <span>{formatMinutes(sumEstimates(unscheduled))}</span>
            </div>
          </div>
        </aside>

        {view === "Month" ? (
          <MonthGrid
            anchor={anchor}
            weeks={weeks}
            tasksOn={tasksOn}
            segmentsOn={segmentsOn}
            {...chipProps}
          />
        ) : (
          <WeekGrid
            days={days}
            tasksOn={tasksOn}
            segmentsOn={segmentsOn}
            startHour={startHour}
            endHour={endHour}
            resize={resize}
            onResizeStart={startResize}
            onResizeMove={moveResize}
            onResizeEnd={endResize}
            move={move}
            onMoveStart={startMove}
            onMoveMove={moveMove}
            onMoveEnd={endMove}
            onConsumeDragClick={consumeDragClick}
            onDeleteBlock={deleteBlock}
            {...chipProps}
          />
        )}

        {/* Same detail the tasks list opens, from a tray chip, a due chip or a
            block — one task detail, wherever the task was clicked. Here it is a
            centred modal, not a third column: the tray and the grid need the
            width, and docking it right left it cramped on narrow windows. */}
        {selected && <TaskDetail task={selected} variant="modal" />}
      </div>
    </>
  );
}

interface ChipProps {
  drag: DragState;
  selectTask: (id: string | null) => void;
  selectedTaskId: string | null;
  today: string;
}

/** A scheduled task on the grid. Draggable, so it can be moved to another day. */
function TaskChip({ task, drag, selectTask, selectedTaskId, today }: ChipProps & { task: Task }) {
  const done = task.status === "done";
  const overdue = !done && task.due !== undefined && task.due < today;
  return (
    <div
      className={[
        "month-chip",
        "cal-task-chip",
        done ? "cal-task-chip-done" : "month-chip-task",
        overdue ? "cal-task-chip-overdue" : "",
        selectedTaskId === task.id ? "cal-task-chip-selected" : "",
        drag.task?.id === task.id ? "cal-task-chip-dragging cal-drag-source" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      title={
        task.estimateMinutes !== undefined
          ? `${task.title} · ${formatMinutes(task.estimateMinutes)}`
          : task.title
      }
      draggable={!done}
      onDragStart={(event) => drag.startTask(event, task)}
      onDragEnd={drag.end}
      onClick={() => selectTask(task.id)}
    >
      {task.title}
    </div>
  );
}

/** A dashed stand-in shown in whichever day the dragged task would land on. */
function DropPreview({ drag, date }: { drag: DragState; date: string }) {
  if (!drag.item) return null;
  if (drag.hoverDate !== date || drag.hoverMinutes !== null || drag.item.task.due === date) {
    return null;
  }
  return <div className="month-chip cal-task-chip cal-task-chip-preview">{drag.item.task.title}</div>;
}

interface GridProps extends ChipProps {
  tasksOn: (date: string) => Task[];
  segmentsOn: (date: string) => Segment[];
}

/** Renders the grid for whichever dates it is given — seven for Week, one for Day.
 *  Deadlines go in the all-day strip; blocks are drawn on the hour columns, which
 *  are drop targets for both a new block and a moved one. */
function WeekGrid({
  days,
  tasksOn,
  segmentsOn,
  startHour,
  endHour,
  resize,
  onResizeStart,
  onResizeMove,
  onResizeEnd,
  move,
  onMoveStart,
  onMoveMove,
  onMoveEnd,
  onConsumeDragClick,
  onDeleteBlock,
  ...chipProps
}: GridProps & {
  days: string[];
  startHour: number;
  endHour: number;
  resize: Resize | null;
  onResizeStart: (event: ReactPointerEvent, seg: Segment, edge: "start" | "end") => void;
  onResizeMove: (event: ReactPointerEvent) => void;
  onResizeEnd: () => void;
  move: Move | null;
  onMoveStart: (event: ReactPointerEvent, seg: Segment) => void;
  onMoveMove: (event: ReactPointerEvent) => void;
  onMoveEnd: () => void;
  onConsumeDragClick: () => boolean;
  onDeleteBlock: (blockId: string) => void;
}) {
  const { drag, today } = chipProps;
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const nowMinutes = useNowMinutes();
  const showNow = nowMinutes >= startHour * 60 && nowMinutes <= endHour * 60;
  const yFor = (minutes: number) => ((minutes - startHour * 60) / 60) * HOUR_PX;

  const cellClass = (base: string, date: string) =>
    [
      base,
      isWeekend(date) ? `${base}-weekend` : "",
      date === today ? `${base}-today` : "",
      drag.hoverDate === date ? "cal-drop-target" : "",
    ]
      .filter(Boolean)
      .join(" ");

  return (
    <div
      className={`cal-grid ${drag.surfaceProps.className}`.trim()}
      onDragLeave={drag.surfaceProps.onDragLeave}
      style={{ "--cal-days": days.length } as CSSProperties}
    >
      <div className="cal-head">
        <div />
        {days.map((date) => (
          <div key={date} className={`cal-head-cell${date === today ? " cal-today" : ""}`}>
            <div className="cal-head-dow text-muted">{DOW[dowIndex(date)]}</div>
            <div
              className="cal-head-day"
              style={isWeekend(date) ? { color: "var(--color-neutral-600)" } : undefined}
            >
              {dayOfMonth(date)}
            </div>
          </div>
        ))}
      </div>

      <div className="cal-allday">
        <div className="cal-allday-label text-muted">DUE</div>
        {days.map((date) => (
          <div key={date} className={cellClass("cal-allday-cell", date)} {...drag.dayProps(date)}>
            {tasksOn(date).map((task) => (
              <TaskChip key={task.id} task={task} {...chipProps} />
            ))}
            <DropPreview drag={drag} date={date} />
          </div>
        ))}
      </div>

      <div className="cal-cols">
        <div className="cal-hours">
          {hours.map((hour) => (
            <div className="cal-hour" key={hour}>
              {String(hour).padStart(2, "0")}
            </div>
          ))}
        </div>

        {days.map((date) => (
          <div
            key={date}
            // read back by the move gesture, which hit-tests its way across columns
            data-cal-date={date}
            className={cellClass("cal-col", date)}
            {...drag.columnProps(date)}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeEnd}
            onPointerCancel={onResizeEnd}
          >
            {segmentsOn(date).map((seg) => (
              <BlockView
                key={`${seg.block.id}-${seg.date}`}
                seg={seg}
                yFor={yFor}
                resizing={resize && resize.block.id === seg.block.id ? resize : null}
                moving={move && move.moved && move.block.id === seg.block.id ? move : null}
                onResizeStart={onResizeStart}
                onMoveStart={onMoveStart}
                onMoveMove={onMoveMove}
                onMoveEnd={onMoveEnd}
                onConsumeDragClick={onConsumeDragClick}
                onDelete={onDeleteBlock}
                {...chipProps}
              />
            ))}
            {drag.hoverDate === date && drag.hoverMinutes !== null && drag.task && (
              <div
                className="cal-event cal-event-ghost"
                style={{ top: yFor(drag.hoverMinutes), height: (drag.length / 60) * HOUR_PX }}
              >
                {drag.task.title}
                <div className="cal-event-sub">{formatMinutes(drag.length)}</div>
              </div>
            )}
            {move && move.moved && move.date === date && (
              <div
                className="cal-event cal-event-ghost"
                style={{ top: yFor(move.start), height: (move.length / 60) * HOUR_PX }}
              >
                {move.task.title}
                <div className="cal-event-sub">
                  {clockOf(atMinutes(date, move.start))}–
                  {clockOf(atMinutes(date, move.start + move.length))}
                  {move.copy ? " · copy" : ""}
                </div>
              </div>
            )}
            {date === today && showNow && (
              <>
                <div className="cal-now" style={{ top: yFor(nowMinutes) }} />
                <div className="cal-now-dot" style={{ top: yFor(nowMinutes), left: 0 }} />
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** One block on the hour grid. Drag it to move it — with Shift held, to copy it
 *  — pull either edge to resize it, press its × to unschedule it. The tail of a
 *  block that started yesterday is none of those: its own edges are not on this
 *  day. Both gestures are pointer-driven, not HTML5 drags (see `Move`). */
function BlockView({
  seg,
  yFor,
  resizing,
  moving,
  onResizeStart,
  onMoveStart,
  onMoveMove,
  onMoveEnd,
  onConsumeDragClick,
  onDelete,
  selectTask,
  selectedTaskId,
}: ChipProps & {
  seg: Segment;
  yFor: (minutes: number) => number;
  resizing: Resize | null;
  moving: Move | null;
  onResizeStart: (event: ReactPointerEvent, seg: Segment, edge: "start" | "end") => void;
  onMoveStart: (event: ReactPointerEvent, seg: Segment) => void;
  onMoveMove: (event: ReactPointerEvent) => void;
  onMoveEnd: () => void;
  onConsumeDragClick: () => boolean;
  onDelete: (blockId: string) => void;
}) {
  const { task, block } = seg;
  // While a resize is in flight the block follows the pointer locally; the
  // backend only hears about it on pointer-up.
  const from = resizing ? resizing.from : seg.from;
  const to = resizing ? resizing.to : seg.to;
  const height = Math.max(((to - from) / 60) * HOUR_PX, 14);
  // A move carries the block away, so the position it left fades; a copy leaves
  // the original exactly where it is, so it stays solid.
  const leaving = moving !== null && !moving.copy;
  const movable = seg.whole && !resizing;

  return (
    <div
      className={[
        "cal-event",
        "cal-event-task",
        "cal-block",
        selectedTaskId === task.id ? "cal-block-selected" : "",
        leaving ? "cal-block-dragging" : "",
        moving ? "cal-block-moving" : "",
        seg.lanes > 1 ? "cal-block-narrow" : "",
        height < 30 ? "cal-block-short" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        top: yFor(from),
        height,
        left: `calc(3px + ${(seg.lane / seg.lanes) * 100}%)`,
        width: `calc(${(1 / seg.lanes) * 100}% - 6px)`,
      }}
      title={`${task.title} · ${clockOf(block.startAt)}–${clockOf(block.endAt)}`}
      // The press is captured by the block, so move and up are handled here
      // rather than on the column: the pointer has to be free to travel across
      // days without the gesture being handed to whatever it passes over.
      onPointerDown={movable ? (event) => onMoveStart(event, seg) : undefined}
      onPointerMove={onMoveMove}
      onPointerUp={onMoveEnd}
      onPointerCancel={onMoveEnd}
      onClick={() => {
        if (onConsumeDragClick()) return; // this click is the tail of a drag
        selectTask(task.id);
      }}
    >
      <div className="cal-block-title">{task.title}</div>
      {height > 34 && (
        <div className="cal-event-sub">
          {clockOf(block.startAt)}–{clockOf(block.endAt)}
        </div>
      )}
      {seg.whole && (
        <>
          <button
            type="button"
            className="cal-block-x"
            aria-label={`Unschedule ${task.title}`}
            onClick={(event) => {
              event.stopPropagation();
              onDelete(block.id);
            }}
            // a mousedown on the × must not become a drag of the block
            onPointerDown={(event) => event.stopPropagation()}
          >
            ×
          </button>
          {/* Both edges are live: pull the top to start earlier, the bottom to
              run later. The body between them still drags the whole block. */}
          <div
            className="cal-block-grip cal-block-grip-start"
            role="presentation"
            onPointerDown={(event) => onResizeStart(event, seg, "start")}
          />
          <div
            className="cal-block-grip cal-block-grip-end"
            role="presentation"
            onPointerDown={(event) => onResizeStart(event, seg, "end")}
          />
        </>
      )}
    </div>
  );
}

/** Variation 2b — month grid. The bar under each date is that day's open
 *  estimates against an eight-hour ceiling. */
function MonthGrid({
  anchor,
  weeks,
  tasksOn,
  segmentsOn,
  ...chipProps
}: GridProps & { anchor: string; weeks: string[][] }) {
  const { drag, today } = chipProps;
  const month = parseIso(anchor).getMonth();

  return (
    <div
      className={drag.surfaceProps.className}
      onDragLeave={drag.surfaceProps.onDragLeave}
      style={{ flex: 1, minWidth: 0, padding: "20px 24px", overflowY: "auto" }}
    >
      <div className="month">
        {DOW.map((day) => (
          <div className="month-dow" key={day}>
            {day.slice(0, 1) + day.slice(1).toLowerCase()}
          </div>
        ))}
        {weeks.flat().map((date) => {
          const dayTasks = tasksOn(date);
          const daySegments = segmentsOn(date);
          const load =
            dayTasks
              .filter((task) => task.status !== "done")
              .reduce((sum, task) => sum + (task.estimateMinutes ?? 0), 0) / DAY_CAPACITY_MINUTES;
          const isToday = date === today;
          const hidden = dayTasks.length - MONTH_CHIP_LIMIT;
          return (
            <div
              key={date}
              className={[
                "month-cell",
                isWeekend(date) ? "month-cell-weekend" : "",
                isToday ? "month-cell-today" : "",
                parseIso(date).getMonth() !== month ? "month-cell-outside" : "",
                drag.hoverDate === date ? "cal-drop-target" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              {...drag.dayProps(date)}
            >
              <div
                style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}
              >
                <div
                  className={isToday ? undefined : "text-muted"}
                  style={
                    isToday
                      ? { fontSize: 12, color: "var(--color-accent-700)", fontWeight: 600 }
                      : { fontSize: 12 }
                  }
                >
                  {dayOfMonth(date)}
                </div>
                {daySegments.length > 0 && (
                  <div
                    className="text-muted"
                    style={{ fontSize: 10 }}
                    title={`${daySegments.length} block${daySegments.length === 1 ? "" : "s"} on this day`}
                  >
                    ▮{" "}
                    {formatMinutes(
                      daySegments.reduce((sum, seg) => sum + (seg.to - seg.from), 0),
                    )}
                  </div>
                )}
              </div>
              {load > 0 && (
                <div
                  className={`month-load${load >= 1 ? " month-load-full" : load >= 0.6 ? " month-load-half" : ""}`}
                  style={{ width: `${Math.min(1, load) * 100}%` }}
                />
              )}
              {dayTasks.slice(0, MONTH_CHIP_LIMIT).map((task) => (
                <TaskChip key={task.id} task={task} {...chipProps} />
              ))}
              {hidden > 0 && (
                <div className="text-muted" style={{ fontSize: 10 }}>
                  +{hidden} more
                </div>
              )}
              <DropPreview drag={drag} date={date} />
            </div>
          );
        })}
      </div>
      <p className="text-muted" style={{ fontSize: 11, marginTop: 8 }}>
        The bar under each date is that day's open estimates against an eight-hour ceiling; the
        figure beside it is time blocked on the hour grid. <Kbd>2</Kbd> returns to the week.
      </p>
    </div>
  );
}
