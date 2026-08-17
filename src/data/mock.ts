/** In-memory sample data mirroring the design mockups.
 *
 * BACKEND SEAM: every export here is what a Tauri command will eventually
 * return. Replace the bodies of `src/data/store.ts` with `invoke(...)` calls and
 * this file can be deleted. */

import type {
  CalendarAccount,
  CalendarEvent,
  GraphEdge,
  GraphNode,
  Task,
  TaskListSummary,
} from "../types";

/** The mockups are set on Friday 14 August 2026; the sample data is anchored to
 *  that so the "Today"/"Overdue" grouping reads the way it does in the design. */
export const TODAY = "2026-08-14";

export const tasks: Task[] = [
  {
    id: "t-budget",
    title: "Send the Q3 budget draft to Priya",
    status: "todo",
    due: "2026-08-13",
    estimateMinutes: 25,
    list: "Work",
    tags: ["finance"],
    dependsOn: [],
  },
  {
    id: "t-review",
    title: "Design review with the platform team",
    status: "todo",
    due: TODAY,
    estimateMinutes: 45,
    list: "Work",
    tags: [],
    dependsOn: [],
  },
  {
    id: "t-onboarding",
    title: "Rewrite the onboarding empty state",
    notes:
      "The zero-task screen currently shows nothing but a heading. Needs a first-run prompt and the keybind legend.",
    status: "in-progress",
    due: TODAY,
    estimateMinutes: 75,
    pomodoros: 3,
    list: "Work",
    tags: ["web", "copy"],
    repo: "web",
    dependsOn: ["t-pr"],
  },
  {
    id: "t-auth",
    title: "Fix flaky auth test on CI",
    status: "in-progress",
    due: TODAY,
    estimateMinutes: 50,
    list: "Work",
    tags: [],
    repo: "api-core",
    dependsOn: ["t-spec"],
  },
  {
    id: "t-pr",
    title: "Review PR #2841 — token refresh",
    status: "todo",
    due: TODAY,
    estimateMinutes: 25,
    list: "Work",
    tags: [],
    repo: "api-core",
    dependsOn: ["t-spec"],
  },
  {
    id: "t-offsite",
    title: "Book the offsite room",
    status: "todo",
    due: TODAY,
    estimateMinutes: 10,
    list: "Work",
    tags: [],
    dependsOn: [],
  },
  {
    id: "t-migration",
    title: "Draft migration plan for the events table",
    status: "todo",
    due: "2026-08-22",
    estimateMinutes: 120,
    list: "Work",
    tags: [],
    repo: "api-core",
    dependsOn: [],
  },
  {
    id: "t-runner",
    title: "Migrate the CI runner image",
    status: "todo",
    list: "Someday",
    tags: [],
    repo: "infra",
    dependsOn: [],
  },
  {
    id: "t-node",
    title: "Bump Node to 22 in the dev image",
    status: "done",
    due: TODAY,
    estimateMinutes: 20,
    completedAt: "08:40",
    list: "Work",
    tags: [],
    repo: "infra",
    dependsOn: [],
  },
  {
    id: "t-vendor",
    title: "Reply to the vendor security questionnaire",
    status: "done",
    due: TODAY,
    completedAt: "09:15",
    list: "Work",
    tags: [],
    dependsOn: [],
  },
  {
    id: "t-spec",
    title: "Spec the token refresh flow",
    status: "done",
    completedAt: "Tue",
    list: "Work",
    tags: [],
    repo: "api-core",
    dependsOn: [],
  },
];

export const lists: TaskListSummary[] = [
  { name: "Work", count: 18 },
  { name: "Home", count: 6 },
  { name: "Someday", count: 31 },
];

/** Monday of the week the mockups show (10–16 August 2026). */
export const weekStart = "2026-08-10";
/** Column index of "today" within that week. */
export const todayColumn = 4;

const hm = (h: number, m = 0) => h * 60 + m;

