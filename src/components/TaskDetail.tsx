/** The task detail — an info sheet in the style of Reminders. Shared by the
 *  tasks list and the calendar, so clicking a row, a due chip, or a block on the
 *  grid all open the same thing.
 *
 *  Two presentations, same content: `variant="pane"` docks the sheet on the
 *  right edge of the tasks list; `variant="modal"` centres it over a scrim,
 *  which is what the calendar uses — there the tray and the hour grid already
 *  compete for the width, and a third column left the pane unreadably narrow.
 *
 *  Read-only for now, apart from unscheduling a block — no field here writes
 *  back yet (see the store: `updateTask` exists, the sheet does not use it). */

import { useApp } from "../data/store";
import type { Task, TaskBlock } from "../types";
import { listColor } from "../data/scope";
import { Kbd, dueLabel, formatMinutes } from "./primitives";
import { clockOf, durationMinutes, fromInstant } from "../data/instants";

/** "Mon 29 Sep · 09:00–10:30" — the block in the reader's own zone, whatever
 *  zone it was authored in. */
function blockLabel(block: TaskBlock): string {
  const day = fromInstant(block.startAt).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  return `${day} · ${clockOf(block.startAt)}–${clockOf(block.endAt)}`;
}

export function TaskDetail({
  task,
  variant = "pane",
}: {
  task: Task;
  variant?: "pane" | "modal";
}) {
  const { selectTask, setPage, page, deleteBlock, today } = useApp();
  const blockedMinutes = task.blocks.reduce(
    (sum, block) => sum + durationMinutes(block.startAt, block.endAt),
    0,
  );
  const overdue = task.status !== "done" && task.due !== undefined && task.due < today;

  const body = (
    <aside
      className={variant === "modal" ? "dt-sheet task-sheet-modal" : "dt-sheet task-sheet-docked"}
      data-color={listColor(task.list)}
      role={variant === "modal" ? "dialog" : undefined}
      aria-modal={variant === "modal" ? true : undefined}
      aria-label={task.title}
      /* the scrim below closes on click; a click inside the sheet must not */
      onClick={variant === "modal" ? (event) => event.stopPropagation() : undefined}
    >
      <div className="dt-sheet-head">
        <h2 className="dt-sheet-title">{task.title}</h2>
        <button
          type="button"
          className="task-sheet-close"
          aria-label="Close"
          onClick={() => selectTask(null)}
        >
          <Kbd>Esc</Kbd>
        </button>
      </div>
      {task.notes && <p className="dt-sheet-notes">{task.notes}</p>}

      <div className="dt-group">
        <div className="dt-field">
          <span className="dt-field-label">Due</span>
          <span className={`dt-field-value${overdue ? " dt-overdue" : ""}`}>
            {dueLabel(task.due, today)}
          </span>
        </div>
        <div className="dt-field">
          <span className="dt-field-label">Estimate</span>
          <span className="dt-field-value">
            {task.pomodoros ? `${task.pomodoros} pomodoros · ` : ""}
            {formatMinutes(task.estimateMinutes)}
          </span>
        </div>
        <div className="dt-field">
          <span className="dt-field-label">List</span>
          <span className="dt-field-value">{task.list ?? "Inbox"}</span>
        </div>
        <div className="dt-field">
          <span className="dt-field-label">Graph</span>
          <span className="dt-field-value">{task.dependsOn.length} linked nodes</span>
        </div>
      </div>

      <div>
        <div className="dt-blocks-head">
          <span>SCHEDULED · {task.blocks.length}</span>
          {blockedMinutes > 0 && <span>{formatMinutes(blockedMinutes)}</span>}
        </div>
        {task.blocks.length === 0 ? (
          <p className="dt-sheet-notes task-sheet-pad">
            No time blocked. Drag it onto the calendar's hour grid.
          </p>
        ) : (
          <div className="dt-group">
            {task.blocks.map((block) => (
              <div className="dt-block-line" key={block.id}>
                <span className="dt-bar" />
                {blockLabel(block)}
                <button
                  type="button"
                  className="dt-btn dt-btn-icon"
                  aria-label={`Unschedule ${blockLabel(block)}`}
                  onClick={() => deleteBlock(block.id)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {(task.tags.length > 0 || task.dependsOn.length > 0) && (
        <div className="dt-sheet-tags">
          {task.tags.map((tag) => (
            <span className="dt-tag" key={tag}>
              #{tag}
            </span>
          ))}
          {task.dependsOn.length > 0 && (
            <span className="dt-tag dt-tag-accent">blocked by {task.dependsOn.length}</span>
          )}
        </div>
      )}

      <div className="dt-sheet-actions">
        {/* Pointless on the calendar — the grid is right there. */}
        {page !== "calendar" && (
          <button type="button" className="dt-btn" onClick={() => setPage("calendar")}>
            Schedule on calendar
          </button>
        )}
        <button
          type="button"
          className="dt-btn dt-btn-primary"
          onClick={() => {
            selectTask(task.id);
            setPage("focus");
          }}
        >
          Start focus <Kbd>F</Kbd>
        </button>
      </div>
    </aside>
  );

  if (variant !== "modal") return body;

  return (
    /* Esc closes it through the global keybind in App.tsx; clicking the dimmed
       area is the pointer equivalent. */
    <div className="dt-scrim task-scrim" onClick={() => selectTask(null)}>
      {body}
    </div>
  );
}
