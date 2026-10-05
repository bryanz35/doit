/** The task list — Reminders-style: a big list title in the list's colour, then
 *  Overdue / Today / Later / Completed sections of round-checkbox rows, with the
 *  detail docked on the right. The Table layout is the same tasks as a native
 *  striped table; the inbox-zero state renders when the scope and filter yield
 *  nothing. */

import { useEffect, useMemo, useState } from "react";
import { useApp } from "../data/store";
import type { Task } from "../types";
import { inScope, listColor, scopeColor, scopeTitle } from "../data/scope";
import { CheckBox, Kbd, MOD_KEY, Segmented, dueLabel, formatMinutes } from "../components/primitives";
import { AddTaskButton, AddTaskRow } from "../components/AddTaskRow";
import { TaskDetail } from "../components/TaskDetail";
import { CheckIcon, InfoIcon, PlusIcon } from "../components/icons";

const FILTERS = ["Open", "Done", "All"] as const;
const LAYOUTS = ["List", "Table"] as const;

type Filter = (typeof FILTERS)[number];
type Layout = (typeof LAYOUTS)[number];

/** `completedAt` arrives as the UTC RFC3339 stamp the database writes. Show the
 *  local clock time for anything finished today, the weekday before that. */
function completedLabel(completedAt: string | undefined, today: string): string {
  if (!completedAt) return "";
  const at = new Date(completedAt);
  if (Number.isNaN(at.getTime())) return completedAt;
  const local = `${at.getFullYear()}-${`${at.getMonth() + 1}`.padStart(2, "0")}-${`${at.getDate()}`.padStart(2, "0")}`;
  return local === today
    ? at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : at.toLocaleDateString(undefined, { weekday: "short" });
}

/** What sits at the right end of a row: when it was finished, or the estimate. */
function trailing(task: Task, today: string): string {
  if (task.status === "done") return completedLabel(task.completedAt, today);
  if (task.pomodoros) return `${task.pomodoros} × 25m`;
  return task.estimateMinutes !== undefined ? formatMinutes(task.estimateMinutes) : "";
}

