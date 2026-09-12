/** Screen 1b — week view with the unscheduled tray. Variation 2b — month density.
 *  Drag-and-drop is stubbed: the tray items are draggable and the grid accepts a
 *  drop, but nothing is persisted yet. */

import type { DragEvent } from "react";
import { useState } from "react";
import { useApp } from "../data/store";
import { events, todayColumn } from "../data/mock";
import type { CalendarEvent } from "../types";
import { Kbd, Segmented, formatClock, formatMinutes } from "../components/primitives";

const DENSITIES = ["Day", "Week", "Month"] as const;
type Density = (typeof DENSITIES)[number];

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const DATES = [10, 11, 12, 13, 14, 15, 16];

/** The grid runs 09:00–16:00 at 88px an hour, as in the mockup. */
const START_HOUR = 9;
const END_HOUR = 16;
const HOUR_PX = 88;
const NOW_MINUTES = 12 * 60 + 55;

const yFor = (minutes: number) => ((minutes - START_HOUR * 60) / 60) * HOUR_PX;

/** Ghost blocks are as tall as the estimate, floored so short tasks stay legible. */
const heightFor = (minutes: number | undefined) =>
  Math.max(24, ((minutes ?? 30) / 60) * HOUR_PX);

/** The tray chip is 236px wide — the width of the sidebar — so the browser's default
 *  drag image dwarfs the day column it is dropped into. Render a column-sized proxy
 *  instead and hand that to setDragImage. */
function setChipDragImage(event: DragEvent, title: string, estimate?: number) {
  const proxy = document.createElement("div");
  proxy.className = "cal-event cal-event-ghost cal-drag-proxy";
  proxy.style.height = `${heightFor(estimate)}px`;
  proxy.textContent = title;
  document.body.appendChild(proxy);
  event.dataTransfer.setDragImage(proxy, 8, 8);
  // the proxy only needs to survive the snapshot the browser takes this frame
  window.setTimeout(() => proxy.remove(), 0);
}

