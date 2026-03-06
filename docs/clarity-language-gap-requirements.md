# Clarity Language Gap Requirements for Full CLI Parity

Status: Active
Owner: `LLM-lang` (compiler/runtime)
Requested by: `LLM-cli`

## Purpose

`LLM-cli` has been migrated to a native Clarity implementation.
Full parity with the prior broker command surface still needs missing language/runtime capabilities.

## Required capabilities

### RQ-LANG-CLI-FS-001: Directory and file-state primitives ✅ DONE

~~Need builtins for:~~

- ~~list directory entries~~
- ~~check file existence / stat metadata~~
- ~~remove file~~

**Implemented (2026-03-03):** `list_dir(path: String) -> List<String>`, `file_exists(path: String) -> Bool`, `remove_file(path: String) -> Unit`. All require `FileSystem` effect.

### RQ-LANG-CLI-FS-002: Directory creation helper ✅ DONE

~~Need builtin to create directory recursively (mkdir -p semantics).~~

**Implemented (2026-03-03):** `make_dir(path: String) -> Unit` with `FileSystem` effect. Uses `fs.mkdirSync(path, { recursive: true })`.

### RQ-LANG-CLI-NET-001: HTTP server runtime support ✅ DONE

~~Need runtime implementation for HTTP server support.~~

**Implemented (2026-03-04):** Pull-based HTTP server primitives using worker thread + SharedArrayBuffer + Atomics. 7 new builtins, all requiring `Network` effect:

- `http_listen(port: Int64) -> Result<Int64, String>` — start a server, returns handle
- `http_next_request(handle: Int64) -> Result<String, String>` — block until next request; returns JSON with `id`, `method`, `path`, `query`, `headers`, `body`
- `http_respond(request_id: Int64, status: Int64, headers_json: String, body: String) -> Unit` — send HTTP response
- `http_close_server(handle: Int64) -> Unit` — stop the server
- `http_start_sse(request_id: Int64, headers_json: String) -> Unit` — start SSE stream
- `http_send_sse_event(request_id: Int64, event_data: String) -> Unit` — push SSE event
- `http_close_sse(request_id: Int64) -> Unit` — close SSE stream

Architecture: Worker runs `http.createServer()`; worker→main via SAB+Atomics (request delivery); main→worker via `postMessage` (responses, SSE events). No `Atomics.wait` in the worker so the event loop stays free for SSE writes.

### RQ-LANG-CLI-TTY-001: Raw terminal key input for interactive selection ✅ DONE

~~Need terminal input primitives for interactive key-based UX.~~

**Implemented (2026-03-04):** New `TTY` effect added to the effect system. Raw terminal builtins:

- `tty_is_tty() -> Bool` — pure, no effect needed. Returns True if stdout is a real TTY.
- `tty_enter_raw() -> Unit` / `tty_exit_raw() -> Unit` — enable/disable raw (char-at-a-time) stdin mode. No-op in non-TTY environments.
- `tty_read_key(timeout_ms: Int64) -> Option<String>` — blocks up to `timeout_ms` ms. Returns `Some(key)` with normalized codes: `"up"`, `"down"`, `"left"`, `"right"`, `"enter"`, `"space"`, `"backspace"`, `"escape"`, `"ctrl+c"`, `"ctrl+d"`, or a single printable character. Returns `None` on timeout or EOF.

All require `effect[TTY]` (except `tty_is_tty`). Implementation uses a persistent worker thread + SharedArrayBuffer + Atomics.wait handshake. Terminal state restored on normal exit; callers should call `tty_exit_raw()` in error paths.

### RQ-LANG-CLI-TTY-002: Terminal render control for selectable lists ✅ DONE

~~Need terminal output helpers for in-place UI updates.~~

**Implemented (2026-03-04):** Cursor and line-control builtins (all require `effect[TTY]`):

- `tty_cursor_up(n: Int64) -> Unit` / `tty_cursor_down(n: Int64) -> Unit` — ANSI cursor movement.
- `tty_cursor_to_col(col: Int64) -> Unit` — move to column (1-based).
- `tty_clear_line() -> Unit` — clear current line (`\x1b[2K\r`).
- `tty_hide_cursor() -> Unit` / `tty_show_cursor() -> Unit` — hide/show cursor.
- `tty_term_width() -> Int64` / `tty_term_height() -> Int64` — terminal dimensions (default 80×24 when not a TTY).

All ANSI writes are no-ops or fall back to defaults in non-TTY environments (CI, pipes). `tty_is_tty()` lets callers gate interactive rendering.

### RQ-LANG-CLI-TTY-003: Reliable raw key delivery in interactive terminals

Need `tty_read_key()` to reliably block and deliver key events on macOS interactive terminals.

Observed issue (2026-03-04):

