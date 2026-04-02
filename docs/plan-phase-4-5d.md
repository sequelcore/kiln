# Phase 4.5d Plan: Core Safety Hardening

> Updated: 2026-04-01. Source: Claude Code local safety scout + current Kiln implementation.

## Objective

Harden Kiln safety controls where bypass risk is highest:

- prompt-injection defenses with Unicode/homoglyph-aware detection
- dangerous command/code execution detection expansion
- tool-result scanning reuse as sink controls
- denial propagation and metrics for fail-closed behavior visibility

## Research Conclusions (High Level)

- Layered defense is required: normalization and pattern checks are necessary but
  insufficient without sink controls.
- Fail-closed approvals are safer than optimistic allow on ambiguity.
- Sink controls are first-class: tool-output scanning/post-tool checks prevent
  rebound injection and exfil paths.
- Denials must propagate as explicit runtime outcomes and metrics.

## Current Slice Status

**Status:** STARTED (`4.5d.a` landed, currently uncommitted)

First slice landed in core prompt scanning:

- detection-time normalization only (Unicode/homoglyph/invisible-char classes)
- original raw input preserved for auditability and forensic review
- adversarial coverage added for homoglyph/invisible-char bypass patterns
- adversarial coverage added for fenced-code downgrade behavior

Primary files touched by this slice:

- `packages/core/src/security/prompt-scanner.ts`
- `packages/core/tests/security/prompt-scanner-adversarial.test.ts`

## Next Slices

1. Expand dangerous command/code execution pattern coverage in security scanning.
2. Reuse tool-result scanning patterns as explicit sink controls where tool
   outputs re-enter prompts or external channels.
3. Wire denial propagation into safety metrics/events with deterministic
   fail-closed semantics for governed surfaces.
4. Add regression tests for new bypass classes before enabling broader defaults.

## Notes

- Keep normalization detection-only unless a specific sink requires transformed
  text; preserve originals for audit by default.
- Keep scope aligned with Phase 4.5 (permission/safety) and avoid runtime
  architecture changes outside hardening surfaces.
