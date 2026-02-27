# Runtime Agent Chat CLI Spec

Status: Active (implemented in native Clarity mode, TypeScript bridge fallback available)  
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
- `clarity-agent runtime-chat [runtimeUrl] [serviceId] [--agent <agentId>] [--run-id <runId>] [--token] [--poll-ms <ms>] [--events-limit <n>] [--bridge <clarity|ts>]`

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
- `GET /api/agents/runs/:runId/events`  
  Used for event rendering in Clarity mode.

## Run Bootstrap Rules

For `agent.run_created`, the bridge includes API trigger context required by runtime validation:

- `route`: `/cli/runtime-chat`
- `method`: `CLI`
- `requestId`: generated from the run id
- `caller`: `clarity-agent-cli`

In the TypeScript fallback engine (`--bridge ts`), `--run-id` is supported and bootstrap can be skipped.
In Clarity default mode today, `--run-id` is ignored and a fresh run is created.

## Chat Loop Rules

- Input commands:
  - `/refresh`: fetch and render latest run events
  - `/exit`: end session
- Non-command input is sent as run chat input (`POST /api/agents/runs/:runId/messages`, `role=user`).
- Event transport in Clarity mode uses polling (`GET /api/agents/runs/:runId/events`).
- TypeScript fallback mode (`--bridge ts`) retains SSE-first transport with polling fallback.
- CLI exits automatically when terminal run events are observed.

## Security

- Optional bearer token passed through `Authorization: Bearer <token>`.
- Runtime-side sanitization/redaction/truncation remains source of truth for HITL message hygiene.

## Compatibility

- Existing broker commands (`watch`, `list`, `answer`, `cancel`, `serve`, `connect`) are unchanged.
- Runtime chat is additive and independent from broker file-handshake mode.

## Migration Notes

- Default engine is Clarity (`clarity/runtime-chat/main.clarity`), launched by `src/pkg/runtime/clarity-runtime-chat.ts`.
- TypeScript engine remains available with `--bridge ts` while Clarity mode is hardened to full parity.