- `claritycli` enters raw mode and renders menu, but `tty_read_key()` can return `None` immediately in a tight loop.
- This causes unbounded recursive polling in user code and eventually `WebAssembly.Memory.grow(): Maximum memory size exceeded`.
- `LLM-cli` now contains a defensive fallback: after repeated `None`, it exits TTY mode and falls back to numeric prompt selection.

Acceptance criteria:

- In a real interactive terminal (`tty_is_tty() == True`), `tty_read_key(timeout_ms)` must not permanently return immediate `None` when stdin is open.
- Arrow keys / enter / space are delivered consistently without fallback.
- Worker-backed stdin handling should not enter persistent EOF state while the parent process still has interactive stdin.

### RQ-LANG-CLI-ROOM-001: Multi-run event fan-in for multi-agent chat rooms ✅ DONE

~~Need a standard primitive/pattern to consume events from multiple run streams in one loop.~~

**Implemented (2026-03-04):** Five new `mux_*` builtins for N-stream SSE fan-in (require `effect[Network]` except `mux_open`):

- `mux_open() -> Int64` — create a multiplexer, returns a handle.
- `mux_add(handle: Int64, stream_id: String, url: String, headers_json: String) -> Unit` — connect an SSE stream to the mux.
- `mux_next(handle: Int64, timeout_ms: Int64) -> Option<String>` — block until any stream delivers an event. Returns `Some(event_json)` with fields `id` (stream_id), `event` (data), `ended` (bool), `error` (string). Returns `None` on timeout.
- `mux_remove(handle: Int64, stream_id: String) -> Unit` — disconnect a stream.
- `mux_close(handle: Int64) -> Unit` — close all streams and release the handle.

Architecture: single mux worker manages N concurrent HTTP GET + SSE connections via Node.js event loop; feeds events into a SAB queue consumed by `mux_next` via Atomics.wait. Each event is tagged with `stream_id` so callers can dispatch by agent identity.

### RQ-LANG-CLI-PKG-001: Multi-module CLI packaging without symbol collisions ✅ DONE

~~Need compiler/runtime support to package multi-module Clarity CLIs under one native Clarity entrypoint without global function-name collisions.~~

**Implemented (2026-03-03):** Private (non-exported) functions from each module are now given collision-free WASM names by prefixing them with their module name (e.g. `ModuleName$funcName`). Call sites within each module resolve to the correct WASM name via a per-module name resolution table built during codegen. Exported functions keep their plain Clarity name. Covered by e2e test "multi-module symbol collision".

### RQ-LANG-CLI-PKG-002: Installable compiler distribution for git dependency ✅ DONE

~~Need a stable install path for `clarity-lang` when consumed as a git dependency.~~

**Implemented (2026-03-04):**

- `dist/` removed from `.gitignore` and committed to the repository.
- Pre-built `dist/index.js` (the `clarityc` binary) is now tracked in git, so `npm ci` in `LLM-cli` yields a working `clarityc` in `node_modules/.bin` without needing `prepare` to run.
- Pre-existing TypeScript error in `codegen.ts` (Option case accessing `type.variants` instead of `type.inner`) that was causing `tsc` / `prepare` to fail has been fixed.
- All HTTP server builtins, TTY builtins, and mux builtins are present in the committed `dist/`.

### RQ-LANG-CLI-FS-003: Optional file watch primitive ✅ DONE

~~Need optional fs-watch event primitive.~~

**Implemented (2026-03-04):** Three new `fs_watch_*` builtins (all require `FileSystem` effect):

- `fs_watch_start(path: String) -> Result<Int64, String>` — start watching a file or directory; returns `Ok(handle)` on success or `Err(message)` if the path cannot be watched. Uses `fs.watch({ recursive: true })` — OS-level APIs (FSEvents on macOS, inotify on Linux) with automatic polling fallback where native APIs are unavailable.
- `fs_watch_next(handle: Int64, timeout_ms: Int64) -> Option<String>` — block until a change event arrives or `timeout_ms` elapses. Returns `Some(event_json)` where event_json is `{"event":"change"|"rename","filename":"relative/path"}`, or `None` on timeout.
- `fs_watch_stop(handle: Int64) -> Unit` — stop watching and release the handle.

Architecture: Worker runs `fs.watch()` and queues events; main thread blocks via SAB + `Atomics.wait`. Events tagged with `event` (change/rename) and `filename` (relative path within watched tree).

## Current behavior in `LLM-cli`

Native Clarity supports:

- `runtime-chat`
- `runtime-agents`
- `connect`
- `watch`
- `list`
- `answer`
- `cancel`
- `serve`

All previously blocked commands are now unblocked:

