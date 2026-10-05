# Backend (src-tauri/)

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

The block commands' argument keys are not uniform: `add_block` takes `taskId`, `update_block` takes `blockId`, `delete_block` takes `id`. The store sends whatever each signature says.
