# Clarity Agent CLI architecture

This repository packages the operator-side HITL interface as a standalone CLI + HTTP broker.

## Components

- `src/cmd/clarity-agent.ts`: command router and UX
- `src/pkg/hitl/broker.ts`: file-protocol primitives (`.question`/`.answer`)
- `src/pkg/hitl/watch.ts`: operator watch loop
- `src/pkg/http/server.ts`: broker HTTP API + SSE + embedded UI
- `src/pkg/http/client.ts`: remote broker client used by `connect`
- `src/pkg/runtime/client.ts`: runtime API client used by `runtime-agents` and `runtime-chat`
- `src/pkg/audit/log.ts`: append-only JSONL audit sink

## Runtime placement

This project is designed to run either:

- beside the runtime process on the same filesystem
- as an HTTP endpoint reachable by remote runtimes using `CLARITY_HITL_BROKER_URL`

## Interface contract

The protocol contract lives in `docs/hitl-broker-spec.md` and is treated as the source of truth.

Runtime-agent chat contract and bridge behavior live in `docs/runtime-agent-chat-spec.md`.
