# Kiln Session Handoff

## Scope

Session focus: GUI parity fallout, `codex-oauth` stability, and telemetry
repair for subscription-backed providers.

Repository: `C:\Proyectos\Sequel\kiln`
Branch: `main`
Date: 2026-04-22

## Current state

The previous handoff is no longer current. The provider switch-back issue and
the `$0` telemetry architecture issue are no longer the active next slices.
The direct-provider write-tool reliability defect is also no longer the active
implementation slice.

What is now true:

- `codex-oauth` switch-back is stabilized enough that it is no longer the
  primary blocker captured in the old handoff.
- telemetry no longer relies on provider-qualified model-string hacks or
  zero-dollar subscription rows in `MODEL_CATALOG`
- execution identity now carries explicit billing semantics
- direct/OAuth tool execution now uses the shared provider-session path instead
  of a `codex-oauth`-only executable branch
- malformed or alias-shaped builtin tool arguments are normalized at the shared
  adapter boundary and rejected as explicit tool errors instead of crashing the
  turn
- executable direct providers now receive explicit tool-usage guidance for
  workspace discovery/edit flows, and unchanged malformed tool calls are no
  longer retried indefinitely
- session identity is now provider-agnostic across GUI/TUI/CLI persistence:
  Kiln sessions own transcript, telemetry, tools, approvals, and replay, while
  provider-native thread IDs are nested provider-thread metadata
- GUI session selection has been live-validated: selecting a session loads the
  selected canonical transcript into the main chat, and the next message is
  routed to that selected runtime session rather than to the previous live
  WebSocket session
- GUI `New Session` detaches the active runtime session and clears the visible
  chat without deleting stored history
- GUI history intentionally lists only sessions with canonical transcript
  metadata; ledger-only rows are not shown as fallbacks
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

- `packages/cli/src/wrapper/provider-session.ts`
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
- `packages/cli/src/wrapper/opencode-session.ts`
- `packages/cli/src/wrapper/provider-session.ts`
- `packages/cli/src/wrapper/codex-session.ts`

### 4. Shared tool-surface unification and malformed-argument hardening

Resolved behavior:

- direct/OAuth providers no longer depend on a `codex-oauth`-only executable
  session branch
- builtin tool exposure now projects from one canonical core tool surface
- malformed JSON tool arguments fail as explicit tool errors instead of
  surfacing as opaque session failures
- builtin alias-shaped inputs such as `path` -> `filePath` and
  `text` -> `content` are normalized before execution

Primary files for this slice:

- `packages/core/src/tools/default-tool-surface.ts`
- `packages/core/src/tools/index.ts`
- `packages/core/src/tools/tool-executor.ts`
- `packages/core/src/tools/mcp/dev-tools-server.ts`
- `packages/core/src/agents/provider-execution-profiles.ts`
- `packages/core/src/agents/model-capability-registry.ts`
- `packages/core/src/agents/tool-call-input.ts`
- `packages/core/src/agents/infrastructure/codex-oauth.ts`
- `packages/core/src/agents/infrastructure/openai-compat.ts`
- `packages/core/src/agents/infrastructure/anthropic.ts`
- `packages/runtime/src/session/runtime-session-orchestrator-tool-executor.ts`
- `packages/cli/src/wrapper/provider-session.ts`
- `packages/cli/src/wrapper/session-registry.ts`

### 5. Direct-provider tool-UX guardrails

Resolved behavior:

- executable direct-provider system prompts now explicitly bias toward sensible
  workspace-aware tool use
- unchanged malformed tool calls are circuit-broken after the first rejection
  instead of spinning until the generic max-round cap
- the runtime now falls back to a final text response after repeated malformed
  tool-call retries instead of continuing the bad loop

Primary files for this slice:

- `packages/cli/src/wrapper/preamble-builder.ts`
- `packages/cli/src/wrapper/provider-session.ts`
- `packages/runtime/src/session/runtime-session-orchestrator.ts`

### 6. Provider-agnostic session model repair

Resolved behavior:

- GUI session history is no longer scoped to the active provider
- GUI session selection selects a canonical Kiln session ID, not a
  provider-owned session target
- selecting a GUI session loads the transcript into chat and makes that session
  the active continuation target automatically
