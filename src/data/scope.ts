/** Smart lists, lists and their colours — how the sidebar and the tasks screen
 *  slice the one flat task array.
 *
 *  Lists are a plain column on `tasks`, not a table of their own, so a list has
 *  no stored colour. Each name hashes to one of the design's `list-*` hues,
 *  which keeps a list the same colour on every screen and across restarts.
 *  Tasks with no list are "Inbox", in blue. */

import type { Task, TaskScope } from "../types";

export type ListColor =
  | "red" | "orange" | "yellow" | "green" | "teal" | "blue"
  | "indigo" | "purple" | "pink" | "brown" | "gray";

export const INBOX = "Inbox";

/** Red reads as overdue and gray as done, so neither is handed out to a list;
 *  blue is Inbox's. */
const LIST_HUES: ListColor[] = ["orange", "purple", "green", "teal", "indigo", "pink", "yellow", "brown"];

export function listColor(list: string | undefined): ListColor {
  if (!list || list === INBOX) return "blue";
  let hash = 0;
  for (const char of list) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return LIST_HUES[Math.abs(hash) % LIST_HUES.length];
}

export type SmartId = Extract<TaskScope, { kind: "smart" }>["id"];

export const SMART_LISTS: { id: SmartId; label: string; color: ListColor }[] = [
  { id: "today", label: "Today", color: "blue" },
  { id: "overdue", label: "Overdue", color: "red" },
  { id: "all", label: "All", color: "gray" },
  { id: "completed", label: "Completed", color: "green" },
];

const isOverdue = (task: Task, today: string) =>
  task.status !== "done" && task.due !== undefined && task.due < today;

/** Today includes what is overdue, as Reminders' Today does; Overdue is just
 *  that slice. Completed is the done tasks whatever the status filter says. */
export function inScope(task: Task, scope: TaskScope, today: string): boolean {
  if (scope.kind === "list") return (task.list ?? INBOX) === scope.name;
  switch (scope.id) {
    case "today":
      return task.status === "done"
        ? task.due === today
        : task.due !== undefined && task.due <= today;
    case "overdue":
      return isOverdue(task, today);
    case "completed":
      return task.status === "done";
    case "all":
      return true;
  }
}

export function scopeTitle(scope: TaskScope): string {
  if (scope.kind === "list") return scope.name;
  return SMART_LISTS.find((smart) => smart.id === scope.id)?.label ?? "";
}

export function scopeColor(scope: TaskScope): ListColor {
  if (scope.kind === "list") return listColor(scope.name);
  return SMART_LISTS.find((smart) => smart.id === scope.id)?.color ?? "blue";
}

export function sameScope(a: TaskScope, b: TaskScope): boolean {
  return a.kind === "list"
    ? b.kind === "list" && a.name === b.name
    : b.kind === "smart" && a.id === b.id;
}

/** Open-task count per smart list — what the sidebar tiles show. Completed
 *  counts done tasks, since it has no open ones. */
export function smartCount(tasks: Task[], id: SmartId, today: string): number {
  const scope: TaskScope = { kind: "smart", id };
  return tasks.filter(
    (task) => inScope(task, scope, today) && (id === "completed" || task.status !== "done"),
  ).length;
}

/** Every list with an open task, alphabetically, with its open count. */
export function openLists(tasks: Task[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    if (task.status === "done") continue;
    const name = task.list ?? INBOX;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
