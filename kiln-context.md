# Kiln Session Handoff

## Scope

Session focus: GUI parity fallout, `codex-oauth` stability, and telemetry
repair for subscription-backed providers.

Repository: `C:\Proyectos\Sequel\kiln`
Branch: `main`
Date: 2026-04-21

## Current state

The previous handoff is no longer current. The provider switch-back issue and
the `$0` telemetry architecture issue are no longer the active next slices.

What is now true:

- `codex-oauth` switch-back is stabilized enough that it is no longer the
  primary blocker captured in the old handoff.
- telemetry no longer relies on provider-qualified model-string hacks or
  zero-dollar subscription rows in `MODEL_CATALOG`
- execution identity now carries explicit billing semantics
- the next remaining defects are narrower and should be handled as follow-up
  validation / reliability slices

## Confirmed fixes completed across the latest GUI-debug sequence

### 1. `codex-oauth` provider switch-back / model-state fallout

Resolved behavior:

- GUI/provider flow now avoids the previously observed breakage where switching
  away from `codex-oauth` and back could fail with
  `[EXECUTABLE_SESSION_ERROR] Codex OAuth request failed`

This is no longer the recommended next slice.

### 2. Telemetry token propagation

Resolved behavior:

- token counts now propagate through the executable/subscription session path
- GUI/runtime processed-turn logs no longer stay stuck at `tokens: 0` when the
  session actually consumed tokens

Relevant files touched in the broader fix path included:

- `packages/cli/src/wrapper/executable-provider-session.ts`
- `packages/runtime/src/execution/cli-response-assembler.ts`
- `packages/runtime/src/execution/cli-session-contract.ts`

### 3. Billing / pricing architecture repair

Resolved behavior:

- cost telemetry no longer depends on ad hoc provider-qualified model aliases
- subscription/free semantics are now represented separately from metered
  pricing lookup
- `codex-oauth` subscription policy is no longer encoded as fake zero-dollar
  catalog rows

Core design now in place:

- execution identity includes:
  - `provider`
  - `model`
  - `canonicalModel`
  - `billingMode`
- `billingMode` distinguishes:
  - `metered`
  - `subscription`
  - `free`
  - `unknown`
- pricing resolution now uses execution metadata instead of guessing from
  prefixed runtime model strings

Primary files for this slice:

- `packages/core/src/agents/execution-identity.ts`
- `packages/core/src/cost/cost-tracker.ts`
- `packages/core/src/agents/model-pricing.ts`
- `packages/runtime/src/session/runtime-session-orchestrator-routing.ts`
- `packages/runtime/src/session/runtime-session-orchestrator-telemetry.ts`
- `packages/cli/src/wrapper/executable-provider-session.ts`
- `packages/cli/src/wrapper/opencode-session.ts`
- `packages/cli/src/wrapper/provider-session.ts`
- `packages/cli/src/wrapper/codex-session.ts`

## Still open

### A. `codex-oauth` write-tool reliability

Still open.

Observed symptom from live usage:

- `codex-oauth` could reach the executable tool path and approval flow
- file creation/write then failed because the emitted `write` tool arguments
  were malformed or otherwise rejected

This remains a real follow-up defect.

Likely files:

- `packages/cli/src/wrapper/executable-provider-session.ts`
- `packages/runtime/src/session/runtime-session-orchestrator-tool-executor.ts`
- `packages/core/src/tools/infrastructure/write-tool.ts`
- `packages/core/src/agents/infrastructure/codex-oauth.ts`

### B. Managed-window shutdown still needs live confirmation

Still open.

The hardening for closing the managed GUI window was applied earlier, but there
is still no confirmed fresh live validation showing that closing the window now
terminates `kiln gui` reliably within a few seconds.

### C. Full live GUI revalidation after the telemetry refactor

Still open.

The architecture and regression tests are green, but the user has not yet
re-run the full manual GUI validation after the latest billing/telemetry slice.

Required live confirmations:

- `codex-oauth` still behaves correctly after provider switching
- telemetry appears sane in both subscription-backed and other provider flows
- no new GUI regression was introduced by the execution-metadata refactor

## Recommended next slice

Execute these in order:

1. Re-run live GUI validation.
   Confirm:
   - provider switching remains stable
   - telemetry displays/records correctly
   - managed-window close behavior is acceptable

2. Fix `codex-oauth` write-tool reliability.
   Goals:
   - add a focused regression test for executable write/create through
     `codex-oauth`
   - determine whether the failure is malformed model-emitted args only, or a
     stricter schema/adapter mismatch
   - improve recovery or argument normalization if needed

3. Only after live validation passes, reassess whether the TUI deletion gate is
   actually ready.

## Tests run successfully in the latest billing/telemetry slice

- `cmd.exe /c bun run typecheck`
  result: pass

- `cmd.exe /c bun x vitest run packages/core/tests/agents/execution-identity.test.ts packages/core/tests/cost/cost-tracker.test.ts packages/core/tests/cost/cost-tracker-model-keying.test.ts packages/runtime/tests/session/runtime-session-orchestrator-model-routing.test.ts packages/cli/tests/wrapper/executable-provider-session.test.ts packages/cli/tests/wrapper/provider-session.test.ts packages/cli/tests/wrapper/opencode-session.test.ts packages/cli/tests/wrapper/codex-session.test.ts`
  result: pass

Focused reruns that also passed during repair:

- `cmd.exe /c bun x vitest run packages/cli/tests/wrapper/opencode-session.test.ts packages/runtime/tests/session/runtime-session-orchestrator-model-routing.test.ts`

## Dirty worktree warning

The repo is still dirty beyond this slice. There are many GUI parity files and
other changes in the worktree that are not part of the billing/telemetry
refactor.

Do not assume the full `git diff` belongs in one commit.

## Resume instruction

Start the next clean session by reading:

1. `kiln-context.md`
2. `docs/roadmap/01-gui-phase-1-parity-checklist.md`
3. `docs/guides/gui-parity-walkthrough.md`

Then continue with:

1. live GUI revalidation
2. `codex-oauth` write-tool reliability
