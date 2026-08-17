/** Screen 1c — pomodoro running on the selected task.
 *  The timer ticks locally; persistence and OS-level "do not disturb" are
 *  backend work. */

import { useEffect, useMemo, useState } from "react";
import { useApp } from "../data/store";
import { CheckBox, Kbd, Rule, formatMinutes } from "../components/primitives";

const WORK_MINUTES = 25;
const PLANNED_SESSIONS = 4;
const COMPLETED_TODAY = 2;
const GOAL_MINUTES = 180;

export function FocusPage() {
  const { tasks, selectedTaskId, selectTask, toggleTask, setPage } = useApp();
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
        <header className="topbar">
          <h4>Focus</h4>
        </header>
        <div className="empty">
          <div className="empty-inner">
            <div className="empty-mark" />
            <h2 style={{ margin: "0 0 10px" }}>Nothing to focus on.</h2>
            <p className="text-muted">Pick a task from the list first.</p>
            <button type="button" className="btn btn-primary" onClick={() => setPage("tasks")}>
              Open tasks
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <header className="topbar">
        <h4>Focus</h4>
        <span className="text-muted meta" style={{ fontSize: 13 }}>
          Session {COMPLETED_TODAY + 1} of {PLANNED_SESSIONS} · {WORK_MINUTES}/5
        </span>
        {/* TODO(backend): actually mute notifications through the OS. */}
        <span className="tag tag-accent" style={{ marginLeft: "auto" }}>
          Notifications muted
        </span>
      </header>

      <div className="body">
        <div className="focus-main">
          <h6 style={{ margin: "0 0 10px", color: "var(--color-accent)" }}>Working on</h6>
          <h2 style={{ margin: "0 0 8px", fontSize: 38 }}>{task.title}</h2>
          <p className="text-muted" style={{ fontSize: 14, margin: "0 0 30px" }}>
            {task.list ?? "Inbox"} · due {task.due ?? "someday"}
            {task.pomodoros ? ` · ${task.pomodoros} pomodoros estimated` : ""}
          </p>

          <div className="focus-clock">{clock}</div>

          <div className="focus-bar">
            <div className="focus-bar-fill" style={{ width: `${progress}%` }} />
          </div>
          <div style={{ display: "flex", fontSize: 12, color: "var(--color-neutral-700)" }}>
            <span>Started 13:58</span>
            <span style={{ marginLeft: "auto" }}>Break at 14:23</span>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 34 }}>
            <button
              type="button"
              className="btn btn-primary"
              style={{ padding: "12px 22px" }}
              onClick={() => setRunning((value) => !value)}
            >
              {running ? "Pause" : "Resume"}
              <Kbd onAccent>Space</Kbd>
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: "12px 22px" }}
              onClick={() => setRemaining(5 * 60)}
            >
              Skip to break
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: "12px 10px" }}
              onClick={() => {
                toggleTask(task.id);
                setRunning(false);
              }}
            >
              Mark task done
            </button>
          </div>
        </div>

        <aside className="side">
          <div>
            <h6 style={{ margin: "0 0 10px", color: "var(--color-neutral-700)" }}>
              Today's sessions
            </h6>
            <div style={{ display: "flex", gap: 6 }}>
              {Array.from({ length: 6 }, (_, index) => (
                <div
                  key={index}
                  className={[
                    "pip",
                    index < COMPLETED_TODAY ? "pip-done" : "",
                    index === COMPLETED_TODAY ? "pip-active" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                />
              ))}
            </div>
            <p className="text-muted" style={{ fontSize: 12, margin: "10px 0 0" }}>
              {formatMinutes(COMPLETED_TODAY * WORK_MINUTES + Math.floor(elapsed / 60))} focused ·
              goal {formatMinutes(GOAL_MINUTES)}
            </p>
          </div>

          <Rule />

          <div>
            <h6 style={{ margin: "0 0 10px", color: "var(--color-neutral-700)" }}>Up next</h6>
            {upNext.map((next) => (
              <div
                className="row"
                style={{ padding: "9px 0" }}
                key={next.id}
                onClick={() => selectTask(next.id)}
              >
                <CheckBox label={next.title} onToggle={() => toggleTask(next.id)} />
                <span style={{ fontSize: 14 }}>{next.title}</span>
                <span className="text-muted row-trailing">
                  {formatMinutes(next.estimateMinutes)}
                </span>
              </div>
            ))}
          </div>

          <Rule />

          <div>
            <h6 style={{ margin: "0 0 8px", color: "var(--color-neutral-700)" }}>Interruptions</h6>
            <p className="text-muted" style={{ fontSize: 12, margin: "0 0 8px" }}>
              Logged without leaving the timer.
            </p>
            <form
              style={{ display: "flex", gap: 8, alignItems: "center" }}
              onSubmit={(event) => {
                event.preventDefault();
                if (!interruption.trim()) return;
                setInterruptions((current) => [...current, interruption.trim()]);
                setInterruption("");
              }}
            >
              <input
                className="input"
                placeholder="Note a distraction…"
                value={interruption}
                onChange={(event) => setInterruption(event.currentTarget.value)}
              />
              <Kbd>I</Kbd>
            </form>
            {interruptions.map((note, index) => (
              <p key={index} className="text-muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
                · {note}
              </p>
            ))}
          </div>

          <div style={{ marginTop: "auto" }}>
            <button type="button" className="btn btn-secondary btn-block">
              Session settings
            </button>
          </div>
        </aside>
      </div>
    </>
  );
}
