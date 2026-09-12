/** App state.
 *
 * BACKEND SEAM: this is the only file that calls `invoke`. Every mutation sends
 * a command to Rust and folds the row it returns back into local state, so the
 * database stays the source of truth for derived fields (ids, completedAt).
 * Pages never see `invoke` — they call the functions on this context. */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PageId, Task, TaskPatch } from "../types";

interface AppState {
  tasks: Task[];
  /** Task shown in the detail pane / focus screen. */
  selectedTaskId: string | null;
  page: PageId;
  paletteOpen: boolean;

  /** False until the first `list_tasks` settles, so an empty list can be told
   *  apart from a list that has not arrived yet. */
  loaded: boolean;
  /** Message from the last failed command, already formatted by AppError. */
  error: string | null;

  setPage: (page: PageId) => void;
  selectTask: (id: string | null) => void;
  toggleTask: (id: string) => void;
  addTask: (title: string) => void;
  updateTask: (id: string, patch: TaskPatch) => void;
  deleteTask: (id: string) => void;
  refresh: () => void;
  setPaletteOpen: (open: boolean) => void;

  today: string;
  taskById: (id: string | null | undefined) => Task | undefined;
}

const AppContext = createContext<AppState | null>(null);

const PAGES: PageId[] = ["tasks", "calendar", "focus", "graph", "settings"];

function pageFromHash(): PageId {
  const hash = window.location.hash.replace("#", "");
  return PAGES.includes(hash as PageId) ? (hash as PageId) : "tasks";
}

/** Local calendar date as YYYY-MM-DD — the same shape the `due` column stores.
 *  `toISOString()` would be wrong here: it converts to UTC first, so an evening
 *  west of Greenwich reports tomorrow. */
function todayIso(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** A rejected `invoke` throws whatever the command's `Err` serialized to — for
 *  AppError that is the `#[error("...")]` string. Anything else is a bug on our
 *  side (bad command name, missing handler entry) and still needs showing. */
function messageOf(err: unknown): string {
  return typeof err === "string" ? err : err instanceof Error ? err.message : String(err);
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The rail is the real navigation; the hash just makes a page deep-linkable
  // (handy in the browser during development).
  const [page, setPage] = useState<PageId>(pageFromHash());
  const [paletteOpen, setPaletteOpen] = useState(false);

  const [today] = useState(todayIso);

  /** Replace one task in place, keeping the backend's ordering. */
  const merge = useCallback((task: Task) => {
    setTasks((current) => current.map((t) => (t.id === task.id ? task : t)));
  }, []);

  const refresh = useCallback(async () => {
    try {
      setTasks(await invoke<Task[]>("list_tasks"));
      setError(null);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggleTask = useCallback(
    async (id: string) => {
      try {
        merge(await invoke<Task>("toggle_task", { id }));
        setError(null);
      } catch (err) {
        setError(messageOf(err));
      }
    },
    [merge],
  );

  const addTask = useCallback(async (title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    try {
      // The id and sort order come from the store, so the created row is
      // appended as returned rather than guessed at here.
      const task = await invoke<Task>("create_task", { title: trimmed, due: todayIso() });
      setTasks((current) => [...current, task]);
      setSelectedTaskId(task.id);
      setError(null);
    } catch (err) {
      setError(messageOf(err));
    }
  }, []);

  const updateTask = useCallback(
    async (id: string, patch: TaskPatch) => {
      try {
        merge(await invoke<Task>("update_task", { id, patch }));
        setError(null);
      } catch (err) {
        setError(messageOf(err));
      }
    },
    [merge],
  );

  const deleteTask = useCallback(async (id: string) => {
    try {
      await invoke<void>("delete_task", { id });
      setTasks((current) => current.filter((t) => t.id !== id));
      setSelectedTaskId((current) => (current === id ? null : current));
      setError(null);
    } catch (err) {
      setError(messageOf(err));
    }
  }, []);

  const value = useMemo<AppState>(
    () => ({
      tasks,
      selectedTaskId,
      page,
      paletteOpen,
      loaded,
      error,
      setPage,
      selectTask: setSelectedTaskId,
      toggleTask,
      addTask,
      updateTask,
      deleteTask,
      refresh,
      setPaletteOpen,
      today,
      taskById: (id) => (id ? tasks.find((task) => task.id === id) : undefined),
    }),
    [
      tasks,
      selectedTaskId,
      page,
      paletteOpen,
      loaded,
      error,
      toggleTask,
      addTask,
      updateTask,
      deleteTask,
      refresh,
      today,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp must be used inside <AppProvider>");
  return value;
}
