/** The task detail. Shared by the tasks list and the calendar, so clicking a
 *  row, a due chip, or a block on the grid all open the same thing.
 *
 *  Two presentations, same content: `variant="pane"` is the right-hand sidebar
 *  the tasks list uses; `variant="modal"` centres it over a dimmed screen, which
 *  is what the calendar uses — there the tray and the hour grid already compete
 *  for the width, and a third column left the pane unreadably narrow.
 *
 *  Read-only for now, apart from unscheduling a block — no field here writes
 *  back yet (see the store: `updateTask` exists, the pane does not use it). */

import { useApp } from "../data/store";
import type { Task, TaskBlock } from "../types";
import { Kbd, Rule, formatMinutes } from "./primitives";
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
  const { selectTask, setPage, page, deleteBlock } = useApp();
  const blockedMinutes = task.blocks.reduce(
    (sum, block) => sum + durationMinutes(block.startAt, block.endAt),
    0,
  );

  const body = (
    <aside
      className={variant === "modal" ? "side side-modal" : "side"}
      role={variant === "modal" ? "dialog" : undefined}
      aria-modal={variant === "modal" ? true : undefined}
      aria-label={variant === "modal" ? task.title : undefined}
      /* the scrim below closes on click; a click inside the panel must not */
      onClick={variant === "modal" ? (event) => event.stopPropagation() : undefined}
    >
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
      <div>
        <div style={{ display: "flex", alignItems: "baseline", marginBottom: 8 }}>
          <h6 style={{ margin: 0, color: "var(--color-neutral-700)" }}>
            Scheduled · {task.blocks.length}
          </h6>
          {blockedMinutes > 0 && (
            <span className="text-muted" style={{ marginLeft: "auto", fontSize: 12 }}>
              {formatMinutes(blockedMinutes)}
            </span>
          )}
        </div>
        {task.blocks.length === 0 ? (
          <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
            No time blocked. Drag it onto the calendar's hour grid.
          </p>
        ) : (
          <div className="detail-blocks">
            {task.blocks.map((block) => (
              <div className="detail-block" key={block.id}>
                <span>{blockLabel(block)}</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-icon"
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
        {/* Pointless on the calendar — the grid is right there. */}
        {page !== "calendar" && (
          <button
            type="button"
            className="btn btn-secondary btn-block"
            onClick={() => setPage("calendar")}
          >
            Schedule on calendar
          </button>
        )}
      </div>
    </aside>
  );

  if (variant !== "modal") return body;

  return (
    /* Esc closes it through the global keybind in App.tsx; clicking the dimmed
       area is the pointer equivalent. */
    <div className="scrim" onClick={() => selectTask(null)}>
      {body}
    </div>
  );
}
