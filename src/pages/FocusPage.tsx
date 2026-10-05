/** Focus — a ring timer on the selected task, with today's sessions beside it.
 *  The timer ticks locally; persistence and OS-level "do not disturb" are
 *  backend work. */

import { useEffect, useMemo, useState } from "react";
import { useApp } from "../data/store";
import { listColor } from "../data/scope";
import { CheckBox, Kbd, dueLabel, formatMinutes } from "../components/primitives";
import { FocusIcon } from "../components/icons";

const WORK_MINUTES = 25;
const PLANNED_SESSIONS = 4;
const COMPLETED_TODAY = 2;
const GOAL_MINUTES = 180;

/** The ring's radius in its 240px box; the arc's dash is a share of this circumference. */
const RING_RADIUS = 112;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function FocusPage() {
  const { tasks, selectedTaskId, selectTask, toggleTask, setPage, today } = useApp();
  const task =
    tasks.find((t) => t.id === selectedTaskId && t.status !== "done") ??
    tasks.find((t) => t.status !== "done");

  const [remaining, setRemaining] = useState(17 * 60 + 42);
  const [running, setRunning] = useState(true);
  const [interruption, setInterruption] = useState("");
  const [interruptions, setInterruptions] = useState<string[]>([]);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      setRemaining((seconds) => (seconds > 0 ? seconds - 1 : 0));
    }, 1000);
    return () => window.clearInterval(id);
  }, [running]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (event.code === "Space") {
        event.preventDefault();
        setRunning((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const elapsed = WORK_MINUTES * 60 - remaining;
  const progress = Math.min(100, (elapsed / (WORK_MINUTES * 60)) * 100);
  const clock = `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;

  const upNext = useMemo(
    () => tasks.filter((t) => t.status !== "done" && t.id !== task?.id).slice(0, 3),
    [tasks, task],
  );

  if (!task) {
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

  const color = listColor(task.list);

  return (
    <>
      <header className="dt-toolbar">
        <span className="dt-toolbar-title">Focus</span>
        <span className="dt-muted toolbar-meta">
          Session {COMPLETED_TODAY + 1} of {PLANNED_SESSIONS} · {WORK_MINUTES}/5
        </span>
        {/* TODO(backend): actually mute notifications through the OS. */}
        <div className="dt-toolbar-right">
          <span className="dt-tag dt-tag-accent">Notifications muted</span>
        </div>
      </header>

      <div className="page-body">
        <div className="focus-main">
          <section className="dt-focus" data-color={color}>
            <div className="dt-focus-kicker">
              WORKING ON · SESSION {COMPLETED_TODAY + 1} OF {PLANNED_SESSIONS}
            </div>
            <h2 className="dt-focus-task">{task.title}</h2>
            <p className="dt-focus-meta">
              {task.list ?? "Inbox"} · due {dueLabel(task.due, today).toLowerCase()}
              {task.pomodoros ? ` · ${task.pomodoros} pomodoros estimated` : ""}
            </p>

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
                  of {WORK_MINUTES}:00{running ? "" : " · paused"}
                </div>
              </div>
            </div>

            <div className="dt-focus-times">
              <span>Started 13:58</span>
              <span>Break at 14:23</span>
            </div>

            <div className="dt-focus-actions">
              <button type="button" className="dt-btn dt-btn-lg" onClick={() => setRemaining(5 * 60)}>
                Skip to break
              </button>
              <button
                type="button"
                className="dt-btn dt-btn-primary dt-btn-round"
                onClick={() => setRunning((value) => !value)}
              >
                {running ? "Pause" : "Resume"}
              </button>
              <button
                type="button"
                className="dt-btn dt-btn-plain dt-btn-lg"
                onClick={() => {
                  toggleTask(task.id);
                  setRunning(false);
                }}
              >
                Mark done
              </button>
            </div>
            <div className="dt-muted focus-hint">
              <Kbd>Space</Kbd> pause / resume
            </div>
          </section>
        </div>

        <aside className="dt-panel" data-color={color}>
          <div>
            <div className="dt-panel-head">TODAY'S SESSIONS</div>
            <div className="dt-pips">
              {Array.from({ length: 6 }, (_, index) => (
                <span
                  key={index}
                  className={[
                    "dt-pip",
                    index < COMPLETED_TODAY ? "dt-pip-done" : "",
                    index === COMPLETED_TODAY ? "dt-pip-active" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                />
              ))}
            </div>
            <p className="dt-panel-note">
              {formatMinutes(COMPLETED_TODAY * WORK_MINUTES + Math.floor(elapsed / 60))} focused ·
              goal {formatMinutes(GOAL_MINUTES)}
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
                setInterruptions((current) => [...current, interruption.trim()]);
                setInterruption("");
              }}
            >
              <input
                className="dt-input"
                placeholder="Note a distraction…"
                aria-label="Note a distraction"
                value={interruption}
                onChange={(event) => setInterruption(event.currentTarget.value)}
              />
              <Kbd>I</Kbd>
            </form>
            {interruptions.length > 0 && (
              <ul className="dt-log">
                {interruptions.map((note, index) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
            )}
          </div>

          <button type="button" className="dt-btn focus-settings">
            Session settings
          </button>
        </aside>
      </div>
    </>
  );
}
