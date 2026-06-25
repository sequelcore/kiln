# Repository Hygiene

This guide defines which Kiln files belong in a shared repository and which
files are operator-local state.

## Versioned Project Files

Commit files that define durable project behavior:

- `.kiln/kiln.yaml`
- `.kiln/project-context.md`
- `.kiln/instructions/**`
- `.kiln/agents/**`
- `.kiln/skills/**`
- generated repo shims such as `AGENTS.md` and `CLAUDE.md`

Project `.kiln/kiln.yaml` is shared project policy. It should contain defaults
that are correct for every contributor and CI. Do not use it for personal
operator preferences such as temporary browser visibility, local debugging
state, credentials, or machine-specific paths.

## Ignored Operator State

Keep runtime and operator-local state out of the repo:

- `.kiln/backups/**`
- `.kiln/benchmarks/**`
- `.kiln/projections/**`
- `.kiln/sessions/**`
- `.kiln/tmp/**`
- `.kiln/*.db`
- `.kiln/*.json`
- `.kiln/*.jsonl`
- `.kiln/*.log`
- `memory/**`
- `.claude/**`

Mutable CLI memory is stored under Kiln user app state, keyed by project
identity. A project-local `.kiln/memory.db` is not a canonical repository file
or a supported runtime contract; remove it from the workspace.

Lessons, personal reminders, and agent self-improvement notes are operator
state. Store them in global Kiln context, global instruction profiles, or the
native harness memory location, not in repo-root `memory/` files.

## Local Preferences

Use global config for personal defaults:

```text
~/.kiln/config.yaml
```

Use project config only when the setting is part of the repository contract. If
a setting would surprise another contributor or CI runner, it should not be
committed to `.kiln/kiln.yaml`.

## Suggested Ignore Block

New Kiln repositories should start with this ignore shape:

```gitignore
.claude/
memory/
.kiln/*
!.kiln/kiln.yaml
!.kiln/project-context.md
!.kiln/instructions/
!.kiln/instructions/**
!.kiln/agents/
!.kiln/agents/**
!.kiln/skills/
!.kiln/skills/**
```
