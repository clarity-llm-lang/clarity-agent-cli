# Clarity Agent CLI architecture

## Overview

`clarity-agent-cli` now runs command implementations in native Clarity modules.
Packaging emits one launcher per command.

- Dispatcher: `bin/clarity-agent.js` (no TypeScript)
- Packed launcher artifacts:
  - `dist/runtime-chat.cjs`
  - `dist/runtime-agents.cjs`
  - `dist/connect.cjs`
  - `dist/answer.cjs`
- Packaging mechanism: `clarityc pack`

## Native command modules

- `clarity/runtime-chat/main.clarity`
  - Connects to runtime registry
  - Selects service by number or service id
  - Boots run events when needed
  - Sends chat messages to run-scoped endpoint
  - Consumes SSE stream with poll fallback
- `clarity/runtime-agents/main.clarity`
  - Lists agent services from `/api/agents/registry`
- `clarity/connect/main.clarity`
  - Polls remote broker `/questions`
  - Submits responses via `/answer`
- `clarity/answer/main.clarity`
  - Writes local `{safeKey}.answer` for file-protocol HITL

## Compatibility status

Supported:

- runtime chat over `/api/agents/*`
- remote broker connect/answer over HTTP
- local answer-file writing

Blocked pending language/runtime features:

- local file queue operations requiring directory traversal (`watch`, `list`, `cancel` parity)
- embedded broker HTTP server (`serve` parity)

Gap requirements are tracked in `docs/clarity-language-gap-requirements.md`.

## Validation

- `npm run build` packs all Clarity command launchers.
- `npm run lint` enforces no TypeScript sources in this repo.
- `npm run test` validates router behavior and runtime-agent listing contract.
