# Claude Code Instructions

## On Every Session Start

1. Read `specs/DOMAIN.md` - architecture rules and patterns
2. Read `specs/METADATA.md` - file layout and commands
3. Read `specs/STATE.md` - current work context and pending items

## After Completing a Task

Update `specs/STATE.md` with:

- What changed (files modified, features added/fixed)
- Any new pending items discovered
- Remove completed items from pending list

## Quick Reference

```bash
pnpm run build:packages   # Build every workspace package
pnpm --filter portal dev  # Run the Portal
pnpm run lint             # Lint
pnpm run test:journeys    # Browser journeys (see tests/e2e/README.md)
```
