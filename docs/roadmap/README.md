# Roadmap

This directory is the canonical roadmap set for active execution tracks and
deferred benchmark work.

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
- `docs/architecture/provider-model-discovery.md`
  Canonical provider/model discovery, diagnostics, and selection rules.

### Active roadmaps

- `01-gui-phase-1-parity-checklist.md`
  Phase I GUI parity checklist. The deletion gate for `packages/tui/`.

- `04-operator-surfaces-and-remote-gui.md`
  Defines Kiln's long-term human operator surface strategy: web-first local GUI,
  IDE extension priority, Tauri as a later thin shell, and remote/cloud GUI
  hardening over the same runtime contract.

- `05-provider-credential-pool.md`
  Generalizes credential management across subscription-auth, direct API-key,
  and harness-wrapped providers. Introduces a provider-agnostic pool with
  rotation, cooldowns, and cross-process reload.

- `06-config-projection-unification.md`
  Makes `~/.kiln/config.yaml` the source of truth for harness configuration,
  projects managed Claude/Codex/OpenCode config, and adds drift-aware sync,
  uninstall, migrate, and engine-status workflows.

- `07-shared-developer-tools.md`
  Owns the shared builtin developer-tool roadmap after the metadata and
  projection foundation: patch, tree/stat, image/OCR, output modes, and
  controlled web tools.

- `08-shared-tooling-intelligence.md`
  Owns the next shared-tooling program: structured outputs, deferred tool
  discovery, LSP-backed code intelligence, bulk context ingestion, monitors,
  task state, elicitation, and MCP resources.

- `09-context-resource-plane.md`
  Owns the follow-up MCP resource program: pagination, workspace-file resource
  templates, artifact namespaces, resource update notifications, resource links
  from high-volume tools, consumer projection, and resource evaluations.

### Deferred work

- `02-external-benchmark-validation.md`
  Deferred public benchmark milestone after architecture and product work
  stabilize.

## Read Order

1. Read the relevant architecture docs in `docs/architecture/` before
   sequencing code refactors, especially `flows.md`, `subsystems.md`,
   `coordination.md`, `invariants.md`, `context-governance.md`,
   `session-model.md`, and `tool-execution.md`.
2. Read `01-gui-phase-1-parity-checklist.md` when planning or verifying GUI
   parity work.
3. Read `docs/architecture/tool-execution.md` and
   `docs/architecture/provider-model-discovery.md` when planning provider,
   wrapper, MCP, builtin-tool execution, or model-discovery changes.
4. Read `04-operator-surfaces-and-remote-gui.md` when planning GUI, IDE,
   desktop, remote GUI, cloud dashboard, or operator supervision work.
5. Read `05-provider-credential-pool.md` when planning any provider-auth
   change, multi-account scaling, or rate-limit recovery work.
6. Read `06-config-projection-unification.md` when planning harness config
   projection, engine registry, drift detection, sync, uninstall, migrate, or
   config-surface work.
7. Read `07-shared-developer-tools.md` when planning builtin developer tools,
   MCP projections, runtime-attached tool surfaces, patch/image/web tools, or
   tool output contracts.
8. Read `09-context-resource-plane.md` when planning MCP resources, resource
   pagination, workspace-file resources, artifact namespaces, or resource
   update notifications.
9. Read `02-external-benchmark-validation.md` only when benchmark work becomes
   active.

## Current Execution Priority

This is the delivery queue. It is the only priority order in this index.

1. Record the GUI parity manual walkthrough using
   `docs/guides/gui-parity-walkthrough.md`, then prepare the TUI deletion PR
   using `docs/guides/tui-deletion-checklist.md`.
2. Use `04-operator-surfaces-and-remote-gui.md` to sequence post-parity
   surface work. The first post-parity backbone slice is the canonical session
   event/replay envelope; real Workspace, Changed Files, Approvals, diffs,
   replay, and future invokable-agent panels must project from that contract
   instead of GUI-local state.
3. Execute `05-provider-credential-pool.md` to close the single-credential
   limitation and generalize pool semantics across all provider categories.
   This slice unblocks multi-account scaling for opencode-go, codex-oauth,
   and direct API-key providers without special-casing any of them.
