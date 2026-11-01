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
import { listen } from "@tauri-apps/api/event";
import type {
  FocusDay,
  FocusKind,
  FocusOutcome,
  FocusSession,
  PageId,
  Task,
  TaskPatch,
  TaskScope,
} from "../types";
import { parseQuickAdd } from "./quickadd";
import { addDays, atMinutes, localZone } from "./instants";
import { focusPrefs, minutesFor, type FocusPrefs } from "./focusplan";
import { todayIso, useToday } from "./clock";

interface AppState {
  tasks: Task[];
  /** Task shown in the detail pane / focus screen. */
  selectedTaskId: string | null;
  page: PageId;
  paletteOpen: boolean;
  /** Whether the tasks screen is showing its compose row. Lives here, not in
   *  TasksPage, so the `N` keybind and the palette can open it from anywhere. */
  composeOpen: boolean;
  /** Which smart list or list the tasks screen shows. Here rather than in
   *  TasksPage because the sidebar, which lives in the shell, sets it. */
  scope: TaskScope;

  /** False until the first `list_tasks` settles, so an empty list can be told
   *  apart from a list that has not arrived yet. */
  loaded: boolean;
  /** Message from the last failed command, already formatted by AppError. */
  error: string | null;

  setPage: (page: PageId) => void;
  selectTask: (id: string | null) => void;
  toggleTask: (id: string) => void;
  /** Takes one line of quick-add text; resolves to the created row, or null if
   *  it had no title or the command failed. */
  addTask: (input: string) => Promise<Task | null>;
  updateTask: (id: string, patch: TaskPatch) => void;
  setTaskTags: (id: string, tags: string[]) => void;
  deleteTask: (id: string) => void;
  /** Schedule a span of work on a task. `startAt`/`endAt` are canonical UTC
   *  instants — build them with the helpers in ./instants. The block's id is
   *  minted by the backend, which returns the whole task back. */
  addBlock: (taskId: string, startAt: string, endAt: string) => void;
  /** Move or resize a block. Replaces the whole span: a drag or a resize
   *  always knows both ends, and the backend has no patch shape for blocks. */
  updateBlock: (blockId: string, startAt: string, endAt: string) => void;
  deleteBlock: (blockId: string) => void;

  /** Stored settings; a missing key means the frontend default. */
  settings: Record<string, string>;
  /** Write one setting, or with `null` reset it to its default. */
  setSetting: (key: string, value: string | null) => void;
  /** Timer lengths and goal, parsed out of `settings` with defaults. */
  focusPrefs: FocusPrefs;

  /** The open focus session, if any. Count down from its `endsAt`. */
  focus: FocusSession | null;
  /** Today's sessions and totals; null until the first read settles. */
  focusDay: FocusDay | null;
  /** Start a session of `kind`, its length taken from `focusPrefs`. */
  /** Each focus command settles once state is re-read, so two can be chained
   *  (finish, then start a break); failures land in `error`, never reject. */
  startFocus: (kind: FocusKind, taskId?: string) => Promise<void>;
  pauseFocus: () => Promise<void>;
  resumeFocus: () => Promise<void>;
  finishFocus: (outcome: FocusOutcome) => Promise<void>;
  logInterruption: (note: string) => Promise<void>;

  setPaletteOpen: (open: boolean) => void;
  setComposeOpen: (open: boolean) => void;
  setScope: (scope: TaskScope) => void;

  today: string;
  taskById: (id: string | null | undefined) => Task | undefined;
}

const AppContext = createContext<AppState | null>(null);

const PAGES: PageId[] = ["tasks", "calendar", "focus", "graph", "settings"];

