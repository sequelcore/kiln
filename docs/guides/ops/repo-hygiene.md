# Repository Hygiene

This guide defines which Kiln files belong in a shared repository and which
files are operator-private project state.

## Versioned Project Files

Commit source files that define durable repository behavior, including deliberate
native guidance projections such as:

- `AGENTS.md` for Codex CLI and OpenCode
- `CLAUDE.md` for Claude Code
- ordinary application, package, and documentation files

`AGENTS.md` and `CLAUDE.md` are generated entrypoints, not configuration
authority. Regenerate them with `kiln sync --repo-shims`; do not edit their
generated content to change Kiln behavior.

## Private Project State

The project config and every mutable project-owned state surface live outside
the repository, in the operator's Kiln home:

```text
~/.kiln/projects/<krp_sha256>/
├── adoption.json
├── config.yaml
├── skill-install-state.json
├── context
├── agents/
├── instructions/
├── skills/
├── runtime/
├── sessions/
├── cache/
├── evidence/
├── backups/
├── mutations/
├── projections/
├── domains/
├── memory/
├── feedback/
├── benchmarks/
└── tmp/
```

`<krp_sha256>` is derived from the canonical physical project root. The
identity-only `adoption.json` contains only the manifest version and matching
`projectRuntimeId`; it does not copy config, credentials, or absolute paths.
Kiln rejects missing, malformed, copied, non-canonical, and unsafe manifests.
Relocation intentionally creates a new project identity and requires explicit
re-adoption. There is no project-local fallback, migration reader, or alias.

Global operator state remains global under `~/.kiln/`, including global config,
credentials, global instruction profiles, global agents, global skills, and
global native-projection state. A project binding may narrow global authority,
never broaden it.

Do not create or restore a repository-local `.kiln/` state tree. The old
repository-local config, context, skills, sessions, caches, SQLite databases,
and projection directories are legacy state, not a supported contract. Remove
them during the one-time clean cutover after private state has been adopted and
verified.

## Local Preferences

Use global config for personal defaults:

```text
~/.kiln/config.yaml
```

Use private project config only when a setting belongs to the repository
contract. The file is not versioned; it is resolved through the canonical
project binding and must be admitted by the project schema. If a setting would
surprise another contributor or CI runner, do not encode it as repository
source or a repo-shim edit.

## Native and Generated State

Native harness files are projections owned by their harness or by Kiln's
recorded projection state. Project-local `.claude/` settings may be generated
for an admitted native route, but they are not Kiln project config. Runtime
state, install-state, drift evidence, backups, and workflow snapshots remain in
the private project namespace, not in the repository.

## Suggested Ignore Block

New Kiln repositories should ignore legacy/private directories while keeping
deliberate repo guidance projections visible:

```gitignore
.claude/
memory/
.kiln/
```

Do not add exceptions that reintroduce `.kiln/kiln.yaml`,
`.kiln/project-context.md`, or other repository-local Kiln state. Private state
must stay under the operator's Kiln home.