export const events: CalendarEvent[] = [
  { id: "e1", title: "Standup", dayIndex: 0, startMinutes: hm(9, 30), durationMinutes: 30, kind: "external", subtitle: "09:30" },
  { id: "e2", title: "Migration plan", dayIndex: 0, startMinutes: hm(10, 15), durationMinutes: 55, kind: "task", taskId: "t-migration", subtitle: "2 pomodoros" },
  { id: "e3", title: "Standup", dayIndex: 1, startMinutes: hm(9, 30), durationMinutes: 30, kind: "external", subtitle: "09:30" },
  { id: "e4", title: "1:1 — Priya", dayIndex: 1, startMinutes: hm(13), durationMinutes: 40, kind: "external", subtitle: "13:00" },
  { id: "e5", title: "Onboarding empty state", dayIndex: 2, startMinutes: hm(10, 30), durationMinutes: 65, kind: "task", taskId: "t-onboarding", subtitle: "3 pomodoros" },
  { id: "e6", title: "Standup", dayIndex: 3, startMinutes: hm(9, 30), durationMinutes: 30, kind: "external" },
  { id: "e7", title: "Vendor call", dayIndex: 3, startMinutes: hm(14), durationMinutes: 45, kind: "external", subtitle: "14:00" },
  { id: "e8", title: "Design review", dayIndex: 4, startMinutes: hm(10), durationMinutes: 45, kind: "external", subtitle: "10:00" },
  { id: "e9", title: "Draft migration plan", dayIndex: 4, startMinutes: hm(12), durationMinutes: 60, kind: "task", taskId: "t-migration", subtitle: "12:00 – 13:00", ghost: true },
  { id: "e10", title: "Budget draft → Priya", dayIndex: 4, startMinutes: hm(14), durationMinutes: 30, kind: "external" },
];

/** Ids of tasks shown in the calendar's "Unscheduled" tray. */
export const unscheduledTaskIds = ["t-auth", "t-pr", "t-offsite", "t-migration"];

export const graphNodes: GraphNode[] = [
  { id: "n-spec", taskId: "t-spec", label: "Spec the token refresh flow", kicker: "DONE", x: 90, y: 120, width: 160, variant: "done" },
  { id: "n-pr", taskId: "t-pr", label: "Review PR #2841 — token refresh", kicker: "SELECTED · 2 LINKS", x: 410, y: 212, width: 230, variant: "selected" },
  { id: "n-auth", taskId: "t-auth", label: "Fix flaky auth test on CI", kicker: "IN PROGRESS", sub: "50m · api-core", x: 410, y: 380, width: 210, variant: "default" },
  { id: "n-ship", label: "Ship 2.4 to staging", kicker: "BLOCKED", sub: "waits on 2 nodes", x: 800, y: 140, width: 230, variant: "default" },
  { id: "n-migration", taskId: "t-migration", label: "Draft migration plan", kicker: "TODO", sub: "2h · Fri 22", x: 800, y: 385, width: 210, variant: "default" },
  { id: "n-release", label: "Write the release note", kicker: "TODO", x: 800, y: 530, width: 190, variant: "default" },
  { id: "n-ratelimit", label: "Rate-limit the refresh endpoint", kicker: "IDEA", x: 90, y: 530, width: 160, variant: "idea" },
];

export const graphEdges: GraphEdge[] = [
  { id: "g1", from: "n-spec", to: "n-pr" },
  { id: "g2", from: "n-spec", to: "n-auth" },
  { id: "g3", from: "n-pr", to: "n-ship" },
  { id: "g4", from: "n-pr", to: "n-migration" },
  { id: "g5", from: "n-auth", to: "n-release" },
  { id: "g6", from: "n-ship", to: "n-migration" },
  { id: "g7", from: "n-ratelimit", to: "n-auth", dashed: true },
];

export const calendarAccounts: CalendarAccount[] = [
  {
    id: "google",
    name: "Google Calendar",
    badge: "G",
    connected: true,
    detail: "dev@example.com · 3 calendars · synced 4m ago",
    sync: "two-way",
  },
  { id: "outlook", name: "Outlook", badge: "O", connected: false, detail: "Not connected" },
  { id: "icloud", name: "iCloud Calendar", badge: "IC", connected: false, detail: "Not connected" },
];

export const feedUrl = "https://ledger.app/ics/8f3a1c7d-4e21-mode-scheduled.ics";
