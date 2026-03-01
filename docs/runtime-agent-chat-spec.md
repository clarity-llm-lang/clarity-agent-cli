# Runtime Agent Chat CLI Spec

Status: Active (implemented in native Clarity mode)  
Owner: `LLM-cli`

## Goal

Provide a CLI operator flow to:

1. Start the CLI.
2. Connect to `LLM-runtime` / `Clarity-runtime`.
3. List available agent services.
4. Connect to one agent run and chat with it.

## Scope

This spec adds runtime chat capabilities to `clarity-agent` without changing the existing HITL broker commands.

Commands:

- `clarity-agent runtime-agents <runtimeUrl> [--token]`
- `clarity-agent runtime-chat [runtimeUrl] [serviceId] [--agent <agentId>] [--run-id <runId>] [--token] [--poll-ms <ms>] [--events-limit <n>] [--no-stream]`

Single-start UX for `runtime-chat`:

1. Connect to runtime (use provided `runtimeUrl` or prompt for URL).
2. Fetch and display agent services as numbered options.
3. Select one number to connect and start chat.

## Runtime API Contract (Clarity Default Engine)

The default `runtime-chat` engine (Clarity) integrates with existing runtime endpoints:

- `GET /api/agents/registry`  
  Used by `runtime-agents` and for service/agent lookup before chat.
- `POST /api/agents/events`  
  Used by `runtime-chat` to create/start a run when `--run-id` is not provided:
  - `agent.run_created` with `trigger=api`
  - `agent.run_started`
- `POST /api/agents/runs/:runId/messages`  
  Used to send operator chat input (`role=user`).
- `GET /api/agents/runs/:runId/events/stream` (SSE)  
  Default live stream channel for runtime run events.
- `GET /api/agents/runs/:runId/events`  
  Poll fallback and `/refresh` source.

## Run Bootstrap Rules

For `agent.run_created`, the bridge includes API trigger context required by runtime validation:

- `route`: `/cli/runtime-chat`
- `method`: `CLI`
- `requestId`: generated from the run id
- `caller`: `clarity-agent-cli`

If `--run-id` is supplied, bootstrap events are skipped and CLI attaches to that existing run.

## Chat Loop Rules

- Input commands:
  - `/status`: print run/session metadata
  - `/refresh`: fetch and render latest run events
  - `/exit` or `/quit`: end session
- Non-command input is sent as run chat input (`POST /api/agents/runs/:runId/messages`, `role=user`).
- Event transport defaults to run-scoped SSE and falls back to polling when stream connection fails.
- CLI exits automatically when terminal run events are observed.

## Security

- Optional bearer token passed through `Authorization: Bearer <token>`.
- Runtime-side sanitization/redaction/truncation remains source of truth for HITL message hygiene.

## Compatibility

- Existing broker commands (`watch`, `list`, `answer`, `cancel`, `serve`, `connect`) are unchanged.
- Runtime chat is additive and independent from broker file-handshake mode.

## Migration Notes

- Runtime chat is fully routed through Clarity (`clarity/runtime-chat/main.clarity`) and launched by `src/pkg/runtime/clarity-runtime-chat.ts`.
