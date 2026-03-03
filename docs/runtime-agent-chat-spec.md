# Runtime Agent Chat CLI Spec

Status: Active (native Clarity implementation)  
Owner: `LLM-cli`

## Goal

Provide a native Clarity operator flow to:

1. Start the CLI.
2. Connect to `LLM-runtime` / `Clarity-runtime`.
3. List available agent services.
4. Select one service and chat.

## Commands

- `clarity-agent runtime-agents [runtimeUrl] [--token <secret>]`
- `clarity-agent runtime-chat [runtimeUrl] [serviceId] [--agent <agentId>] [--run-id <runId>] [--token <secret>] [--poll-ms <ms>] [--events-limit <n>] [--no-stream]`

Single-start UX for `runtime-chat`:

1. Connect to runtime (provided URL or prompt).
2. Fetch and print numbered services from registry.
3. Select by number (or pass service id).
4. Start/attach run and enter chat loop.

## Runtime API Contract

- `GET /api/agents/registry`
  - service listing and selection
- `POST /api/agents/events`
  - bootstrap run when `--run-id` is omitted
  - emits `agent.run_created` then `agent.run_started`
- `POST /api/agents/runs/:runId/messages`
  - sends operator messages with `role = "user"`
- `GET /api/agents/runs/:runId/events/stream`
  - preferred run-scoped SSE stream
- `GET /api/agents/runs/:runId/events`
  - fallback polling and `/refresh`

## Run bootstrap context

`agent.run_created.data` includes:

- `trigger = "api"`
- `route = "/cli/runtime-chat"`
- `method = "CLI"`
- `requestId = <runId>`
- `caller = "clarity-agent-cli"`

## Chat behavior

- Commands:
  - `/status`
  - `/refresh`
  - `/exit`, `/quit`
- Non-command input is posted as run chat message.
- CLI exits on terminal run events:
  - `agent.run_completed`
  - `agent.run_failed`
  - `agent.run_cancelled`

## Security

- Optional bearer token is forwarded as `Authorization: Bearer <token>`.

## Implementation location

- Router: `clarity/main.clarity`
- Packed launcher: `dist/clarity-agent.cjs`
- Chat engine: `clarity/runtime-chat/main.clarity`
- Registry listing: `clarity/runtime-agents/main.clarity`
