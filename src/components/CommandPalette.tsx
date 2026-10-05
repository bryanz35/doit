/** ⌘K palette — a floating search panel in the style of Spotlight. The
 *  scheduling actions are UI-only stubs for now; creating a task is real. */

import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../data/store";
import { listColor } from "../data/scope";
import { CalendarIcon, FocusIcon, PlusIcon, SearchIcon } from "./icons";
import { Kbd, dueLabel } from "./primitives";

interface Action {
  id: string;
  label: string;
  Icon: typeof PlusIcon;
  run: () => void;
}

export function CommandPalette() {
  const { tasks, paletteOpen, setPaletteOpen, selectTask, setPage, addTask, setComposeOpen, today } =
    useApp();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (paletteOpen) {
      setQuery("");
      setCursor(0);
      inputRef.current?.focus();
    }
  }, [paletteOpen]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const open = tasks.filter((task) => task.status !== "done");
    if (!needle) return open.slice(0, 5);
    return open
      .filter((task) =>
        needle
          .split(/\s+/)
          .every((word) => task.title.toLowerCase().includes(word)),
      )
      .slice(0, 5);
  }, [tasks, query]);

  const target = matches[0];

  // TODO(backend): the scheduling / timer actions become real commands once
  // Rust is wired. Creating is not a stub — it runs `create_task`.
  const actions = useMemo<Action[]>(() => {
    const typed = query.trim();
    const create: Action = typed
      ? {
          id: "create",
          // Quick-add sigils work here too, so the label echoes the raw line
          // rather than the parsed title.
          label: `Create task “${typed}”`,
          Icon: PlusIcon,
          run: () => {
            void addTask(typed);
            setPage("tasks");
          },
        }
      : {
          id: "create-empty",
          label: "New task…",
          Icon: PlusIcon,
          run: () => {
            setPage("tasks");
            setComposeOpen(true);
          },
        };
    // An exact title match means the user is looking for the task they already
    // have, not making a second one with the same name.
    const duplicate = typed
      ? tasks.some((task) => task.title.toLowerCase() === typed.toLowerCase())
      : false;
    const head = duplicate ? [] : [create];
    if (!target) return head;
    return [
      ...head,
      {
        id: "schedule-today",
        label: `Schedule “${target.title}” → today 12:00`,
        Icon: CalendarIcon,
        run: () => {
          selectTask(target.id);
          setPage("calendar");
        },
      },
      {
        id: "schedule-later",
        label: `Schedule “${target.title}” → Fri 22, 09:00`,
        Icon: CalendarIcon,
        run: () => {
          selectTask(target.id);
          setPage("calendar");
        },
      },
      {
        id: "focus",
        label: `Start focus session on “${target.title}”`,
        Icon: FocusIcon,
        run: () => {
          selectTask(target.id);
          setPage("focus");
        },
      },
    ];
  }, [target, tasks, query, selectTask, setPage, addTask, setComposeOpen]);

  if (!paletteOpen) return null;

  const rows = [
    ...actions.map((action) => ({ kind: "action" as const, action })),
    ...matches.map((task) => ({ kind: "task" as const, task })),
  ];

  const close = () => setPaletteOpen(false);

  const commit = (index: number) => {
    const row = rows[index];
    if (!row) return;
    if (row.kind === "action") row.action.run();
    else {
      selectTask(row.task.id);
      setPage("tasks");
    }
    close();
  };

  return (
    <div className="dt-scrim palette-scrim" onClick={close} role="presentation">
      <div
        className="dt-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dt-palette-search">
          <SearchIcon size={20} />
          <input
            ref={inputRef}
            className="dt-palette-input"
            placeholder="Search tasks and actions"
            aria-label="Search tasks and actions"
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              setCursor(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setCursor((c) => Math.min(c + 1, rows.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              } else if (event.key === "Enter") {
                commit(cursor);
              } else if (event.key === "Escape") {
                close();
              }
            }}
          />
          <Kbd>Esc</Kbd>
        </div>

        <div className="dt-palette-list" role="listbox">
          {actions.length > 0 && <div className="dt-palette-section">Actions</div>}
          {actions.map((action, index) => (
            <button
              key={action.id}
              type="button"
              role="option"
              aria-selected={cursor === index}
              className="dt-palette-item"
              onMouseEnter={() => setCursor(index)}
              onClick={() => commit(index)}
            >
              <action.Icon size={16} />
              {action.label}
              {cursor === index && <span className="dt-trail">↵</span>}
            </button>
          ))}

          {matches.length > 0 && <div className="dt-palette-section">Tasks</div>}
          {matches.map((task, index) => {
            const rowIndex = actions.length + index;
            return (
              <button
                key={task.id}
                type="button"
                role="option"
                aria-selected={cursor === rowIndex}
                className="dt-palette-item"
                data-color={listColor(task.list)}
                onMouseEnter={() => setCursor(rowIndex)}
                onClick={() => commit(rowIndex)}
              >
                <span className="dt-check" aria-hidden="true" />
                {task.title}
                <span className="dt-trail">{dueLabel(task.due, today)}</span>
              </button>
            );
          })}

          {rows.length === 0 && <div className="dt-palette-section">No matches.</div>}
        </div>

        <div className="dt-palette-foot">
          <span>
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> move
          </span>
          <span>
            <Kbd>↵</Kbd> run
          </span>
          <span>
            <Kbd>Esc</Kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
