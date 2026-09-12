/** The compose row — the one place a task gets created.
 *
 * Renders under Today on screen 1a, above the table on 2a, and inside the
 * inbox-zero state on 1f, so "New task" and `N` always land somewhere. The line
 * is quick-add text (see data/quickadd.ts); what it parsed to is echoed under
 * the field so the sigils are discoverable without a legend. */

import { useMemo, useRef, useState } from "react";
import { useApp } from "../data/store";
import { parseQuickAdd } from "../data/quickadd";
import { Kbd, formatMinutes } from "./primitives";

/** "Today" / "Fri 22" / "Someday" — matches how the rows label a due date. */
function dueChip(due: string | null, today: string): string {
  if (due === null) return "Someday";
  if (due === today) return "Today";
  return new Date(`${due}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
  });
}

export function AddTaskRow() {
  const { addTask, setComposeOpen, today } = useApp();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => parseQuickAdd(draft, today), [draft, today]);

  const close = () => {
    setDraft("");
    setComposeOpen(false);
  };

  const submit = async () => {
    if (!parsed.title || busy) return;
    setBusy(true);
    const created = await addTask(draft);
    setBusy(false);
    // Adding several in a row is the common case, so the field clears and keeps
    // focus rather than closing. Escape (or blurring an empty field) closes it.
    if (created) {
      setDraft("");
      inputRef.current?.focus();
    }
  };

  return (
    <div className="addrow addrow-open">
      <form
        className="addrow-line"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <span className="box box-add" />
        <input
          ref={inputRef}
          autoFocus
          className="palette-input"
          placeholder="Add a task…  @tomorrow  #api  /Work  =45m"
          value={draft}
          disabled={busy}
          onChange={(event) => setDraft(event.currentTarget.value)}
          /* Only an abandoned empty row closes itself. Blurring with text in it
             (clicking a row, alt-tabbing) must not silently commit or discard
             what was typed — Enter commits, Escape discards. */
          onBlur={() => {
            if (!draft.trim()) close();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              close();
            }
          }}
        />
        <span className="addrow-hint text-muted">
          <Kbd>↵</Kbd> add <Kbd>Esc</Kbd> close
        </span>
      </form>

      {/* The echo only earns its line once there is something to echo. */}
      {parsed.title && (
        <div className="addrow-echo">
          <span className="tag tag-outline">{dueChip(parsed.due, today)}</span>
          {parsed.list && <span className="tag tag-neutral">{parsed.list}</span>}
          {parsed.estimateMinutes !== undefined && (
            <span className="tag tag-neutral">{formatMinutes(parsed.estimateMinutes)}</span>
          )}
          {parsed.tags.map((tag) => (
            <span className="tag tag-neutral" key={tag}>
              #{tag}
            </span>
          ))}
          {parsed.unknown.map((word) => (
            <span className="tag tag-accent" key={word}>
              {word}?
            </span>
          ))}
          <span className="text-muted addrow-echo-title">{parsed.title}</span>
        </div>
      )}
    </div>
  );
}

/** The collapsed affordance that opens the row. */
export function AddTaskButton() {
  const { setComposeOpen } = useApp();
  return (
    <button type="button" className="addrow" onClick={() => setComposeOpen(true)}>
      <span className="box box-add" />
      <span>Add a task…</span>
      <span style={{ marginLeft: "auto" }}>
        <Kbd>N</Kbd>
      </span>
    </button>
  );
}
