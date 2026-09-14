/** Screen 1b — week view with the unscheduled tray. Variation 2b — month density.
 *  Below NARROW_QUERY the seven columns get too thin to read, so Week falls back to
 *  a single-day grid and the density switch offers only Day and Month.
 *
 *  Everything here is real tasks. A task's `due` is a date with no time, so a
 *  scheduled task sits in the all-day strip of its day (or its month cell), not on
 *  the hour grid. Dragging a tray chip — or a scheduled chip — onto a day sets its
 *  `due` through `updateTask`. The hour grid stays empty until tasks carry a start
 *  time and external calendars are imported. */

import type { CSSProperties, DragEvent } from "react";
import { useEffect, useState } from "react";
import { useApp } from "../data/store";
import type { Task } from "../types";
import { Kbd, Segmented, formatMinutes } from "../components/primitives";

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

// ── drag ─────────────────────────────────────────────────────────────

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
  dragging: Task | null;
  hoverDate: string | null;
  start: (event: DragEvent, task: Task) => void;
  end: () => void;
  targetProps: (date: string) => {
    onDragOver: (event: DragEvent) => void;
    onDragLeave: (event: DragEvent) => void;
    onDrop: (event: DragEvent) => void;
  };
}

function useTaskDrag(onDropOnDate: (task: Task, date: string) => void): DragState {
  const [dragging, setDragging] = useState<Task | null>(null);
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const end = () => {
    setDragging(null);
    setHoverDate(null);
  };
  return {
    dragging,
    hoverDate,
    start: (event, task) => {
      setChipDragImage(event, task);
      setDragging(task);
    },
    end,
    targetProps: (date) => ({
      onDragOver: (event) => {
        if (!dragging) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        if (hoverDate !== date) setHoverDate(date);
      },
      onDragLeave: (event) => {
        // ignore leaves into a child of the same target
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setHoverDate((current) => (current === date ? null : current));
      },
      onDrop: (event) => {
        event.preventDefault();
        if (dragging && dragging.due !== date) onDropOnDate(dragging, date);
        end();
      },
    }),
  };
}

// ── page ─────────────────────────────────────────────────────────────

