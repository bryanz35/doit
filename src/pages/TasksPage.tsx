/** The task list — Reminders-style: a big list title in the list's colour, then
 *  Overdue / Today / Later / Completed sections of round-checkbox rows, with the
 *  detail docked on the right. The Table layout is the same tasks as a native
 *  striped table; the inbox-zero state renders when the scope and filter yield
 *  nothing. */

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../data/store";
import type { Task } from "../types";
import { inScope, listColor, scopeColor, scopeTitle } from "../data/scope";
import { CheckBox, Kbd, MOD_KEY, Segmented, dueLabel, formatMinutes } from "../components/primitives";
import { AddTaskButton, AddTaskRow } from "../components/AddTaskRow";
import { TaskDetail } from "../components/TaskDetail";
import { TitleInput } from "../components/TitleInput";
import { NAV_ITEMS } from "../components/Rail";
import { parseListKeys, type ListCommand } from "../data/vimlist";
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
    setPage,
    taskById,
    deleteTask,
  } = useApp();
  const [filter, setFilter] = useState<Filter>("Open");
  const [layout, setLayout] = useState<Layout>("List");
  /** The task whose title is open in the inline editor: `i`/`a` keep the
   *  title with the caret at its start/end, `cc` clears it. */
  const [editing, setEditing] = useState<{ id: string; at: "start" | "end" | "clear" } | null>(null);
  /** Set when `o`/`O` opened the compose row, placed beside the anchor task
   *  when it is on screen. Null for the plain `N` row. */
  const [composeAt, setComposeAt] = useState<{ anchorId?: string; where: "above" | "below" } | null>(null);
  const pendingKeys = useRef<string[]>([]);
  // The list's cursor outlives the selection: Esc closes the detail by
  // clearing it, and the next `j` carries on from here.
  const cursorRef = useRef<string | null>(null);

  useEffect(() => {
    if (selectedTaskId) cursorRef.current = selectedTaskId;
  }, [selectedTaskId]);

  useEffect(() => {
    if (!composeOpen) setComposeAt(null);
  }, [composeOpen]);

  const anchor = composeOpen ? taskById(composeAt?.anchorId) : undefined;

  // A newly added task may not match what is on screen, which would make the
  // add look like it failed. It is open and due today unless the line says
  // otherwise, so the Done filter and the Overdue / Completed lists would hide it.
  // One opened beside an open task takes that task's date and list instead, so
  // it lands where its anchor already is.
  useEffect(() => {
    if (!composeOpen || (anchor && anchor.status !== "done")) return;
    if (filter === "Done") setFilter("Open");
    if (scope.kind === "smart" && (scope.id === "overdue" || scope.id === "completed")) {
      setScope({ kind: "smart", id: "today" });
    }
  }, [composeOpen, anchor, filter, scope, setScope]);

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

  const ordered = useMemo(
    () => [...groups.overdue, ...groups.today, ...groups.later, ...groups.done],
    [groups],
  );
  const openCount = ordered.length - groups.done.length;
  const totalEstimate = ordered
    .filter((t) => t.status !== "done")
    .reduce((sum, t) => sum + (t.estimateMinutes ?? 0), 0);

  const selected = tasks.find((task) => task.id === selectedTaskId);
  const isEmpty = ordered.length === 0;
  const title = scopeTitle(scope);
  const anchorShown = anchor && ordered.includes(anchor) ? anchor : undefined;

  // Vim keys on the list (data/vimlist.ts). Global keybinds live in App.tsx,
  // but these are this screen's own: the shell only routes to the page, it does
  // not know the rows exist. The shell leaves 1–5 alone here, so digits are
  // counts and `g1`…`g5` switch pages instead.
  useEffect(() => {
    const run = (command: ListCommand) => {
      const shown = selected && ordered.includes(selected) ? selected : undefined;
      const at = ordered.findIndex((task) => task.id === (selectedTaskId ?? cursorRef.current));
      const select = (index: number) => {
        if (ordered.length) selectTask(ordered[Math.max(0, Math.min(ordered.length - 1, index))].id);
      };
      switch (command.kind) {
        case "move":
          if (at >= 0) select(at + command.by);
          else select(command.by > 0 ? command.by - 1 : ordered.length + command.by);
          break;
        case "goto":
          select(command.index === "last" ? ordered.length - 1 : command.index);
          break;
        case "page": {
          const nav = NAV_ITEMS.find((item) => item.key === command.key);
          if (!nav) break;
          // Same as the shell: never unmount a page under a focus ring.
          const el = document.activeElement;
          if (el instanceof HTMLElement && el !== document.body) el.blur();
          setPage(nav.id);
          break;
        }
        case "open":
          setComposeAt({ anchorId: shown?.id, where: command.where });
          setComposeOpen(true);
          break;
        case "edit":
          if (shown) setEditing({ id: shown.id, at: command.at });
          break;
        case "change":
          if (shown) setEditing({ id: shown.id, at: "clear" });
          break;
        case "compose":
          setComposeAt(null);
          setComposeOpen(true);
          break;
        // Both act on the visible selection only — never on a cursor the user
        // cannot see — and leave the selection on the row that follows, the way
        // vim's cursor lands on the next line.
        case "delete": {
          if (!shown) break;
          const here = ordered.indexOf(shown);
          const last = ordered.length - 1;
          const { span, count } = command;
          // `dj`/`dk` past either end does nothing, as in vim; `dd` with a
          // count runs out at the end instead.
          if ((span === "down" && here + count > last) || (span === "up" && here - count < 0)) break;
          const from = span === "up" ? here - count : span === "first" ? 0 : here;
          const to =
            span === "line" ? Math.min(last, here + count - 1)
            : span === "down" ? here + count
            : span === "last" ? last
            : here;
          selectTask((ordered[to + 1] ?? ordered[from - 1])?.id ?? null);
          for (const task of ordered.slice(from, to + 1)) deleteTask(task.id);
          break;
        }
        case "toggle": {
          if (!shown) break;
          const here = ordered.indexOf(shown);
          const flipped = ordered.slice(here, here + command.count);
          // A toggled task leaves its place (or the list, under a filter), so
          // the selection moves on to whatever followed it.
          const next = ordered[here + flipped.length] ?? ordered[here - 1];
          if (next) selectTask(next.id);
          for (const task of flipped) toggleTask(task.id);
          break;
        }
      }
    };

    const onKey = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (paletteOpen || !loaded || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Escape") {
        // Drop a half-typed count, and let the shell close whatever is open.
        pendingKeys.current = [];
        return;
      }
      // Lone Shift (on the way to `G`, `O`) and other named keys are not ours.
      if (event.key.length > 1 && event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const keys = [...pendingKeys.current, event.key];
      const command = parseListKeys(keys);
      pendingKeys.current = command === "pending" ? keys : [];
      if (command === "invalid") return;
      event.preventDefault();
      if (command !== "pending") run(command);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    ordered,
    selected,
    selectedTaskId,
    selectTask,
    toggleTask,
    deleteTask,
    paletteOpen,
    loaded,
    setPage,
    setComposeOpen,
  ]);

  // Keep the keyboard's selection on screen.
  useEffect(() => {
    if (!selectedTaskId) return;
    document
      .querySelector(`[data-task-id="${CSS.escape(selectedTaskId)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedTaskId]);

  const composeRow = (beside?: Task) =>
    composeAt ? (
      <AddTaskRow
        vim
        anchor={beside ?? anchor}
        onCreated={(task) => setComposeAt({ anchorId: task.id, where: "below" })}
      />
    ) : (
      <AddTaskRow />
    );
  // The default spot for the compose row, unless it is open beside its anchor.
  const composeSlot = composeOpen ? !anchorShown && composeRow() : <AddTaskButton />;

  const titleOf = (task: Task, className?: string) =>
    editing?.id === task.id ? (
      <TitleEditor task={task} at={editing.at} onDone={() => setEditing(null)} />
    ) : (
      <span className={className}>{task.title}</span>
    );

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
    const row = (
      <div
        key={task.id}
        data-task-id={task.id}
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
          {titleOf(task, "dt-row-title")}
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
    if (task !== anchorShown) return row;
    return (
      <Fragment key={task.id}>
        {composeAt?.where === "above" && composeRow(task)}
        {row}
        {composeAt?.where === "below" && composeRow(task)}
      </Fragment>
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
            {composeOpen ? composeRow() : <AddTaskButton />}
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
                      data-task-id={task.id}
                      data-color={listColor(task.list)}
                      aria-selected={task.id === selectedTaskId}
                      onClick={() => selectTask(task.id)}
                      className="tasks-table-row"
                    >
                      <td>
                        <CheckBox label={task.title} done={done} onToggle={() => toggleTask(task.id)} />
                      </td>
                      <td className={done ? "dt-done" : undefined}>{titleOf(task)}</td>
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
            {composeSlot}
            {section("Later", groups.later)}
            {section("Completed", groups.done)}
          </div>
        )}

        {loaded && selected && !isEmpty && <TaskDetail task={selected} />}
      </div>
    </>
  );
}

/** The inline title editor a row swaps in for `i`, `a`, `cc`. Enter, Esc or
 *  clicking away saves and hands the keys back to the list; an emptied title
 *  is not saved, so `cc` then Esc leaves the old one. */
function TitleEditor({
  task,
  at,
  onDone,
}: {
  task: Task;
  at: "start" | "end" | "clear";
  onDone: () => void;
}) {
  const { updateTask } = useApp();
  const [draft, setDraft] = useState(at === "clear" ? "" : task.title);
  // Saving unmounts the field, and some webviews then report a blur as well.
  const finished = useRef(false);

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    const title = draft.trim();
    if (title && title !== task.title) updateTask(task.id, { title });
    onDone();
  };

  return (
    <span
      className="row-title-edit"
      // The row turns a press into a selection and a click into select; inside
      // the field a press places the cursor instead.
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <TitleInput
        className="row-title-input"
        label={`Title of ${task.title}`}
        value={draft}
        at={at === "start" ? "start" : "end"}
        onChange={setDraft}
        onEnter={finish}
        onEscape={finish}
        onBlur={finish}
      />
    </span>
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
        <Kbd>g3</Kbd>
        <button type="button" className="dt-btn dt-btn-plain empty-link" onClick={() => setPage("focus")}>
          Start a pomodoro on anything
        </button>
        <Kbd>g4</Kbd>
        <button type="button" className="dt-btn dt-btn-plain empty-link" onClick={() => setPage("graph")}>
          Open the graph
        </button>
      </div>
    </div>
  );
}
