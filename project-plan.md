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

Current state (2026-09-06): the storage layer and the task logic both exist and
run; `cargo test` is 23 green and the app creates
`~/.local/share/com.bryan.doit/doit.sqlite3` on first launch. `model.rs` holds
`TaskStatus`, `Task`, `TaskPatch`; `tasks.rs` holds all six task functions as
plain fns over `&Connection`, with tests. Nothing is reachable from the app yet
— `commands.rs` does not exist and `generate_handler![]` is still empty (the
template's `greet` is gone). Every fn in `tasks.rs` is therefore dead code, and
`cargo build` says so: ~20 dead-code warnings, all expected until the wrappers
land. The frontend is untouched: ~2k lines of UI still reading
`src/data/mock.ts`, and nothing calls `invoke`.

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

- Tests are at 23, all against `Connection::open_in_memory()` via the `fresh()`
  helper in `tasks.rs`. Covered: create/list round-trip and `sort_order`
  ordering, due validation, patch-only-named-fields, the `completed_at`
  transition, toggle in all three directions, tags and deps trim/dedup/replace,
  the cycle rejection and its rollback, a diamond that must *not* be rejected,
  `NotFound` on every write path, and cascade on delete from both ends of an
  edge. Still missing, both cheap: a bad status value is rejected by the CHECK
  constraint, and serde agrees with `as_str` on every variant (see the model
  section).
- `db::open` takes a directory and creates a real file, so tests can't exercise
  it — they re-set the pragmas by hand and can drift from production. Split into
  `open(dir)` + `configure(&conn)` once there are more pragmas to get wrong.
- `list` is a column on `tasks`, not a table, so a list can't be renamed or
  exist while empty. Promote it in `002_lists.sql` when lists CRUD lands.
- Cycle detection lives in `tasks::reaches`, called from `set_task_deps` after
  the inserts but before `tx.commit()`, so a rejected write rolls back when the
  `Err` drops the transaction. The schema's CHECK still handles self-edges.
  Two rough edges left: the error text says "{id} depends on itself" for a cycle
  of any length, and the whole `task_deps` table is read on every write — fine
  at this size, worth a bounded walk if it ever isn't.
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
- [x] `Task` — `pomodoros`, `list`, `repo` and `completed_at` are on the struct
      and in `TASK_COLUMNS`, so `row_to_task` reads every column `types.ts`
      expects. Serde omits an absent field silently, so a missing one would have
      been `undefined` in the UI with no error anywhere.
- [x] `Task` field convention — every optional field is `Option<T>` plus
      `#[serde(skip_serializing_if = "Option::is_none")]`, so a NULL column
      arrives as `undefined`, not `null`. `types.ts` is `strict`, and `null` is
      not assignable to `string | undefined`. `created_at`/`sort_order` are
      columns but deliberately not on the struct — ordering is server-side.
- [ ] `TaskPatch` covers title/notes/status/due/estimate_minutes. The detail
      pane in §3 also needs `pomodoros` and `list` — both are columns
      `update_task` currently cannot touch. (`tags` has its own fn,
      `set_task_tags`, so it does not belong on the patch.) `None` still means
      "not sent", so there is no way to *clear* a field; the fix is
      `Option<Option<T>>` with a custom `deserialize_with`, deferred.
- [ ] The kebab-case strings exist twice — serde's `rename_all` and `as_str` —
      with nothing enforcing agreement. A `#[serde(rename)]` on a variant, or a
      variant whose kebab spelling differs from the one typed into `as_str`,
      diverges with no compile error. Guard with a test asserting
      `serde_json::to_string(&s)` matches `as_str()` for every variant.

**Task logic** — `src-tauri/src/tasks.rs`, done. Plain fns over `&Connection`
(`&mut` where a transaction is needed), no Tauri types, so every one is testable
against `Connection::open_in_memory()`.

- [x] `create_task`, `update_task`, `delete_task`, `list_tasks`, `toggle_task`,
      `set_task_deps` — the six from the table below — plus `set_task_tags`,
      which §3's tag editing needs and the table did not name.
- [x] `TASK_COLUMNS` is the single column list feeding `row_to_task`, shared by
      `get_task` and `list_tasks`, since `row_to_task` looks columns up by name
      and a SELECT that omits one panics at runtime, not compile time.
- [x] `list_tasks` is three queries, not N+1: `collect_pairs` folds `task_tags`
      and `task_deps` into `HashMap<String, Vec<String>>` and they are drained
      onto the tasks while iterating.
- [x] `update_task` is one `UPDATE` of `COALESCE(?n, column)`s, so a `None`
      leaves a column alone. `completed_at` is derived from the status
      transition in a `CASE`, not sent by the caller.
- [x] `toggle_task` reads the pre-update `status` in both `CASE`s — SQLite
      evaluates every SET expression against the original row, so the second
      `CASE` sees the old value on purpose.
- [x] `check_due` parses with chrono *and* re-formats to compare, because
      `%Y-%m-%d` accepts `2026-9-10` and `26-09-10`. `due` is stored as a string
      and the UI compares it as one, so only the zero-padded form is legal.
- [x] Rows-affected is the 404 on every write path; `get_task` translates
      `query_row`'s no-rows into `AppError::NotFound`.

**Known gaps in `tasks.rs`**

- An unknown id in `depends_on` hits the foreign key and surfaces as
  `AppError::Db("FOREIGN KEY constraint failed")`, not `NotFound` — an opaque
  string for the UI. Same for `set_task_tags`. Translate it when the wrappers
  land, since that is where the error surface becomes user-visible.
- `set_task_deps` validates the *owning* task exists but not the targets; the FK
  above is the only thing catching them.
- No ordering command. `sort_order` is written once at create
  (`COALESCE(MAX(sort_order), 0) + 1`) and never changed, so the list cannot be
  reordered by hand. It is a REAL column specifically so a reorder can insert
  between two rows without rewriting the table — that fn is unwritten.

**Next: `commands.rs`.** Thin `#[tauri::command]` wrappers — lock the
`Db(Mutex<Connection>)`, delegate to the `tasks.rs` fn, return. Register each in
`generate_handler![...]` as it lands. That clears the dead-code warnings and is
the last thing between the storage layer and the frontend rewire in §2.

**Command surface** — the six task commands exist as plain fns; none are
registered as commands yet. Names match the seam comments already in the code.

| Command | Returns | Called from | Done |
| --- | --- | --- | --- |
| `list_tasks` | `Vec<Task>` | store init | fn |
| `create_task { title, due?, list? }` | `Task` | `store.tsx:78` | fn |
| `update_task { id, patch }` | `Task` | detail pane (new UI) | fn |
| `toggle_task { id }` | `Task` | `store.tsx:56` | fn |
| `delete_task { id }` | `()` | missing UI | fn |
| `set_task_deps { id, depends_on }` | `Task` | `GraphPage` | fn |
| `list_events { week_start }` | `Vec<CalendarEvent>` | `CalendarPage` | |
| `schedule_task { id, day, start_minutes, duration }` | `CalendarEvent` | `CalendarPage.tsx:113` | |
| `unschedule_event { id }` | `()` | `CalendarPage` | |
| `load_graph` / `save_graph_layout { nodes }` | layout | `GraphPage.tsx:59` | |
| `start_focus` / `pause_focus` / `complete_pomodoro` / `log_interruption` | `FocusSession` | `FocusPage` | |
| `get_settings` / `set_setting` | kv | `SettingsPage` | |
| `export_ics { scope }` | path or string | `SettingsPage` | |

"fn" = the logic exists in `tasks.rs` and is tested; the `#[tauri::command]`
wrapper and the `generate_handler!` entry are still missing. `set_task_tags`
also exists as a fn and needs the same wrapper.

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
migration runner, `AppError`, the tasks schema, the `model.rs` structs, and all
of `tasks.rs` are done. Left: the `commands.rs` wrappers plus
`generate_handler!`, then rewiring `store.tsx` to async, deleting `mock.ts`,
real `TODAY`, and the edit/delete UI. The app is genuinely usable at the end of
this phase.

**P2 — calendar.** `events` table, schedule/unschedule persisted, real
unscheduled tray, Day view, ICS file export.

**P3 — focus.** Timer state in Rust, session log, notifications, pomodoro counts
feeding back into task rows.

**P4 — graph.** Persisted layout, edge create/delete writing `task_deps`, graph
and task list sharing one source of truth.

**P5 — ship.** Icons, identifier, tray, window state, bundle, test the artifact.

**P6 — later.** ICS subscribe/import, OAuth, LLM command API, dotfile
integration.
