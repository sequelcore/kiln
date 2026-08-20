---
version: "2"
source: reviewed-project-context
---

# Project Context

This file owns reviewed repository-wide notes that cannot be derived from
executable repository evidence. Package facts, commands, workspaces, and
standard references are derived when Kiln generates repository shims.
Do not put durable repo guidance directly in `AGENTS.md` or `CLAUDE.md`.
Regenerate this descriptor through `kiln project adopt` when replacement is
intended.

## Agent Review Notes

### No External Consumers

Kiln is published to npm and has no external consumers; the operator is the
only one. Breaking changes therefore need no migration shim, deprecation
window, or compatibility variant. Replace contracts outright and delete the old
path in the same change.

The operator's durable local state under `.kiln/` and `~/.kiln/` is the one
exception, and it is a data-migration question decided per change, not a reason
to keep an API compatibility layer. Discarding local state with no
future-useful evidence is an admitted outcome.

Canonical statement and full rules: `docs/architecture/core/engineering-standards.md`,
section "Consumer Surface".
