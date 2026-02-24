# Runtime Agent Chat CLI Spec

Status: Draft (implemented in TypeScript bridge mode)  
Owner: `LLM-cli`

## Goal

Provide a CLI operator flow to:

1. Start the CLI.
2. Connect to `LLM-runtime` / `Clarity-runtime`.
3. List available agent services.
4. Connect to one agent run and chat with it.

## Scope

This spec adds runtime chat capabilities to `clarity-agent` without changing the existing HITL broker commands.

New commands:

- `clarity-agent runtime-agents <runtimeUrl> [--token]`
- `clarity-agent runtime-chat <runtimeUrl> <serviceId> [--agent <agentId>] [--run-id <runId>] [--token] [--poll-ms <ms>] [--events-limit <n>]`

## Runtime API Contract (Current Bridge)

The CLI integrates with existing runtime endpoints:

- `GET /api/agents/registry`  
  Used by `runtime-agents` and for service/agent lookup before chat.
- `POST /api/agents/events`  
  Used by `runtime-chat` to create/start a run when `--run-id` is not provided:
  - `agent.run_created` with `trigger=api`
  - `agent.run_started`
- `POST /api/agents/runs/:runId/hitl`  
  Used to send operator chat input.
- `GET /api/agents/runs/:runId/events`  
  Used to poll and render run timeline messages.
- `GET /api/agents/runs`  
  Used to read run status and stop chat when terminal.

## Run Bootstrap Rules

For `agent.run_created`, the bridge includes API trigger context required by runtime validation:

- `route`: `/cli/runtime-chat`
- `method`: `CLI`
- `requestId`: generated from the run id
- `caller`: `clarity-agent-cli`

If `--run-id` is supplied, bootstrap events are skipped and CLI attaches to that existing run.

## Chat Loop Rules

- Input commands:
  - `/status`: print current run status
  - `/refresh`: fetch and render latest run events
  - `/exit` or `/quit`: end session
- Non-command input is sent as HITL message.
- CLI exits automatically when run status becomes terminal (`completed|failed|cancelled`).

## Security

- Optional bearer token passed through `Authorization: Bearer <token>`.
- Runtime-side sanitization/redaction/truncation remains source of truth for HITL message hygiene.

## Compatibility

- Existing broker commands (`watch`, `list`, `answer`, `cancel`, `serve`, `connect`) are unchanged.
- Runtime chat is additive and independent from broker file-handshake mode.

## Clarity Rewrite Backlog

- Backlog ID: `CLI-RT-CHAT-CLARITY-001`
- Priority: `P1`
- Item: Rewrite runtime chat bridge from TypeScript to native Clarity when language/runtime support is ready.
- Dependency:
  - Generic HTTP client functions in Clarity stdlib (GET/POST + headers + status + body).
  - Structured JSON support beyond flat map parsing (nested objects/arrays).
  - Ergonomic CLI command parsing helpers for multi-command apps.
