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

### RQ-LANG-CLI-NET-001: HTTP server runtime support

Need runtime implementation for HTTP server support.

Why:

- Required for native `serve` command and embedded broker HTTP API (`/questions`, `/answer`, `/cancel`, `/events`).

Note: `http_listen` was previously a dead stub and has been removed from the compiler (backlog item #4, 2026-03-01). A real implementation is needed.

Acceptance criteria:

- An HTTP server primitive can start a server, route requests, and return responses from Clarity handlers.
- SSE endpoint support is available or an equivalent stream primitive is provided.

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

- `serve` — blocked by RQ-LANG-CLI-NET-001 (HTTP server primitive)

## Backlog item

- Backlog ID: `LANG-CLI-PARITY-CLARITY-001`
- Priority: `P1`
- Item: Implement RQ-LANG-CLI-NET-001 to restore full broker command parity for `serve` in native Clarity.

- Backlog ID: `LANG-CLI-FS-003`
- Priority: `P3` (nice-to-have)
- Item: Implement RQ-LANG-CLI-FS-003 optional file watch primitive for lower-latency `watch` command.
