# Operator Workspace Guide

## Purpose

Use Kiln Operator Workspace to start, supervise, inspect, approve, and close
governed AI work from one control plane.

The workspace is not a chat-only surface. Chat is one interaction mode inside a
larger work environment that also shows work state, sessions, managed agents,
resources, gateway targets, config health, route health, and attention.

Architecture source: `../architecture/operator-workspace.md`.

## Core Workflow

1. Open Kiln through a human operator surface.

   ```bash
   kiln gui
   ```

2. Attach to the runtime you want to operate.

   Local operator sessions use the local Operator Gateway. App runtime work
   attaches to a running App Gateway:

   ```bash
   kiln gateway --config ./gateway.yaml --port 3800
   kiln gui --connect http://localhost:3800
   ```

3. Select the target app and tenant when operating an App Gateway.

4. Start or resume work from the workspace.

5. Inspect progress through shared projections:

   - Work for goals, work items, evidence gates, and residual risk.
   - Agents for managed child invocations, source resources, leases, joins,
     cancellations, and adoption state.
   - Activity for runtime events, routing, tools, cost, and completion.
   - Workspace for read-only files and working-tree context.
   - Setup for config, provider, projection, and install health.

6. Approve, deny, steer, join, cancel, or inspect through operator controls.

7. Close work only after required evidence and verification gates are present.

## Gateway Home Projection

The dashboard publishes `operatorWorkspaceHome` when the gateway can provide a
shared workspace summary. GUI consumes that projection before deriving local
summaries from session events.

The current projection includes:

- gateway targets
- session summaries
- governed work/goals summary
- managed-agent counts and attention count
- pending/resolved approvals summary
- config health summary
- route health summary
- provider/model readiness summary
- gateway/app health summary
- linked resources
- shared attention summary

Config health is `unknown` until the active runtime supplies setup/doctor
diagnostics. Do not treat `unknown` as healthy.

## Gateway Targets

Operator actions should point at explicit gateway targets. Long term, the
target switcher will expose:

- local Operator Gateway
- local App Gateway
- remote App Gateway
- simulated gateway
- app target
- tenant target

In App Gateway attach mode, GUI target selection is backed by
`operatorWorkspaceHome.gatewayTargets`. Composer messages carry the selected
`gatewayTargetId`; app and tenant message fields are derived from that target,
and the runtime validates the target identity before routing.
Managed-agent cancel and prompt controls carry the projected `gatewayTargetId`
when the cockpit item includes one.
Browser session takeover/release controls and brokered browser operator input
also carry the projected `gatewayTargetId` when the browser session includes
one. Runtime browser evidence includes that target identity for audit and
inspection.
Approval approve/reject actions carry the selected `gatewayTargetId` when the
workspace has an explicit target selection.
Plan/execute mode transitions also carry the selected `gatewayTargetId` when
the workspace has an explicit target selection.
Explicit continuation selection also carries `gatewayTargetId`; the gateway
acknowledgement preserves that identity.

Do not infer authority from a label, selected port, or visible app name. The
runtime target must be represented by shared target identity.

Do not add target identity to global control-plane actions unless they become
target-bound. Provider refresh, provider authentication, provider switching,
clear, operator-theme results, and voice synthesis are surface/catalog/message
controls rather than selected app/tenant runtime actions.

## Resource Inspection

`kiln://` resource URIs are durable inspection handles. Use resource links
instead of copying large artifacts into chat or surface-local state.

Important resource families include:

- `kiln://session/work-items/...`
- `kiln://session/goals/...`
- `kiln://managed-agents/invocations/...`
- `kiln://artifacts/...`
- `kiln://memory/...`
- `kiln://workspace/...`

The same URI should resolve through the same resource-read contract whether it
is opened from GUI, TUI, CLI, native, SDK, or another future client.

GUI gateway reads use `POST /gui/api/resources/read` with an
`OperatorResourceReadRequest` body and return `OperatorResourceReadResult`. A
surface may adapt the first content item into a preview or download, but should
not treat that preview representation as the canonical resource payload.
When the surface has selected a gateway target, the request should include the
target fields rather than relying on labels, ports, or local instance strings.
Runtime forwards that target into provider read options before resolving the
URI.

## Operator Rules

- Treat gateway projections as runtime truth.
- Treat transcript replay as offline inspection, not the normal live model.
- Do not consider final assistant prose enough evidence.
- Do not bypass missing evidence, failed gates, or unresolved pause
  requirements.
- Do not treat a surface badge or row as authority; authority comes from the
  runtime admission and evidence contract.
