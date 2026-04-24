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

### Active roadmaps

- `01-gui-phase-1-parity-checklist.md`
  Phase I GUI parity checklist. The deletion gate for `packages/tui/`.

- `03-shared-tool-surface-unification.md`
  Converges direct/OAuth provider tool execution onto one canonical Kiln tool
  surface and establishes MCP as the shared wrapper integration contract.

- `04-operator-surfaces-and-remote-gui.md`
  Defines Kiln's long-term human operator surface strategy: web-first local GUI,
  IDE extension priority, Tauri as a later thin shell, and remote/cloud GUI
  hardening over the same runtime contract.

- `05-context-governor-unification.md`
  Collapses parallel context-assembly owners onto a single `ContextGovernor`
  in `@kilnai/core`, brings skills and cross-agent coordination state under
  one ranking policy, and unifies the audit trail across surfaces.

- `06-provider-credential-pool.md`
  Generalizes credential management across subscription-auth, direct API-key,
  and harness-wrapped providers. Introduces a provider-agnostic pool with
  rotation, cooldowns, and cross-process reload.

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
3. Read `03-shared-tool-surface-unification.md` when planning provider,
   wrapper, MCP, or builtin-tool execution changes.
4. Read `04-operator-surfaces-and-remote-gui.md` when planning GUI, IDE,
   desktop, remote GUI, cloud dashboard, or operator supervision work.
5. Read `05-context-governor-unification.md` when planning any change to
   context assembly, budget, ranking, truncation, or audit trail across
   `core`, `runtime`, `cli`, or GUI.
6. Read `06-provider-credential-pool.md` when planning any provider-auth
   change, multi-account scaling, or rate-limit recovery work.
7. Read `02-external-benchmark-validation.md` only when benchmark work becomes
   active.

## Current Execution Priority

This is the delivery queue. It is the only priority order in this index.

1. Record the GUI parity manual walkthrough using
   `docs/guides/gui-parity-walkthrough.md`, then prepare the TUI deletion PR
   using `docs/guides/tui-deletion-checklist.md`.
2. Execute `03-shared-tool-surface-unification.md` to remove the hardcoded
   direct-provider tool split and make MCP the canonical shared-tool contract.
3. Execute `05-context-governor-unification.md` to collapse parallel
   context-assembly owners onto the core `ContextGovernor`, bring skills and
   coordination state under one ranking policy, and unify the audit trail.
   This is a load-bearing refactor: it closes the gap between
   `context-governance.md` doctrine and the code, and it unblocks clean
   memory-layer work elsewhere.
4. Use `04-operator-surfaces-and-remote-gui.md` to sequence post-parity
   surface work. The first post-parity backbone slice is the canonical session
   event/replay envelope; real Workspace, Changed Files, Approvals, diffs,
   replay, and future invokable-agent panels must project from that contract
   instead of GUI-local state.
5. Execute `06-provider-credential-pool.md` to close the single-credential
   limitation and generalize pool semantics across all provider categories.
   This slice unblocks multi-account scaling for opencode-go, codex-oauth,
   and direct API-key providers without special-casing any of them.
6. Write and accept the config and registries surface ADR before broader config
   and registry UI work starts.
7. Keep `02-external-benchmark-validation.md` deferred until the product
   surface stabilizes.

## Current Status

As of 2026-04-23:

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
- shared direct/OAuth provider tool execution is now an active roadmap concern
  in `03-shared-tool-surface-unification.md`
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

## Rules

- Do not add new conceptual roadmap docs when an existing numbered file can be
  expanded instead.
- Do not split one concern across multiple near-duplicate plan files.
- Delete superseded roadmap docs once their stable doctrine is absorbed into
  canonical architecture or guide documentation.
