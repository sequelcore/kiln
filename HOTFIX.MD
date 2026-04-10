# Kiln Hotfix Status

## Objective

Close the runtime-truth hotfix across TUI, runtime, CLI, Studio, and SDK so
user-visible capabilities match real execution behavior.

## Current Status (2026-04-10)

### Completed and verified

- Approval flow is session-scoped end to end instead of singleton/global.
- TUI gateway approval wiring now reflects real runtime session state.
- Studio approval contract is aligned to `sessionId`.
- SDK approval documentation now describes the real dev-route approval surface.
- Gateway-mode fake resume/history behavior was removed from the TUI startup
  path; runtime continuity remains authoritative in gateway mode.
- Runtime turn finalization now uses one canonical record/update path for both
  TUI and non-TUI flows.
- TUI and non-TUI runtime turns now persist real approval transitions through
  the canonical runtime turn record.
- Structured file-change telemetry is now preserved through the canonical turn
  record path instead of being inferred from human-readable output.
- CLI projected-context artifact key construction was centralized into one
  helper module and reused by `run`, `tui`, and session-preparation flows.
- Context-governance task-shape normalization was centralized and reused.
- Duplicate CLI/runtime context-artifact cache implementation was removed in
  favor of one authoritative runtime-owned implementation.
- Verification previously passed for the implemented hotfix slices:
  - `bun run typecheck`
  - `bun run test`

### Deferred urgent item

- `codex-oauth` is still documented and behaving as a direct API provider path,
  not a Kiln-local executable tool backend.
- Result: in TUI, a turn routed through `codex-oauth` can generate tool intent
  in model output, but it cannot complete real local write/edit execution the
  way harness `codex` can.
- This is now an explicit remaining hotfix item. It is not resolved in the
  current branch state and must not be described as resolved in docs or status
  summaries.

## What This Means Operationally

- Use harness providers (`codex`, `claude`, `opencode`) for live local
  tool/write verification.
- Do not treat `codex-oauth` as equivalent to harness `codex` for filesystem
  execution until the runtime path is actually wired.
- TUI route labels should still be trusted as route truth; they do not imply
  identical execution substrates across providers.

## Next Required Hotfix Slice

1. Decide whether `codex-oauth` should become a true executable provider path
   through Kiln-owned tool execution, or remain direct/text-only.
2. If it remains direct/text-only, keep docs strict and do not expose it as a
   local tool/write backend.
3. If it becomes executable, wire it through one real execution substrate, add
   regression tests, then update docs after behavior is proven.

## Files Most Relevant To The Deferred Item

- `packages/cli/src/wrapper/provider-session.ts`
- `packages/cli/src/wrapper/session-registry.ts`
- `packages/core/src/agents/infrastructure/codex-oauth.ts`
- `packages/runtime/src/session/mode-b-orchestrator.ts`
- `packages/runtime/src/gateway/tui-gateway.ts`
- `docs/guides/tui.md`
- `docs/guides/tool-use.md`
- `docs/changelog.md`

## Guardrails

- Do not claim the hotfix is fully closed while the `codex-oauth` execution gap
  remains open.
- Do not restore fake capability language in prompts, docs, or UI.
- Do not update docs ahead of real behavior.
