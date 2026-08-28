# Repository Hygiene

Repository guidance is shared project/team content. Operator preferences,
runtime configuration, credentials, and generated evidence are private state.
Keep those boundaries explicit so a repository checkout is useful without
leaking one operator's environment into another contributor's work.

## Project-owned repository guidance

Commit source files that define durable repository behavior, including:

- `AGENTS.md`, the project/team-owned guidance consumed natively by Codex and
  OpenCode;
- `CLAUDE.md`, when the project needs Claude-specific guidance. It should import
  `@AGENTS.md` and contain only genuine Claude-specific deltas;
- ordinary application, package, and documentation files.

Kiln does not routinely regenerate or overwrite these repository files. Treat an
existing file as project-owned by default. Use the `agent-context-doctor` skill
to diagnose ownership, duplication, leakage, and a proposed diff. Apply a
change only after the user explicitly requests it and the project owner is
clear.

## Content placement

Resolve ownership before classifying content:

- Derived repository evidence such as manifests, scripts, workspace metadata,
  and generated facts stays with its executable or source owner. Do not copy it
  into private project context.
- Project/team-owned guidance belongs in `AGENTS.md`. A project-owned
  `CLAUDE.md` may import it and add genuine Claude-specific deltas.
- Private reviewed project context is for non-derivable operator or project
  notes that Kiln needs. It is not a mirror of repository structure or commands.

Then use these categories when deciding whether a block belongs in repository
guidance:

| Category | Repository rule |
| --- | --- |
| Project context | Keep non-derivable reviewed project notes in the private project-context owner when they are not shared repository guidance. |
| Global preference/doctrine | Keep operator or team defaults in global or private-project instruction profiles; do not copy them into a repository without project ownership. |
| Runtime config | Keep provider, model, routing, workers, depth, permissions, sandbox, and MCP credentials in canonical configuration, never prose guidance. |
| Procedure/skill | Put reusable task procedures in skills and reference them rather than duplicating steps. |
| Executable enforcement | Enforce hard policy in schemas, runtime, tools, hooks, or tests; prose can explain it but cannot enforce it. |
| Derived/redundant cache | Keep generated snapshots, indexes, and status material disposable and out of repository guidance. |

Private or global content must not be copied into `AGENTS.md` or `CLAUDE.md`:
this includes credentials, absolute operator paths, local provider/model
choices, routing and worker limits, permission or sandbox settings, and MCP
secrets. Repository guidance may link to public project documentation, but it
must not become a private workflow transcript or runtime configuration file.

## Private project state

The project binding and mutable Kiln state live outside the repository, in the
operator's Kiln home:

```text
~/.kiln/projects/<krp_sha256>/
├── adoption.json
├── config.yaml
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

`<krp_sha256>` is derived from the canonical physical project root.
`adoption.json` is an identity-only manifest containing its version and matching
`projectRuntimeId`; it does not copy configuration, credentials, or absolute
paths. A missing, malformed, copied, non-canonical, or unsafe manifest fails
closed. Relocation creates a new project identity and requires explicit
re-adoption.

Global operator state remains under `~/.kiln/`, including global config,
credentials, instruction profiles, agents, skills, and native-projection state.
A project binding may narrow global authority, never broaden it.

Do not create a repository-local `.kiln/` state tree. Private config, sessions,
caches, SQLite authorities, install state, drift evidence, backups, mutations,
and projections stay under the operator's Kiln home. The private workflow
snapshot is a generated projection for private consumers; it is not repository
guidance and has no authority of its own.

## Native projections

Global native instruction projections are opt-in managed renderings of neutral
doctrine. They are written only to harness-owned user locations after explicit
selection, retain ownership and drift evidence in private state, and never
become repository guidance. A native harness adapter may add its own genuine
delta, but it must not copy private runtime state or invent project policy.

Project-local native settings such as `.claude/` are harness state, not Kiln
project config or repository guidance. Preserve unmanaged fields and diagnose
drift through the owning status surface.

## Suggested ignore block

Repositories may ignore private and native state while keeping project-owned
guidance visible:

```gitignore
.claude/
memory/
.kiln/
```

Do not add exceptions that reintroduce repository-local Kiln config, context,
skills, sessions, databases, or projection state. Private state must stay under
the operator's Kiln home.
