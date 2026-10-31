# Backend (src-tauri/)

Layered so the logic is testable without an app handle:

| File | Role |
| --- | --- |
| `lib.rs` | Builder setup: opens the DB in `app_data_dir()`, `manage`s it, registers the handler list. |
| `command.rs` | The Tauri boundary — **singular**, `mod command`. Each command locks the mutex, calls `tasks`/`focus`/`settings`, returns. No logic — the focus commands' one extra line hands the returned session to the alarm. |
| `tasks.rs` | All task logic and SQL, over a plain `rusqlite::Connection`. Also owns `check_instant`/`format_instant`, the one spelling every instant column uses. |
| `focus.rs` | Pomodoro sessions, same shape as `tasks.rs`. Rows hold instants (started/paused/ended), never a countdown; `derive` computes `endsAt`/`remainingSeconds` per read. Every fn takes `now` (tests drive the clock) and calls `expire` first, so a run-out session is closed — as `completed`, at its deadline — by whatever touches it next. |
| `alarm.rs` | One thread that sleeps until the open session's deadline, calls `focus::expire`, emits `focus-ended` (payload: the closed `FocusSession`) and shows a notification. Commands re-arm it with `Alarm::follow`. Wakes at least every 30s because the channel timeout's monotonic clock stops during suspend. Not unit-tested — it needs an `AppHandle`. |
| `settings.rs` | String key/value prefs. A missing key means "default"; `set_setting` with no value deletes. Defaults live in the frontend. |
| `model.rs` | `Task`, `TaskPatch`, `TaskStatus`, the `Focus*` types — the serde/rusqlite shapes shared with `src/types.ts`. The kebab-case enums get `as_str`/`parse`/`ToSql`/`FromSql` from `sql_enum!`; `enum_spellings_match_serde` checks its strings against serde's. |
| `error.rs` | `AppError` (thiserror) with a hand-written `Serialize` that emits the `#[error(...)]` string, so a rejected `invoke` throws that string in JS. |
| tests | In `tasks.rs`, `focus.rs`, `settings.rs` and `db/migrations.rs`, all against `open_in_memory()` via each file's `fresh()`. |
| `db/` | `open()` (pragmas: foreign_keys, WAL, busy_timeout) and `migrations.rs`. |
| `pinch.rs` | Linux only, called from setup. A capture-phase `GtkGestureZoom` on the webview claims touchpad pinches (otherwise WebKitGTK magnifies the whole page) and emits each step as a `pinch` event for the calendar's zoom. Its `gtk`/`webkit2gtk` deps are pinned to the versions tauri already uses — bump them together with tauri. |
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

`tauri-plugin-notification` is held at `~2.3` because newer releases require a newer tauri, which would also move the gtk/webkit2gtk versions `pinch.rs` is pinned to. The alarm calls it from Rust only, so it has no capability entry or npm package; add both if the frontend ever needs it.

Focus commands: `current_focus`, `start_focus { taskId?, kind, plannedSeconds }`, `pause_focus`, `resume_focus`, `finish_focus { outcome }` (idempotent — `null` when nothing was open), `log_interruption { note }`, `focus_day { from, to }` (the local day as two UTC instants, half-open). `kind` is `work|short-break|long-break`; `outcome` is `completed|skipped|abandoned`. Pause/resume/log reject with "no focus session is running" when none is open; start rejects while one is.

The block commands' argument keys are not uniform: `add_block` takes `taskId`, `update_block` takes `blockId`, `delete_block` takes `id`. The store sends whatever each signature says.
