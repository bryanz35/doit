/** Screen 1a — Today, with the detail pane. Variation 2a adds the dense table.
 *  Screen 1f's inbox-zero state renders when the filter yields nothing. */

import { useMemo, useState } from "react";
import { useApp } from "../data/store";
import type { Task } from "../types";
import { CheckBox, Kbd, Rule, Segmented, formatMinutes } from "../components/primitives";

const FILTERS = ["Open", "Done", "All"] as const;
const LAYOUTS = ["List", "Table"] as const;

type Filter = (typeof FILTERS)[number];
type Layout = (typeof LAYOUTS)[number];

/** "Yesterday" / "Today" / "Fri 22" — how the mockups label a due date. */
function dueLabel(task: Task, today: string): string {
  if (!task.due) return "Someday";
  if (task.due === today) return "Today";
  if (task.due < today) return "Yesterday";
  const date = new Date(`${task.due}T00:00:00`);
  return date.toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
}

export function TasksPage() {
  const { tasks, today, selectedTaskId, selectTask, toggleTask, addTask } = useApp();
  const [filter, setFilter] = useState<Filter>("Open");
  const [layout, setLayout] = useState<Layout>("List");
  const [draft, setDraft] = useState("");
  const [composing, setComposing] = useState(false);

  const groups = useMemo(() => {
    const visible = tasks.filter((task) => {
      if (filter === "Open") return task.status !== "done";
      if (filter === "Done") return task.status === "done";
      return true;
    });
    return {
      overdue: visible.filter((t) => t.status !== "done" && t.due && t.due < today),
      today: visible.filter((t) => t.status !== "done" && t.due === today),
      later: visible.filter((t) => t.status !== "done" && (!t.due || t.due > today)),
      done: visible.filter((t) => t.status === "done"),
    };
  }, [tasks, filter, today]);

  const openCount = tasks.filter((t) => t.status !== "done").length;
  const doneCount = tasks.length - openCount;
  const totalEstimate = tasks
    .filter((t) => t.status !== "done")
    .reduce((sum, t) => sum + (t.estimateMinutes ?? 0), 0);

  const selected = tasks.find((task) => task.id === selectedTaskId);
  const isEmpty =
    groups.overdue.length + groups.today.length + groups.later.length + groups.done.length === 0;

  const submitDraft = () => {
    addTask(draft);
    setDraft("");
    setComposing(false);
  };

  const renderRow = (task: Task) => (
    <div
      key={task.id}
      className={[
        "row",
        task.id === selectedTaskId ? "row-selected" : "",
        task.status === "done" ? "row-done" : "",
      ]
        .filter(Boolean)
        .join(" ")}
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
      <CheckBox
        label={task.title}
        done={task.status === "done"}
        overdue={Boolean(task.due && task.due < today && task.status !== "done")}
        onToggle={() => toggleTask(task.id)}
      />
      <span className={task.status === "done" ? "row-title text-muted" : "row-title"}>
        {task.title}
      </span>
      {task.due && task.due < today && task.status !== "done" ? (
        <span className="tag tag-accent" style={{ marginLeft: "auto" }}>
          Yesterday
        </span>
      ) : (
        <span className="text-muted row-trailing">
          {task.status === "done"
            ? task.completedAt
            : task.pomodoros
              ? `${task.pomodoros} × 25m`
              : formatMinutes(task.estimateMinutes)}
        </span>
      )}
    </div>
  );

  return (
    <>
      <header className="topbar">
        <h4>Today</h4>
        <span className="text-muted meta" style={{ fontSize: 13 }}>
          Friday, 14 August
        </span>
        <div className="topbar-right">
          <Segmented options={LAYOUTS} value={layout} onChange={setLayout} />
          <Segmented options={FILTERS} value={filter} onChange={setFilter} />
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setComposing(true)}
          >
            New task
            <Kbd onAccent>N</Kbd>
          </button>
        </div>
      </header>

      <div className="body">
        {isEmpty ? (
          <EmptyState />
        ) : (
          <div className="tasklist">
            {layout === "Table" ? (
              <>
                <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14 }}>
                  <h4 style={{ margin: 0 }}>All tasks</h4>
                  <span className="text-muted" style={{ fontSize: 12 }}>
                    {openCount} open · {doneCount} done
                  </span>
                  <span
                    className="tag tag-outline meta"
                    style={{ marginLeft: "auto", alignSelf: "center" }}
                  >
                    est. {formatMinutes(totalEstimate)}
                  </span>
                </div>
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 26 }} />
                      <th>Task</th>
                      <th style={{ width: 110 }}>Due</th>
                      <th style={{ width: 96 }}>Est.</th>
                      <th style={{ width: 110 }}>Repo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...groups.overdue, ...groups.today, ...groups.later, ...groups.done].map(
                      (task) => (
                        <tr
                          key={task.id}
                          onClick={() => selectTask(task.id)}
                          style={{ cursor: "pointer" }}
                        >
                          <td>
                            <CheckBox
                              label={task.title}
                              done={task.status === "done"}
                              overdue={Boolean(
                                task.due && task.due < today && task.status !== "done",
                              )}
                              onToggle={() => toggleTask(task.id)}
                            />
                          </td>
                          <td
                            className={task.status === "done" ? "text-muted" : undefined}
                            style={
                              task.status === "done" ? { textDecoration: "line-through" } : undefined
                            }
                          >
                            {task.title}
                          </td>
                          <td className={task.due && task.due < today ? undefined : "text-muted"}>
                            {task.status === "done" ? (
                              "Done"
                            ) : task.due && task.due < today ? (
                              <span className="tag tag-accent">Yesterday</span>
                            ) : (
                              dueLabel(task, today)
                            )}
                          </td>
                          <td className="text-muted">{formatMinutes(task.estimateMinutes)}</td>
                          <td className="text-muted">{task.repo ?? "—"}</td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </>
            ) : (
              <>
                {groups.overdue.length > 0 && (
                  <>
                    <h6 className="group-head group-head-overdue">
                      Overdue · {groups.overdue.length}
                    </h6>
                    <Rule />
                    {groups.overdue.map(renderRow)}
                  </>
                )}

                {groups.today.length > 0 && (
                  <>
                    <h6 className="group-head">Today · {groups.today.length}</h6>
                    <Rule />
                    {groups.today.map(renderRow)}
                  </>
                )}

                {composing ? (
                  <form
                    className="addrow"
                    onSubmit={(event) => {
                      event.preventDefault();
                      submitDraft();
                    }}
                  >
                    <span className="box box-add" />
                    <input
                      autoFocus
                      className="palette-input"
                      placeholder="Add a task…"
                      value={draft}
                      onChange={(event) => setDraft(event.currentTarget.value)}
                      onBlur={submitDraft}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          setDraft("");
                          setComposing(false);
                        }
                      }}
                    />
                  </form>
                ) : (
                  <button type="button" className="addrow" onClick={() => setComposing(true)}>
                    <span className="box box-add" />
                    <span>Add a task…</span>
                    <span style={{ marginLeft: "auto" }}>
                      <Kbd>N</Kbd>
                    </span>
                  </button>
                )}

                {groups.later.length > 0 && (
                  <>
                    <h6 className="group-head">Later · {groups.later.length}</h6>
                    <Rule />
                    {groups.later.map(renderRow)}
                  </>
                )}

                {groups.done.length > 0 && (
                  <>
                    <h6 className="group-head">Completed · {groups.done.length}</h6>
                    <Rule />
                    {groups.done.map(renderRow)}
                  </>
                )}
              </>
            )}
          </div>
        )}

        {selected && !isEmpty && <TaskDetail task={selected} />}
      </div>
    </>
  );
}

