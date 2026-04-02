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

**Status:** STARTED (`4.5d.a`, `4.5d.b`, `4.5d.c`, `4.5d.d`, and `4.5d.e` landed, currently uncommitted)

First slice landed in core prompt scanning:

- detection-time normalization only (Unicode/homoglyph/invisible-char classes)
- original raw input preserved for auditability and forensic review
- adversarial coverage added for homoglyph/invisible-char bypass patterns
- adversarial coverage added for fenced-code downgrade behavior

Primary files touched by this slice:

- `packages/core/src/security/prompt-scanner.ts`
- `packages/core/tests/security/prompt-scanner-adversarial.test.ts`

Second slice landed in dangerous-command detection:

- new detector contract in `engine/domain`
- deterministic implementation in `security`
- shell-aware `allow | ask | deny` decisions
- coverage for Unix destructive, Windows destructive, download-and-exec, and
  ambiguous ask boundaries

Verification status for this slice:

- targeted core compile passed
- focused test execution remains blocked in the current environment

Third slice landed in runtime enforcement:

- detector enforcement now runs before tool execution in `ModeBOrchestrator`
- wiring is provided from `gateway-server`
- `deny` and `ask` are enforced fail-closed
- detector errors are handled conservatively
- empty commands are blocked before execution

Verification status for this slice:

- targeted runtime compile passed
- focused runtime tests are implemented for the enforcement path

Fourth slice landed in cache-hit tool-result sink hardening:

- cached tool results now pass through `ToolResultSanitizer` before
  reinjection in `ModeBOrchestrator`
- sanitizer failure on cache hit no longer re-executes the tool
- cache-hit reinjection remains controlled and does not bypass the safety path

Verification status for this slice:

- targeted runtime compile passed
- focused `mode-b-orchestrator-tools` cache-hit sanitization test passed

Fifth slice landed in runtime gateway sanitizer wiring:

- runtime now wires prompt-injection scanning into `ToolResultSanitizer`
  construction through `tool-result-sanitizer-factory`
- sanitizer wiring honors runtime `securityConfig.promptInjection`
- regression coverage exists for enabled, disabled, and custom
  `allowedPatterns` behavior through the runtime tool-result reinjection path

Verification status for this slice:

- targeted runtime compile passed
- focused gateway sanitizer regression coverage exists for
  enabled/disabled/custom-allowlist cases

## Next Slices

1. Reuse tool-result scanning patterns as explicit sink controls where tool
   outputs re-enter prompts or external channels.
2. Expand dangerous command/code execution coverage beyond the first detector
   slice where additional shells/pattern families warrant it.
3. Wire denial propagation into safety metrics/events with deterministic
   fail-closed semantics for governed surfaces.
4. Add regression tests for new bypass classes before enabling broader defaults.

## Notes

- Keep normalization detection-only unless a specific sink requires transformed
  text; preserve originals for audit by default.
- Keep scope aligned with Phase 4.5 (permission/safety) and avoid runtime
  architecture changes outside hardening surfaces.
