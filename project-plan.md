# DOIT

DOIT is intended to a clean, lightweight TODO app designed for developers /
project managers.


frontend:
make clean ui with react/claude - check skills plugin
backend: code by self

pages:
 - standard task list
 - calendar page
 - focus page/timer for pomodoro?
 - free whiteboard with draggable elements/graph design
features:
 - import into external calendar

future:
 - command api for llms
 - desktop integration into linux dotfiles

---

# Implementation plan

Current state: ~2k lines of UI, all read-only over `src/data/mock.ts`. The Rust
side is still the Tauri template's `greet`. Nothing calls `invoke`.

"Working" for the first milestone means: tasks survive a restart, the timer is
real, the calendar exports. Everything past that is the scope above.

## 1. Backend — does not exist yet (self-written)

**Storage**

- Pick a store. SQLite (`rusqlite`, bundled feature) over a JSON file — graph
  edges and calendar blocks are relational, and partial writes matter.
- DB path from `app.path().app_data_dir()`, created on first run.
- Schema: `tasks`, `task_tags`, `task_deps` (from_id, to_id), `events`,
  `graph_nodes` (x, y, width, variant per task), `lists`, `settings` kv,
  `focus_sessions`.
- Migration runner (at minimum a `user_version` pragma + match). Needed before
  the first release or data breaks on the next schema change.
- Managed state: `tauri::Manager` + `.manage(Db(Mutex<Connection>))`.

**Command surface** — what the frontend needs. Names match the seam comments
already in the code.

| Command | Returns | Called from |
| --- | --- | --- |
| `list_tasks` | `Vec<Task>` | store init |
| `create_task { title, due?, list? }` | `Task` | `store.tsx:78` |
| `update_task { id, patch }` | `Task` | detail pane (new UI) |
| `toggle_task { id }` | `Task` | `store.tsx:56` |
| `delete_task { id }` | `()` | missing UI |
| `set_task_deps { id, depends_on }` | `Task` | `GraphPage` |
| `list_events { week_start }` | `Vec<CalendarEvent>` | `CalendarPage` |
| `schedule_task { id, day, start_minutes, duration }` | `CalendarEvent` | `CalendarPage.tsx:113` |
| `unschedule_event { id }` | `()` | `CalendarPage` |
| `load_graph` / `save_graph_layout { nodes }` | layout | `GraphPage.tsx:59` |
| `start_focus` / `pause_focus` / `complete_pomodoro` / `log_interruption` | `FocusSession` | `FocusPage` |
| `get_settings` / `set_setting` | kv | `SettingsPage` |
| `export_ics { scope }` | path or string | `SettingsPage` |

- Serde: `#[serde(rename_all = "camelCase")]` on every struct. `src/types.ts` is
  already camelCase (`estimateMinutes`, `dependsOn`, `startMinutes`); a mismatch
  is a silent `undefined`, not a compile error.
- One `AppError` implementing `serde::Serialize`, so `invoke` rejects cleanly
  instead of panicking.
- Register everything in `generate_handler![...]`, drop `greet`.

## 2. Frontend rewiring (the seam)

- `store.tsx` goes async: `useEffect` → `invoke("list_tasks")`, with `loading`
  and `error` in the context. Every mutation becomes async — optimistic update,
  revert on reject.
- Delete `mock.ts`. Four files import it directly today and must read through
  `useApp()` instead: `Rail.tsx:4` (lists), `GraphPage.tsx:5` (nodes/edges),
  `CalendarPage.tsx:7` (events, todayColumn, unscheduledTaskIds),
  `SettingsPage.tsx:4` (accounts, feedUrl).
- `TODAY = "2026-08-14"` is hardcoded. Replace with the real clock plus a
  rollover effect — an app left open overnight must re-bucket "Today".
- The `nextId` client counter (`store.tsx:38`) goes away; ids come from Rust.
- Add an error boundary and a toast / inline error surface. A rejected `invoke`
  is currently invisible.
- `capabilities/default.json` needs a permission entry per plugin used. A
  missing entry fails at runtime, not at build.

## 3. Missing UI (not in the mockups, but the app doesn't work without it)

