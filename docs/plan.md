# Phase 10 — ProviderSession (Direct API Backend)

**Status:** IMPLEMENTED, pending end-to-end provider smoke tests and root test-script cleanup  
**Branch:** `feat/cli/provider-session`  
**Last updated:** 2026-04-08

---

## Objective

Add `ProviderSession` — a new `IKilnSession` implementation that drives Kiln's existing provider adapters (anthropic, openai, deepseek, openrouter, ollama) directly, without a CLI harness. Integrates into the `SessionRegistry` pool alongside `ClaudeSession`, `CodexSession`, `OpenCodeSession`.

---

## Architecture Decision

`ProviderSession.run()` calls `ProviderAdapter.streamMessage()` directly — it does **not** drive the `Orchestrator` phase machine. The Orchestrator is a multi-phase planning machine; a single-turn `IKilnSession` is the correct abstraction boundary. Tool support deferred to Phase 10 V2 (requires Phase 9 bridge wiring).

---

## Sub-phases

### 10a — ProviderSession class [x] COMPLETE

**New file:** `packages/cli/src/wrapper/provider-session.ts`

Config shape:
```ts
interface ProviderSessionConfig {
  provider: "anthropic" | "openai" | "deepseek" | "openrouter" | "ollama"
  model?: string
  task: string
  systemPrompt?: string
  cwd?: string
  env?: Record<string, string>
  permissionPolicy: KilnPermissionPolicy
  constraintInstructions?: readonly string[]
}
```

Capabilities: `{ mcp: false, streaming: true, resumable: false, resume: false, costTrackingMode: "computed", priority: 4 }`

`run()` flow:
1. Resolve API key from `options.env` → `config.env` → `process.env` (provider-specific var names)
2. Instantiate correct adapter (`AnthropicAdapter`, `OpenAIAdapter`, etc.) with `{ apiKey, defaultModel }`
3. Build system prompt: base prompt + `[KILN POLICY CONSTRAINTS]` section from `constraintInstructions`
4. Call `adapter.streamMessage({ system, messages })` (no tools in V1)
5. Map `AgentStreamEvent` → `SessionEvent`:
   - `"thinking"` → `{ type: "text_delta", content, isThinking: true }`
   - `"text"` → `{ type: "text_delta", content }`
   - `"tool_use"` → `{ type: "tool_use", toolName, input }` (JSON.parse content)
   - `"tool_result"` → `{ type: "tool_result", toolName: "", output: content }`
   - `"done"` → `{ type: "cost_update", usd: 0 }` then `{ type: "completed" }`
6. On error: yield `{ type: "error", ... }` then `{ type: "completed", isError: true }`
7. Respect `abortSignal`

`dispose()`: no-op (stateless)
`providerSessionId`: `undefined`

**Test file:** `packages/cli/tests/wrapper/provider-session.test.ts`  
12 test cases covering capabilities, UUID sessionId, event mapping, error handling, abort, API key resolution order, Ollama no-key, constraint injection.

**Workers:**
- Codex gpt-5.3-codex → write failing tests first, then implement
- OpenCode → code review

**Verify:** `bun run typecheck && bun run test` in `packages/cli`

---

### 10b — Unified SessionRegistry Pool [x] COMPLETE

**Modify:** `packages/cli/src/wrapper/session-registry.ts`

Changes:
1. Add `translatePermissionForProvider(policy): { constraintInstructions, warnings }` function
2. Widen `ProviderId`: add `"anthropic" | "openai" | "deepseek" | "openrouter" | "ollama"`
3. Change `allIds` in `selectBest()` to iterate `this.providers.keys()` (remove hard-coded array)
4. Add 5 provider descriptors to `createDefaultRegistry()` with cost tiers:
   - `anthropic`: high, priority 4
   - `openai`: high, priority 5
   - `openrouter`: low, priority 6 (`(free)` models available)
   - `deepseek`: medium, priority 7
   - `ollama`: low, priority 8

Each descriptor's `create()` calls `translatePermissionForProvider()` and constructs a `ProviderSession`.

**Test additions:** `packages/cli/tests/wrapper/session-registry.test.ts`  
7 new cases: all 8 providers in registry, selectBest for direct providers, translatePermissionForProvider with/without policy rules, circuit breaker parity.

**Workers:**
- Codex gpt-5.3-codex → tests then implementation
- OpenCode → code review

**Verify:** `bun run typecheck && bun run test` in `packages/cli`

---

### 10c — CLI + TUI Integration [x] COMPLETE

**Modify:** `packages/cli/src/commands/run.ts`
- Add `DIRECT_API_PROVIDERS` set
- Change `requiresMcp` to `!isDirectProvider(config.provider)`

**Modify:** `packages/cli/src/commands/tui.ts`
- Expand `VALID_PROVIDERS` to include 5 direct API providers

**Modify:** `packages/tui/src/app.tsx` (or `ui.ts`)
- Two-section provider picker: "Harness" / "Direct API"
- `(free)` label on `openrouter` and `ollama`

**Workers:**
- Codex gpt-5.3-codex → all 3 file changes (one atomic invocation each)
- OpenCode → review `requiresMcp` logic

**Verify:** `bun run typecheck && bun run test` in `packages/cli` + `packages/tui`

---

### 10d — Context Management [x] COMPLETE

**New file:** `packages/cli/src/wrapper/provider-context.ts`
- `ProviderContextTracker` class: token accumulation, compaction threshold, `shouldTriggerCompaction()`

**Modify:** `packages/cli/src/wrapper/preamble-builder.ts`
- Add `buildProviderSystemPrompt(base, constraintInstructions)` — no MCP context, plain string output

**Test file:** `packages/cli/tests/wrapper/provider-context.test.ts`  
3 cases: accumulation, compaction trigger, boundary values.

**Workers:**
- Codex gpt-5.3-codex → tests then both files
- OpenCode → review `buildProviderSystemPrompt` for no MCP imports

**Verify:** `bun run typecheck && bun run test` in `packages/cli`

---

## Risks

| Risk | Mitigation |
|------|-----------|
| `AgentStreamEvent.tool_use` content is JSON string | JSON.parse in mapping, yield error event on parse failure |
| Token counts not available mid-stream | `costTrackingMode: "computed"`, emit `usd: 0`, V2 enhancement |
| Ollama needs `baseUrl` not `apiKey` | Branch on `provider === "ollama"` in adapter factory |
| `allIds` hard-coded breaks with new providers | Replace with `this.providers.keys()` iteration |

---

## Completion Criteria

- [x] `bun run typecheck` — zero errors (all packages)
- [ ] `bun run test` — root script still fails after package suites because workspace filters reference packages without a `test` script; core/runtime/cli/react/widget suites passed before the script exited
- [ ] `kiln run --provider openrouter --model meta-llama/llama-3.1-8b-instruct:free` works end-to-end
- [ ] `kiln run --provider ollama --model llama3.2` works end-to-end
- [x] CLAUDE.md bounded context table updated
- [x] STRATEGY.md Phase 10 status updated to COMPLETE
- [x] `docs/changelog.md` entry added
- [ ] Commit on `feat/cli/provider-session`, PR to `main`