export function TasksPage() {
  const {
    tasks,
    today,
    loaded,
    error,
    selectedTaskId,
    selectTask,
    toggleTask,
    paletteOpen,
    composeOpen,
    setComposeOpen,
    scope,
    setScope,
  } = useApp();
  const [filter, setFilter] = useState<Filter>("Open");
  const [layout, setLayout] = useState<Layout>("List");

  // `N` opens the compose row. Global keybinds live in App.tsx, but this one is
  // this screen's own: the shell only routes to the page, it does not know the
  // row exists.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (paletteOpen) return;
      if (event.key !== "n" && event.key !== "N") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      setComposeOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen, setComposeOpen]);

  // A newly added task may not match what is on screen, which would make the
  // add look like it failed. It is open and due today unless the line says
  // otherwise, so the Done filter and the Overdue / Completed lists would hide it.
  useEffect(() => {
    if (!composeOpen) return;
    if (filter === "Done") setFilter("Open");
    if (scope.kind === "smart" && (scope.id === "overdue" || scope.id === "completed")) {
      setScope({ kind: "smart", id: "today" });
    }
  }, [composeOpen, filter, scope, setScope]);

  // Completed is done tasks by definition, so the status filter stands aside.
  const showsDone = scope.kind === "smart" && scope.id === "completed";

  const groups = useMemo(() => {
    const visible = tasks.filter((task) => {
      if (!inScope(task, scope, today)) return false;
      if (showsDone || filter === "All") return true;
      return filter === "Open" ? task.status !== "done" : task.status === "done";
    });
    return {
      overdue: visible.filter((t) => t.status !== "done" && t.due && t.due < today),
      today: visible.filter((t) => t.status !== "done" && t.due === today),
      later: visible.filter((t) => t.status !== "done" && (!t.due || t.due > today)),
      done: visible.filter((t) => t.status === "done"),
    };
  }, [tasks, scope, filter, showsDone, today]);

  const ordered = [...groups.overdue, ...groups.today, ...groups.later, ...groups.done];
  const openCount = ordered.length - groups.done.length;
  const totalEstimate = ordered
    .filter((t) => t.status !== "done")
    .reduce((sum, t) => sum + (t.estimateMinutes ?? 0), 0);

  const selected = tasks.find((task) => task.id === selectedTaskId);
  const isEmpty = ordered.length === 0;
  const title = scopeTitle(scope);

  const renderRow = (task: Task) => {
    const overdue = task.status !== "done" && task.due !== undefined && task.due < today;
    const meta = [
      task.due && task.status !== "done" ? (
        <span key="due" className={overdue ? "dt-overdue" : undefined}>
          {dueLabel(task.due, today)}
        </span>
      ) : null,
      scope.kind !== "list" && task.list ? <span key="list">{task.list}</span> : null,
      ...task.tags.map((tag) => (
        <span key={`#${tag}`} className="dt-hashtag">
          #{tag}
        </span>
      )),
    ].filter(Boolean);
    return (
      <div
        key={task.id}
        className={task.status === "done" ? "dt-row dt-row-done" : "dt-row"}
        data-color={listColor(task.list)}
        aria-selected={task.id === selectedTaskId}
        onClick={() => selectTask(task.id)}
        /* Selecting with the mouse must not park DOM focus on the row: the next
           keybind would paint a :focus-visible ring an instant before the page
           unmounts it. Keyboard focus (Tab) still works and still rings. */
        onMouseDown={(event) => event.preventDefault()}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter") selectTask(task.id);
        }}
      >
        <CheckBox label={task.title} done={task.status === "done"} onToggle={() => toggleTask(task.id)} />
        <div className="dt-row-body">
          <span className="dt-row-title">{task.title}</span>
          {meta.length > 0 && <span className="dt-row-meta">{meta}</span>}
        </div>
        <span className="dt-row-trailing">{trailing(task, today)}</span>
        <button
          type="button"
          className="dt-row-info"
          aria-label={`Show detail for ${task.title}`}
          onClick={(event) => {
            event.stopPropagation();
            selectTask(task.id);
          }}
        >
          <InfoIcon size={18} stroke={1.6} />
        </button>
      </div>
    );
  };

  const section = (label: string, list: Task[], overdue = false) =>
    list.length > 0 && (
      <>
        <div className={overdue ? "dt-section dt-section-overdue" : "dt-section"}>
          {label} <span className="dt-count">{list.length}</span>
        </div>
        <div>{list.map(renderRow)}</div>
      </>
    );

  return (
    <>
      <header className="dt-toolbar">
        <span className="dt-toolbar-title">Tasks</span>
        <span className="dt-muted toolbar-meta">
          {new Date(`${today}T00:00:00`).toLocaleDateString(undefined, {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </span>
        <div className="dt-toolbar-right">
          <Segmented options={LAYOUTS} value={layout} onChange={setLayout} />
          {!showsDone && <Segmented options={FILTERS} value={filter} onChange={setFilter} />}
          <button
            type="button"
            className="dt-btn dt-btn-icon toolbar-add"
            aria-label="New task"
            title="New task (N)"
            onClick={() => setComposeOpen(true)}
          >
            <PlusIcon />
          </button>
        </div>
      </header>

      {/* `.page-body` is a row (list + docked detail), so the failure banner
          sits above it rather than inside. */}
      {error && (
        <div className="dt-banner" role="alert">
          <InfoIcon size={14} />
          {error}
        </div>
      )}

      <div className="page-body">
        {!loaded ? (
          <div className="dt-empty page-fill">
            <p>Loading tasks…</p>
          </div>
        ) : isEmpty ? (
          <EmptyState title={emptyTitle(scope.kind === "list" ? scope.name : scope.id)} />
        ) : layout === "Table" ? (
          <div className="tasks-scroll tasks-table">
            <div className="dt-table-head">
              <h2>{title}</h2>
              <span className="dt-muted">
                {openCount} open · {groups.done.length} done
              </span>
              {totalEstimate > 0 && (
                <span className="dt-tag dt-tag-accent table-total">
                  est. {formatMinutes(totalEstimate)}
                </span>
              )}
            </div>
            {composeOpen ? <AddTaskRow /> : <AddTaskButton />}
            <table className="dt-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }} />
                  <th>Task</th>
                  <th style={{ width: 110 }}>Due</th>
                  <th style={{ width: 96 }}>Est.</th>
                  <th style={{ width: 110 }}>Repo</th>
                </tr>
              </thead>
              <tbody>
                {ordered.map((task) => {
                  const done = task.status === "done";
                  const overdue = !done && task.due !== undefined && task.due < today;
                  return (
                    <tr
                      key={task.id}
                      data-color={listColor(task.list)}
                      aria-selected={task.id === selectedTaskId}
                      onClick={() => selectTask(task.id)}
                      className="tasks-table-row"
                    >
                      <td>
                        <CheckBox label={task.title} done={done} onToggle={() => toggleTask(task.id)} />
                      </td>
                      <td className={done ? "dt-done" : undefined}>{task.title}</td>
                      <td className="dt-num">
                        {done ? (
                          "Done"
                        ) : (
                          <span className={overdue ? "dt-overdue" : undefined}>
                            {dueLabel(task.due, today)}
                          </span>
                        )}
                      </td>
                      <td className="dt-num">{formatMinutes(task.estimateMinutes)}</td>
                      <td className="dt-num">{task.repo ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="tasks-scroll">
            <div className="dt-listhead" data-color={scopeColor(scope)}>
              <h1 className="dt-listhead-title">{title}</h1>
              <span className="dt-listhead-count">{openCount || groups.done.length}</span>
            </div>
            {section("Overdue", groups.overdue, true)}
            {section("Today", groups.today)}
            {composeOpen ? <AddTaskRow /> : <AddTaskButton />}
            {section("Later", groups.later)}
            {section("Completed", groups.done)}
          </div>
        )}

        {loaded && selected && !isEmpty && <TaskDetail task={selected} />}
      </div>
    </>
  );
}

function emptyTitle(scope: string): string {
  switch (scope) {
    case "today":
      return "Nothing due today.";
    case "overdue":
      return "Nothing overdue.";
    case "completed":
      return "Nothing completed yet.";
    case "all":
      return "Nothing to do.";
    default:
      return `Nothing in ${scope}.`;
  }
}

/** Inbox zero. "Add something now" is a live compose row here, not a pointer at
 *  a row that only exists when there is a list to hang it under. */
function EmptyState({ title }: { title: string }) {
  const { setPaletteOpen, setPage, composeOpen, setComposeOpen } = useApp();
  return (
    <div className="dt-empty page-fill">
      <div className="dt-empty-icon">
        <CheckIcon size={30} />
      </div>
      <h2>{title}</h2>
      <p>Add something now, or pull one forward from the calendar.</p>
      {composeOpen ? <AddTaskRow /> : <AddTaskButton />}
      <div className="dt-keys">
        <Kbd>N</Kbd>
        <button type="button" className="dt-btn dt-btn-plain empty-link" onClick={() => setComposeOpen(true)}>
          New task
        </button>
        <Kbd>{MOD_KEY}K</Kbd>
        <button type="button" className="dt-btn dt-btn-plain empty-link" onClick={() => setPaletteOpen(true)}>
          Command palette
        </button>
        <Kbd>3</Kbd>
        <button type="button" className="dt-btn dt-btn-plain empty-link" onClick={() => setPage("focus")}>
          Start a pomodoro on anything
        </button>
        <Kbd>4</Kbd>
        <button type="button" className="dt-btn dt-btn-plain empty-link" onClick={() => setPage("graph")}>
          Open the graph
        </button>
      </div>
    </div>
  );
}
