# AGENTS.md

## Repository intent

`clarity-agent-cli` provides a standalone operator interface for Clarity HITL workflows.

## Guardrails

- Keep command behavior aligned with `docs/hitl-broker-spec.md`.
- Preserve file protocol compatibility (`.question` / `.answer`) for runtime integrations.
- Maintain CI parity with this repo's `.github/workflows/` baseline.
- Run `npm run build`, `npm run lint`, and `npm test` before shipping changes.
