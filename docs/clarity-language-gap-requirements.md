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

### RQ-LANG-CLI-PKG-002: Installable compiler distribution for git dependency

Need a stable install path for `clarity-lang` when consumed as a git dependency.

Why:

- `LLM-cli` depends on `clarityc pack` in CI/build.
- Current git dependency path can fail during `prepare` (`tsc`) and may not provide a ready-to-run `clarityc` binary without local manual linking/workarounds.

Acceptance criteria:

- `npm ci` in `LLM-cli` yields a working `clarityc` command in `node_modules/.bin`.
- No manual `npm install --ignore-scripts` / local symlink workaround is needed.
- HTTP server builtins (`http_listen`, `http_next_request`, `http_respond`, SSE helpers) are available in the installed compiler used by `LLM-cli`.

### RQ-LANG-CLI-FS-003: Optional file watch primitive (nice-to-have)

Need optional fs-watch event primitive.

Why:

- `watch` can be implemented by polling once FS primitives exist, but event-based watch lowers latency and CPU usage.

Acceptance criteria:

- Clarity can subscribe to directory change notifications, with polling fallback documented.

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
- Priority: `P1`
- Item: Implement RQ-LANG-CLI-PKG-002 so `LLM-cli` can consume updated `clarity-lang` from git without manual local installation workarounds.

- Backlog ID: `LANG-CLI-FS-003`
- Priority: `P3` (nice-to-have)
- Item: Implement RQ-LANG-CLI-FS-003 optional file watch primitive for lower-latency `watch` command.
