# AGENTS.md

## Repository intent

`clarity-agent-cli` provides a standalone operator interface for Clarity HITL workflows.

## Guardrails

- Keep command behavior aligned with `docs/hitl-broker-spec.md`.
- Preserve file protocol compatibility (`.question` / `.answer`) for runtime integrations.
- Maintain CI parity with this repo's `.github/workflows/` baseline.
- Run `npm run build`, `npm run lint`, and `npm test` before shipping changes.

## Working mode

- Follow trunk-based development as in `LLM-runtime`:
  - branch from `main`
  - keep branches short-lived
  - merge back quickly
- Branch naming convention:
  - `result/<outcome-kebab-case>`
  - `hotfix/<outcome-kebab-case>`
  - `codex/<outcome-kebab-case>`
  - `dependabot/*` for automation
- Use conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`).
- Push meaningful checkpoints to remote so collaborators can track progress.

## Language-first policy

- CLI production implementation must be native Clarity.
- If any required behavior cannot be implemented with current Clarity language/runtime capabilities, add a formal requirement entry in project requirements docs immediately.
- When such a gap is identified, explicitly raise a question to the stakeholder: implement a temporary workaround anyway, or wait for language/runtime support.

## Module naming policy

- Use descriptive file names for command modules (for example `clarity/serve.clarity` or `clarity/serve/serve.clarity`), not repeated `main.clarity` per command folder.
- Reserve `clarity/main.clarity` for the top-level CLI router entrypoint only.
- Keep module path and exported function names aligned with command intent (`run_hitl_serve`, `run_runtime_chat`, etc.).