- the runtime registry supports multiple canonical runtime sessions for the
  same GUI user, so sending after sidebar selection goes to the selected
  session, not the previously live session
- `New Session` detaches the active runtime session without deleting stored
  history
- GUI session history is driven by canonical transcript metadata; ledger-only
  rows are hidden rather than used as compatibility fallbacks
- TUI startup loads the latest canonical Kiln session and makes it available to
  all provider routes
- provider/model selection controls the next turn's route only
- provider-native resume/thread IDs are used only when the selected provider
  has matching provider-thread metadata for the canonical Kiln session
- top-level persisted `providerSessionId` was removed from session metadata in
  favor of nested provider-thread metadata

Primary files for this slice:

- `docs/architecture/session-model.md`
- `packages/gateway-contracts/src/frames.ts`
- `packages/runtime/src/gateway/gui-gateway.ts`
- `packages/runtime/src/gateway/operator-gateway.ts`
- `packages/runtime/src/session/persistence/session-registry.ts`
- `packages/runtime/src/session/runtime-session.ts`
- `packages/cli/src/wrapper/session-store.ts`
- `packages/cli/src/commands/tui.ts`
- `packages/cli/src/commands/gui.ts`
- `packages/cli/src/commands/gui-session-summaries.ts`
- `packages/gui/src/components/session-list.tsx`
- `packages/gui/src/lib/session-store.ts`
- `packages/gui/src/lib/ws-client.ts`

## Still open

### A. Managed-window shutdown still needs live confirmation

Still open.

The managed-window shutdown path was hardened in this session in two layers:

- the CLI can shut down after a real GUI/operator connection drops to zero for
  a short grace period
- the managed browser host now also watches the DevTools page target for the
  dedicated `/gui/` app window, so Kiln no longer depends only on the browser
  child-process exit when Edge keeps the process alive after the visible window
  closes
- the GUI frontend now emits an explicit `window-closed` lifecycle signal via
  `pagehide`/`beforeunload`, and the gateway forwards that to the CLI shutdown
  monitor; this is the primary close signal for the managed app window, with
  connection-count and DevTools target disappearance as fallbacks
- profile cleanup no longer runs synchronously from `close()`, because live
  testing showed Edge can still hold locks on the temporary profile directory
  and throw `EBUSY`; cleanup is now best-effort from browser `exit/error`

What is still missing is fresh live validation showing that closing the managed
GUI window now terminates `kiln gui` reliably within a few seconds on the real
Edge-managed flow.

### B. Full live GUI revalidation after the telemetry and tool-surface refactors

Partially complete.

The session-history portion has been live-tested successfully after the latest
repair:

- create session A
- create session B
- select session A in the sidebar
- send a new message
- runtime logs show the turn using session A's canonical session ID

Still required live confirmations:

- `codex-oauth` still behaves correctly after provider switching
- executable builtin tools work through the shared provider path, including a
  real write/create flow
- telemetry appears sane in both subscription-backed and other provider flows
- no new GUI regression was introduced by the execution-metadata refactor

### C. Tool UX still needs live validation and possible discovery tuning

Still open.

The retry-loop failure mode is fixed, but the broader product-quality question
still needs live validation with normal prompts:

- whether the new guidance is enough for natural workspace discovery behavior
- whether additional `glob -> read -> summarize` biasing is still needed
- whether wrapper-facing MCP follow-through should be the next architectural
  slice after parity is revalidated

## Recommended next slice

Execute these in order:

1. Continue live GUI validation.
   Confirm:
   - provider switching remains stable
   - multi-provider turns remain in one canonical session
   - telemetry displays/records correctly
   - executable write/create works through the shared provider path
   - managed-window close behavior is acceptable

2. Only after live validation passes, reassess whether the TUI deletion gate is
   actually ready.

3. After GUI parity is revalidated, decide the next product-quality slice for:
   - any remaining tool prompting / mediation gaps
   - wrapper-facing MCP consumption follow-through
   - additional file-discovery biasing only if real prompts still need it

## Tests run successfully in the latest billing/telemetry slice

- `cmd.exe /c bun run typecheck`
  result: pass