4. Execute `06-config-projection-unification.md` after the provider credential
   pool and config/registry ADR sequencing is clear. It owns harness config
   projection, drift detection, engine registry, and config lifecycle commands.
5. `07-shared-developer-tools.md` and `08-shared-tooling-intelligence.md` are
   complete as of 2026-04-29. Use `09-context-resource-plane.md` for the next
   shared-tooling expansion. Resource pagination, stable cursors, and
   workspace-file resource templates are closed; continue with artifact
   namespaces.
6. Keep `02-external-benchmark-validation.md` deferred until the product
   surface stabilizes.

## Current Status

As of 2026-04-29:

- the taxonomy freeze and module mapping slices are closed
- bounded-context doctrine now lives only in the stable architecture docs,
  not in a standalone pseudo-roadmap matrix
- orchestrator cleanup, admitted-turn convergence, execution-boundary cleanup,
  and authority/audit convergence are complete for the current runtime stop
  point
- that doctrine now lives in `docs/architecture/flows.md`,
  `docs/architecture/subsystems.md`, `docs/architecture/context-governance.md`,
  `docs/architecture/session-model.md`, `docs/architecture/tool-execution.md`,
  `docs/architecture/coordination.md`, and `docs/architecture/invariants.md`
- GUI Phase 1 parity is functionally closed in
  `01-gui-phase-1-parity-checklist.md`
- parity status is 50/51 rows complete, with the sole remaining unchecked row
  (`6.7`) explicitly out of scope
- GUI/TUI/CLI session history and resume are now provider-agnostic; provider
  selection is next-turn routing state and provider-native IDs are nested
  provider-thread metadata
- GUI session selection now activates the canonical Kiln session directly:
  the transcript loads into the main chat and the next message continues that
  selected runtime conversation without a separate resume-target step
- the GUI now has a shadcn/Base UI baseline mapped onto Kiln semantic tokens,
  and the session rail has moved toward the dense operator-console direction
  with grouped canonical sessions, compact provider glyphs, and subtle active
  continuation state
- the dedicated GUI parity suite now exists at `packages/gui/tests/parity/`
  and passes; category 7 remains covered by CLI integration tests
- the remaining gate before TUI deletion is operational, not implementation:
  record the manual walkthrough, then cut the deletion PR
- shared direct/OAuth provider tool execution is complete and its stable
  doctrine lives in `docs/architecture/tool-execution.md`
- provider model-discovery diagnostics are complete and their stable doctrine
  lives in `docs/architecture/provider-model-discovery.md`
- operator surface strategy now lives in
  `04-operator-surfaces-and-remote-gui.md`, keeping human supervision surfaces
  separate from tool execution/provider integration concerns
- `kiln run --agent <name>` remains a CLI agent-profile configuration path;
  Kiln does not yet expose first-class managed agent invocation through the
  GUI/TUI/gateway operator contract
- external benchmark validation remains deferred
- OpenCode Go/Zen is now a first-class direct provider via the new
  `opencode-auth` + `opencode-provider` modules in `@kilnai/core`, with
  `kiln auth opencode {link,status,logout}` wired into the CLI; the
  credential-pool roadmap picks up from here
- context governor unification completed on 2026-04-27: runtime admitted-turn
  context, CLI session preparation, procedural memory, and cross-agent
  coordination state now use the core governor and audit trail. Stable doctrine
  now lives in `docs/architecture/context-governance.md`,
  `docs/architecture/memory.md`, `docs/architecture/coordination.md`,
  `docs/architecture/flows.md`, and `docs/guides/skills.md`
- context-governor execution records were pruned on 2026-04-27 after
  consolidation, and roadmap numbering was compacted:
  provider credential pool is now `05`, and config projection is now `06`
- shared developer-tool metadata, timeout handling, runtime evidence, MCP
  projection, and consumer alignment completed on 2026-04-29; remaining builtin
  tool expansion now lives in `07-shared-developer-tools.md`

## Rules

- Do not add new conceptual roadmap docs when an existing numbered file can be
  expanded instead.
- Do not split one concern across multiple near-duplicate plan files.
- Delete superseded roadmap docs once their stable doctrine is absorbed into
  canonical architecture or guide documentation.
