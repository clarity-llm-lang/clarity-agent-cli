# Clarity Language Gap Requirements for Full CLI Parity

Status: Active  
Owner: `LLM-lang` (compiler/runtime)  
Requested by: `LLM-cli`

## Purpose

`LLM-cli` has been migrated to a native Clarity implementation.
Full parity with the prior broker command surface still needs missing language/runtime capabilities.

## Required capabilities

### RQ-LANG-CLI-FS-001: Directory and file-state primitives

Need builtins for:

- list directory entries
- check file existence / stat metadata
- remove file

Why:

- Required for `watch`, `list`, and `cancel` parity for `.question` / `.answer` protocol.

Acceptance criteria:

- Clarity can enumerate `.question` files in a target directory.
- Clarity can detect whether `{safeKey}.answer` exists.
- Clarity can remove `{safeKey}.question` to implement cancel semantics.

### RQ-LANG-CLI-FS-002: Directory creation helper

Need builtin to create directory recursively (mkdir -p semantics).

Why:

- Required to match current broker behavior that ensures handshake directory exists before writing.

Acceptance criteria:

- Clarity command can ensure configured HITL dir exists without external shell tools.

### RQ-LANG-CLI-NET-001: HTTP server runtime support

Need runtime implementation for `http_listen` (currently stubbed).

Why:

- Required for native `serve` command and embedded broker HTTP API (`/questions`, `/answer`, `/cancel`, `/events`).

Acceptance criteria:

- `http_listen` can start a server, route requests, and return responses from Clarity handlers.
- SSE endpoint support is available or an equivalent stream primitive is provided.

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
- `answer`

Temporarily unsupported (blocked by requirements above):

- `watch`
- `list`
- `cancel`
- `serve`

## Backlog item

- Backlog ID: `LANG-CLI-PARITY-CLARITY-001`
- Priority: `P1`
- Item: Implement RQ-LANG-CLI-FS-001, RQ-LANG-CLI-FS-002, and RQ-LANG-CLI-NET-001 to restore full broker command parity in native Clarity.
