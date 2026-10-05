/** The compose row — the one place a task gets created.
 *
 * Renders in the task list, above the table, and inside the inbox-zero state,
 * so "New task" and `N` always land somewhere. The line is quick-add text (see
 * data/quickadd.ts); what it parsed to is echoed under the field so the sigils
 * are discoverable without a legend. */

import { useMemo, useRef, useState } from "react";
import { useApp } from "../data/store";
import { parseQuickAdd } from "../data/quickadd";
import { INBOX } from "../data/scope";
import { PlusIcon } from "./icons";
import { Kbd, dueLabel, formatMinutes } from "./primitives";

export function AddTaskRow() {
  const { addTask, setComposeOpen, today, scope } = useApp();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Adding while a list is open files the task there unless the line names its
  // own `/list` — the sigil cannot spell a name with a space, so neither can
  // this, and Inbox is simply no list.
  const line = useMemo(() => {
    if (scope.kind !== "list" || scope.name === INBOX || /\s/.test(scope.name)) return draft;
    return parseQuickAdd(draft, today).list ? draft : `${draft} /${scope.name}`;
  }, [draft, scope, today]);
  const parsed = useMemo(() => parseQuickAdd(line, today), [line, today]);

  const close = () => {
    setDraft("");
    setComposeOpen(false);
  };

  const submit = async () => {
    if (!parsed.title || busy) return;
    setBusy(true);
    const created = await addTask(line);
    setBusy(false);
    // Adding several in a row is the common case, so the field clears and keeps
    // focus rather than closing. Escape (or blurring an empty field) closes it.
    if (created) {
      setDraft("");
      inputRef.current?.focus();
    }
  };

  return (
    <div className="dt-add-open">
      <form
        className="dt-add-line"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <span className="dt-check dt-check-add" />
        <input
          ref={inputRef}
          autoFocus
          className="dt-add-input"
          aria-label="New task"
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
        <span className="dt-add-hint">
          <Kbd>↵</Kbd> add <Kbd>Esc</Kbd> close
        </span>
      </form>

      {/* The echo only earns its line once there is something to echo. */}
      {parsed.title && (
        <div className="dt-add-echo">
          <span className="dt-tag dt-tag-accent">{dueLabel(parsed.due ?? undefined, today)}</span>
          {parsed.list && <span className="dt-tag">{parsed.list}</span>}
          {parsed.estimateMinutes !== undefined && (
            <span className="dt-tag">{formatMinutes(parsed.estimateMinutes)}</span>
          )}
          {parsed.tags.map((tag) => (
            <span className="dt-tag" key={tag}>
              #{tag}
            </span>
          ))}
          {parsed.unknown.map((word) => (
            <span className="dt-tag dt-tag-unknown" key={word}>
              {word}?
            </span>
          ))}
          <span className="dt-muted add-echo-title">{parsed.title}</span>
        </div>
      )}
    </div>
  );
}

/** The collapsed affordance that opens the row. */
export function AddTaskButton() {
  const { setComposeOpen } = useApp();
  return (
    <button type="button" className="dt-add" onClick={() => setComposeOpen(true)}>
      <PlusIcon size={16} stroke={2.5} />
      New task
      <Kbd>N</Kbd>
    </button>
  );
}
