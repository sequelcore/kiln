# Execution Surfaces

## Purpose

Execution surfaces define where Kiln work is started, supervised, inspected,
approved, and completed.

This document is the canonical product and architecture contract for Kiln's
long-term surface direction. It does not replace the runtime taxonomy in
`runtime-surfaces.md` or the human operator rules in `operator-surfaces.md`.
It names the product center those documents serve:

- **Kiln Operator Workspace** is the primary human work surface.
- **Kiln Gateway** is the governed app AI runtime.
- Codex, Claude Code, OpenCode, MCP clients, IDEs, shells, and provider-native
  runtimes are adapters, providers, import sources, or fallback execution
  routes. They are not Kiln's product center.

Research basis: [tool execution and trust](../../research/foundations/tool-execution-and-trust.md)
for the operator-control and human-AI interaction evidence, and
[work governance and verification](../../research/foundations/work-governance-and-verification.md)
for the governance-framework evidence.

## Product Center

Kiln should be good enough that an operator naturally says: "I will open Kiln
and do the work there."

The Operator Workspace is not a wrapper console and not a transcript viewer. It
is the place where the operator can see governed work, sessions, managed
children, resources, approvals, gateway targets, config health, route health,
and attention state from one shared control-plane projection.

Kiln Gateway should be good enough that a developer naturally says: "I will run
Kiln Gateway to power AI features in my app."

The Gateway owns app, tenant, session, tool, MCP, provider/model, memory,
context, approval, audit, event, replay, managed-agent, and resource-plane
runtime semantics. Operator surfaces attach to it; they do not become
independent runtimes.

## Ownership Rules

1. Kiln owns the governed work runtime, evidence plane, operator workflow, and
   app runtime contract.
2. Human surfaces are projections over the control plane. They may own
   presentation state, but they must not own session truth, tool authority,
   work-item state, approval lifecycle, provider routing, memory admission,
   changed-file facts, or replay semantics.
3. Harnesses are execution adapters. Their prompts, hooks, permissions,
   subagents, task APIs, and transcripts may feed Kiln evidence, but they do
   not define canonical Kiln state.
4. New surface facts must be promoted to shared contracts before rich surfaces
   depend on them. Prefer `@kilnai/gateway-contracts`, core domain contracts,
   and runtime projections over GUI/TUI/CLI/native-local inference.
5. Direct-provider execution must remain first-class. Harness routes are useful
   fallbacks and comparison routes, not the required path to a good Kiln
   operator experience.
6. IDE and native surfaces are clients of Kiln Gateway/operator contracts. They
   must not fork work, session, or approval state.
7. Runtime state must not surprise users by appearing in arbitrary workspaces.
   Project-local artifacts must be explicit project-owned configuration,
   projections, or exports.

## First-Class Operator Objects

Every Operator Workspace projection should be able to organize work around
these objects without parsing final assistant prose:

- work: goals, work items, phases, expected evidence, execution attempts,
  verification gates, pause requirements, and residual risk
- sessions: active conversations, replay, provider/model routes, cost, tool
  calls, approvals, files changed, browser state, and mode transitions
- managed agents: children, route/capability snapshots, source resources,
  leases, worktree state, prompts, joins, cancellation, and adoption gates
- resources: transcripts, diffs, diagnostics, artifacts, source bundles,
  feedback bundles, memory graph resources, and external evidence
- gateways: local Operator Gateway, App Gateways, tenants/apps, health, auth,
  MCP exposure, channels, and runtime policies
- config health: provider credentials, model discovery, harness adapters,
  native projections, drift, and missing capability evidence
- attention: approvals, failed gates, missing evidence, blocked capability,
  stale heartbeat, route health, browser takeover, dirty worktree, and unsafe
  external effect requests

Chat remains useful as an interaction mode. It is not the source of truth.

## Shared Projection Contracts

Execution-surface behavior is contract-first:

1. **Gateway and operator target identity.** Every operator action must name the
   target it operates: local Operator Gateway, local App Gateway, remote App
   Gateway, simulated/dev target, app, tenant, session, and work target when
   applicable. The shared contract is `OperatorGatewayTargetIdentity` in
   `@kilnai/gateway-contracts`; cockpit attach plans and read-only projections
   must carry that identity instead of asking surfaces to infer gateway meaning
   from labels, URLs, or local instance strings.
2. **Attention model.** Normalize what needs operator attention across work
   items, managed invocations, approvals, browser takeover, config health,
   route health, and missing capability pauses. The shared contract starts with
   `OperatorAttentionSummary` and `OperatorAttentionItem` in
   `@kilnai/gateway-contracts`; surfaces may render badges, queues, and
   sidebars differently, but they must consume shared attention reasons instead
   of inventing private severity models.
