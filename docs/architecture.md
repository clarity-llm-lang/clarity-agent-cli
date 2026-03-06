# Clarity Agent CLI architecture

## Overview

`clarity-agent-cli` now runs through a single native Clarity router.

- Clarity entrypoint: `clarity/main.clarity`
- Packed launcher artifact: `dist/clarity-agent.cjs`
- Operator UX entrypoint: `clarity/claritycli.clarity`
- Packed operator UX artifact: `dist/claritycli.cjs` (arrow-key selector + chat transcript UX)
- Packaging mechanism: `clarityc pack`

## Native command modules

- `clarity/runtime-chat/runtime-chat.clarity`
  - Connects to runtime registry
  - Selects service by number or service id
  - Boots run events when needed
  - Sends chat messages to run-scoped endpoint
  - Consumes SSE stream with poll fallback
- `clarity/runtime-shared/runtime-shared.clarity`
  - Shared runtime URL/auth/payload/request helpers used by `runtime-chat` and `claritycli`
- `clarity/runtime-agents/runtime-agents.clarity`
  - Lists agent services from `/api/agents/registry`
- `clarity/connect/connect.clarity`
  - Polls remote broker `/questions`
  - Submits responses via `/answer`
- `clarity/watch/watch.clarity`
  - Polls `.question` files and captures operator responses
- `clarity/list/list.clarity`
  - Lists pending local questions from handshake directory
- `clarity/cancel/cancel.clarity`
  - Removes pending local question files
- `clarity/answer/answer.clarity`
  - Writes local `{safeKey}.answer` for file-protocol HITL
- `clarity/serve/serve.clarity`
  - Hosts broker HTTP API (`/questions`, `/questions/:key`, `/answer`, `/cancel`, `/events`)
  - Optional bearer token auth (`--token`)
  - Query-token auth disabled by default; explicit opt-in via `--allow-query-token`
  - Emits broker SSE events for `new_question` and `answered`

## Compatibility status

Supported:

- runtime chat over `/api/agents/*`
- remote broker connect/answer over HTTP
- local answer-file writing
- local file-protocol watch/list/cancel flow
- embedded broker HTTP server via native Clarity `serve`

Gap requirements are tracked in `docs/clarity-language-gap-requirements.md` and the shared registry `../LLM-lang/docs/runtime-cli-language-requirements.md`.

## Validation

- `npm run build` packs the single Clarity router launcher.
- `npm run lint` enforces no TypeScript sources in this repo.
- `npm run test` validates router behavior, runtime-agent listing, native `serve` broker API, and local HITL list/cancel behavior.