- **Task editing.** The detail pane (`TasksPage.tsx:290-338`) is read-only text.
  Needs edit for title, notes, due, estimate/pomodoros, list, tags.
- **Delete task.** No path anywhere in the UI.
- **Dependency editing.** `dependsOn` renders but is never set. The graph needs
  edge draw and delete.
- **Filters.** Confirm `Open/Done/All` and `List/Table` filter live data rather
  than the mock's pre-grouping.
- **Search.** The palette's commands are static (`CommandPalette.tsx:43`).
- **Lists CRUD.** Rail lists are a static array with fixed counts.
- **Settings sections** other than Calendars read "Not designed yet"
  (`SettingsPage.tsx:146`). Minimum: General (theme, start-of-week, pomodoro
  lengths) and Data (db path, export, wipe).
- **Calendar `Day` density.** `Week` and `Month` exist; the `Day` branch at
  `CalendarPage.tsx:106` likely falls through.

## 4. Feature work behind the plan

- **Pomodoro, for real.** Timer state is local and seeded to `17:42`
  (`FocusPage.tsx:20`). Needs: persistence across page switches and restarts,
  work/break cycling, a session log in the DB, completion notification
  (`tauri-plugin-notification`). The OS do-not-disturb TODO at
  `FocusPage.tsx:82` has no cross-platform API — scope it down or drop it.
- **Calendar export.** `feedUrl` is fake. Two real options: (a) write an `.ics`
  file on demand — simple, ship this first; (b) serve a live feed over localhost
  HTTP so Google can subscribe, which needs a background server and a stable
  token.
- **Calendar import.** ICS parse (`icalendar` crate) for read-only external
  events. Full Google/Outlook OAuth (`SettingsPage.tsx:57`) is its own project —
  defer.

## 5. Shipping

- Icons, `productName`, `identifier`, and version in `tauri.conf.json`.
- **Custom window chrome (cross-platform TODO).** `decorations: false` is set in
  `tauri.conf.json`, so the OS title bar is gone on every platform. Consequences
  to handle before shipping beyond Linux dev:
  - The window can't be dragged. Needs `data-tauri-drag-region` on a header strip
    (the rail top is the natural spot) plus `core:window:allow-start-dragging` in
    `capabilities/default.json`.
  - No close/minimize/maximize affordance. Needs in-app buttons calling
    `getCurrentWindow().close()/minimize()/toggleMaximize()` from
    `@tauri-apps/api/window`, with the matching `core:window:allow-*`
    permissions.
  - Resize from window edges is unreliable on some Linux WMs/Wayland and the
    frameless window loses OS shadows; macOS also loses the traffic lights, so
    an undecorated build there needs its own button placement (or
    `titleBarStyle: "Overlay"` instead of `decorations: false`).
  - Snapping, double-click-to-maximize, and WM window menus all disappear —
    reimplement or accept.
- Window state persistence (`tauri-plugin-window-state`), single-instance, tray
  plus global shortcut — this is what the dotfile-integration goal wants.
- Linux bundle targets (`deb`, `appimage`). Test the built binary;
  `npm run tauri dev` hides packaging bugs.
- No test runner, linter, or formatter is configured. Add `vitest` and
  `cargo test` for the store layer, wire the script into `package.json`, and
  note the single-test invocation in `CLAUDE.md`.

## Phases

**P1 — persistence (unblocks everything).** SQLite + migrations + task CRUD
commands. Rewire `store.tsx` to async, delete `mock.ts`, real `TODAY`. Add
edit/delete UI. The app is genuinely usable at the end of this phase.

**P2 — calendar.** `events` table, schedule/unschedule persisted, real
unscheduled tray, Day view, ICS file export.

**P3 — focus.** Timer state in Rust, session log, notifications, pomodoro counts
feeding back into task rows.

**P4 — graph.** Persisted layout, edge create/delete writing `task_deps`, graph
and task list sharing one source of truth.

**P5 — ship.** Icons, identifier, tray, window state, bundle, test the artifact.

**P6 — later.** ICS subscribe/import, OAuth, LLM command API, dotfile
integration.