function pageFromHash(): PageId {
  const hash = window.location.hash.replace("#", "");
  return PAGES.includes(hash as PageId) ? (hash as PageId) : "tasks";
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
  const [composeOpen, setComposeOpen] = useState(false);
  const [scope, setScope] = useState<TaskScope>({ kind: "smart", id: "all" });
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [focus, setFocus] = useState<FocusSession | null>(null);
  const [focusDay, setFocusDay] = useState<FocusDay | null>(null);

  // Rolls over at midnight: the window can stay open for days, and every
  // overdue/today/later split downstream reads this.
  const today = useToday();

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

  const addTask = useCallback(
    async (input: string): Promise<Task | null> => {
      const parsed = parseQuickAdd(input, todayIso());
      if (!parsed.title) return null;
      try {
        // The id and sort order come from the store, so the created row is
        // appended as returned rather than guessed at here. `due: undefined` is
        // omitted by Tauri's serializer, which the Option<String> reads as an
        // unscheduled task — that is what `@someday` asks for.
        let task = await invoke<Task>("create_task", {
          title: parsed.title,
          due: parsed.due ?? undefined,
          list: parsed.list,
        });
        // Shown as soon as it exists, so a failed follow-up below cannot leave a
        // saved task off screen (and a retry would then add it twice).
        const created = task;
        setTasks((current) => [...current, created]);
        setSelectedTaskId(task.id);
        // create_task takes neither of these, so they are follow-up commands.
        // Each returns the whole row, so the last one wins and stays authoritative.
        if (parsed.estimateMinutes !== undefined) {
          task = await invoke<Task>("update_task", {
            id: task.id,
            patch: { estimateMinutes: parsed.estimateMinutes },
          });
          merge(task);
        }
        if (parsed.tags.length > 0) {
          task = await invoke<Task>("set_task_tags", { id: task.id, tags: parsed.tags });
          merge(task);
        }
        setError(null);
        return task;
      } catch (err) {
        setError(messageOf(err));
        return null;
      }
    },
    [merge],
  );

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

  const setTaskTags = useCallback(
    async (id: string, tags: string[]) => {
      try {
        merge(await invoke<Task>("set_task_tags", { id, tags }));
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

  // Blocks. add/update return the whole task like every other mutation, so they
  // fold through `merge`; delete returns nothing, so the row is dropped locally
  // — the only place in this file where state moves without the backend saying
  // what the new row looks like.
  const addBlock = useCallback(
    async (taskId: string, startAt: string, endAt: string) => {
      try {
        merge(await invoke<Task>("add_block", { taskId, startAt, endAt, tz: localZone() }));
        setError(null);
      } catch (err) {
        setError(messageOf(err));
      }
    },
    [merge],
  );

  const updateBlock = useCallback(
    async (blockId: string, startAt: string, endAt: string) => {
      try {
        merge(await invoke<Task>("update_block", { blockId, startAt, endAt, tz: localZone() }));
        setError(null);
      } catch (err) {
        setError(messageOf(err));
      }
    },
    [merge],
  );

  // `delete_block` takes `id`, unlike `update_block`'s `blockId` — the arg keys
  // follow the Rust signatures, which differ.
  const deleteBlock = useCallback(async (blockId: string) => {
    try {
      await invoke<void>("delete_block", { id: blockId });
      setTasks((current) =>
        current.map((task) =>
          task.blocks.some((block) => block.id === blockId)
            ? { ...task, blocks: task.blocks.filter((block) => block.id !== blockId) }
            : task,
        ),
      );
      setError(null);
    } catch (err) {
      setError(messageOf(err));
    }
  }, []);

  // Settings. `set_setting` returns nothing, so the map is updated locally once
  // the write succeeds.
  useEffect(() => {
    invoke<Record<string, string>>("get_settings").then(setSettings, (err) =>
      setError(messageOf(err)),
    );
  }, []);

  const setSetting = useCallback(async (key: string, value: string | null) => {
    try {
      await invoke<void>("set_setting", { key, value: value ?? undefined });
      setSettings((current) => {
        const next = { ...current };
        if (value === null) delete next[key];
        else next[key] = value;
        return next;
      });
      setError(null);
    } catch (err) {
      setError(messageOf(err));
    }
  }, []);

  const prefs = useMemo(() => focusPrefs(settings), [settings]);

  // Focus. Every focus command returns the session it touched; an ended one is
  // no longer "open", and any change moves the day's totals, so the day is
  // re-read after each — it is one small query.
  const loadFocus = useCallback(async () => {
    const [open, day] = await Promise.all([
      invoke<FocusSession | null>("current_focus"),
      invoke<FocusDay>("focus_day", {
        from: atMinutes(today, 0),
        to: atMinutes(addDays(today, 1), 0),
      }),
    ]);
    setFocus(open);
    setFocusDay(day);
  }, [today]);

  const runFocus = useCallback(
    async (command: string, args?: Record<string, unknown>) => {
      try {
        await invoke<FocusSession | null>(command, args);
        await loadFocus();
        setError(null);
      } catch (err) {
        setError(messageOf(err));
      }
    },
    [loadFocus],
  );

  // Re-read on mount, at midnight (`today` moves), and whenever the alarm
  // closes a session that ran out.
  useEffect(() => {
    loadFocus().catch((err) => setError(messageOf(err)));
    let gone = false;
    let unlisten: (() => void) | undefined;
    listen<FocusSession>("focus-ended", () => {
      loadFocus().catch((err) => setError(messageOf(err)));
    }).then((stop) => (gone ? stop() : (unlisten = stop)));
    return () => {
      gone = true;
      unlisten?.();
    };
  }, [loadFocus]);

  const startFocus = useCallback(
    (kind: FocusKind, taskId?: string) =>
      runFocus("start_focus", {
        kind,
        taskId,
        plannedSeconds: minutesFor(kind, prefs) * 60,
      }),
    [runFocus, prefs],
  );
  const pauseFocus = useCallback(() => runFocus("pause_focus"), [runFocus]);
  const resumeFocus = useCallback(() => runFocus("resume_focus"), [runFocus]);
  const finishFocus = useCallback(
    (outcome: FocusOutcome) => runFocus("finish_focus", { outcome }),
    [runFocus],
  );
  const logInterruption = useCallback(
    (note: string) => runFocus("log_interruption", { note }),
    [runFocus],
  );

  const value = useMemo<AppState>(
    () => ({
      tasks,
      selectedTaskId,
      page,
      paletteOpen,
      composeOpen,
      scope,
      loaded,
      error,
      setPage,
      selectTask: setSelectedTaskId,
      toggleTask,
      addTask,
      updateTask,
      setTaskTags,
      deleteTask,
      addBlock,
      updateBlock,
      deleteBlock,
      settings,
      setSetting,
      focusPrefs: prefs,
      focus,
      focusDay,
      startFocus,
      pauseFocus,
      resumeFocus,
      finishFocus,
      logInterruption,
      setPaletteOpen,
      setComposeOpen,
      setScope,
      today,
      taskById: (id) => (id ? tasks.find((task) => task.id === id) : undefined),
    }),
    [
      tasks,
      selectedTaskId,
      page,
      paletteOpen,
      composeOpen,
      scope,
      loaded,
      error,
      toggleTask,
      addTask,
      updateTask,
      setTaskTags,
      deleteTask,
      addBlock,
      updateBlock,
      deleteBlock,
      settings,
      setSetting,
      prefs,
      focus,
      focusDay,
      startFocus,
      pauseFocus,
      resumeFocus,
      finishFocus,
      logInterruption,
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