function TaskDetail({ task }: { task: Task }) {
  const { selectTask, setPage } = useApp();
  return (
    <aside className="side">
      <div style={{ display: "flex", alignItems: "center" }}>
        <h6 style={{ margin: 0, color: "var(--color-neutral-700)" }}>Task</h6>
        <span style={{ marginLeft: "auto" }}>
          <Kbd>Esc to close</Kbd>
        </span>
      </div>
      <h4 style={{ margin: 0 }}>{task.title}</h4>
      {task.notes && (
        <p className="text-muted" style={{ fontSize: 13, margin: 0, textWrap: "pretty" }}>
          {task.notes}
        </p>
      )}
      <Rule />
      <div className="detail-grid">
        <span className="text-muted">Due</span>
        <span>{task.due ?? "Someday"}</span>
        <span className="text-muted">Estimate</span>
        <span>
          {task.pomodoros ? `${task.pomodoros} pomodoros · ` : ""}
          {formatMinutes(task.estimateMinutes)}
        </span>
        <span className="text-muted">List</span>
        <span>{task.list ?? "—"}</span>
        <span className="text-muted">Graph</span>
        <span>{task.dependsOn.length} linked nodes</span>
      </div>
      <Rule />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {task.tags.map((tag) => (
          <span className="tag tag-neutral" key={tag}>
            {tag}
          </span>
        ))}
        {task.dependsOn.length > 0 && (
          <span className="tag tag-outline">blocked by {task.dependsOn.length}</span>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: "auto" }}>
        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={() => {
            selectTask(task.id);
            setPage("focus");
          }}
        >
          Start focus session
          <span style={{ marginLeft: "auto" }}>
            <Kbd onAccent>F</Kbd>
          </span>
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-block"
          onClick={() => setPage("calendar")}
        >
          Schedule on calendar
        </button>
      </div>
    </aside>
  );
}

/** Screen 1f — inbox zero. */
function EmptyState() {
  const { setPaletteOpen, setPage } = useApp();
  return (
    <div className="empty">
      <div className="empty-inner">
        <div className="empty-mark" />
        <h2 style={{ margin: "0 0 10px" }}>Nothing due today.</h2>
        <p className="text-muted" style={{ fontSize: 15, margin: "0 0 26px", textWrap: "pretty" }}>
          Eight tasks are scheduled later this week. Add something now, or pull one forward from the
          calendar.
        </p>
        <Rule />
        <div className="empty-keys" style={{ marginTop: 22 }}>
          <Kbd>N</Kbd>
          <span className="text-muted">New task</span>
          <button
            type="button"
            className="kbd"
            style={{ cursor: "pointer", background: "transparent" }}
            onClick={() => setPaletteOpen(true)}
          >
            ⌘K
          </button>
          <span className="text-muted">Command palette</span>
          <Kbd>3</Kbd>
          <span className="text-muted">
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: 0 }}
              onClick={() => setPage("focus")}
            >
              Start a pomodoro on anything
            </button>
          </span>
          <Kbd>4</Kbd>
          <span className="text-muted">
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: 0 }}
              onClick={() => setPage("graph")}
            >
              Open the graph
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
