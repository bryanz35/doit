# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

DOIT — a lightweight TODO desktop app for developers / project managers (see `project-plan.md` for the intended scope: task list, calendar, pomodoro focus timer, whiteboard/graph page, external calendar export; later an LLM command API and Linux dotfile integration).

The **frontend is scaffolded, the backend is not**. All five screens render from in-memory mock data; `src-tauri/src/lib.rs` still exposes only the template's `greet` command and nothing in `src/` calls `invoke` yet.

Stated preference in `project-plan.md`: the frontend UI is meant to be built with Claude's help; the Rust backend the author writes themselves. Respect that split — don't add Rust commands unprompted.

## Commands

```bash
npm run tauri dev      # run the desktop app (spawns vite on :1420 + cargo build)
npm run tauri build    # bundle release binaries
npm run dev            # vite only, browser at :1420 — Tauri `invoke` calls will fail
npm run build          # tsc typecheck + vite build (this is the typecheck step; noEmit is set)
cargo build            # in src-tauri/, Rust-only check
```

No test runner, linter, or formatter is configured. If adding tests, wire the script into `package.json` and note the single-test invocation here.

## Architecture

Two processes, one bundle:

- **Frontend** (`src/`, Vite + React 19 + TS strict) renders the webview. It reaches the backend only through `invoke("command_name", args)` from `@tauri-apps/api/core`.
- **Backend** (`src-tauri/src/`, Rust) is split so mobile targets work: `main.rs` is a thin binary that calls `doit_lib::run()`; all real setup lives in `lib.rs` (crate `doit_lib`, per the `[lib] name` in `Cargo.toml`).

Adding a backend command requires three edits in step:
1. `#[tauri::command] fn foo(...)` in `src-tauri/src/lib.rs`
2. register it in `tauri::generate_handler![greet, foo]`
3. call `invoke("foo", { ... })` from the frontend — arg keys are camelCase on the JS side, snake_case in Rust

Anything beyond core APIs also needs a permission added to `src-tauri/capabilities/default.json`; a missing entry fails at runtime, not compile time. Plugins additionally need the crate in `Cargo.toml`, `.plugin(...)` in the builder, and the npm `@tauri-apps/plugin-*` package.

### Frontend

The UI is a direct port of the Claude Design project *Todo App Mockups* (`claude.ai/design/p/32715cf1-be3f-42cc-b28f-133756f12562`). Screens map 1:1 to mockup ids: 1a → `TasksPage` list, 2a → its table layout, 1b/2b → `CalendarPage` week/month, 1c → `FocusPage`, 1d → `GraphPage`, 1e → `SettingsPage`, 1f → the empty state + `CommandPalette`, 2c → the expanded rail.

- `src/styles/design-system.css` is vendored **verbatim** from the design project's `_ds/…/styles.css` — tokens plus `.btn`/`.tag`/`.input`/`.seg`/`.table`/`.card` classes. Don't hand-edit it; re-pull it. Note the system is deliberately square (`--radius-*: 0`) and single-accent (`#ec3013`).
- `src/styles/app.css` holds app chrome only (rail, rows, calendar grid, graph canvas), built from those tokens. New UI should reach for a design-system class first and add here only when the mockups show something the system has no class for.
- No router: `page` is state in `src/data/store.tsx`, keybinds `1`–`5` switch it, and the URL hash seeds the initial page so a screen can be deep-linked during development (`http://localhost:1420/#graph`).

**The backend seam** is `src/data/store.tsx` plus `src/data/mock.ts` — the only two files that know where data comes from. Every mutation there is a local `setState` marked `TODO(backend)`; wiring Rust means replacing those bodies with `invoke(...)` and deleting `mock.ts`. `src/types.ts` holds the shapes both sides must agree on. Pages read state through `useApp()` and never hold data of their own beyond view state.

### Config coupling

Preserve these: `vite.config.ts` pins port 1420 with `strictPort` and `tauri.conf.json` points `devUrl` at it; `frontendDist: "../dist"` must match Vite's output. `tsconfig.json` has `noUnusedLocals`/`noUnusedParameters` on, so unused imports break `npm run build`.
