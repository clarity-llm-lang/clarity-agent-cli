# Contributing

This repository follows trunk-based development, aligned with `LLM-runtime/clarity-runtime`.

## Development flow

1. Keep `main` releasable at all times.
2. Create short-lived branches from `main`.
3. Rebase or update from `main` frequently.
4. Open PRs early and merge quickly once checks pass.

## Branch naming

Use outcome-based names:

- `result/<outcome-kebab-case>`
- `hotfix/<outcome-kebab-case>`
- `codex/<outcome-kebab-case>`
- `dependabot/*` for dependency automation

## Validation before push

Run:

```bash
npm run build
npm run lint
npm run format
npm test
npm run test:coverage
```

## Commit convention

Use conventional commits:

- `feat: ...`
- `fix: ...`
- `chore: ...`
- `docs: ...`
- `refactor: ...`

Use `BREAKING CHANGE:` in the commit body for major-version behavior changes.

## Collaboration expectation

Push meaningful checkpoints so remote branch state stays current for reviewers and automation.