- `cmd.exe /c bun x vitest run packages/core/tests/agents/execution-identity.test.ts packages/core/tests/cost/cost-tracker.test.ts packages/core/tests/cost/cost-tracker-model-keying.test.ts packages/runtime/tests/session/runtime-session-orchestrator-model-routing.test.ts packages/cli/tests/wrapper/provider-session.test.ts packages/cli/tests/wrapper/session-registry.test.ts packages/cli/tests/wrapper/opencode-session.test.ts packages/cli/tests/wrapper/codex-session.test.ts`
  result: pass

Focused reruns that also passed during repair:

- `cmd.exe /c bun x vitest run packages/cli/tests/wrapper/opencode-session.test.ts packages/runtime/tests/session/runtime-session-orchestrator-model-routing.test.ts`
  result: pass

- `cmd.exe /c bun x vitest run packages/core/src/agents/infrastructure/__tests__/codex-oauth.test.ts packages/runtime/tests/session/runtime-session-orchestrator-tools.test.ts packages/cli/tests/wrapper/provider-session.test.ts packages/cli/tests/wrapper/session-registry.test.ts`
  result: pass

- `cmd.exe /c bun x vitest run packages/cli/tests/wrapper/preamble-builder.test.ts packages/cli/tests/wrapper/provider-session.test.ts packages/runtime/tests/session/runtime-session-orchestrator.test.ts packages/runtime/tests/session/runtime-session-orchestrator-tools.test.ts`
  result: pass

Additional shutdown-slice reruns:

- `cmd.exe /c bun x vitest run packages/cli/tests/commands/gui.test.ts packages/runtime/tests/gateway/gui-gateway.test.ts packages/runtime/tests/gateway/gui-gateway-authority.test.ts`
  result: pass

- `cmd.exe /c bun x vitest run packages/cli/tests/commands/gui-window.test.ts packages/cli/tests/commands/gui.test.ts packages/runtime/tests/gateway/gui-gateway.test.ts packages/runtime/tests/gateway/gui-gateway-authority.test.ts`
  result: pass

- `cmd.exe /c bun x vitest run packages/cli/tests/commands/gui-window.test.ts`
  result: pass

- `cmd.exe /c bun run typecheck`
  result: pass

- `cmd.exe /c bun run build`
  result: pass

Latest provider-agnostic session repair reruns:

- `cmd.exe /c bun run --cwd packages/gui test:run`
  result: pass

- `cmd.exe /c bun run test`
  result: pass

- `cmd.exe /c bun run typecheck`
  result: pass

- `cmd.exe /c bun run build`
  result: pass

Latest GUI canonical continuation repair reruns:

- `cmd.exe /c bun run typecheck`
  result: pass

- `cmd.exe /c bun test packages/runtime/tests/session/session-registry.test.ts packages/cli/tests/commands/gui-session-summaries.test.ts packages/cli/tests/wrapper/session-store-clear.test.ts`
  result: pass

- `cmd.exe /c bun run --cwd packages/gui test:run`
  result: pass

- `cmd.exe /c bun run build`
  result: pass

Docs refactored for the live-test handoff:

- `docs/architecture/session-model.md`
- `docs/architecture/README.md`
- `docs/guides/gui.md`
- `docs/guides/tui.md`
- `docs/guides/tool-use.md`
- `docs/guides/gui-parity-walkthrough.md`
- `docs/roadmap/01-gui-phase-1-parity-checklist.md`
- `docs/roadmap/03-shared-tool-surface-unification.md`
- `docs/roadmap/04-operator-surfaces-and-remote-gui.md`
## Dirty worktree warning

The repo is still dirty beyond this slice. There are many GUI parity files and
other changes in the worktree that are not part of the billing/telemetry
refactor.

Do not assume the full `git diff` belongs in one commit.

## Resume instruction

Start the next clean session by reading:

1. `kiln-context.md`
2. `docs/architecture/session-model.md`
3. `docs/roadmap/01-gui-phase-1-parity-checklist.md`
4. `docs/guides/gui-parity-walkthrough.md`

Then continue with:

1. live GUI revalidation
2. managed-window shutdown confirmation
3. TUI deletion-gate reassessment only if live parity remains green
