# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

DOIT — a lightweight TODO desktop app for developers / project managers (see `project-plan.md` for the intended scope: task list, calendar, pomodoro focus timer, whiteboard/graph page, external calendar export; later an LLM command API and Linux dotfile integration).

**Status: tasks and calendar blocks are wired end to end; every other feature is still mock data.** The tasks domain has a SQLite schema, a tested data layer, ten Tauri commands, and a frontend store that calls them. The calendar schedules real blocks against real tasks (no external-calendar import/export yet, and the sync badge in its topbar is still a stub); the focus, graph, and settings screens still render from `src/data/mock.ts` and have no backend at all.

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

Registered today: `list_tasks`, `create_task`, `update_task`, `toggle_task`, `delete_task`, `set_task_tags`, `set_task_deps`, `add_block`, `update_block`, `delete_block`.

The block commands' argument keys are not uniform: `add_block` takes `taskId`, `update_block` takes `blockId`, `delete_block` takes `id`. The store sends whatever each signature says.

### Frontend

The UI is self-contained — the screens and the stylesheet in `src/` are the source of truth, with no external design project to sync against. Screens: `TasksPage` (list + table layouts), `CalendarPage` (week/month), `FocusPage`, `GraphPage`, `SettingsPage`, plus the empty state, `CommandPalette`, and the collapsed/expanded rail.

- `src/styles/design-system.css` is the design system — tokens plus `.btn`/`.tag`/`.input`/`.seg`/`.table`/`.card` classes. Treat it as the shared vocabulary: extend it deliberately rather than tweaking it per screen. **Keep the established style:** deliberately square (`--radius-*: 0`), single-accent (`#ec3013`), dense type scale, hairline borders over shadows. Anything new must match that; don't introduce rounded corners, a second accent colour, or a competing token set.
- `src/styles/app.css` holds app chrome only (rail, rows, calendar grid, graph canvas), built from those tokens. New UI should reach for a design-system class first and add here only when the system has no class for it.
- No router: `page` is state in `src/data/store.tsx`, keybinds `1`–`5` switch it, and the URL hash seeds the initial page so a screen can be deep-linked during development (`http://localhost:1420/#graph`).

**Dragging inside the app is pointer events, not HTML5 drag-and-drop.** This is the default for any new gesture — moving, resizing, reordering, panning, pulling a graph edge. Model it on `Move`/`Resize` in `CalendarPage.tsx`; the legacy DnD on the calendar's chips is the exception, not the pattern to copy.

Reach for native DnD only when you need what only it gives — a drop into another window or application, or the OS drag image — and never for a gesture that carries a modifier key. The Linux webview (WebKitGTK, what `tauri dev` actually runs) breaks it in ways that do not show up in a browser:

- Shift+press is read as "extend the text selection", so a Shift+drag never starts at all.
- `DragEvent.shiftKey` latches: once Shift has been pressed, every later drag still reports it.
- A drag whose source element stops hit-testing mid-drag — `pointer-events: none` from a class added on `dragstart`, say — is cancelled outright.

A pointer gesture has none of that, and everything about it stays inspectable. The shape to follow:

1. `onPointerDown`: bail unless `event.button === 0`, `preventDefault()` (or the press becomes a selection), `setPointerCapture(event.pointerId)`, and record both the press point and the grab offset within the element.
2. Give the element `user-select: none` and `touch-action: none` in CSS.
3. `onPointerMove`/`onPointerUp` go on the captured element, not on the surface underneath — capture retargets them there. To know what is under the pointer, hit-test with `elementsFromPoint` against a `data-*` attribute on the targets (`elementFromPoint` alone returns the thing being dragged).
4. Keep a movement threshold (`MOVE_THRESHOLD_PX`) so a press that never travels stays a click, and consume the click the gesture ends with (`justDragged`) so it does not also fire the element's `onClick`.
5. Track the gesture in local state and send **one** mutation on pointer-up — never per frame. Intermediate states the backend would reject then never reach it.
6. Read modifiers off the pointer event *and* corroborate with a window-level key listener (`useShiftHeld`); a single source has been caught latching.

**The backend seam** is `src/data/store.tsx` — the only file that calls `invoke`. Pages read state through `useApp()` and never hold data of their own beyond view state. `src/types.ts` holds the shapes both sides must agree on; keep it in step with `model.rs` by hand, since `invoke<Task>(...)` is an unchecked assertion, not validation.

Conventions in the store:

