# CLAUDE.md

## Project

DOIT — a lightweight TODO desktop app for developers / project managers (see `project-plan.md` for the intended scope: task list, calendar, pomodoro focus timer, whiteboard/graph page, external calendar export; later an LLM command API and Linux dotfile integration).

**Status: tasks and calendar blocks are wired end to end; every other feature is still mock data.** The tasks domain has a SQLite schema, a tested data layer, ten Tauri commands, and a frontend store that calls them. The calendar schedules real blocks against real tasks and exports them as an `.ics` file (`ics.rs`; no import or live feed yet, and the sync badge in its topbar is still a stub). The focus timer is wired end to end (`focus.rs`, `alarm.rs`; `FocusPage` counts down to the session's `endsAt`). Settings has a backend; only its Focus & timers section uses it. The graph screen renders from `src/data/mock.ts` and has no backend at all.


## Commands

```bash
npm run tauri dev      # run the desktop app (spawns vite on :1420 + cargo build)
npm run tauri build    # bundle release binaries
npm run dev            # vite only, browser at :1420 — Tauri `invoke` calls will fail
npm run build          # tsc typecheck + vite build (this is the typecheck step; noEmit is set)
npm test               # node --test over src/**/*.test.ts (pure modules in src/data)
node --test --test-name-pattern="DST" src/data/blocks.test.ts   # single test
```

In `src-tauri/`:

```bash
cargo test
cargo test tasks::tests::toggle_flips   # single test by path
cargo clippy --all-targets
```

Frontend tests use Node's built-in runner, no dependency: Node strips the types, so a tested module must be pure (no JSX, no React) and import its siblings with the `.ts` extension. `tsconfig.json` excludes `*.test.ts` (no `@types/node`), so tests are not typechecked. No linter or formatter is configured.

## Architecture

Two processes, one bundle:

- **Frontend** (`src/`, Vite + React 19 + TS strict) renders the webview. It reaches the backend only through `invoke("command_name", args)` from `@tauri-apps/api/core`.
- **Backend** (`src-tauri/src/`, Rust) is split so mobile targets work: `main.rs` is a thin binary that calls `doit_lib::run()`; all real setup lives in `lib.rs` (crate `doit_lib`, per the `[lib] name` in `Cargo.toml`).

Layer conventions and gotchas live next to the code they govern: `src/CLAUDE.md` (frontend, store seam, gestures) and `src-tauri/CLAUDE.md` (command boundary, migrations). Read the one for the side you are touching.

## Config coupling

Preserve these: `vite.config.ts` pins port 1420 with `strictPort` and `tauri.conf.json` points `devUrl` at it; `frontendDist: "../dist"` must match Vite's output. `tsconfig.json` has `noUnusedLocals`/`noUnusedParameters` on, so unused imports break `npm run build`.