3. **Operator Workspace projection.** Promote a shared home projection that
   summarizes governed work/goals, active sessions, managed children, pending
   approvals, gateway targets, resources, config health, route health, and
   attention queue. The shared home contract is `OperatorWorkspaceHomeProjection` in
   `@kilnai/gateway-contracts`; gateway dashboard snapshots publish it as
   `operatorWorkspaceHome` so surfaces do not rebuild home summaries from raw
   events when a live gateway projection is available.
4. **Surface convergence.** GUI, TUI, CLI, native, SDK/widget, IDE, and remote
   surfaces consume shared projections. They do not reconstruct private models.
   GUI is the first consumer of the shared Operator Workspace home projection:
   it consumes dashboard `operatorWorkspaceHome` for workspace summary and
   managed-agent attention count. The managed-agent cockpit panel still consumes
   read-only cockpit view state until the home projection carries enough detail
   to replace that panel input. TUI stores the same home projection beside its
   managed-agent sidebar state, CLI exposes the home projection in
   `kiln managed-agent list --json`, and the native cockpit contract returns
   the shared home projection with its read-only view-state wrapper.
5. **Resource inspector.** `kiln://` resources are first-class inspectable
   objects across rich and terminal surfaces. `OperatorWorkspaceResourceItem`
   deduplicates resource links with target identity, and
   `OperatorResourceReadRequest`/`OperatorResourceReadResult` carry URI,
   target, content, summary, cursor, and presentation data through the shared
   resource plane.
6. **Direct-provider parity.** Direct-provider managed execution must satisfy
   the same authority, evidence, cancellation, handoff, replay, and tool-policy
   contracts as harness-backed execution. Runtime adapter descriptors are
   parity-tested so direct-provider routes and CLI-harness routes keep the same
   lifecycle, timeout, transcript, usage, handoff, credential, memory, cleanup,
   and write-authority guarantees while preserving distinct execution modes.
7. **Gateway app runtime path.** Developer docs and SDK/widget flows should
   present Kiln Gateway as the governed app AI runtime, not as a GUI helper.
   The first guide-level projection is
   `docs/guides/channels/gateway-app-runtime.md`, which maps `gateway.yaml`,
   `app.yaml`, operator attachment, tenant boundaries, MCP, and production
   hardening back to the shared runtime-surface doctrine.
8. **Permission integrity projection.** Trusted/full-access execution state is
   part of config health and setup status through the shared
   `TrustedExecutionIntegrity` contract. Surfaces may summarize the
   classification, evidence source, enforcement strength, effective proof,
   approval requirement, and recommendation, but they must not infer runtime
   authority from a UI selector, native file, model statement, or local badge.

## Non-Goals

- Do not copy Codex, Claude Code, OpenCode, VS Code, or MCP feature-for-feature.
- Do not build new rich UI panels before the shared projection contract exists.
- Do not create harness compatibility layers without real consumers.
- Do not treat transcript replay as the normal live inspection model when a
  gateway projection is available.
- Do not expose remote Operator Gateway behavior as if it were a hardened App
  Gateway runtime.

## Invariants

- Kiln is where governed AI work is understood, supervised, and finished.
- Kiln Gateway is the runtime developers can trust inside their own AI apps.
- Final assistant text is never enough evidence.
- A surface-local badge, row, panel, checklist, or terminal line is never
  authority.
- Every cross-surface behavior must be represented by a shared contract or
  explicitly remain deferred.

## Implementation Status

Accepted and implemented foundation:

- `OperatorGatewayTargetIdentity`, attach targets, and read-only cockpit
  projections carry gateway target identity.
- `OperatorAttentionSummary` centralizes managed-agent attention and seeds
  broader work/config/route attention.
- `OperatorWorkspaceHomeProjection` is exported from gateway contracts and now
  includes governed work/goals, approval summaries, config health, route
  health, provider/model readiness, gateway/app health, gateway targets,
  sessions, managed-agent attention, resources, and shared attention.
- App Gateway and local GUI dashboard snapshots publish `operatorWorkspaceHome`.
- GUI dashboard parsing preserves `operatorWorkspaceHome`, and `AppShell`
  prefers the gateway-published home projection before falling back to local
  reconstruction.
- Runtime, CLI, GUI fallback, TUI, and native cockpit projections pass the
  normalized operator event stream into the shared home projector instead of
  deriving work or approval summaries inside a surface.
- Route health and provider/model readiness are projected from managed-agent
  capability snapshots. Gateway/app health is projected from explicit gateway
  target identity. Config health is part of the contract; local GUI setup
  diagnostics feed it, including permission-integrity mismatches and stale or
  unproven trusted-execution evidence. Producers without setup/doctor evidence
  project `unknown`.
- GUI target-bound operator actions use explicit `gatewayTargetId`; targetless
  global control-plane frames are limited to connected-surface, provider
  catalog, UI preference, or source-message operations.
- `OperatorResourceReadRequest` and `OperatorResourceReadResult` define the
  first-party resource inspector path. GUI, CLI, SDK, TUI, and native consumers
  use the shared resource contract or projected resource URIs instead of
  surface-local resource models; runtime resource reads pass target identity
  into provider options before resolution.
