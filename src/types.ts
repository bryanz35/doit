/** Domain types for the UI scaffold.
 *
 * These are the shapes the UI renders today from in-memory mock data. When the
 * Rust side lands, these become the deserialized results of `invoke(...)` — keep
 * field names in sync with the serde structs (JS camelCase ↔ Rust snake_case). */

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
  /** Clock time the task was completed, for the Completed group. */
  completedAt?: string;
  /** ids of tasks this one depends on — drawn as graph edges. */
  dependsOn: string[];
}

/** A block of real time on the calendar: either an imported external event or a
 *  task the user dragged onto the grid. */
export interface CalendarEvent {
  id: string;
  title: string;
  /** 0-6, Monday-indexed, within the displayed week. */
  dayIndex: number;
  /** Minutes from midnight. */
  startMinutes: number;
  durationMinutes: number;
  /** "task" blocks are ours; "external" ones came from Google/Outlook/iCloud. */
  kind: "task" | "external";
  taskId?: string;
  subtitle?: string;
  /** Rendered as a drop preview rather than a committed block. */
  ghost?: boolean;
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
