# 00 - Public Release Truth

Status: Active release blocker
Execution: Ready - complete operator live validation before public prerelease.
Started: 2026-06-28

## Objective

Ensure Kiln's public GUI presents canonical execution truth without duplicated,
false, unavailable, or surface-local states.

## Ownership

This track owns GUI presentation, interaction, accessibility, and operator live
validation. Runtime, route, skill, gateway, permission, and capability truth
remain owned by their shared contracts and roadmaps.

## Scope

- Single-owner activity emphasis and no empty assistant rows.
- Canonical Task and Tool execution evidence.
- Long-running, interrupted, restored, and responsive GUI behavior.
- Presentation of managed-agent, tool, skill, and provider diagnostics supplied by shared contracts.

## Non-Goals

- No GUI-local route admission, capability inference, or compatibility fixes.
- No broad visual polish.
- No Plan or Confirmation component without a real canonical consumer.
- No release claim from source tests alone.

## Ordered Slices

### Slice 0 - Implemented Work Experience

Status: Code complete.

Activity ownership, empty-assistant removal, source-owned Task presentation, and
structured Tool output are implemented with focused component and contract tests.

### Slice 1 - Operator Live Validation

Status: Ready.

Validate real streaming, long-running work, interruption, reconnect, restored
sessions, compact layout, inspector modes, workspace icons, and rotate/pulse
ownership. Record browser console state and exact route/session evidence.

### Slice 2 - Cross-Surface Presentation Parity

Status: Queued behind Slice 1.

Verify CLI and TUI use the same event vocabulary and do not contradict GUI
terminal state. Presentation may differ; canonical meaning may not.

### Slice 3 - Evidence-Led Component Adoption

Status: Queued.

Adopt only components with an admitted Kiln consumer. Components render Gateway
contracts and do not synthesize plans, permissions, progress, or provider truth.
Delete replaced renderers and unused compatibility paths in the same slice.

## Promotion Gates

- Exactly one passive activity owner is visible.
- No assistant row exists before visible assistant content.
- Tool and Task state survives reload and remains keyed by canonical identity.
- Managed-agent, skill, and provider diagnostics are projections, not GUI policy.
- Live validation covers normal, interrupted, restored, and long-running work.

## Verification

- Focused GUI and gateway-contract tests.
- GUI typecheck, build, and Chromium parity.
- Operator-authorized production live validation.
- `git diff --check`.

## Completion Criteria

The GUI is truthful and usable for real work, live evidence is recorded, stable
behavior is promoted to architecture/guides, and the prerelease UI gate can close.
