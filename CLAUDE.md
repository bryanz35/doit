# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

DOIT — a lightweight TODO desktop app for developers / project managers (see `project-plan.md` for the intended scope: task list, calendar, pomodoro focus timer, whiteboard/graph page, external calendar export; later an LLM command API and Linux dotfile integration).

**Status: tasks are wired end to end; every other feature is still mock data.** The tasks domain has a SQLite schema, a tested data layer, seven Tauri commands, and a frontend store that calls them. The calendar, focus, graph, and settings screens still render from `src/data/mock.ts` and have no backend at all.

Stated preference in `project-plan.md`: the frontend UI is meant to be built with Claude's help; the Rust backend the author writes themselves. Respect that split — don't add Rust commands unprompted.

## Commands

```bash
npm run tauri dev      # run the desktop app (spawns vite on :1420 + cargo build)
npm run tauri build    # bundle release binaries
npm run dev            # vite only, browser at :1420 — Tauri `invoke` calls will fail
npm run build          # tsc typecheck + vite build (this is the typecheck step; noEmit is set)
```

In `src-tauri/`:

```bash
cargo test                              # 23 tests, all in-memory SQLite
cargo test tasks::tests::toggle_flips   # single test by path
cargo clippy --all-targets
```

No frontend test runner, linter, or formatter is configured. If adding one, wire the script into `package.json` and note the single-test invocation here.

## Architecture

Two processes, one bundle:

- **Frontend** (`src/`, Vite + React 19 + TS strict) renders the webview. It reaches the backend only through `invoke("command_name", args)` from `@tauri-apps/api/core`.
- **Backend** (`src-tauri/src/`, Rust) is split so mobile targets work: `main.rs` is a thin binary that calls `doit_lib::run()`; all real setup lives in `lib.rs` (crate `doit_lib`, per the `[lib] name` in `Cargo.toml`).

### Backend

Layered so the logic is testable without an app handle:

| File | Role |
| --- | --- |
| `lib.rs` | Builder setup: opens the DB in `app_data_dir()`, `manage`s it, registers the handler list. |
| `command.rs` | The Tauri boundary — **singular**, `mod command`. Each command locks the mutex, calls `tasks`, returns. No logic. |
| `tasks.rs` | All task logic and SQL, over a plain `rusqlite::Connection`. Every test in the project lives here or in `db/migrations.rs`. |
| `model.rs` | `Task`, `TaskPatch`, `TaskStatus` — the serde/rusqlite shapes shared with `src/types.ts`. |
| `error.rs` | `AppError` (thiserror) with a hand-written `Serialize` that emits the `#[error(...)]` string, so a rejected `invoke` throws that string in JS. |
| `db/` | `open()` (pragmas: foreign_keys, WAL, busy_timeout) and `migrations.rs`. |
| `migrations/NNN_*.sql` | Frozen once shipped. Change the schema by appending a file; `user_version` tracks what has run. |

Conventions that matter when adding to `command.rs`:

- Use the `lock(&db)` helper; bind `let mut conn` for the functions that open a transaction (`create_task`, `set_task_tags`, `set_task_deps`) and plain `let conn` for the rest.
- Commands are sync, so they run on the main thread. Fine for local SQLite; anything doing network I/O should be `async` or `#[tauri::command(async)]`.
- An `Option<T>` argument may be omitted by the caller — Tauri's deserializer returns `None` for a missing key. A non-`Option` argument errors with "missing required key".

Adding a backend command requires three edits in step:
1. `#[tauri::command] pub fn foo(...)` in `src-tauri/src/command.rs`
2. register it in `tauri::generate_handler![...]` in `lib.rs` — an unregistered command fails at runtime, not compile time
3. call `invoke("foo", { ... })` from `src/data/store.tsx` — arg keys are camelCase on the JS side, snake_case in Rust

The app's own commands need **no** entry in `src-tauri/capabilities/default.json`; that file gates core and plugin APIs only. Plugins additionally need the crate in `Cargo.toml`, `.plugin(...)` in the builder, and the npm `@tauri-apps/plugin-*` package.

Registered today: `list_tasks`, `create_task`, `update_task`, `toggle_task`, `delete_task`, `set_task_tags`, `set_task_deps`.

### Frontend

The UI is a direct port of the Claude Design project *Todo App Mockups* (`claude.ai/design/p/32715cf1-be3f-42cc-b28f-133756f12562`). Screens map 1:1 to mockup ids: 1a → `TasksPage` list, 2a → its table layout, 1b/2b → `CalendarPage` week/month, 1c → `FocusPage`, 1d → `GraphPage`, 1e → `SettingsPage`, 1f → the empty state + `CommandPalette`, 2c → the expanded rail.

- `src/styles/design-system.css` is vendored **verbatim** from the design project's `_ds/…/styles.css` — tokens plus `.btn`/`.tag`/`.input`/`.seg`/`.table`/`.card` classes. Don't hand-edit it; re-pull it. Note the system is deliberately square (`--radius-*: 0`) and single-accent (`#ec3013`).
- `src/styles/app.css` holds app chrome only (rail, rows, calendar grid, graph canvas), built from those tokens. New UI should reach for a design-system class first and add here only when the mockups show something the system has no class for.
- No router: `page` is state in `src/data/store.tsx`, keybinds `1`–`5` switch it, and the URL hash seeds the initial page so a screen can be deep-linked during development (`http://localhost:1420/#graph`).

**The backend seam** is `src/data/store.tsx` — the only file that calls `invoke`. Pages read state through `useApp()` and never hold data of their own beyond view state. `src/types.ts` holds the shapes both sides must agree on; keep it in step with `model.rs` by hand, since `invoke<Task>(...)` is an unchecked assertion, not validation.

Conventions in the store:

- Each mutation sends a command and folds the row it returns back into state — the DB is authoritative for ids, `completedAt`, and the trimmed title. No optimistic updates.
- A rejected `invoke` throws the serialized `AppError` **string**, not an `Error`; `messageOf` handles both.
- `loaded` distinguishes "no rows" from "not back yet" and `error` holds the last failure; `TasksPage` renders both (a `.banner` under the topbar, a "Loading tasks…" placeholder), so a backend failure no longer looks like an empty list.
- `addTask` takes one line of quick-add text (`src/data/quickadd.ts`: `@due #tag /list =estimate`) and fans it out across `create_task` + the follow-up `update_task` / `set_task_tags` calls create does not cover, folding the last row returned into state.
- `deleteTask` is wired to its command but no screen calls it yet, and the detail pane is still read-only. `set_task_deps` has no store function at all.

`src/data/mock.ts` is now only the screens with no backend: calendar `events`, `graphNodes`/`graphEdges`, `calendarAccounts`. The rail's list counts and the calendar's unscheduled tray are derived from real tasks. The `taskId` fields left in the mock events and nodes point at the mockup's task ids and resolve to nothing in a real database.

### Config coupling

Preserve these: `vite.config.ts` pins port 1420 with `strictPort` and `tauri.conf.json` points `devUrl` at it; `frontendDist: "../dist"` must match Vite's output. `tsconfig.json` has `noUnusedLocals`/`noUnusedParameters` on, so unused imports break `npm run build`.
