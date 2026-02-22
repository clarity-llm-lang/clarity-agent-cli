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
