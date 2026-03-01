<p align="center">
  <img src="assets/clarity-agent-cli-banner.svg" alt="Clarity Agent CLI" width="860">
</p>

<p align="center">
  <strong>Native Clarity CLI for runtime-agent chat and HITL operator actions.</strong>
</p>

---

`clarity-agent-cli` is now implemented in Clarity and packaged as a native Clarity launcher.

## Status

Implemented commands:

- `runtime-chat` — connect to runtime, select agent, and chat
- `runtime-agents` — list runtime agent services
- `connect` — connect to a remote HITL broker (`/questions`, `/answer`)
- `answer` — write a local `.answer` file for file-protocol HITL

Temporarily unsupported in native Clarity:

- `watch`
- `list`
- `cancel`
- `serve`

These are blocked on language/runtime capabilities tracked in `docs/clarity-language-gap-requirements.md`.

## Install and run

```bash
npm install
npm run build

# show help
npx clarity-agent --help

# list runtime agents
npx clarity-agent runtime-agents http://localhost:4707

# single-start runtime chat flow
npx clarity-agent runtime-chat http://localhost:4707

# connect to remote broker
npx clarity-agent connect http://localhost:7842

# write local answer file
npx clarity-agent answer review-step-3 "Looks good"
```

## CLI commands

```bash
clarity-agent runtime-chat [runtime-url] [service-id] [--agent <agent-id>] [--run-id <run-id>] [--token <secret>] [--poll-ms <ms>] [--events-limit <n>] [--no-stream]
clarity-agent runtime-agents [runtime-url] [--token <secret>]
clarity-agent connect [broker-url] [--token <secret>] [--poll-ms <ms>] [--timeout <secs>] [--auto-approve]
clarity-agent answer <key> <response> [--dir <path>]
```

## Runtime chat flow

1. Start `runtime-chat`.
2. Connect to runtime and fetch `/api/agents/registry`.
3. Select numbered agent service.
4. Bootstrap run (`agent.run_created`, `agent.run_started`) unless `--run-id` is provided.
5. Chat via `POST /api/agents/runs/:runId/messages`.
6. Receive events by SSE (`/api/agents/runs/:runId/events/stream`) with polling fallback.

## Project structure

```text
.
|-- clarity/
|   |-- runtime-chat/main.clarity
|   |-- runtime-agents/main.clarity
|   |-- connect/main.clarity
|   `-- answer/main.clarity
|-- bin/
|   `-- clarity-agent.js
|-- docs/
|   |-- hitl-broker-spec.md
|   |-- runtime-agent-chat-spec.md
|   `-- clarity-language-gap-requirements.md
|-- tests/
|   `-- cli.test.mjs
`-- scripts/
    `-- check-no-typescript.mjs
```

## Quality gates

```bash
npm run build
npm run lint
npm run test
```

## Notes

- `runtime-chat` is fully Clarity-native.
- Distribution is generated with `clarityc pack` into `dist/runtime-chat.cjs`, `dist/runtime-agents.cjs`, `dist/connect.cjs`, and `dist/answer.cjs`.
- `bin/clarity-agent.js` is a thin command dispatcher to those packed Clarity launchers.
- No TypeScript source remains in production CLI paths.
