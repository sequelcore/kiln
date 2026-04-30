# Roadmap

This directory is the canonical roadmap set for active execution tracks and
deferred benchmark work.

Numbered roadmap files are active or deferred planning records only. Once a
program is implemented, its stable doctrine must move into `docs/architecture/`
or `docs/guides/`, and the roadmap file must be deleted.

## Canonical File Set

The roadmap uses numbered files only for active execution tracks. The number
indicates the default read order, not necessarily the active work priority.

### Architecture references

- `docs/architecture/flows.md`
  Canonical runtime and tool-flow sequencing after ingress admission.
- `docs/architecture/subsystems.md`
  Canonical subsystem boundaries, owned responsibilities, and failure modes.
- `docs/architecture/coordination.md`
  Canonical coordination primitives and their current vocabulary.
- `docs/architecture/invariants.md`
  Architectural laws and non-negotiable rules.
- `docs/architecture/context-governance.md`
  Canonical context-assembly ownership and budget doctrine.
- `docs/architecture/session-model.md`
  Canonical provider-agnostic session identity and provider-thread metadata
  rules.
- `docs/architecture/tool-execution.md`
  Canonical tool authority, execution, and safety boundaries.
- `docs/architecture/developer-tools.md`
  Canonical shared builtin developer-tool contracts.
- `docs/architecture/shared-tooling-intelligence.md`
  Canonical shared builtin-tool intelligence contracts.
- `docs/architecture/context-resource-plane.md`
  Canonical read-only resource-plane contracts.
- `docs/architecture/provider-model-discovery.md`
  Canonical provider/model discovery, diagnostics, and selection rules.
- `docs/architecture/operator-surfaces.md`
  Canonical human operator surface model, ownership rules, GUI/TUI/CLI/IDE
  boundaries, remote GUI requirements, and future desktop-wrapper constraints.
- `docs/guides/gui-parity.md`
  Canonical GUI parity status and GUI/TUI focus policy.
- `docs/guides/tui-maintenance.md`
  Canonical frozen TUI maintenance policy.

### Active roadmaps

- `01-memory-lattice-governed-memory.md`
  Defines the governed memory and Memory Lattice program: core memory domain,
  provenance, relations, context-admission evidence, resource projection, and
  first GUI graph view over shared contracts.

- `02-provider-credential-pool.md`
  Generalizes credential management across subscription-auth, direct API-key,
  and harness-wrapped providers. Introduces a provider-agnostic pool with
  rotation, cooldowns, and cross-process reload.

- `03-config-projection-unification.md`
  Makes `~/.kiln/config.yaml` the source of truth for harness configuration,
  projects managed Claude/Codex/OpenCode config, and adds drift-aware sync,
  uninstall, migrate, and engine-status workflows.

### Completed programs promoted to architecture or guides

- GUI Phase 1 parity is closed. Stable status now lives in
  `docs/guides/gui-parity.md`.
- Shared developer tools completed on 2026-04-29. Stable doctrine now lives in
  `docs/architecture/developer-tools.md`.
- Shared tooling intelligence completed on 2026-04-29. Stable doctrine now
  lives in `docs/architecture/shared-tooling-intelligence.md`.
- Context resource plane completed on 2026-04-30. Stable doctrine now lives in
  `docs/architecture/context-resource-plane.md`.

### Deferred work

- `04-external-benchmark-validation.md`
  Deferred public benchmark milestone after architecture and product work
  stabilize.

## Read Order

1. Read the relevant architecture docs in `docs/architecture/` before
   sequencing code refactors, especially `flows.md`, `subsystems.md`,
   `coordination.md`, `invariants.md`, `context-governance.md`,
   `session-model.md`, `tool-execution.md`, `developer-tools.md`,
   `shared-tooling-intelligence.md`, and `context-resource-plane.md`.
2. Read `docs/guides/gui-parity.md` and
   `docs/guides/tui-maintenance.md` when planning GUI/TUI operator-surface
   changes.
3. Read `docs/architecture/tool-execution.md`,
   `docs/architecture/developer-tools.md`,
   `docs/architecture/shared-tooling-intelligence.md`,
   `docs/architecture/context-resource-plane.md`, and
   `docs/architecture/provider-model-discovery.md` when planning provider,
   wrapper, MCP, builtin-tool execution, resource, or model-discovery changes.
4. Read `01-memory-lattice-governed-memory.md` when planning memory, recall,
   context-admission evidence, graph/resource projection, Memory Lattice GUI,
   memory CLI/TUI/MCP projection, or memory YAML policy work.
