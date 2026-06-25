# Operator Workspace

## Purpose

Kiln Operator Workspace is the primary human surface for governed AI work. It
is not a transcript viewer, wrapper console, or GUI-owned state machine.

Operator Workspace surfaces consume shared gateway contracts for work, sessions,
managed agents, resources, gateway targets, config health, route health, and
attention. Surface components may own layout and interaction state; they must
not own canonical runtime truth.

## Source Of Truth

The shared home projection starts at
`OperatorWorkspaceHomeProjection` in `@kilnai/gateway-contracts`.

The projection is intentionally read-only. It summarizes:

- gateway targets
- sessions
- governed work items and goal counts
- managed-agent counts and attention counts
- pending/resolved approval counts
- config health
- route health
- provider/model readiness
- gateway/app health
- linked resources
- shared attention state

The dashboard frame exposes it as `GuiDashboardSnapshot.operatorWorkspaceHome`.
GUI attach mode must prefer that gateway-published projection. A local
projection is allowed only as an explicit fallback when no gateway home
projection is available.

## Surface Rules

1. Work, session, managed-agent, resource, approval, route, and config facts
   should be promoted into shared contracts before a surface renders them as
   first-class product state.
2. GUI, TUI, CLI, native, IDE, SDK, and remote surfaces may render different
   layouts, but they must consume the same target identity, attention, and
   resource contracts.
3. Transcript replay is an offline inspection mode. Live surfaces should prefer
   gateway-published projections and resource reads.
4. Final assistant prose is never sufficient evidence for work completion.
5. Surface badges, panels, rows, and terminal lines are presentation, not
   authority.

## Current Implementation Status

- Gateway dashboard snapshots publish `operatorWorkspaceHome`.
- GUI parses the dashboard field and uses it for managed-agent attention count
  before falling back to a local projection.
- TUI stores the shared home projection beside its managed-agent sidebar state.
- Native cockpit projection returns the shared home projection with its
  read-only view-state wrapper.
- CLI exposes a workspace home projection from managed-agent list JSON.
- Runtime, CLI, GUI fallback, TUI, and native producers pass normalized
  operator events into the shared projector so work/goals, approvals, route
  health, and provider readiness stay cross-surface.
- Gateway/app health is projected from explicit target identity. Config health
  is present in the contract; local GUI setup diagnostics feed it, and
  producers without setup/doctor evidence project `unknown`.

The remaining work is to extend setup/doctor diagnostics coverage without
surface-local inference.

## Gateway Target Switcher

The target switcher is an Operator Workspace control, not a GUI-only app
dropdown.

It must present explicit `OperatorGatewayTargetIdentity` values for:

- local Operator Gateway
- local App Gateway
- remote App Gateway
- simulated or fixture-backed gateway
- app and tenant targets when applicable

The first implemented slice publishes App Gateway app and tenant targets through
`operatorWorkspaceHome.gatewayTargets`. GUI attach mode selects a
`targetId` from that list and sends composer messages with `gatewayTargetId`;
app and tenant fields are derived from the selected target for the current App
Gateway runtime handler.

Every operator action that crosses a gateway/app/session boundary must carry a
target identity. Surfaces must not infer target authority from labels, selected
ports, or local instance strings.

## Resource Inspector

The resource inspector is the first-party way to open `kiln://` resources from
any surface.

It should consume shared resource summaries and resource-read contracts for:

- session work items and goals
- managed invocation aggregate and resource bundles
- transcripts and replay artifacts
- diffs, diagnostics, and source bundles
- memory graph resources
- external evidence bundles

Surfaces may choose rich, terminal, or JSON presentation, but the URI, target,
authorization, and read result must come from the shared resource plane.
