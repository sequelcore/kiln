# GUI Execution Presentation

Status: Canonical

## Purpose

Define the stable presentation invariants for Kiln's GUI execution experience.
The GUI projects canonical Runtime and Gateway evidence; it does not create a
second execution, route, permission, capability, or lifecycle truth.

## Ownership

Runtime and shared contracts own execution identity, lifecycle, work items,
tools, approvals, routes, capabilities, and terminal state. The GUI owns only
presentation, interaction, accessibility, responsive composition, and local
view state.

CLI and TUI may use different layouts, but they must preserve the same canonical
meaning and terminal outcome.

## Activity Invariants

- Exactly one aggregate surface owns passive activity emphasis at a time.
- Before structured progress or visible assistant text exists, the composer may
  present the bounded working indicator.
- When a canonical Task or other structured work projection becomes active,
  aggregate emphasis moves to that projection instead of being duplicated.
- Visible assistant streaming is itself the activity signal; no empty assistant
  row or cursor-only message is rendered.
- Individual tool rows preserve canonical lifecycle evidence and are not wrapped
  in competing activity animations.
- Motion is never the sole status signal; reduced-motion and accessible textual
  state remain available.

## Execution Evidence

- Task and Tool presentation is keyed by canonical identity, not array position
  or presentation-local state.
- Terminal state survives reload and restored-session projection.
- Structured output is preferred when supplied by shared contracts; readable
  bounded raw evidence remains available where required.
- Managed-agent, provider, skill, permission, and capability diagnostics are
  rendered from shared evidence and are never inferred by GUI components.
- Late events from another session cannot mutate the selected session view.
- Interrupted, cancelled, failed, detached, and approval-bound states remain
  explicit because they require operator understanding or action.

## Component Admission

Source-owned UI components may be adopted only for a real Kiln consumer. They
must consume canonical Gateway contracts, preserve accessibility and identity,
and delete the renderer or compatibility path they replace. A component must
not synthesize plans, progress, permissions, capability, provider availability,
or terminal success from prose.

`Plan`, `Confirmation`, or similar structures are admitted only after a shared
canonical producer exists.

## Validation

The execution presentation is validated through focused GUI and Gateway-contract
tests, GUI typecheck and build, Chromium parity, reload/restoration fixtures, and
operator-authorized production use. Operator use confirmed the implemented
activity, Task, Tool, restored-session, and responsive behavior is suitable for
the prerelease candidate. Future visual improvements are normal product work and
do not reopen release debt unless they expose a concrete truth, accessibility,
continuity, or canonical-state regression.

## Release Boundary

Passing source tests and operator validation close GUI presentation debt. Public
publication remains governed by the release runbook, exact candidate checks,
cross-platform smoke, trusted publishing, provenance, package-content review,
and registry installation verification.