export function CalendarPage() {
  const { tasks, loaded, error, today, selectTask, selectedTaskId, updateTask } = useApp();
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

  const drag = useTaskDrag((task, date) => updateTask(task.id, { due: date }));

  const days = view === "Day" ? [anchor] : weekOf(anchor);
  const weeks = monthWeeks(anchor);
  const rangeStart = view === "Month" ? weeks[0][0] : days[0];
  const rangeEnd = view === "Month" ? weeks[weeks.length - 1][6] : days[days.length - 1];

  const byDate = new Map<string, Task[]>();
  for (const task of tasks) {
    if (!task.due) continue;
    const bucket = byDate.get(task.due);
    if (bucket) bucket.push(task);
    else byDate.set(task.due, [task]);
  }
  const tasksOn = (date: string) => byDate.get(date) ?? [];

  const unscheduled = tasks.filter((task) => task.status !== "done" && !task.due);
  const scheduledInRange = tasks.filter(
    (task) =>
      task.status !== "done" && task.due && task.due >= rangeStart && task.due <= rangeEnd,
  );
  const sumEstimates = (list: Task[]) =>
    list.reduce((sum, task) => sum + (task.estimateMinutes ?? 0), 0);

  const title =
    view === "Day"
      ? `${DOW[dowIndex(anchor)].slice(0, 1)}${DOW[dowIndex(anchor)].slice(1).toLowerCase()} ${dayOfMonth(anchor)} ${monthName(anchor)}`
      : view === "Week"
        ? weekTitle(days)
        : `${monthName(anchor)} ${parseIso(anchor).getFullYear()}`;
  const unit = view === "Day" ? "day" : view === "Week" ? "week" : "month";

  const chipProps = { drag, selectTask, selectedTaskId, today };

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
            Drag onto a day to schedule it.
          </p>
          {!loaded ? (
            <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
              Loading tasks…
            </p>
          ) : unscheduled.length === 0 ? (
            <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
              Every open task has a date.
            </p>
          ) : (
            unscheduled.map((task) => (
              <div
                key={task.id}
                className={[
                  "chip",
                  drag.dragging?.id === task.id ? "chip-dragging" : "",
                  selectedTaskId === task.id ? "chip-selected" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                draggable
                onDragStart={(event) => drag.start(event, task)}
                onDragEnd={drag.end}
                onClick={() => selectTask(task.id)}
              >
                {task.title}
                <div className="text-muted" style={{ fontSize: 11 }}>
                  {drag.dragging?.id === task.id
                    ? "dragging…"
                    : [formatMinutes(task.estimateMinutes), task.list].filter(Boolean).join(" · ")}
                </div>
              </div>
            ))
          )}
          <div style={{ marginTop: "auto", paddingTop: 12, borderTop: "2px solid var(--color-divider)" }}>
            <div className="text-muted" style={{ fontSize: 11, marginBottom: 6 }}>
              This {unit}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span>Scheduled · {scheduledInRange.length}</span>
              <span>{formatMinutes(sumEstimates(scheduledInRange))}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span>Unscheduled · {unscheduled.length}</span>
              <span style={{ color: "var(--color-accent-700)" }}>
                {formatMinutes(sumEstimates(unscheduled))}
              </span>
            </div>
          </div>
        </aside>

        {view === "Month" ? (
          <MonthGrid anchor={anchor} weeks={weeks} tasksOn={tasksOn} {...chipProps} />
        ) : (
          <WeekGrid days={days} tasksOn={tasksOn} {...chipProps} />
        )}
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
        drag.dragging?.id === task.id ? "cal-task-chip-dragging" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      title={
        task.estimateMinutes !== undefined
          ? `${task.title} · ${formatMinutes(task.estimateMinutes)}`
          : task.title
      }
      draggable={!done}
      onDragStart={(event) => drag.start(event, task)}
      onDragEnd={drag.end}
      onClick={() => selectTask(task.id)}
    >
      {task.title}
    </div>
  );
}

/** A dashed stand-in shown in whichever day the dragged task would land on. */
function DropPreview({ drag, date }: { drag: DragState; date: string }) {
  if (!drag.dragging || drag.hoverDate !== date || drag.dragging.due === date) return null;
  return <div className="month-chip cal-task-chip cal-task-chip-preview">{drag.dragging.title}</div>;
}

/** The grid runs 09:00–16:00 at 88px an hour, as in the mockup. */
const START_HOUR = 9;
const END_HOUR = 16;
const HOUR_PX = 88;

const yFor = (minutes: number) => ((minutes - START_HOUR * 60) / 60) * HOUR_PX;

/** Renders the grid for whichever dates it is given — seven for Week, one for Day.
 *  Tasks go in the all-day strip; the hour columns are drop targets too. */
function WeekGrid({
  days,
  tasksOn,
  ...chipProps
}: ChipProps & { days: string[]; tasksOn: (date: string) => Task[] }) {
  const { drag, today } = chipProps;
  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);
  const nowMinutes = useNowMinutes();
  const showNow = nowMinutes >= START_HOUR * 60 && nowMinutes <= END_HOUR * 60;

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
    <div className="cal-grid" style={{ "--cal-days": days.length } as CSSProperties}>
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
          <div key={date} className={cellClass("cal-allday-cell", date)} {...drag.targetProps(date)}>
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
          <div key={date} className={cellClass("cal-col", date)} {...drag.targetProps(date)}>
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

/** Variation 2b — month grid. The bar under each date is that day's open
 *  estimates against an eight-hour ceiling. */
function MonthGrid({
  anchor,
  weeks,
  tasksOn,
  ...chipProps
}: ChipProps & { anchor: string; weeks: string[][]; tasksOn: (date: string) => Task[] }) {
  const { drag, today } = chipProps;
  const month = parseIso(anchor).getMonth();

  return (
    <div style={{ flex: 1, minWidth: 0, padding: "20px 24px", overflowY: "auto" }}>
      <div className="month">
        {DOW.map((day) => (
          <div className="month-dow" key={day}>
            {day.slice(0, 1) + day.slice(1).toLowerCase()}
          </div>
        ))}
        {weeks.flat().map((date) => {
          const dayTasks = tasksOn(date);
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
              {...drag.targetProps(date)}
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
        The bar under each date is that day's open estimates against an eight-hour ceiling.{" "}
        <Kbd>2</Kbd> returns to the week.
      </p>
    </div>
  );
}
