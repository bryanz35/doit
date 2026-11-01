# DOIT

A lightweight TODO desktop app for developers and project managers. Tasks,
calendar, a pomodoro focus timer, and a dependency graph — in one small native
window, with everything stored locally.

Built with [Tauri 2](https://tauri.app) (Rust backend) + React 19 + TypeScript.

> **Status: work in progress.** Tasks and calendar scheduling are real and
> persist in SQLite. The focus timer and settings have a tested backend that
> their screens don't call yet, and the graph is still mock data. See
> `project-plan.md` for the full roadmap.

## Screens

| Page | What it does | State |
| --- | --- | --- |
| **Tasks** | Smart lists, list and table views, quick-add, vim keys, detail pane | Live |
| **Calendar** | Day / week / month; drag tasks onto the grid to block out time, move, copy, resize | Live |
| **Focus** | Pomodoro timer with interruption logging | Backend done, page mock |
| **Graph** | Whiteboard of draggable task nodes showing what blocks what | Mock |
| **Settings** | Calendar accounts, export, app preferences | Backend done, page mock |

Press `1`–`5` to switch pages (`g1`–`g5` on the task list, where digits are vim
counts); the command palette is `Cmd/Ctrl+K`.

Quick-add takes one line: `Write report @2026-11-02 #work /Inbox =45m`
(`@` due, `#` tag, `/` list, `=` estimate).

## Getting started

Needs [Node](https://nodejs.org) and the
[Rust toolchain](https://rustup.rs) plus Tauri's
[system dependencies](https://tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev      # run the desktop app
```

Other commands:

```bash
npm run tauri build    # bundle release binaries
npm run dev            # vite only, in a browser at :1420 (no backend)
npm run build          # typecheck + production build
npm test               # frontend unit tests (Node's built-in runner)
cargo test             # from src-tauri/ — backend tests
docker/build.sh        # Linux bundles (deb, rpm, AppImage) into release/
```

## How it's put together

Two processes in one bundle. The frontend (`src/`) renders the webview and
talks to the backend only through `invoke("command_name", args)`. The backend
(`src-tauri/src/`) owns the data:

```
src/
  data/store.tsx     app state — the only file that calls invoke
  data/mock.ts       graph + calendar-account placeholders, until those have a backend
  types.ts           shapes both sides agree on
  pages/             one file per screen
  components/        shared UI (task detail, palette, rail)
  styles/            design tokens + app chrome

src-tauri/src/
  lib.rs             app setup, managed DB state, command registry
  db/                connection, pragmas, forward-only migrations
  model.rs           Rust mirror of types.ts
  tasks.rs           tasks + calendar blocks, plain fns over &Connection (tested)
  focus.rs           pomodoro sessions, derived from stored instants (tested)
  alarm.rs           wakes at a session's deadline, notifies the frontend
  settings.rs        key/value preferences
  command.rs         thin #[tauri::command] wrappers
  error.rs           AppError — serializable, so invoke rejects cleanly
  pinch.rs           Linux touchpad pinch → calendar zoom
```

Data lives in SQLite at the platform app-data dir
(`~/.local/share/com.bryan.doit/doit.sqlite3` on Linux), created on first run.
No account, no server, no sync.

## Roadmap

Wire the focus and settings screens → task editing → calendar `.ics` export →
persisted graph → packaged release. Later: ICS import, an LLM command API, and
Linux dotfile integration. Details and current state in `project-plan.md`.