export function CalendarPage() {
  const { tasks, selectTask } = useApp();
  const [density, setDensity] = useState<Density>("Week");
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{ day: number; minutes: number } | null>(null);

  // The tray holds real open tasks that have no date on them yet; the grid
  // itself is still mock data until calendar commands exist.
  const unscheduled = tasks.filter((task) => task.status !== "done" && !task.due);

  const committedMinutes = events
    .filter((event) => !event.ghost)
    .reduce((sum, event) => sum + event.durationMinutes, 0);
  const unscheduledMinutes = unscheduled.reduce(
    (sum, task) => sum + (task.estimateMinutes ?? 0),
    0,
  );

  return (
    <>
      <header className="topbar">
        <h4>10 – 16 August</h4>
        <div style={{ display: "flex", gap: 4 }}>
          <button type="button" className="btn btn-secondary btn-icon" aria-label="Previous week">
            ‹
          </button>
          <button type="button" className="btn btn-secondary btn-icon" aria-label="Next week">
            ›
          </button>
          <button type="button" className="btn btn-secondary">
            Today
          </button>
        </div>
        <div className="topbar-right">
          {/* TODO(backend): real sync status from the calendar integration. */}
          <span className="tag tag-neutral meta">Google Calendar synced 4m ago</span>
          <Segmented options={DENSITIES} value={density} onChange={setDensity} />
        </div>
      </header>

      <div className="body">
        <aside className="cal-side">
          <h6 style={{ margin: 0, color: "var(--color-neutral-700)" }}>Unscheduled</h6>
          <p className="text-muted" style={{ fontSize: 11, margin: 0 }}>
            Drag onto the grid to block time.
          </p>
          {unscheduled.map((task) => (
            <div
              key={task.id}
              className={`chip${dragging === task.id ? " chip-dragging" : ""}`}
              draggable
              onDragStart={(event) => {
                setChipDragImage(event, task.title, task.estimateMinutes);
                setDragging(task.id);
              }}
              onDragEnd={() => {
                setDragging(null);
                setDropHint(null);
              }}
              onClick={() => selectTask(task.id)}
            >
              {task.title}
              <div className="text-muted" style={{ fontSize: 11 }}>
                {dragging === task.id ? "dragging…" : formatMinutes(task.estimateMinutes)}
              </div>
            </div>
          ))}
          <div style={{ marginTop: "auto", paddingTop: 12, borderTop: "2px solid var(--color-divider)" }}>
            <div className="text-muted" style={{ fontSize: 11, marginBottom: 6 }}>
              This week
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span>Committed</span>
              <span>{formatMinutes(committedMinutes)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span>Unscheduled</span>
              <span style={{ color: "var(--color-accent-700)" }}>
                {formatMinutes(unscheduledMinutes)}
              </span>
            </div>
          </div>
        </aside>

        {density === "Month" ? (
          <MonthGrid />
        ) : (
          <WeekGrid
            dropHint={dropHint}
            onHover={setDropHint}
            onDrop={() => {
              // TODO(backend): invoke("schedule_task", { id, start }) then refetch.
              setDragging(null);
              setDropHint(null);
            }}
            draggingTitle={
              dragging ? (tasks.find((t) => t.id === dragging)?.title ?? null) : null
            }
            draggingEstimate={
              dragging
                ? (tasks.find((t) => t.id === dragging)?.estimateMinutes ?? null)
                : null
            }
          />
        )}
      </div>
    </>
  );
}

function WeekGrid({
  dropHint,
  onHover,
  onDrop,
  draggingTitle,
  draggingEstimate,
}: {
  dropHint: { day: number; minutes: number } | null;
  onHover: (hint: { day: number; minutes: number } | null) => void;
  onDrop: () => void;
  draggingTitle: string | null;
  draggingEstimate: number | null;
}) {
  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);

  return (
    <div className="cal-grid">
      <div className="cal-head">
        <div />
        {DAYS.map((day, index) => (
          <div
            key={day}
            className={`cal-head-cell${index === todayColumn ? " cal-today" : ""}`}
          >
            <div className="cal-head-dow text-muted">{day}</div>
            <div
              className="cal-head-day"
              style={index > 4 ? { color: "var(--color-neutral-600)" } : undefined}
            >
              {DATES[index]}
            </div>
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

        {DAYS.map((day, dayIndex) => (
          <div
            key={day}
            className={[
              "cal-col",
              dayIndex > 4 ? "cal-col-weekend" : "",
              dayIndex === todayColumn ? "cal-col-today" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onDragOver={(event) => {
              event.preventDefault();
              const bounds = event.currentTarget.getBoundingClientRect();
              const offset = event.clientY - bounds.top;
              // snap to the nearest 15 minutes
              const minutes =
                START_HOUR * 60 + Math.round((offset / HOUR_PX) * 4) * 15;
              onHover({ day: dayIndex, minutes });
            }}
            onDrop={(event) => {
              event.preventDefault();
              onDrop();
            }}
          >
            {events
              .filter((event) => event.dayIndex === dayIndex)
              .map((event) => (
                <EventBlock key={event.id} event={event} />
              ))}

            {draggingTitle && dropHint?.day === dayIndex && (
              <div
                className="cal-event cal-event-ghost"
                style={{
                  top: yFor(dropHint.minutes),
                  height: heightFor(draggingEstimate ?? undefined),
                }}
              >
                {draggingTitle}
                <div className="cal-event-sub">{formatClock(dropHint.minutes)}</div>
              </div>
            )}

            {dayIndex === todayColumn && (
              <>
                <div className="cal-now" style={{ top: yFor(NOW_MINUTES) }} />
                <div className="cal-now-dot" style={{ top: yFor(NOW_MINUTES), left: 0 }} />
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function EventBlock({ event }: { event: CalendarEvent }) {
  const classes = ["cal-event"];
  if (event.kind === "task") classes.push("cal-event-task");
  if (event.ghost) classes.push("cal-event-ghost");
  return (
    <div
      className={classes.join(" ")}
      style={{
        top: yFor(event.startMinutes),
        height: (event.durationMinutes / 60) * HOUR_PX,
      }}
      title={event.title}
    >
      {event.title}
      {event.subtitle && <div className="cal-event-sub text-muted">{event.subtitle}</div>}
    </div>
  );
}

/** Variation 2b — month grid. The bar under each date is that day's committed
 *  time against an eight-hour ceiling. */
function MonthGrid() {
  const weeks = [
    [10, 11, 12, 13, 14, 15, 16],
    [17, 18, 19, 20, 21, 22, 23],
  ];
  const load: Record<number, number> = { 10: 0.4, 11: 0.7, 12: 0.4, 13: 0.3, 14: 1, 17: 0.3, 19: 0.4 };
  const chips: Record<number, { label: string; task?: boolean }[]> = {
    10: [{ label: "Standup" }],
    11: [{ label: "Migration plan" }, { label: "Standup" }],
    12: [{ label: "Design review" }],
    14: [{ label: "Budget draft", task: true }, { label: "Design review" }],
    17: [{ label: "PR #2841" }],
    19: [{ label: "Retro" }],
  };

  return (
    <div style={{ flex: 1, minWidth: 0, padding: "20px 24px", overflowY: "auto" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14 }}>
        <h4 style={{ margin: 0 }}>August 2026</h4>
      </div>
      <div className="month">
        {DAYS.map((day) => (
          <div className="month-dow" key={day}>
            {day.slice(0, 1) + day.slice(1).toLowerCase()}
          </div>
        ))}
        {weeks.flat().map((date, index) => {
          const weekend = index % 7 > 4;
          const amount = load[date] ?? 0;
          return (
            <div
              key={date}
              className={[
                "month-cell",
                weekend ? "month-cell-weekend" : "",
                date === 14 ? "month-cell-today" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <div
                className={date === 14 ? undefined : "text-muted"}
                style={
                  date === 14
                    ? { fontSize: 12, color: "var(--color-accent-700)", fontWeight: 600 }
                    : { fontSize: 12 }
                }
              >
                {date}
              </div>
              {amount > 0 && (
                <div
                  className={`month-load${amount >= 1 ? " month-load-full" : amount >= 0.6 ? " month-load-half" : ""}`}
                />
              )}
              {(chips[date] ?? []).map((chip) => (
                <div
                  key={chip.label}
                  className={`month-chip${chip.task ? " month-chip-task" : ""}`}
                >
                  {chip.label}
                </div>
              ))}
              {date === 14 && (
                <div className="text-muted" style={{ fontSize: 10 }}>
                  +3 more
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-muted" style={{ fontSize: 11, marginTop: 8 }}>
        The bar under each date is that day's committed time against an eight-hour ceiling.{" "}
        <Kbd>2</Kbd> returns to the week.
      </p>
    </div>
  );
}