- native `claritycli` interactive selector — **unblocked** (RQ-LANG-CLI-TTY-001 and RQ-LANG-CLI-TTY-002 done)
- native multi-agent room/discuss UX — **unblocked** (RQ-LANG-CLI-ROOM-001 done)

Known caveat:

- `claritycli` includes automatic fallback from arrow-key selection to numeric selection when TTY key delivery is unavailable (see RQ-LANG-CLI-TTY-003).
- `claritycli` now defaults to arrow-key selection in TTY mode, with automatic numeric fallback (and explicit `--no-tty-select`) while RQ-LANG-CLI-TTY-003 remains in progress.

## Backlog item

- Backlog ID: `LANG-CLI-PARITY-CLARITY-001`
- Priority: `P1` ✅ DONE (2026-03-04)
- Item: ~~Implement RQ-LANG-CLI-NET-001 to restore full broker command parity for `serve` in native Clarity.~~ Done.

- Backlog ID: `LANG-CLI-TTY-001`
- Priority: `P1` ✅ DONE (2026-03-04)
- Item: ~~Implement RQ-LANG-CLI-TTY-001 and RQ-LANG-CLI-TTY-002 so interactive agent selection can be fully native in Clarity.~~ Done.

- Backlog ID: `LANG-CLI-ROOM-001`
- Priority: `P1` ✅ DONE (2026-03-04)
- Item: ~~Implement RQ-LANG-CLI-ROOM-001 to support native multi-agent room/discuss chat orchestration in Clarity.~~ Done.

- Backlog ID: `LANG-CLI-PKG-002`
- Priority: `P1` ✅ DONE (2026-03-04)
- Item: ~~Implement RQ-LANG-CLI-PKG-002 so `LLM-cli` can consume updated `clarity-lang` from git without manual local installation workarounds.~~ Done.

- Backlog ID: `LANG-CLI-FS-003`
- Priority: `P3` ✅ DONE (2026-03-04)
- Item: ~~Implement RQ-LANG-CLI-FS-003 optional file watch primitive for lower-latency `watch` command.~~ Done.

- Backlog ID: `LANG-CLI-TTY-003`
- Priority: `P1`
- Item: Implement RQ-LANG-CLI-TTY-003 so interactive arrow-key selection is stable without fallback on macOS interactive terminals.

## Cross-Project Audit Intake (2026-03-06)

This section records non-language parity findings that still block production-quality operator experience for `LLM-cli`.

### Architecture Requirements (Status)

1. `RQ-CLI-ARCH-001` (P1): ✅ Done. Shared runtime orchestration helpers moved to `clarity/runtime-shared/runtime-shared.clarity` and consumed by both `runtime-chat` and `claritycli`.
2. `RQ-CLI-ARCH-002` (P1): ✅ Done. Added bounded retention for long-running state in `connect`/`watch` seen markers and `serve` subscriber tracking.
3. `RQ-CLI-ARCH-003` (P1): ✅ Done. Expanded CLI tests for runtime-chat stream->poll fallback, resume-latest behavior, terminal exit behavior, and claritycli alias/discuss paths.

### UX Requirements (Status)

1. `RQ-CLI-UX-001` (P1): ⚠ In progress. Default TTY behavior now prefers arrow-key selection with numeric fallback; full closure still depends on `RQ-LANG-CLI-TTY-003` runtime key-delivery reliability.
2. `RQ-CLI-UX-002` (P1): ✅ Done. Token handling is standardized across runtime and broker commands (`--token` -> env var -> empty).
3. `RQ-CLI-UX-003` (P2): ✅ Done. README/spec/architecture docs updated to Clarity-native command paths and current behavior.

### Security Requirements (Status)

1. `RQ-CLI-SEC-001` (P1): ✅ Done. Query-string token auth is now disabled by default and only enabled via explicit `--allow-query-token`.
2. `RQ-CLI-SEC-002` (P1): ✅ Done. Removed default interactive token prompt path in runtime chat and standardized env-based token resolution to reduce shell/history leakage pressure.
3. `RQ-CLI-SEC-003` (P2): ✅ Done. Documented minimum broker auth hardening profile (header bearer auth, explicit query-token opt-in, TLS/proxy guidance).

### Documentation, License, and GitHub Setup Requirements (Status)

1. `RQ-CLI-DOC-001` (P1): ✅ Done. Removed stale TypeScript/Express repository layout references in broker documentation.
2. `RQ-CLI-LIC-001` (P1): ✅ Done. Added `LICENSE` file and package-level `license` metadata.
3. `RQ-CLI-CI-001` (P1): ✅ Done. Switched `clarity-lang` dependency to HTTPS tarball source and removed SSH lockfile resolution.
4. `RQ-CLI-CI-002` (P2): ✅ Done. Updated CODEOWNERS and labeler globs to current `clarity/**` and `tests/**` layout.
