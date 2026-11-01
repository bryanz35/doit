# DOIT

A clean, lightweight TODO desktop app for developers and project managers.

**Pages**

- Task list
- Calendar
- Focus page — pomodoro timer
- Graph — free whiteboard of draggable task nodes and their dependencies
- Settings

**Features**

- Export to an external calendar

**Later**

- Command API for LLMs
- Desktop integration into Linux dotfiles

"Working" for the first milestone means: tasks survive a restart, the timer is
real, the calendar exports. Everything past that is the scope above.

How the code is laid out and the rules for changing it live in `CLAUDE.md`,
`src/CLAUDE.md` (frontend, store seam, gestures) and `src-tauri/CLAUDE.md`
(commands, migrations). This file covers only what is done, what is left, and in
what order.

---

# Status (2026-10-30)

| Area | Backend | Frontend | State |
| --- | --- | --- | --- |
| Tasks | `tasks.rs`, 7 commands | `TasksPage`, vim list keys, quick-add | Wired; detail pane read-only |
| Calendar blocks | `task_blocks`, 3 commands | `CalendarPage` Day/Week/Month | Wired; no import/export |
| Focus | `focus.rs`, `alarm.rs`, 7 commands | `FocusPage`, palette | Wired; no do-not-disturb |
| Settings | `settings.rs`, 2 commands | `SettingsPage` | Focus & timers wired; rest mock + placeholders |
| Graph | none | `GraphPage` | Mock data only |
| Calendar export | none | Settings → Calendars | Mock `feedUrl` |

Tests: `cargo test` has 63 (`tasks` 38, `focus` 21, `settings` 2,
`migrations` 2); `npm test` has 9 (`quickadd`, `blocks`, `focusplan`).

Schema: `001_tasks`, `002_task_schedule` (`task_blocks`), `003_focus`
(`focus_sessions`, `focus_interruptions`), `004_settings`. Next is `005_*`.

## Done

- **Storage.** SQLite via `rusqlite` (bundled), DB in `app_data_dir()`, pragmas
  on every open (`foreign_keys`, WAL, `busy_timeout`), forward-only migrations
  tracked by `user_version`, each in its own transaction.
- **Command boundary.** 19 commands registered in `lib.rs`; one `AppError`
  that serializes to a string so a rejected `invoke` carries a message.
- **Tasks end to end.** `store.tsx` is the only `invoke` caller: async load with
  `loaded`/`error`, mutations fold the returned row back in (no optimistic
  updates), ids come from Rust, `mock.ts` no longer feeds the task list or rail.
  Real clock with day rollover (`useToday`).
- **Task list.** Smart lists (Today/Overdue/All/Completed), quick-add sigils
  (`@due #tag /list =estimate`), vim keys including `dd` delete.
- **Calendar.** Due dates as an all-day strip, blocks on the hour grid:
  drop-to-schedule, move, Shift-copy, resize, delete; lane packing, DST-safe
  wall-clock layout, pinch/Ctrl-wheel zoom (`pinch.rs` on Linux), swipe to step
  the range.
- **Focus backend.** Sessions stored as instants, remaining time derived on
  read, so it survives page switches, restarts and suspend. One open session at
  a time (partial unique index). `alarm.rs` closes an expired session, emits
  `focus-ended` and shows a notification. Pomodoros done per task are counted on
  every task read.
- **Packaging.** `productName`/`identifier` set; `docker/build.sh` builds deb,
  rpm and AppImage in Ubuntu 22.04 into `release/`.

# Open work

## Wire the screens that have a backend

- **Settings page.** Store loads `get_settings` and writes `set_setting`;
  Focus & timers is done (defaults in `src/data/focusplan.ts`). Left: General
  (theme, start of week), Data & export (DB path, export, wipe) — placeholders.
  "Session settings" on the focus page lands on the Calendars section.
- **Command palette.** Scheduling actions are stubs; create task and start
  focus are real.
- **Focus leftovers.** `Task` in `types.ts` lacks the backend's
  `pomodorosDone`, so actuals are not shown anywhere yet.

## Missing UI

- **Task editing.** `TaskDetail` is read-only apart from unscheduling a block.
  Needs title, notes, due, estimate/pomodoros, list, tags.
- **Delete.** Only the vim `d` commands delete, with no confirmation or undo.
  Add a visible delete path; consider undo.
