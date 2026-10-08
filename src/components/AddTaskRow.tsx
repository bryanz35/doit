/** The compose row — the one place a task gets created.
 *
 * Renders in the task list, above the table, and inside the inbox-zero state,
 * so "New task" and `N` always land somewhere. The line is quick-add text (see
 * data/quickadd.ts); what it parsed to is echoed under the field so the sigils
 * are discoverable without a legend. */

import { useMemo, useState } from "react";
import { useApp } from "../data/store";
import { parseQuickAdd } from "../data/quickadd";
import { INBOX } from "../data/scope";
import type { Task } from "../types";
import { PlusIcon } from "./icons";
import { Kbd, dueLabel, formatMinutes } from "./primitives";
import { TitleInput } from "./TitleInput";

export function AddTaskRow({
  vim = false,
  anchor,
  onCreated,
}: {
  /** Opened by `o`/`O` on the list: Esc adds what was typed, as leaving
   *  insert mode keeps the new line in vim, rather than discarding it. */
  vim?: boolean;
  /** The task this row was opened next to. The new task takes its due date and
   *  list unless the line names its own, so it lands in the same section. */
  anchor?: Task;
  /** A task was added and the row stays open for the next. */
  onCreated?: (task: Task) => void;
}) {
  const { addTask, setComposeOpen, today, scope } = useApp();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  // Adding while a list is open files the task there unless the line names its
  // own `/list` — the sigil cannot spell a name with a space, so neither can
  // this, and Inbox is simply no list.
  const line = useMemo(() => {
    const own = parseQuickAdd(draft, today);
    let text = draft;
    if (anchor && !own.dueGiven) text += ` @${anchor.due ?? "someday"}`;
    const list = anchor ? anchor.list : scope.kind === "list" ? scope.name : undefined;
    if (!own.list && list && list !== INBOX && !/\s/.test(list)) text += ` /${list}`;
    return text;
  }, [draft, scope, today, anchor]);
  const parsed = useMemo(() => parseQuickAdd(line, today), [line, today]);

  const close = () => {
    setDraft("");
    setComposeOpen(false);
  };

  const submit = async (closeAfter = false) => {
    if (busy) return;
    if (!parsed.title) {
      if (closeAfter) close();
      return;
    }
    setBusy(true);
    const created = await addTask(line);
    setBusy(false);
    if (!created) return;
    if (closeAfter) {
      close();
      return;
    }
    // Adding several in a row is the common case, so the field clears and keeps
    // focus rather than closing. Escape (or blurring an empty field) closes it.
    setDraft("");
    onCreated?.(created);
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
        <TitleInput
          className="dt-add-input"
          label="New task"
          placeholder="Add a task…  @tomorrow  #api  /Work  =45m"
          value={draft}
          disabled={busy}
          onChange={setDraft}
          /* Enter is vim's newline: add, then keep composing (under the new
             task, for `o`/`O`). */
          onEnter={() => void submit()}
          onEscape={() => (vim ? void submit(true) : close())}
          /* Only an abandoned empty row closes itself. Blurring with text in it
             (clicking a row, alt-tabbing) must not silently commit or discard
             what was typed. */
          onBlur={() => {
            if (!draft.trim()) close();
          }}
        />
        {!vim && (
          <span className="dt-add-hint">
            <Kbd>↵</Kbd> add <Kbd>Esc</Kbd> close
          </span>
        )}
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
