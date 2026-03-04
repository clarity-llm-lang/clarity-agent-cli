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
- `watch` — poll local `.question` files and answer interactively
- `list` — list pending local questions
- `answer` — write a local `.answer` file for file-protocol HITL
- `cancel` — remove a pending local question file
- `serve` — host broker HTTP API (`/questions`, `/questions/:key`, `/answer`, `/cancel`, `/events`)

## Operator UX command

Use `claritycli` for the streamlined chat UX:

- default target when no args are provided: `http://localhost:4707`
- arrow-key (`up/down`) agent selection
- simple chat transcript:
  - `you> ...`
  - `bot> ...`

`claritycli` accepts:

```bash
claritycli [runtime-url] [--token <secret>]
```

## Install and run

```bash
npm install
npm run build

# show help
npx clarity-agent --help

# streamlined operator UX (defaults to localhost:4707)
npx claritycli

# list runtime agents
npx clarity-agent runtime-agents http://localhost:4707

# single-start runtime chat flow
npx clarity-agent runtime-chat http://localhost:4707

# connect to remote broker
npx clarity-agent connect http://localhost:7842

# start broker HTTP server
npx clarity-agent serve --port 7842

# write local answer file
npx clarity-agent answer review-step-3 "Looks good"
```

## CLI commands

```bash
clarity-agent runtime-chat [runtime-url] [service-id] [--agent <agent-id>] [--run-id <run-id>] [--token <secret>] [--poll-ms <ms>] [--events-limit <n>] [--no-stream]
clarity-agent runtime-agents [runtime-url] [--token <secret>]
clarity-agent connect [broker-url] [--token <secret>] [--poll-ms <ms>] [--timeout <secs>] [--auto-approve]
clarity-agent watch [dir] [--dir <path>] [--timeout <secs>] [--auto-approve] [--log <file>] [--poll-ms <ms>]
clarity-agent list [dir] [--dir <path>]
clarity-agent answer <key> <response> [--dir <path>]
clarity-agent cancel <key> [dir] [--dir <path>]
clarity-agent serve [dir] [--dir <path>] [--port <port>] [--token <secret>]
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
|   |-- main.clarity
|   |-- claritycli.clarity
|   |-- runtime-chat/main.clarity
|   |-- runtime-agents/main.clarity
|   |-- connect/main.clarity
|   |-- watch/main.clarity
|   |-- list/main.clarity
|   |-- cancel/main.clarity
|   |-- answer/main.clarity
|   `-- serve/main.clarity
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
- `claritycli` is fully Clarity-native (`clarity/claritycli.clarity` -> `dist/claritycli.cjs`).
- Distribution is generated with `clarityc pack` into `dist/clarity-agent.cjs` from `clarity/main.clarity`.
- Lint enforces Clarity-only implementation files under `clarity/`, `src/`, and `bin/`.
