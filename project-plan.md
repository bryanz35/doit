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

Current state (2026-08-29): the storage layer exists and runs; `cargo test`
passes and the app creates `~/.local/share/com.bryan.doit/doit.sqlite3` on first
launch. `model.rs` holds `TaskStatus`, `Task`, `TaskPatch`. No commands are
registered yet — `generate_handler![]` is empty and the template's `greet` is
gone. The frontend is untouched: ~2k lines of UI still
reading `src/data/mock.ts`, and nothing calls `invoke`.

"Working" for the first milestone means: tasks survive a restart, the timer is
real, the calendar exports. Everything past that is the scope above.

## 1. Backend — storage done, commands not started (self-written)

**Storage** — done.

- [x] SQLite over a JSON file. `rusqlite 0.40` with `bundled` (vendored SQLite
      compiled into the binary, so a shipped build doesn't depend on the user
      having a system libsqlite3) and `extra_check`. Plus `uuid` (v4 ids),
      `chrono`, `thiserror`.
- [x] DB path from `app.path().app_data_dir()`, created on first run —
      `src-tauri/src/db/mod.rs`.
- [x] Pragmas re-applied on every open: `foreign_keys = ON` (off by default in
      SQLite and per-connection — without it the schema's `ON DELETE CASCADE` is
      inert), `journal_mode = WAL`, 5s `busy_timeout`.
- [x] Migration runner — `user_version` pragma, forward-only array of
      `include_str!`'d SQL, each migration wrapped in an explicit transaction so
      a partial failure rolls back instead of wedging the file permanently.
      `src-tauri/src/db/migrations.rs`.
- [x] Managed state: `tauri::Manager` + `.manage(Db(Mutex<Connection>))` in
      `setup`, so the DB is ready before the window shows.
- [x] `AppError` — `thiserror` plus a hand-written `Serialize`, so a rejected
      `invoke` carries a message instead of panicking. `src-tauri/src/error.rs`.
- [x] Migration `001_tasks.sql` — `tasks`, `task_tags`, `task_deps`, two
      indexes. `status` is a CHECK constraint listing the exact kebab-case values
      from `types.ts`, so a serde casing slip fails loudly at the DB rather than
      silently hiding every row from the UI.
- [ ] Remaining tables, as their phases land: `events`, `graph_nodes`, `lists`,
      `settings` kv, `focus_sessions`. Each is a new `00N_*.sql` appended to
      `MIGRATIONS` — never edit a migration that has shipped.

**Known gaps in the storage layer**

- Only one test (`migrations_are_idempotent`). Worth having, all cheap against
  `Connection::open_in_memory()`: deleting a task cascades to `task_tags` (the
  only thing that catches a missing `foreign_keys` pragma); a bad status value is
  rejected; serde and `as_str` agree on every variant; create/list round-trips;
  toggle sets then clears `completed_at`.
- `db::open` takes a directory and creates a real file, so tests can't exercise
  it — they re-set the pragmas by hand and can drift from production. Split into
  `open(dir)` + `configure(&conn)` once there are more pragmas to get wrong.
- `list` is a column on `tasks`, not a table, so a list can't be renamed or
  exist while empty. Promote it in `002_lists.sql` when lists CRUD lands.
- Cycle detection for `task_deps` has no home yet. The schema's CHECK blocks
  only self-edges; A→B→C→A has to be rejected in Rust, inside `set_task_deps`.
- `completed_at` is stored as RFC3339, but `types.ts` still documents a display
  string (`"14:32"` from `toLocaleTimeString`) that loses the date, so completed
  tasks can't be bucketed across a day boundary. Decided: RFC3339 all the way to
  the frontend, formatted in React. Update the `types.ts` doc comment when the
  store is rewired.

**Model** — `src-tauri/src/model.rs`, one file mirroring `src/types.ts` so drift
is visible in a diff.

- [x] `TaskStatus` enum, `#[serde(rename_all = "kebab-case")]` so `InProgress`
      serializes as `"in-progress"` — the spelling `types.ts` and the CHECK
      constraint both expect. Serde's default `"InProgress"` would be a silent
      `undefined` in React and an outright rejection at the DB.
- [x] `TaskStatus::as_str` / `::parse` — the hand conversion. `parse` errors on
      an unknown string rather than defaulting, since a bad value means the CHECK
      constraint was bypassed.
- [x] `impl ToSql`/`FromSql for TaskStatus`, so `params![status]` and
      `row.get("status")` work directly and `Option<TaskStatus>` comes free.
      Legal under the orphan rule because the type is local.
- [ ] `Task` — missing `pomodoros`, `list`, `repo`, `completed_at`, all present
      in both `types.ts` and the `tasks` table. Serde omits an absent field
      silently, so the UI reads `undefined` with no error anywhere. Add before
      writing `tasks.rs`.
- [x] `Task` field convention — every optional field is `Option<T>` plus
      `#[serde(skip_serializing_if = "Option::is_none")]`, so a NULL column
      arrives as `undefined`, not `null`. `types.ts` is `strict`, and `null` is
      not assignable to `string | undefined`. `created_at`/`sort_order` are
      columns but deliberately not on the struct — ordering is server-side.
