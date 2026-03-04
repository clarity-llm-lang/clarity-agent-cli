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

### RQ-LANG-CLI-TTY-001: Raw terminal key input for interactive selection

Need terminal input primitives for interactive key-based UX.

Why:

- `claritycli` currently provides arrow-key (`up/down`) agent selection.
- Native Clarity currently supports line input but does not provide a stable raw-key event API for this UX.

Acceptance criteria:

- Clarity can enable/disable raw terminal mode for stdin.
- Key events can be read as normalized codes (`up`, `down`, `enter`, `space`, `escape`) with UTF-8 safety.
- Terminal state is restored on normal exit and error paths.

### RQ-LANG-CLI-TTY-002: Terminal render control for selectable lists

Need terminal output helpers for in-place UI updates.

Why:

- Interactive list selection needs efficient redraw without printing unbounded log-like output.

Acceptance criteria:

- Clarity can clear/redraw selected regions or use cursor movement primitives safely.
- Rendering behavior works in common TTYs on macOS/Linux.
- Fallback to plain numbered prompt mode is documented when no TTY is available.

### RQ-LANG-CLI-ROOM-001: Multi-run event fan-in for multi-agent chat rooms

Need a standard primitive/pattern to consume events from multiple run streams in one loop.

Why:

- Multi-agent room chat requires receiving replies from several agent runs while keeping one operator input stream.
- Discuss mode requires turn orchestration across multiple participants.

Acceptance criteria:

- Clarity can subscribe to N run event streams and dispatch events with run identity.
- Operator input loop remains responsive while streams are active.
- Disconnect/reconnect and stream cleanup behavior is defined.

### RQ-LANG-CLI-PKG-001: Multi-module CLI packaging without symbol collisions ✅ DONE

~~Need compiler/runtime support to package multi-module Clarity CLIs under one native Clarity entrypoint without global function-name collisions.~~

**Implemented (2026-03-03):** Private (non-exported) functions from each module are now given collision-free WASM names by prefixing them with their module name (e.g. `ModuleName$funcName`). Call sites within each module resolve to the correct WASM name via a per-module name resolution table built during codegen. Exported functions keep their plain Clarity name. Covered by e2e test "multi-module symbol collision".

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

Temporarily unsupported (blocked by requirements above):

- `serve` — **unblocked** as of 2026-03-04; RQ-LANG-CLI-NET-001 is now implemented
- native `claritycli` interactive selector — blocked by RQ-LANG-CLI-TTY-001 and RQ-LANG-CLI-TTY-002
- native multi-agent room/discuss UX — blocked by RQ-LANG-CLI-ROOM-001

## Backlog item

- Backlog ID: `LANG-CLI-PARITY-CLARITY-001`
- Priority: `P1` ✅ DONE (2026-03-04)
- Item: ~~Implement RQ-LANG-CLI-NET-001 to restore full broker command parity for `serve` in native Clarity.~~ Done.

- Backlog ID: `LANG-CLI-TTY-001`
- Priority: `P1`
- Item: Implement RQ-LANG-CLI-TTY-001 and RQ-LANG-CLI-TTY-002 so interactive agent selection can be fully native in Clarity.

- Backlog ID: `LANG-CLI-ROOM-001`
- Priority: `P1`
- Item: Implement RQ-LANG-CLI-ROOM-001 to support native multi-agent room/discuss chat orchestration in Clarity.

- Backlog ID: `LANG-CLI-FS-003`
- Priority: `P3` (nice-to-have)
- Item: Implement RQ-LANG-CLI-FS-003 optional file watch primitive for lower-latency `watch` command.
