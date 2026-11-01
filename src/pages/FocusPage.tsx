/** Focus — a ring timer on the selected task, with today's sessions beside it.
 *  Sessions live in the backend (`focus.rs`), which stores instants and rings
 *  the alarm, so the timer survives page switches, restarts and suspend; this
 *  page only counts down to the session's `endsAt`. */

import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../data/store";
import { listColor } from "../data/scope";
import { clockOf } from "../data/instants";
import { minutesFor, nextKind, plannedSessions } from "../data/focusplan";
import type { FocusKind } from "../types";
import { CheckBox, Kbd, Segmented, dueLabel, formatMinutes } from "../components/primitives";
import { FocusIcon } from "../components/icons";

const KIND_LABELS: Record<FocusKind, string> = {
  work: "Focus",
  "short-break": "Short break",
  "long-break": "Long break",
};
const KINDS = Object.keys(KIND_LABELS) as FocusKind[];

/** The ring's radius in its 240px box; the arc's dash is a share of this circumference. */
const RING_RADIUS = 112;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function FocusPage() {
  const {
    tasks,
    selectedTaskId,
    selectTask,
    toggleTask,
    setPage,
    today,
    focus,
    focusDay,
    focusPrefs: prefs,
    startFocus,
    pauseFocus,
    resumeFocus,
    finishFocus,
    logInterruption,
  } = useApp();
  // A running session keeps its own task, even one marked done elsewhere.
  const task =
    (focus?.taskId ? tasks.find((t) => t.id === focus.taskId) : undefined) ??
    tasks.find((t) => t.id === selectedTaskId && t.status !== "done") ??
    tasks.find((t) => t.status !== "done");

  // While idle the user may override the suggested next session.
  const [picked, setPicked] = useState<FocusKind | null>(null);
  const kind = focus?.kind ?? picked ?? nextKind(focusDay, prefs);
  const running = Boolean(focus?.endsAt);

  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!focus?.endsAt) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [focus?.endsAt]);

  const planned = focus ? focus.plannedSeconds : minutesFor(kind, prefs) * 60;
  const remaining = !focus
    ? planned
    : focus.endsAt
      ? Math.max(0, Math.round((Date.parse(focus.endsAt) - now) / 1000))
      : focus.remainingSeconds;
  const progress = Math.min(100, ((planned - remaining) / planned) * 100);
  const clock = `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;

  const done = focusDay?.pomodoros ?? 0;
  const sessions = plannedSessions(prefs);
  // The day's total was read with the open session's elapsed time at that
  // moment; swap that for the live figure.
  const focusedSeconds =
    (focusDay?.focusedSeconds ?? 0) +
    (focus?.kind === "work" ? planned - remaining - focus.elapsedSeconds : 0);

  const start = () => {
    setPicked(null);
    void startFocus(kind, kind === "work" ? task?.id : undefined);
  };
  const toggle = () => {
    if (!focus) start();
    else if (running) void pauseFocus();
    else void resumeFocus();
  };
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;

  const [interruption, setInterruption] = useState("");
  const interruptRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (event.code === "Space") {
        event.preventDefault();
        toggleRef.current();
      } else if (event.key === "i" && interruptRef.current && !interruptRef.current.disabled) {
        event.preventDefault();
        interruptRef.current.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const upNext = useMemo(
    () => tasks.filter((t) => t.status !== "done" && t.id !== task?.id).slice(0, 3),
    [tasks, task],
  );

  if (!task && !focus) {
    return (
      <>
        <header className="dt-toolbar">
          <span className="dt-toolbar-title">Focus</span>
        </header>
        <div className="dt-empty page-fill">
          <div className="dt-empty-icon">
            <FocusIcon size={30} />
          </div>
          <h2>Nothing to focus on.</h2>
          <p>Pick a task from the list first.</p>
          <button type="button" className="dt-btn dt-btn-primary" onClick={() => setPage("tasks")}>
            Open tasks
          </button>
        </div>
      </>
    );
  }

  const color = listColor(task?.list);
  const isWork = kind === "work";
  const kicker = isWork
    ? `WORKING ON · SESSION ${done + 1} OF ${sessions}`
    : `${KIND_LABELS[kind].toUpperCase()} · THEN`;

  return (
    <>
      <header className="dt-toolbar">
        <span className="dt-toolbar-title">Focus</span>
        <span className="dt-muted toolbar-meta">
          Session {done + 1} of {sessions} · {prefs.workMinutes}/{prefs.shortBreakMinutes}
        </span>
      </header>

      <div className="page-body">
        <div className="focus-main">
          <section className="dt-focus" data-color={color}>
            <div className="dt-focus-kicker">{kicker}</div>
            <h2 className="dt-focus-task">{task?.title ?? "No task"}</h2>
            {task && (
              <p className="dt-focus-meta">
                {task.list ?? "Inbox"} · due {dueLabel(task.due, today).toLowerCase()}
                {task.pomodoros ? ` · ${task.pomodoros} pomodoros estimated` : ""}
              </p>
            )}

            {!focus && (
              <Segmented
                options={KINDS.map((k) => KIND_LABELS[k])}
                value={KIND_LABELS[kind]}
                onChange={(label) => setPicked(KINDS.find((k) => KIND_LABELS[k] === label) ?? null)}
              />
            )}

            <div
              className={running ? "dt-ring" : "dt-ring dt-ring-paused"}
              role="timer"
              aria-label={`${Math.floor(remaining / 60)} minutes ${remaining % 60} seconds left`}
            >
              <svg width="240" height="240" viewBox="0 0 240 240" aria-hidden="true">
                <circle className="dt-ring-track" cx="120" cy="120" r={RING_RADIUS} />
                <circle
                  className="dt-ring-fill"
                  cx="120"
                  cy="120"
                  r={RING_RADIUS}
                  strokeDasharray={`${(RING_CIRCUMFERENCE * progress) / 100} ${RING_CIRCUMFERENCE}`}
                />
              </svg>
              <div className="dt-ring-center">
                <div className="dt-timer">{clock}</div>
                <div className="dt-timer-sub">
                  of {Math.round(planned / 60)}:00{focus && !running ? " · paused" : ""}
                </div>
              </div>
            </div>

            {focus && (
              <div className="dt-focus-times">
                <span>Started {clockOf(focus.startedAt)}</span>
                {focus.endsAt ? (
                  <span>
                    {isWork ? "Break" : "Back"} at {clockOf(focus.endsAt)}
                  </span>
                ) : (
                  focus.pausedAt && <span>Paused at {clockOf(focus.pausedAt)}</span>
                )}
              </div>
            )}

            <div className="dt-focus-actions">
              {focus && (
                <button
                  type="button"
                  className="dt-btn dt-btn-lg"
                  onClick={async () => {
                    await finishFocus("skipped");
                    if (isWork) await startFocus("short-break");
                  }}
                >
                  {isWork ? "Skip to break" : "Skip break"}
                </button>
              )}
              <button type="button" className="dt-btn dt-btn-primary dt-btn-round" onClick={toggle}>
                {!focus ? "Start" : running ? "Pause" : "Resume"}
              </button>
              {task && (
                <button
                  type="button"
                  className="dt-btn dt-btn-plain dt-btn-lg"
                  onClick={() => {
                    toggleTask(task.id);
                    // The task is finished, so the pomodoro served its purpose.
                    if (focus?.taskId === task.id) void finishFocus("completed");
                  }}
                >
                  Mark done
                </button>
              )}
            </div>
            <div className="dt-muted focus-hint">
              <Kbd>Space</Kbd> {focus ? "pause / resume" : "start"}
            </div>
          </section>
        </div>

        <aside className="dt-panel" data-color={color}>
          <div>
            <div className="dt-panel-head">TODAY'S SESSIONS</div>
            <div className="dt-pips">
              {Array.from({ length: Math.max(sessions, done + 1) }, (_, index) => (
                <span
                  key={index}
                  className={[
                    "dt-pip",
                    index < done ? "dt-pip-done" : "",
                    index === done && focus?.kind === "work" ? "dt-pip-active" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                />
              ))}
            </div>
            <p className="dt-panel-note">
              {formatMinutes(Math.floor(focusedSeconds / 60))} focused · goal{" "}
              {formatMinutes(prefs.dailyGoalMinutes)}
            </p>
          </div>

          {upNext.length > 0 && (
            <div>
              <div className="dt-panel-head">UP NEXT</div>
              <div className="dt-group">
                {upNext.map((next) => (
                  <div
                    className="dt-row"
                    data-color={listColor(next.list)}
                    key={next.id}
                    onClick={() => selectTask(next.id)}
                  >
                    <CheckBox label={next.title} onToggle={() => toggleTask(next.id)} />
                    <div className="dt-row-body">
                      <span className="dt-row-title">{next.title}</span>
                    </div>
                    {next.estimateMinutes !== undefined && (
                      <span className="dt-row-trailing">{formatMinutes(next.estimateMinutes)}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="dt-panel-head">INTERRUPTIONS</div>
            <form
              className="focus-interrupt"
              onSubmit={(event) => {
                event.preventDefault();
                if (!interruption.trim()) return;
                void logInterruption(interruption.trim());
                setInterruption("");
                interruptRef.current?.blur();
              }}
            >
              <input
                ref={interruptRef}
                className="dt-input"
                placeholder={focus ? "Note a distraction…" : "Start a session to log distractions"}
                aria-label="Note a distraction"
                disabled={!focus}
                value={interruption}
                onChange={(event) => setInterruption(event.currentTarget.value)}
              />
              <Kbd>I</Kbd>
            </form>
            {focus && focus.interruptions.length > 0 && (
              <ul className="dt-log">
                {focus.interruptions.map((note) => (
                  <li key={note.id}>
                    {clockOf(note.at)} · {note.note}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button type="button" className="dt-btn focus-settings" onClick={() => setPage("settings")}>
            Session settings
          </button>
        </aside>
      </div>
    </>
  );
}
