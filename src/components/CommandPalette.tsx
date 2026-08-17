/** ⌘K palette — screen 1f. Actions are UI-only stubs for now. */

import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../data/store";
import { SearchIcon } from "./icons";
import { CheckBox, Kbd } from "./primitives";

interface Action {
  id: string;
  label: string;
  run: () => void;
}

export function CommandPalette() {
  const { tasks, paletteOpen, setPaletteOpen, selectTask, setPage } = useApp();
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

  // TODO(backend): these become scheduling / timer commands once Rust is wired.
  const actions = useMemo<Action[]>(() => {
    if (!target) return [];
    return [
      {
        id: "schedule-today",
        label: `Schedule “${target.title}” → today 12:00`,
        run: () => {
          selectTask(target.id);
          setPage("calendar");
        },
      },
      {
        id: "schedule-later",
        label: `Schedule “${target.title}” → Fri 22, 09:00`,
        run: () => {
          selectTask(target.id);
          setPage("calendar");
        },
      },
      {
        id: "focus",
        label: `Start focus session on “${target.title}”`,
        run: () => {
          selectTask(target.id);
          setPage("focus");
        },
      },
    ];
  }, [target, selectTask, setPage]);

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
    <div
      className="palette-backdrop"
      onClick={close}
      role="presentation"
    >
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="palette-search">
          <span style={{ color: "var(--color-accent)", display: "flex" }}>
            <SearchIcon />
          </span>
          <input
            ref={inputRef}
            className="palette-input"
            placeholder="Search tasks and actions…"
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

        <div className="palette-list">
          {actions.length > 0 && (
            <div className="palette-section">
              <h6 style={{ margin: 0, color: "var(--color-neutral-700)" }}>Actions</h6>
            </div>
          )}
          {actions.map((action, index) => (
            <button
              key={action.id}
              type="button"
              className={`palette-item${cursor === index ? " palette-item-on" : ""}`}
              onMouseEnter={() => setCursor(index)}
              onClick={() => commit(index)}
            >
              {action.label}
              {cursor === index && (
                <span style={{ marginLeft: "auto", font: "600 10px ui-monospace, Menlo, monospace", opacity: 0.8 }}>
                  ↵
                </span>
              )}
            </button>
          ))}

          {matches.length > 0 && (
            <div className="palette-section" style={{ marginTop: 6 }}>
              <h6 style={{ margin: 0, color: "var(--color-neutral-700)" }}>Tasks</h6>
            </div>
          )}
          {matches.map((task, index) => {
            const rowIndex = actions.length + index;
            return (
              <button
                key={task.id}
                type="button"
                className={`palette-item${cursor === rowIndex ? " palette-item-on" : ""}`}
                onMouseEnter={() => setCursor(rowIndex)}
                onClick={() => commit(rowIndex)}
              >
                <CheckBox label={task.title} />
                {task.title}
                <span className="text-muted" style={{ marginLeft: "auto", fontSize: 12 }}>
                  {task.due ?? "Someday"}
                </span>
              </button>
            );
          })}

          {rows.length === 0 && (
            <div className="palette-section text-muted" style={{ fontSize: 13 }}>
              No matches.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
