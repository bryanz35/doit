/** The calendar, in the style of Calendar: week (or day) grid with the
 *  unscheduled tray, or the month view.
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

import type { CSSProperties, DragEvent, PointerEvent as ReactPointerEvent, RefObject } from "react";
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { useApp } from "../data/store";
import type { Task, TaskBlock } from "../types";
import { atMinutes, clockOf, durationMinutes } from "../data/instants";
import { listColor } from "../data/scope";
import { Kbd, Segmented, formatMinutes } from "../components/primitives";
import { TaskDetail } from "../components/TaskDetail";

const DENSITIES = ["Day", "Week", "Month"] as const;
type Density = (typeof DENSITIES)[number];

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const NARROW_QUERY = "(max-width: 960px)";

/** Month cells show this many lines before collapsing the rest into "N more". */
const MONTH_CHIP_LIMIT = 3;
/** The load bar under a month date measures estimates against this ceiling. */
const DAY_CAPACITY_MINUTES = 8 * 60;

/** The grid always spans the whole day; it opens scrolled to this hour, or to
 *  just before the current time when today is on screen. */
const DEFAULT_SCROLL_HOUR = 8;
/** Hour heights the zoom moves between. The real floor is whatever makes the 24
 *  hours exactly fill the pane, so the grid never stops short of its bottom. */
const DEFAULT_HOUR_PX = 48;
const MAX_HOUR_PX = 240;
/** How hard the wheel zooms: the hour height scales by e^(-deltaY · this). */
const ZOOM_RATE = 0.002;

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

/** The hour grid's zoom. Ctrl/⌘ + wheel (a trackpad pinch arrives as the same
 *  event) scales the hour height around the pointer, so the time under it stays
 *  put; a plain wheel still scrolls. The height never drops below the one that
 *  fits all 24 hours in the pane, so there is never empty space under 24:00.
 *  `openAt` is the minute the pane opens scrolled to, read once per mount. */
function useHourZoom(openAt: number) {
  const [pane, setPane] = useState<HTMLDivElement | null>(null);
  const [wanted, setWanted] = useState(DEFAULT_HOUR_PX);
  const [floor, setFloor] = useState(0);
  const hourPx = clamp(wanted, floor, Math.max(floor, MAX_HOUR_PX));
  // A scroll position to restore once the next render is laid out: keep `minute`
  // `offset` px below the top of the pane. Set only alongside a state change.
  const anchor = useRef<{ minute: number; offset: number } | null>(null);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const latest = useRef({ hourPx, floor, openAt });
  latest.current = { hourPx, floor, openAt };

  useEffect(() => {
    if (!pane) return;
    const pad = () => parseFloat(getComputedStyle(pane).paddingTop) || 0;
    const minuteAt = (offset: number) =>
      ((pane.scrollTop + offset - pad()) / latest.current.hourPx) * 60;

    anchor.current = { minute: latest.current.openAt, offset: 0 };
    rerender();

    // The pane's height is set by the window, not by the grid, so this can't loop.
    const observer = new ResizeObserver(() => {
      const next = (pane.clientHeight - pad()) / 24;
      if (next === latest.current.floor) return;
      anchor.current ??= { minute: minuteAt(0), offset: 0 };
      setFloor(next);
    });
    observer.observe(pane);

    // React's onWheel is passive, and only a non-passive listener can stop the
    // webview zooming the whole page on Ctrl + wheel.
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const { hourPx: current, floor: low } = latest.current;
      const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaY;
      const next = clamp(current * Math.exp(-delta * ZOOM_RATE), low, Math.max(low, MAX_HOUR_PX));
      if (next === current) return;
      const offset = event.clientY - pane.getBoundingClientRect().top;
      anchor.current = { minute: minuteAt(offset), offset };
      setWanted(next);
    };
    pane.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      observer.disconnect();
      pane.removeEventListener("wheel", onWheel);
    };
  }, [pane]);

  useLayoutEffect(() => {
    const target = anchor.current;
    if (!pane || !target) return;
    anchor.current = null;
    const pad = parseFloat(getComputedStyle(pane).paddingTop) || 0;
    pane.scrollTop = pad + (target.minute / 60) * hourPx - target.offset;
  });

  return { hourPx, paneRef: setPane };
}