5. Read `docs/architecture/operator-surfaces.md` when planning GUI, IDE,
   desktop, remote GUI, cloud dashboard, TUI maintenance, or operator
   supervision work.
6. Read `02-provider-credential-pool.md` when planning any provider-auth
   change, multi-account scaling, or rate-limit recovery work.
7. Read `03-config-projection-unification.md` when planning harness config
   projection, engine registry, drift detection, sync, uninstall, migrate, or
   config-surface work.
8. Read `04-external-benchmark-validation.md` only when benchmark work becomes
   active.

## Current Execution Priority

This is the delivery queue. It is the only priority order in this index.

1. Execute `01-memory-lattice-governed-memory.md` first. It upgrades memory from
   saved text into a governed, scoped, provenance-aware graph that can be
   consumed by GUI, CLI, TUI, YAML apps, SDK, and MCP through shared resource
   contracts. The first visible product output is the GUI Memory Lattice, but the
   core memory/domain/resource work comes first.
2. Execute `02-provider-credential-pool.md` to close the single-credential
   limitation and generalize pool semantics across all provider categories.
   This slice unblocks multi-account scaling for opencode-go, codex-oauth, and
   direct API-key providers without special-casing any of them.
3. Execute `03-config-projection-unification.md` after the provider credential
   pool and config/registry ADR sequencing is clear. It owns harness config
   projection, drift detection, engine registry, and config lifecycle commands.
4. Keep `04-external-benchmark-validation.md` deferred until the product
   surface stabilizes.

## Current Status

As of 2026-04-30:

- the taxonomy freeze and module mapping slices are closed
- bounded-context doctrine now lives only in the stable architecture docs, not
  in a standalone pseudo-roadmap matrix
- orchestrator cleanup, admitted-turn convergence, execution-boundary cleanup,
  and authority/audit convergence are complete for the current runtime stop
  point
- stable doctrine lives in `docs/architecture/flows.md`,
  `docs/architecture/subsystems.md`, `docs/architecture/context-governance.md`,
  `docs/architecture/session-model.md`, `docs/architecture/tool-execution.md`,
  `docs/architecture/developer-tools.md`,
  `docs/architecture/shared-tooling-intelligence.md`,
  `docs/architecture/context-resource-plane.md`,
  `docs/architecture/operator-surfaces.md`,
  `docs/architecture/coordination.md`, and `docs/architecture/invariants.md`
- GUI Phase 1 parity is closed and promoted to `docs/guides/gui-parity.md`
- TUI remains a frozen maintenance surface under
  `docs/guides/tui-maintenance.md`
- GUI/TUI/CLI session history and resume are now provider-agnostic; provider
  selection is next-turn routing state and provider-native IDs are nested
  provider-thread metadata
- shared direct/OAuth provider tool execution is complete and its stable
  doctrine lives in `docs/architecture/tool-execution.md`
- provider model-discovery diagnostics are complete and their stable doctrine
  lives in `docs/architecture/provider-model-discovery.md`
- Memory Lattice and governed memory is now priority 1 in
  `01-memory-lattice-governed-memory.md`
- operator surface doctrine now lives in
  `docs/architecture/operator-surfaces.md`
- external benchmark validation remains deferred
- OpenCode Go/Zen is now a first-class direct provider via `opencode-auth` and
  `opencode-provider` modules in `@kilnai/core`; the credential-pool roadmap
  picks up from here
- context governor unification completed on 2026-04-27; stable doctrine now
  lives in `docs/architecture/context-governance.md`,
  `docs/architecture/memory.md`, `docs/architecture/coordination.md`,
  `docs/architecture/flows.md`, and `docs/guides/skills.md`
- roadmap numbering was compacted on 2026-04-30 after operator-surface doctrine
  moved to architecture: memory lattice is now `01`, provider credential pool is
  now `02`, config projection is now `03`, and external benchmark validation is
  now `04`
- shared developer-tool metadata, timeout handling, runtime evidence, MCP
  projection, consumer alignment, and the initial builtin tool expansion are
  complete and promoted to `docs/architecture/developer-tools.md`
- shared tooling intelligence and the context resource plane are complete and
  promoted to architecture docs

## Rules

- Do not add new conceptual roadmap docs when an existing numbered file can be
  expanded instead.
- Do not split one concern across multiple near-duplicate plan files.
- Delete superseded roadmap docs once their stable doctrine is absorbed into
  canonical architecture or guide documentation.