- Each mutation sends a command and folds the row it returns back into state — the DB is authoritative for ids, `completedAt`, and the trimmed title. No optimistic updates.
- A rejected `invoke` throws the serialized `AppError` **string**, not an `Error`; `messageOf` handles both.
- `loaded` distinguishes "no rows" from "not back yet" and `error` holds the last failure; `TasksPage` renders both (a `.banner` under the topbar, a "Loading tasks…" placeholder), so a backend failure no longer looks like an empty list.
- `addTask` takes one line of quick-add text (`src/data/quickadd.ts`: `@due #tag /list =estimate`) and fans it out across `create_task` + the follow-up `update_task` / `set_task_tags` calls create does not cover, folding the last row returned into state.
- `addBlock`/`updateBlock`/`deleteBlock` cover `task_blocks`. add and update fold the returned task through `merge` like every other mutation; delete returns `()`, so it is the one place state moves without the backend describing the new row — the block is filtered out of its task locally. `addBlock` stamps the local IANA zone on every block it creates.
- `deleteTask` is wired to its command but no screen calls it yet, and the detail pane is still read-only. `set_task_deps` has no store function at all.

`src/components/TaskDetail.tsx` is the task detail, shared by `TasksPage` and `CalendarPage` — a task row, a due chip and a block all open the same thing, and `Esc` closes it through the global keybind in `App.tsx`. It has two presentations behind a `variant` prop: `"pane"` (default) is the right-hand `.side` column the tasks list docks; the calendar passes `variant="modal"`, which wraps the same markup in a `.scrim` and centres it as a `.side-modal` — the tray and the hour grid already want the width, so a third column read as cramped. Clicking the scrim closes it, like `Esc`. On the calendar a click is a toggle: clicking the task whose pane is open closes it. A press on a block's resize grip ends as a click on the block, so the block consumes that one click rather than toggling the pane shut mid-resize. It is read-only apart from unscheduling a block, and hides its own "Schedule on calendar" button when `page` is already the calendar.

`src/data/mock.ts` is now only the screens with no backend: `graphNodes`/`graphEdges`, `calendarAccounts`. The rail's list counts are derived from real tasks. The `taskId` fields left in the mock nodes point at placeholder task ids and resolve to nothing in a real database.

`CalendarPage` draws two different things and keeps them apart:

- **`due` is a deadline** — a date with no time. Dated tasks sit in the all-day `DUE` strip (Week/Day) or in month cells, never on the hour grid. Dropping a chip on a day calls `updateTask(id, { due })`. `TaskPatch` cannot clear `due`, so a deadline can be moved but not removed from here.
- **A block is when the work happens** — a span on the hour grid. Dropping a chip on an hour column calls `addBlock` (length = the task's estimate, snapped and clamped to 15m–8h, else 60m); dragging its body moves it (hold **Shift** to copy instead — `addBlock` on the same task, the original left where it is), dragging either edge resizes it from that end, its × calls `deleteBlock`. A resize follows the pointer in local state and sends one `updateBlock` on pointer-up — not per frame, so an intermediate span that would collide with a neighbour never reaches the backend.

The tray is open tasks with **no blocks** — a deadline is not a plan, so a dated-but-unblocked task still waits there.

Everything on the grid is local wall-clock time; `task_blocks` stores UTC instants spelled exactly `YYYY-MM-DDTHH:MM:SSZ`, which `check_instant` enforces. `src/data/instants.ts` is the only place that conversion happens — use `toInstant`, not `Date.toISOString()`, which appends `.sssZ` and is rejected. The hour window opens on 09:00–16:00 but grows to cover whatever blocks the visible days hold, so a block outside it is never unreachable; blocks on different tasks may overlap (the backend only forbids overlap within one task) and are lane-packed side by side. Grid drops and resizes snap to 15 minutes.

**Two gestures move things on this page, and the split is deliberate.** A block already on the grid moves and resizes under pointer events (`Move`/`startMove`/`moveMove`/`endMove` and `Resize`), per the rule above — it hit-tests across days on the `data-cal-date` of each `.cal-col`, and Shift makes the drop an `addBlock` copy instead of an `updateBlock` move. Tray, due and month chips still use HTML5 drag-and-drop (`useCalendarDrag`), which is fine only because no modifier is involved: for those, `.cal-dragging` silences the *other* children of a day cell while the drag source carries `cal-drag-source` and is exempt — silencing the source cancels the drag. Move new gestures to pointer events; don't extend the chip DnD.

### Config coupling

Preserve these: `vite.config.ts` pins port 1420 with `strictPort` and `tauri.conf.json` points `devUrl` at it; `frontendDist: "../dist"` must match Vite's output. `tsconfig.json` has `noUnusedLocals`/`noUnusedParameters` on, so unused imports break `npm run build`.