/** Wheel travel, in px, that Shift + wheel needs before it steps the range —
 *  under one notch of a mouse wheel, so every notch is one step. */
const WHEEL_STEP_PX = 40;

/** Shift + wheel over `surface` steps the visible range, like the ‹ › buttons:
 *  down or right is forward. */
function useWheelStep(surface: RefObject<HTMLElement | null>, step: (delta: number) => void) {
  const stepRef = useRef(step);
  stepRef.current = step;

  useEffect(() => {
    const el = surface.current;
    if (!el) return;
    let travel = 0;
    const onWheel = (event: WheelEvent) => {
      // Ctrl/⌘ belongs to the hour zoom; the tray and the task modal scroll as usual.
      if (!event.shiftKey || event.ctrlKey || event.metaKey) return;
      if ((event.target as Element).closest(".dt-tray, .dt-scrim")) return;
      // Stops the webview turning it into a horizontal scroll.
      event.preventDefault();
      // WebKit reports Shift + wheel as horizontal, so take whichever axis moved.
      const raw = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? raw * 16 : raw;
      // A change of direction starts over rather than paying off the old travel.
      travel = Math.sign(delta) === Math.sign(travel) ? travel + delta : delta;
      if (Math.abs(travel) < WHEEL_STEP_PX) return;
      stepRef.current(Math.sign(travel));
      travel = 0;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [surface]);
}

/** How far, in px, and how long, in ms, a new range slides in from. */
const SLIDE_PX = 24;
const SLIDE_MS = 180;

/** Slides the grid (or month) in from the side the range moved towards whenever
 *  `anchor` changes, by whatever means — wheel, ‹ ›, Today. A step mid-slide
 *  cancels the running one, so fast wheeling never queues animations. */
function useRangeSlide(surface: RefObject<HTMLElement | null>, anchor: string) {
  const previous = useRef(anchor);
  useLayoutEffect(() => {
    const from = previous.current;
    previous.current = anchor;
    if (from === anchor || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const grid = surface.current?.querySelector<HTMLElement>(".cal-grid, .cal-month");
    if (!grid) return;
    // ISO dates order as strings, so this is "moved forward".
    const offset = anchor > from ? SLIDE_PX : -SLIDE_PX;
    for (const running of grid.getAnimations()) running.cancel();
    grid.animate(
      [
        { transform: `translateX(${offset}px)`, opacity: 0 },
        { transform: "none", opacity: 1 },
      ],
      { duration: SLIDE_MS, easing: "cubic-bezier(0.2, 0, 0, 1)" },
    );
  }, [anchor, surface]);
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

/** The toolbar title, Calendar-style: the month in bold and the year in
 *  regular weight — "October 2026", "September – October 2026" for a week that
 *  straddles two, "5 October 2026" for a day. */
function calendarTitle(view: Density, anchor: string, days: string[]): { strong: string; light: string } {
  const year = String(parseIso(anchor).getFullYear());
  if (view === "Day") return { strong: `${dayOfMonth(anchor)} ${monthName(anchor)}`, light: year };
  if (view === "Week") {
    const first = monthName(days[0]);
    const last = monthName(days[days.length - 1]);
    return { strong: first === last ? last : `${first} – ${last}`, light: year };
  }
  return { strong: monthName(anchor), light: year };
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
  proxy.className = "dt-due cal-drag-proxy";
  proxy.dataset.color = listColor(task.list);
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
  const bodyRef = useRef<HTMLDivElement>(null);
  useWheelStep(bodyRef, step);
  useRangeSlide(bodyRef, anchor);

  const days = view === "Day" ? [anchor] : weekOf(anchor);
  const weeks = monthWeeks(anchor);
  const visibleDays = view === "Month" ? weeks.flat() : days;
  const rangeStart = visibleDays[0];
  const rangeEnd = visibleDays[visibleDays.length - 1];

  const segments = useMemo(() => segmentsByDate(tasks, visibleDays), [tasks, visibleDays.join()]);
  const segmentsOn = (date: string) => segments.get(date) ?? [];

  const now = new Date();
  const { hourPx, paneRef } = useHourZoom(
    days.includes(today) ? Math.max(0, now.getHours() - 1) * 60 : DEFAULT_SCROLL_HOUR * 60,
  );

  // Column geometry, shared by the drop handlers and the resize handler: both
  // need "which minute is this Y", and both measure against the same rect.
  const minutesAtY = (clientY: number, rect: DOMRect) =>
    ((clientY - rect.top) / hourPx) * 60;

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
    const column = (event.currentTarget as HTMLElement).closest("[data-cal-date]");
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
      grab: snap(((event.clientY - rect.top) / hourPx) * 60),
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

  const title = calendarTitle(view, anchor, days);
  const unit = view === "Day" ? "day" : view === "Week" ? "week" : "month";

  const chipProps = { drag, selectTask: toggleSelect, selectedTaskId, today };

  return (
    <>
      <header className="dt-toolbar">
        <span className="dt-toolbar-title cal-title">
          {title.strong} <span className="cal-title-year">{title.light}</span>
        </span>
        {view === "Day" && (
          <span className="dt-muted toolbar-meta">
            {parseIso(anchor).toLocaleDateString(undefined, { weekday: "long" })}
          </span>
        )}
        <div className="dt-toolbar-right">
          {/* TODO(backend): real sync status from the calendar integration. */}
          <span className="dt-status dt-status-on cal-sync">Google Calendar · synced 4m ago</span>
          <button
            type="button"
            className="dt-btn dt-btn-icon"
            aria-label={`Previous ${unit}`}
            onClick={() => step(-1)}
          >
            ‹
          </button>
          <button type="button" className="dt-btn" onClick={() => setAnchor(today)}>
            Today
          </button>
          <button
            type="button"
            className="dt-btn dt-btn-icon"
            aria-label={`Next ${unit}`}
            onClick={() => step(1)}
          >
            ›
          </button>
          <Segmented options={options} value={view} onChange={setDensity} />
        </div>
      </header>

      {error && (
        <div className="dt-banner" role="alert">
          {error}
        </div>
      )}

      <div className="page-body cal-body" ref={bodyRef}>
        <aside className="dt-tray">
          <div className="dt-tray-head">
            Unscheduled{loaded && <span className="dt-count">{unscheduled.length}</span>}
          </div>
          <p className="dt-tray-hint">
            Drop on the hour grid to make time for it; on the due strip to set its due date.
          </p>
          {!loaded ? (
            <p className="dt-tray-hint">Loading tasks…</p>
          ) : unscheduled.length === 0 ? (
            <p className="dt-tray-hint">Every open task has time on the calendar.</p>
          ) : (
            unscheduled.map((task) => (
              <div
                key={task.id}
                className={drag.task?.id === task.id ? "dt-chip dt-chip-dragging" : "dt-chip"}
                data-color={listColor(task.list)}
                aria-selected={selectedTaskId === task.id}
                draggable
                onDragStart={(event) => drag.startTask(event, task)}
                onDragEnd={drag.end}
                onClick={() => toggleSelect(task.id)}
              >
                <div>
                  <div className="dt-chip-title">{task.title}</div>
                  <div className="dt-chip-meta">
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
              </div>
            ))
          )}
          <div className="dt-tray-sum">
            <div className="cal-sum-caption">This {unit}</div>
            <div>
              <span>Blocked · {rangeSegments.length}</span>
              <span>{formatMinutes(blockedMinutes)}</span>
            </div>
            <div>
              <span>Due · {dueInRange.length}</span>
              <span>{formatMinutes(sumEstimates(dueInRange))}</span>
            </div>
            <div>
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
            hourPx={hourPx}
            paneRef={paneRef}
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
            centred sheet, not a third column: the tray and the grid need the
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

/** A deadline in the due strip or a month cell. Draggable, so it can be moved
 *  to another day. */
function TaskChip({ task, drag, selectTask, selectedTaskId, today }: ChipProps & { task: Task }) {
  const done = task.status === "done";
  const overdue = !done && task.due !== undefined && task.due < today;
  return (
    <div
      className={[
        "dt-due",
        "cal-due",
        done ? "dt-due-done" : "",
        overdue ? "dt-due-overdue" : "",
        drag.task?.id === task.id ? "cal-due-dragging cal-drag-source" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-color={listColor(task.list)}
      aria-selected={selectedTaskId === task.id}
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

/** An outlined stand-in shown in whichever day the dragged task would land on. */
function DropPreview({ drag, date }: { drag: DragState; date: string }) {
  if (!drag.item) return null;
  if (drag.hoverDate !== date || drag.hoverMinutes !== null || drag.item.task.due === date) {
    return null;
  }
  return (
    <div className="dt-due cal-due-ghost" data-color={listColor(drag.item.task.list)}>
      {drag.item.task.title}
    </div>
  );
}

interface GridProps extends ChipProps {
  tasksOn: (date: string) => Task[];
  segmentsOn: (date: string) => Segment[];
}

/** Renders the grid for whichever dates it is given — seven for Week, one for Day.
 *  Deadlines go in the all-day due strip; blocks are drawn on the hour columns,
 *  which are drop targets for both a new block and a moved one. */
function WeekGrid({
  days,
  tasksOn,
  segmentsOn,
  hourPx,
  paneRef,
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
  hourPx: number;
  paneRef: (pane: HTMLDivElement | null) => void;
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
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const nowMinutes = useNowMinutes();
  const yFor = (minutes: number) => (minutes / 60) * hourPx;

  const cellClass = (base: string, date: string) =>
    [base, isWeekend(date) ? "dt-col-weekend" : "", drag.hoverDate === date ? "cal-drop-target" : ""]
      .filter(Boolean)
      .join(" ");

  return (
    <div
      className={`dt-cal cal-grid ${drag.surfaceProps.className}`.trim()}
      onDragLeave={drag.surfaceProps.onDragLeave}
      style={{ "--days": days.length, "--hour-px": `${hourPx}px` } as CSSProperties}
    >
      <div className="dt-week">
        <div />
        {days.map((date) => (
          <div
            key={date}
            className={date === today ? "dt-week-head dt-week-head-today" : "dt-week-head"}
          >
            <span className="dt-dow">{DOW[dowIndex(date)]}</span>
            <span className={date === today ? "dt-today-dot" : "dt-dnum"}>{dayOfMonth(date)}</span>
          </div>
        ))}
      </div>

      <div className="dt-week cal-allday">
        <div className="dt-allday-label">due</div>
        {days.map((date) => (
          <div key={date} className={cellClass("dt-allday-cell", date)} {...drag.dayProps(date)}>
            {tasksOn(date).map((task) => (
              <TaskChip key={task.id} task={task} {...chipProps} />
            ))}
            <DropPreview drag={drag} date={date} />
          </div>
        ))}
      </div>

      <div className="dt-week cal-cols" ref={paneRef}>
        <div className="dt-hours">
          {hours.map((hour) => (
            <div className="dt-hour" key={hour}>
              <div className="dt-gutter-label">{String(hour).padStart(2, "0")}:00</div>
            </div>
          ))}
        </div>

        {days.map((date) => (
          <div
            key={date}
            // read back by the move gesture, which hit-tests its way across columns
            data-cal-date={date}
            className={cellClass("dt-col", date)}
            {...drag.columnProps(date)}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeEnd}
            onPointerCancel={onResizeEnd}
          >
            <div className="dt-col-lines" />
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
                className="dt-event dt-event-ghost"
                data-color={listColor(drag.task.list)}
                style={{ top: yFor(drag.hoverMinutes), height: (drag.length / 60) * hourPx }}
              >
                <div className="dt-event-title">{drag.task.title}</div>
                <div className="dt-event-time">{formatMinutes(drag.length)}</div>
              </div>
            )}
            {move && move.moved && move.date === date && (
              <div
                className="dt-event dt-event-ghost"
                data-color={listColor(move.task.list)}
                style={{ top: yFor(move.start), height: (move.length / 60) * hourPx }}
              >
                <div className="dt-event-title">{move.task.title}</div>
                <div className="dt-event-time">
                  {clockOf(atMinutes(date, move.start))} – {clockOf(atMinutes(date, move.start + move.length))}
                  {move.copy ? " · copy" : ""}
                </div>
              </div>
            )}
            {date === today && <div className="dt-now" style={{ top: yFor(nowMinutes) }} />}
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
  const height = Math.max(yFor(to) - yFor(from), 12);
  // A move carries the block away, so the position it left fades; a copy leaves
  // the original exactly where it is, so it stays solid.
  const leaving = moving !== null && !moving.copy;
  const movable = seg.whole && !resizing;
  // Under half an hour the title and time share one line.
  const short = height < 30;
  const time = `${clockOf(block.startAt)} – ${clockOf(block.endAt)}`;

  return (
    <div
      className={[
        "dt-event",
        "cal-block",
        leaving ? "dt-event-moving" : "",
        moving ? "cal-block-moving" : "",
        seg.lanes > 1 ? "cal-block-narrow" : "",
        short ? "dt-event-short" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-color={listColor(task.list)}
      aria-selected={selectedTaskId === task.id}
      style={{
        top: yFor(from),
        height,
        left: `calc(2px + ${(seg.lane / seg.lanes) * 100}%)`,
        width: `calc(${(1 / seg.lanes) * 100}% - 5px)`,
      }}
      title={`${task.title} · ${time}`}
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
      <div className="dt-event-title">
        {task.title}
        {short ? ` · ${clockOf(block.startAt)}` : ""}
      </div>
      {!short && height > 34 && <div className="dt-event-time">{time}</div>}
      {seg.whole && (
        <>
          <button
            type="button"
            className="dt-event-x"
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

/** The month view. Each cell lists its deadlines, then its blocks as dot lines;
 *  the bar under the date is that day's open estimates against an eight-hour
 *  ceiling. */
function MonthGrid({
  anchor,
  weeks,
  tasksOn,
  segmentsOn,
  ...chipProps
}: GridProps & { anchor: string; weeks: string[][] }) {
  const { drag, today, selectTask } = chipProps;
  const month = parseIso(anchor).getMonth();

  return (
    <div
      className={`dt-cal cal-month ${drag.surfaceProps.className}`.trim()}
      onDragLeave={drag.surfaceProps.onDragLeave}
    >
      <div className="dt-month">
        {DOW.map((day) => (
          <div className="dt-month-dow" key={day}>
            {day}
          </div>
        ))}
        {weeks.flat().map((date) => {
          const dayTasks = tasksOn(date);
          const daySegments = segmentsOn(date);
          const load =
            dayTasks
              .filter((task) => task.status !== "done")
              .reduce((sum, task) => sum + (task.estimateMinutes ?? 0), 0) / DAY_CAPACITY_MINUTES;
          const shownTasks = dayTasks.slice(0, MONTH_CHIP_LIMIT);
          const shownSegments = daySegments.slice(0, Math.max(0, MONTH_CHIP_LIMIT - shownTasks.length));
          const hidden = dayTasks.length + daySegments.length - shownTasks.length - shownSegments.length;
          return (
            <div
              key={date}
              className={[
                "dt-month-cell",
                isWeekend(date) ? "dt-month-cell-weekend" : "",
                parseIso(date).getMonth() !== month ? "dt-month-cell-outside" : "",
                drag.hoverDate === date ? "cal-drop-target" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              {...drag.dayProps(date)}
            >
              <span className={date === today ? "dt-mday dt-today-dot" : "dt-mday"}>
                {dayOfMonth(date)}
              </span>
              {load > 0 && (
                <div className={load >= 1 ? "dt-load dt-load-full" : "dt-load"}>
                  <i style={{ width: `${Math.min(1, load) * 100}%` }} />
                </div>
              )}
              {shownTasks.map((task) => (
                <TaskChip key={task.id} task={task} {...chipProps} />
              ))}
              {shownSegments.map((seg) => (
                <div
                  key={`${seg.block.id}-${seg.date}`}
                  className="dt-mline cal-mline"
                  data-color={listColor(seg.task.list)}
                  onClick={() => selectTask(seg.task.id)}
                >
                  <span>{seg.task.title}</span>
                  <span className="dt-mtime">{clockOf(seg.block.startAt)}</span>
                </div>
              ))}
              {hidden > 0 && <div className="dt-mmore">{hidden} more</div>}
              <DropPreview drag={drag} date={date} />
            </div>
          );
        })}
      </div>
      <p className="cal-month-note">
        The bar under each date is that day's open estimates against an eight-hour ceiling.{" "}
        <Kbd>2</Kbd> returns to the week.
      </p>
    </div>
  );
}
