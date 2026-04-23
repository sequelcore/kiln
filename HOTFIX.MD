# Kiln Hotfix Status

## Objective

Close the runtime-truth hotfix across TUI, runtime, CLI, Studio, and SDK so
user-visible capabilities match real execution behavior.

## Current Status (2026-04-10)

### Closed and verified

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
- `codex-oauth` now runs through a Kiln-local executable provider path instead
  of the old text-only direct-provider route.
- The `codex-oauth` live-session output freeze was fixed. Multi-turn live turns
  now produce visible assistant output instead of hanging in `thinking...`.

### Verification completed

- `bun run typecheck`
- `bun run build`
- Focused runtime, CLI, and core tests for the `codex-oauth` executable path,
  approval flow, and live-session adapter behavior

## What This Means Operationally

- Harness providers (`codex`, `claude`, `opencode`) remain valid local
  execution backends.
- `codex-oauth` is now also a real Kiln-local executable provider path.
- Other direct API providers (`anthropic`, `openai`, `deepseek`, `openrouter`,
  `ollama`) still remain direct/text-oriented unless they are explicitly wired
  to an executable direct session.
- TUI route labels should still be trusted as route truth; they do not imply
  identical execution substrates across providers.

## Remaining Follow-Up Item

The structural hotfix is closed, and the malformed-retry follow-up is now
partially closed as well:

- executable direct providers now receive explicit workspace/tool guidance
- unchanged malformed tool calls are no longer retried indefinitely

What still remains should be treated as a separate usability slice:

- `codex-oauth` tool use still needs fresh live validation with normal prompts
- natural-language requests such as "search it yourself" may still need
  stronger `glob -> read -> summarize` bias if the new guidance is not enough
- this is no longer a session/runtime-truth bug. It is now a product-quality
  tool-UX / mediation follow-up

## Next Recommended Slice

1. Re-run manual GUI/TUI end-to-end validation with normal prompts.
2. Confirm the repeated-malformed-call loop is actually gone in live use.
3. Only if live prompts still feel too literal, bias file discovery flows
   further toward sensible `glob -> read -> summarize` behavior.

## Files Most Relevant To The Follow-Up

- `packages/cli/src/wrapper/preamble-builder.ts`
- `packages/cli/src/wrapper/provider-session.ts`
- `packages/runtime/src/session/runtime-session-orchestrator.ts`
- `packages/cli/src/wrapper/session-registry.ts`
- `docs/guides/tui.md`
- `docs/guides/tool-use.md`
- `docs/guides/cli-wrapper.md`

## Guardrails

- Do not regress `codex-oauth` back to a text-only path.
- Do not describe all direct API providers as executable; that is still false.
- Do not claim the natural-language tool-UX follow-up is solved until it is
  validated with normal prompts in the GUI/TUI.
