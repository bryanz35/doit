/** Domain types shared with the Rust side.
 *
 * `Task`/`TaskStatus`/`TaskPatch` are the deserialized results of `invoke(...)`
 * and must stay in step with the serde structs in src-tauri/src/model.rs by hand
 * (JS camelCase ↔ Rust snake_case) — `invoke<Task>(...)` asserts, it does not
 * validate. The rest still describe mock data for screens with no backend. */

export type PageId = "tasks" | "calendar" | "focus" | "graph" | "settings";

export type TaskStatus = "todo" | "in-progress" | "done" | "idea" | "blocked";

export interface Task {
  id: string;
  title: string;
  notes?: string;
  status: TaskStatus;
  /** ISO date (YYYY-MM-DD). Undefined means unscheduled / someday. */
  due?: string;
  /** Estimate in minutes. */
  estimateMinutes?: number;
  /** Estimate expressed as pomodoros, when the user set one. */
  pomodoros?: number;
  list?: string;
  tags: string[];
  repo?: string;
  /** RFC3339 UTC stamp written when the task became done; the Completed group
   *  formats it for display. */
  completedAt?: string;
  /** ids of tasks this one depends on — drawn as graph edges. */
  dependsOn: string[];
  /** Calendar blocks, ordered by start. Always present — the backend sends an
   *  empty array for a task that has never been scheduled. */
  blocks: TaskBlock[];
}

/** One scheduled span of work on a task — mirrors `TaskBlock` in model.rs.
 *
 *  `startAt`/`endAt` are UTC instants spelled exactly `YYYY-MM-DDTHH:MM:SSZ`.
 *  The backend rejects any other spelling (no offset, no milliseconds), so
 *  build them with `toInstant` in src/data/instants.ts rather than
 *  `Date.toISOString()`, which appends `.sssZ`.
 *
 *  `tz` is the IANA zone the block was authored in, kept for calendar export;
 *  undefined means floating — render in whatever zone the app is in. */
export interface TaskBlock {
  id: string;
  taskId: string;
  startAt: string;
  endAt: string;
  tz?: string;
}

export interface GraphNode {
  id: string;
  taskId?: string;
  label: string;
  kicker: string;
  sub?: string;
  x: number;
  y: number;
  width: number;
  variant: "default" | "selected" | "idea" | "done";
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  /** Dashed edges are soft/proposed links. */
  dashed?: boolean;
  accent?: boolean;
}

export interface FocusSession {
  taskId: string;
  /** Index of the current session within today's plan, 1-based. */
  index: number;
  plannedSessions: number;
  workMinutes: number;
  breakMinutes: number;
  remainingSeconds: number;
  running: boolean;
  /** Completed pomodoros today, used for the pip row. */
  completedToday: number;
  goalMinutes: number;
  focusedMinutes: number;
}

export interface CalendarAccount {
  id: string;
  name: string;
  badge: string;
  connected: boolean;
  detail: string;
  sync?: "two-way" | "read-only";
}

export interface TaskListSummary {
  name: string;
  count: number;
}

/** Partial update sent to the `update_task` command. Every key is optional and
 *  an absent key means "leave this column alone" — mirrors `TaskPatch` in
 *  src-tauri/src/model.rs, including its limitation: there is no way to clear a
 *  field back to null. */
export interface TaskPatch {
  title?: string;
  notes?: string;
  status?: TaskStatus;
  due?: string;
  estimateMinutes?: number;
}
