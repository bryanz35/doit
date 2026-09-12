/** In-memory sample data for the screens that have no backend yet.
 *
 * BACKEND SEAM: tasks now come from SQLite through `src/data/store.tsx`; what is
 * left here is calendar events, graph nodes and settings accounts, which still
 * have no Tauri commands behind them. Delete each block as its commands land.
 * The `taskId` fields below point at the design mockup's tasks and resolve to
 * nothing in a real database — they are placeholders, not lookups. */

import type {
  CalendarAccount,
  CalendarEvent,
  GraphEdge,
  GraphNode,
} from "../types";

/** Column index of "today" within the week the calendar mockup shows. */
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
