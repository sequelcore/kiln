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

The structural hotfix is closed, but one follow-up issue remains and should be
handled as a separate usability slice:

- `codex-oauth` tool use still requires overly explicit prompts in some normal
  conversations.
- Natural-language requests such as "search it yourself" can still lead to poor
  tool selection, invalid repeated tool calls, or overly literal requests for
  user-supplied paths that Kiln already knows.
- This is no longer a session/runtime-truth bug. It is now a tool-UX and agent
  behavior problem: prompt guidance, tool mediation, and invalid-call recovery
  still need improvement.

## Next Recommended Slice

1. Improve `codex-oauth` tool guidance for normal workspace-aware requests.
2. Prevent repeated invalid tool retries for the same malformed call.
3. Bias file discovery flows toward sensible `glob -> read -> summarize`
   behavior without requiring API-shaped user prompts.
4. Re-run manual TUI end-to-end validation after those UX fixes land.

## Files Most Relevant To The Follow-Up

- `packages/core/src/agents/infrastructure/codex-oauth.ts`
- `packages/cli/src/wrapper/executable-provider-session.ts`
- `packages/runtime/src/session/mode-b-orchestrator.ts`
- `packages/cli/src/wrapper/session-registry.ts`
- `docs/guides/tui.md`
- `docs/guides/tool-use.md`
- `docs/guides/cli-wrapper.md`

## Guardrails

- Do not regress `codex-oauth` back to a text-only path.
- Do not describe all direct API providers as executable; that is still false.
- Do not claim the natural-language tool-UX follow-up is solved until it is
  validated with normal prompts in the TUI.