- **Dependencies.** `set_task_deps` exists but has no store function; nothing
  sets `dependsOn`. The graph needs edge draw/delete.
- **Lists CRUD.** A list is a column on `tasks`, so it cannot be renamed or
  exist while empty. Promote it to a `lists` table in a new migration.
- **Manual ordering.** `sort_order` is written once at create and has no
  command. It is `REAL` so a reorder can insert between rows; the fn and the
  vim placement (`o`/`O` between rows) wait on it.
- **Calendar sync badge** (`CalendarPage.tsx:808`) is a stub.

## Feature work

- **Graph (no backend).** Persist layout (`load_graph`/`save_graph_layout`,
  `GraphPage.tsx:59`), edge create/delete writing `task_deps`, graph and task
  list reading one source of truth. Then drop the rest of `mock.ts`.
- **Calendar export.** `feedUrl` is fake. Ship (a) first:
  - (a) write an `.ics` file on demand — blocks carry their IANA `tz` for this.
  - (b) serve a live feed over localhost HTTP so Google can subscribe — needs a
    background server and a stable token.
- **Calendar import.** ICS parse (`icalendar` crate) for read-only external
  events. Google/Outlook OAuth (`SettingsPage.tsx:63`) is its own project —
  defer.
- **Do not disturb.** `FocusPage.tsx:90` wants OS-level muting; there is no
  cross-platform API. Scope down or drop.

## Known backend gaps

- **`TaskPatch` cannot clear a field.** `None` means "not sent", so `due`,
  `notes` etc. can be changed but never removed. Fix with `Option<Option<T>>`
  and a custom `deserialize_with`. It also lacks `pomodoros` and `list`, which
  the editing UI needs.
- **Opaque FK errors.** An unknown id in `set_task_deps`/`set_task_tags`
  surfaces as `"FOREIGN KEY constraint failed"`, not `NotFound`. Targets of
  `set_task_deps` are not validated beyond the FK.
- **Cycle error text** says "{id} depends on itself" for a cycle of any length,
  and the whole `task_deps` table is read on every write — fine at this size.
- **`db::open` is untested.** It takes a directory and creates a real file, so
  tests set the pragmas by hand and can drift. Split into `open(dir)` +
  `configure(&conn)`.
- **No bad-status test.** Nothing checks that the `status` CHECK constraint
  rejects an unknown value.

## Shipping

- [x] `identifier` `com.bryan.doit` decides the DB path — **frozen**; changing
      it strands existing users' data.
- [x] Linux bundles (deb, rpm, AppImage) via `docker/build.sh`.
- [ ] Test the built artifact, not just `npm run tauri dev`.
- [ ] Final app icon set in `src-tauri/icons`; bump version off `0.1.0`.
- [ ] **Custom window chrome.** `decorations: false` removes the OS title bar,
      and nothing replaces it yet:
  - No drag: add `data-tauri-drag-region` (rail top) plus
    `core:window:allow-start-dragging` in `capabilities/default.json`.
  - No close/minimize/maximize: in-app buttons calling `getCurrentWindow()`
    with matching `core:window:allow-*` permissions.
  - Edge resize is unreliable on some Linux WMs/Wayland; shadows, snapping,
    double-click-maximize and WM menus are gone. macOS loses traffic lights —
    use `titleBarStyle: "Overlay"` there instead.
- [ ] Window state (`tauri-plugin-window-state`), single instance, tray, global
      shortcut — what the dotfile goal needs.
- [ ] Tooling: no linter or formatter; JS tests cover only pure modules.
- [ ] `README.md` status section still says everything is mock data.

# Phases

**P1 — persistence.** *Done.* SQLite, migrations, task commands, async store,
real clock, `mock.ts` out of the task list.

**P2 — calendar.** *Mostly done.* Blocks persisted, scheduling gestures, Day
view, real unscheduled tray. Left: ICS file export.

**P3 — focus.** *Done.* Backend, `FocusPage`, Settings timer lengths, palette
start. Left: show `pomodorosDone`; do not disturb (see Feature work).

**P4 — editing.** Task detail editing, `TaskPatch` clearing, lists table,
manual ordering, visible delete.

**P5 — graph.** Persisted layout, edge editing writing `task_deps`, delete
`mock.ts`.

**P6 — ship.** Icon, version, window chrome, window state, tray, test the
bundle.

**P7 — later.** ICS subscribe/import, OAuth, LLM command API, dotfile
integration.
