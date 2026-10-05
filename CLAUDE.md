# CLAUDE.md

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
cargo test
cargo test tasks::tests::toggle_flips   # single test by path
cargo clippy --all-targets
```

No frontend test runner, linter, or formatter is configured. If adding one, wire the script into `package.json` and note the single-test invocation here.

## Architecture

Two processes, one bundle:

- **Frontend** (`src/`, Vite + React 19 + TS strict) renders the webview. It reaches the backend only through `invoke("command_name", args)` from `@tauri-apps/api/core`.
- **Backend** (`src-tauri/src/`, Rust) is split so mobile targets work: `main.rs` is a thin binary that calls `doit_lib::run()`; all real setup lives in `lib.rs` (crate `doit_lib`, per the `[lib] name` in `Cargo.toml`).

Layer conventions and gotchas live next to the code they govern: `src/CLAUDE.md` (frontend, store seam, gestures) and `src-tauri/CLAUDE.md` (command boundary, migrations). Read the one for the side you are touching.

## Config coupling

Preserve these: `vite.config.ts` pins port 1420 with `strictPort` and `tauri.conf.json` points `devUrl` at it; `frontendDist: "../dist"` must match Vite's output. `tsconfig.json` has `noUnusedLocals`/`noUnusedParameters` on, so unused imports break `npm run build`.