- [ ] `TaskPatch` is a stub (title/notes/status). The detail pane in §3 also
      needs `due`, `estimate_minutes`, `pomodoros`, `list`, `tags`. `None` means
      "not sent", so there is no way to *clear* a field; the fix is
      `Option<Option<T>>` with a custom `deserialize_with`, deferred.
- [ ] The kebab-case strings exist twice — serde's `rename_all` and `as_str` —
      with nothing enforcing agreement. A `#[serde(rename)]` on a variant, or a
      variant whose kebab spelling differs from the one typed into `as_str`,
      diverges with no compile error. Guard with a test asserting
      `serde_json::to_string(&s)` matches `as_str()` for every variant.

**Next: task commands.** `tasks.rs` (plain fns over `&Connection`) then
`commands.rs` (thin `#[tauri::command]` wrappers).

**Command surface** — none implemented. Names match the seam comments already in
the code.

| Command | Returns | Called from | Done |
| --- | --- | --- | --- |
| `list_tasks` | `Vec<Task>` | store init | |
| `create_task { title, due?, list? }` | `Task` | `store.tsx:78` | |
| `update_task { id, patch }` | `Task` | detail pane (new UI) | |
| `toggle_task { id }` | `Task` | `store.tsx:56` | |
| `delete_task { id }` | `()` | missing UI | |
| `set_task_deps { id, depends_on }` | `Task` | `GraphPage` | |
| `list_events { week_start }` | `Vec<CalendarEvent>` | `CalendarPage` | |
| `schedule_task { id, day, start_minutes, duration }` | `CalendarEvent` | `CalendarPage.tsx:113` | |
| `unschedule_event { id }` | `()` | `CalendarPage` | |
| `load_graph` / `save_graph_layout { nodes }` | layout | `GraphPage.tsx:59` | |
| `start_focus` / `pause_focus` / `complete_pomodoro` / `log_interruption` | `FocusSession` | `FocusPage` | |
| `get_settings` / `set_setting` | kv | `SettingsPage` | |
| `export_ics { scope }` | path or string | `SettingsPage` | |

- Serde: `#[serde(rename_all = "camelCase")]` on every struct. `src/types.ts` is
  already camelCase (`estimateMinutes`, `dependsOn`, `startMinutes`); a mismatch
  is a silent `undefined`, not a compile error. `TaskStatus` is the exception —
  it needs `rename_all = "kebab-case"` for `"in-progress"`. The same camelCase
  mapping applies to command *arguments*, so a Rust param `start_minutes` is
  `startMinutes` on the `invoke` side.
- Read paths do three queries, not N+1: one over `task_tags`, one over
  `task_deps`, each folded into a `HashMap<String, Vec<String>>`, then attached
  while iterating the `tasks` rows.
- `execute` returns rows-affected — that is the 404. A `WHERE id = ?1` update
  touching 0 rows becomes `AppError::NotFound`, and `query_row`'s
  `QueryReturnedNoRows` is translated rather than surfacing as
  `"database: Query returned no rows"`.
- Ids come from `uuid::Uuid::new_v4()` in Rust; `sort_order` from
  `COALESCE(MAX(sort_order), 0) + 1`. Writes that touch more than one table take
  a transaction, which needs `&mut Connection`.
- Before rewiring React, call `invoke("list_tasks")` from the devtools console
  and eyeball the JSON. Key casing and `null`-vs-`undefined` are both silent
  failures in TypeScript; this is the cheap catch.
- [x] One `AppError` implementing `serde::Serialize`, so `invoke` rejects
  cleanly instead of panicking.
- [x] `greet` dropped. Register each new command in `generate_handler![...]` as
  it lands; the list is currently empty.
- Keep command bodies to a few lines — lock the mutex and delegate to a plain
  fn taking `&Connection`, so the logic is testable with
  `Connection::open_in_memory()` and no Tauri runtime.

## 2. Frontend rewiring (the seam) — not started

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

- [x] `productName` (`doit`) and `identifier` (`com.bryan.doit`) set in
  `tauri.conf.json`. The identifier decides the DB path, so changing it later
  strands every existing user's data — treat it as frozen now.
- Icons and version still to do.
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
- `cargo test` works (one migration test today; run a single one with
  `cargo test <name>` from `src-tauri/`). Still missing: a JS test
  runner for the store layer (`vitest`), a linter, and a formatter. Wire the
  script into `package.json` and note the single-test invocation in
  `CLAUDE.md`.

## Phases

**P1 — persistence (unblocks everything).** *In progress.* SQLite, pragmas,
migration runner, `AppError`, the tasks schema, and the `model.rs` structs are
done. Left: task CRUD commands, rewiring `store.tsx` to async, deleting
`mock.ts`, real `TODAY`, and the edit/delete UI. The app is genuinely usable at
the end of this phase.

**P2 — calendar.** `events` table, schedule/unschedule persisted, real
unscheduled tray, Day view, ICS file export.

**P3 — focus.** Timer state in Rust, session log, notifications, pomodoro counts
feeding back into task rows.

**P4 — graph.** Persisted layout, edge create/delete writing `task_deps`, graph
and task list sharing one source of truth.

**P5 — ship.** Icons, identifier, tray, window state, bundle, test the artifact.

**P6 — later.** ICS subscribe/import, OAuth, LLM command API, dotfile
integration.
