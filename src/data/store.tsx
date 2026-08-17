/** App state.
 *
 * BACKEND SEAM: every mutation below currently edits React state only. Each one
 * should become an `invoke("...")` call into Rust, with the returned rows
 * replacing local state (or an optimistic update reconciled against it).
 * Nothing outside this file talks to a data source. */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { PageId, Task } from "../types";
import { TODAY, tasks as seedTasks } from "./mock";

interface AppState {
  tasks: Task[];
  /** Task shown in the detail pane / focus screen. */
  selectedTaskId: string | null;
  page: PageId;
  paletteOpen: boolean;

  setPage: (page: PageId) => void;
  selectTask: (id: string | null) => void;
  toggleTask: (id: string) => void;
  addTask: (title: string) => void;
  setPaletteOpen: (open: boolean) => void;

  today: string;
  taskById: (id: string | null | undefined) => Task | undefined;
}

const AppContext = createContext<AppState | null>(null);

let nextId = 0;

const PAGES: PageId[] = ["tasks", "calendar", "focus", "graph", "settings"];

function pageFromHash(): PageId {
  const hash = window.location.hash.replace("#", "");
  return PAGES.includes(hash as PageId) ? (hash as PageId) : "tasks";
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>(seedTasks);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>("t-onboarding");
  // The rail is the real navigation; the hash just makes a page deep-linkable
  // (handy in the browser during development).
  const [page, setPage] = useState<PageId>(pageFromHash());
  const [paletteOpen, setPaletteOpen] = useState(false);

  // TODO(backend): invoke("toggle_task", { id }) and take the updated row back.
  const toggleTask = useCallback((id: string) => {
    setTasks((current) =>
      current.map((task) =>
        task.id === id
          ? {
              ...task,
              status: task.status === "done" ? "todo" : "done",
              completedAt:
                task.status === "done"
                  ? undefined
                  : new Date().toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    }),
            }
          : task,
      ),
    );
  }, []);

  // TODO(backend): invoke("create_task", { title, due }) — the id should come
  // from the store, not the client.
  const addTask = useCallback((title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    nextId += 1;
    const task: Task = {
      id: `local-${nextId}`,
      title: trimmed,
      status: "todo",
      due: TODAY,
      list: "Work",
      tags: [],
      dependsOn: [],
    };
    setTasks((current) => [...current, task]);
    setSelectedTaskId(task.id);
  }, []);

  const value = useMemo<AppState>(
    () => ({
      tasks,
      selectedTaskId,
      page,
      paletteOpen,
      setPage,
      selectTask: setSelectedTaskId,
      toggleTask,
      addTask,
      setPaletteOpen,
      today: TODAY,
      taskById: (id) => (id ? tasks.find((task) => task.id === id) : undefined),
    }),
    [tasks, selectedTaskId, page, paletteOpen, toggleTask, addTask],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp must be used inside <AppProvider>");
  return value;
}
