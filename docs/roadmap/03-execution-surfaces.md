# 03 - Execution Surfaces

Started: 2026-06-25

## Scope

This roadmap tracks the remaining implementation work that turns the execution
surfaces strategy into product behavior.

Stable doctrine lives in:

- `docs/architecture/execution-surfaces.md`
- `docs/architecture/operator-workspace.md`
- `docs/architecture/app-gateway-runtime.md`
- `docs/guides/gateway-app-runtime.md`

Research basis:

- `docs/research/18-execution-surfaces-strategy.md`

## Principles

- Contract first. Promote shared state into `@kilnai/gateway-contracts`,
  core, or runtime before rich surfaces depend on it.
- No parallel models. GUI, TUI, CLI, native, SDK/widget, IDE, and remote
  clients consume shared projections or explicitly remain deferred.
- Gateway owns runtime truth. Surfaces own layout and local interaction state
  only.
- No compatibility shims without real consumers.
- Every completed slice needs focused tests, typecheck, and documentation
  updates.

## Active Slices

### 1. GUI Consumes Gateway Home Projection

Status: implemented.

The GUI dashboard parser preserves `operatorWorkspaceHome`, and `AppShell`
prefers the gateway-published home projection for managed-agent attention count
before falling back to local reconstruction.

Remaining follow-up:

- Continue replacing GUI-local summary reductions as the shared home projection
  gains first-class route, config, provider, and gateway health fields.

### 2. Operator Workspace Home Expansion

Status: implemented for shared contract projection.

Current home projection summarizes gateway targets, sessions, managed agents,
resources, managed-agent attention seed, governed work/goals, approvals, route
health, provider/model readiness, gateway/app health, and config health.

Remaining follow-up:

- Extend setup/doctor diagnostics beyond local GUI producers where needed.
  Producers without setup/doctor evidence correctly project config health as
  `unknown`.

Completion gate:

- GUI, TUI, CLI, native, and SDK consumers can answer "what needs attention?"
  and "what work is active?" from shared contracts without parsing transcript
  prose or surface-local stores.

### 3. Gateway Target Switcher

Status: implemented for current GUI target-bound operator actions.

Current GUI consumes `operatorWorkspaceHome.gatewayTargets` for App Gateway
attach mode, selects by `OperatorGatewayTargetIdentity.targetId`, and sends
composer messages with explicit `gatewayTargetId` plus derived app/tenant
fields. The App Gateway GUI message handler resolves and validates
`gatewayTargetId`, rejects conflicting app/tenant fields, and routes tenant
targets without falling back to label or port inference.
Managed-agent cancel/prompt controls now carry projected `gatewayTargetId`
through GUI and native frames when cockpit state provides target identity.
Browser session takeover/release controls and brokered browser operator input
now carry projected `gatewayTargetId` when browser session state provides target
identity, and the runtime GUI gateway forwards that identity through browser
provider requests and browser-operator evidence.
Approval approve/reject frames now carry the selected `gatewayTargetId` from
GUI approval surfaces when the target switcher has an explicit selection.
Plan/execute mode transition frames now carry the selected `gatewayTargetId`
from GUI controls when the target switcher has an explicit selection.
Explicit continuation selection frames now carry `gatewayTargetId` and gateway
ACKs preserve it in `continuation_selected`.

Current global control-plane frames remain intentionally targetless:
`clear`, `refresh_providers`, `provider_auth`, provider switching,
operator-theme results, and voice-synthesis requests. They operate on the
connected operator surface, provider catalog, UI preference, or source message,
not on an app/tenant runtime target.

Next fields and behavior:

- local Operator Gateway target
- remote App Gateway target
- simulated target
- app and tenant target identity for future target-bound operator actions
- trust label and connection state

Completion gate:

- operator actions carry target identity without inferring authority from
  labels, selected ports, or local instance strings.

### 4. Resource Inspector

Status: active.

Current surfaces can open some `kiln://` resources. The shared
`OperatorResourceReadResult` contract now defines the first canonical
resource-read result shape, and the GUI gateway reads resources through
`/gui/api/resources/read` instead of a GUI-only data URL payload.
Configured builtin tool surfaces now also expose workspace external-engagement
artifacts from `.kiln/external-engagement` through the shared resource plane,
including content-derived artifact indexes, aggregate evidence/candidate/review
counts in `OperatorResourceReadResult.summary`, and evidence-id reads for
source-grounded review.
CLI resource reads and GUI preview data URLs now preserve summarized resources
as shared `OperatorResourceReadResult` JSON instead of collapsing them to raw
text. Summarized reads also project through
`projectOperatorResourceReadPresentation`, giving terminal and browser
presentations deterministic rows for counts, facets, metadata, content count,
and cursor state without owning separate resource models.
Shared summary producers now cover the implemented aggregate resource
families: tool catalog, session work items, session goals, workspace trees,
artifact namespaces, memory graph snapshots, managed-agent invocation indexes,
and external-engagement artifact indexes.

Next behavior:

- target-aware resource open requests on every surface
- add summary producers for newly introduced aggregate resource families as
  they land

Completion gate:

- opening the same `kiln://` URI from GUI, TUI, CLI, native, or SDK resolves
  through the same resource-read contract and target identity.

### 5. Documentation Closeout

Status: active.

Docs created or updated:

- `docs/architecture/operator-workspace.md`
- `docs/architecture/app-gateway-runtime.md`
- `docs/architecture/execution-surfaces.md`
- `docs/roadmap/03-execution-surfaces.md`

Remaining docs:

- update `docs/guides/gui.md` as surface behavior lands
- update `docs/research/18-execution-surfaces-strategy.md` from diagnosis-only
  to accepted research basis after the first full home/switcher/inspector
  closeout
- update `docs/research/README.md` and `docs/roadmap/README.md` when this
  roadmap moves from active to completed

## Out Of Scope

- IDE extension implementation before gateway resource/target contracts are
  stable.
- Native-only runtime state.
- Remote Operator Gateway exposure as if it were a hardened App Gateway.
- Harness feature cloning.
