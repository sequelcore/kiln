# Changelog

## Unreleased -- Provider-Agnostic Session Identity

- GUI, TUI, and CLI resume now treat the Kiln session as the canonical
  conversation/work unit instead of scoping history to the active provider.
- Provider/model selection is next-turn routing state. A single Kiln session
  may contain turns from multiple providers.
- Provider-native thread/session IDs are persisted as nested provider-thread
  metadata and are only passed back to the matching provider.
- GUI resume frames now select only a Kiln session ID; session history is no
  longer keyed by the active provider.
- GUI session selection now loads the canonical transcript into the main chat
  and makes that session the active runtime continuation target immediately.
- GUI `New Session` detaches the active runtime conversation without deleting
  canonical stored history.
- GUI session history now lists only sessions with canonical transcript
  metadata; ledger-only rows are intentionally hidden instead of used as
  compatibility fallback history.
- Added `docs/architecture/session-model.md` as the canonical session identity
  reference for future provider, GUI, TUI, and CLI work.

## v1.0.4 (2026-04-10) -- Timezone Scheduling Fix

### Scheduler fix

- Fixed `nextFireTime()` for named IANA timezones so schedules no longer fail
  to resolve under zones such as `America/Tijuana`.
- Preserved the original scheduler behavior when no timezone is provided.
- Added focused cron tests covering:
  - named timezone evaluation
  - `America/Tijuana`
  - deterministic UTC assertions

### Downstream impact

- This fixes the runtime crash that blocked `kiln-gateway` from registering
  scheduled triggers for `artu`.
- No temporary config workaround is required in gateway app definitions.

### Verification

- `bun run typecheck` passed
- `bun run test` passed
- `bun run build` passed

## v1.0.3 (2026-04-10) -- Release Line Correction

### Version consistency

- Workspace package versions were bumped to `1.0.3` so the published npm
  metadata matches the git tag for this release.
- This supersedes the inconsistent `v1.0.2` tag, which fixed the publish
  workflow but still published `1.0.1` package versions.

### Publish pipeline state

- The `1.0.1` and `1.0.2` release fixes are now carried forward together:
  - full package graph publish
  - build steps for published artifacts
  - valid `jq` workspace dependency rewriting
- `1.0.3` is the first release in the `1.x` line intended to be both
  architecturally aligned and packaging-consistent.

### Verification

- `bun run typecheck` passed
- `bun run test` passed
- `bun run build` passed

## v1.0.1 (2026-04-10) -- Packaging Graph Fix

### Publish pipeline fix

- `publish.yml` now publishes the full npm graph required by the `1.x` line,
  not just a subset of the workspace.
- Added publish steps for:
  - `@kilnai/tools`
  - `@kilnai/tools-darwin-arm64`
  - `@kilnai/tools-darwin-x64`
  - `@kilnai/tools-linux-x64`
  - `@kilnai/tools-win32-x64`
  - `@kilnai/tui`
- Added missing build steps for `@kilnai/tools` and `@kilnai/tui` before
  publish.

### Workspace version resolution fix

- The publish workflow now resolves `workspace:*` references across all public
  `packages/*` before `bun publish`, instead of only patching a small subset.
- This prevents externally published packages from carrying invalid workspace
  references at install time.
- The critical case fixed here is `@kilnai/core`, which depends on
  `@kilnai/tools`.

### Release metadata

- Workspace package versions were bumped from `1.0.0` to `1.0.1`.
- This is a packaging hotfix release. It does not change the `1.0.0`
  architectural baseline; it makes that baseline publishable and consumable.

### Verification

- `bun run typecheck` passed
- `bun run test` passed
- `bun run build` passed

## Unreleased -- Post-1.0 Architectural Continuation

Kiln `1.0.0` establishes the new control-plane direction and removes the most
confusing orchestrator-era residue from the active surface.

More breaking changes are expected in upcoming releases as the remaining
bounded contexts are refactored to match the new architecture, especially
around runtime/session, engine contracts, memory/knowledge alignment, and
safety/tool boundaries.

That work is intentionally paused for now while development focus moves to a
different project built on top of this cleaner base. The next release after
`1.0.0` should be treated as potentially breaking even if the exact scope is
not frozen yet.

## v1.0.0 (2026-04-10) -- Control Plane Reset

### Architectural reset

- Kiln's public direction is now explicitly framed as a
  **biocybernetic control plane** rather than an orchestration engine,
  meta-orchestrator, or literal organism model.
- Root documentation, architecture docs, and research synthesis were rewritten
  to make the new doctrine the source of truth.
- Canonical subsystem language now centers on `IngressGovernor`,
  `ContextGovernor`, `DemandAllocator`, `ChainGovernor`, `TaskRegistry`,
  `SafetyKernel`, and related control-plane boundaries.

### Orchestrator refactor

- `Orchestrator` responsibilities were split into focused support modules for:
  checkpointing, interrupt handling, developer tools, memory sync, and
  verification.
- Old orchestrator-era names were replaced in the active code surface:
  - `ThresholdAllocator` -> `DemandAllocator`
  - `CascadeController` -> `ChainGovernor`
  - `TaskChannel` -> `TaskRegistry`
- `TeamComposer` and `SwarmStrategy` were removed from the active product
  surface.
- `swarm` was removed as an official `TeamMode`. Supported team execution modes
  are now `sequential` and `supervisor`.

### Release surface cleanup

- Package metadata was bumped to `1.0.0` across the workspace to mark the new
  architectural baseline.
- Public package descriptions now align with the control-plane identity instead
  of the old orchestration-engine framing.
- Legacy tests that referenced removed swarm-era modules were either deleted or
  rewritten to validate the new active boundaries.

### Verification

- `bun run typecheck` passed
- `bun run test` passed
- `bun run build` passed

## Unreleased -- Hotfix Verification

- `codex-oauth` now runs through an executable direct-provider path instead of
  the old text-only direct-provider route.
- The `codex-oauth` live-session freeze was fixed: turns no longer get stuck in
  `thinking...` with no visible assistant output.
- `HOTFIX.MD`, TUI, tool-use, and CLI-wrapper docs now reflect the verified
  runtime state: `codex-oauth` is executable, while the remaining follow-up is
  natural-language tool usability rather than missing execution wiring.

## v0.27.0 (2026-04-09) -- Codex OAuth Provider (Phase 11.5a)

### Phase 11.5a: Codex OAuth Provider

- **`codex-oauth` provider**: `CodexOAuthAdapter` targets the OpenAI Responses API at `chatgpt.com/backend-api/codex/responses`. It provides routing and text generation through OAuth-backed Responses, while Kiln now owns the concrete local tool execution path for this provider.
- **OAuth device code flow + PKCE**: `CodexOAuthAuth` handles device authorization, PKCE challenge generation, token polling, and auto-refresh 120 seconds before expiry. Tokens persisted at `~/.kiln/auth/codex-oauth.json`.
- **Models**: `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.3-codex`, `gpt-5.3-codex-spark` — all catalogued at $0 marginal cost.
- **Priority 1 in SessionRegistry**: `codex-oauth` is selected before all other providers when valid credentials exist; falls back to direct API providers when credentials are absent.
- **Provider-scoped capability registry**: `ModelCapabilityRegistry` now keys profiles by `provider/model` composite to support shared model IDs across providers. `getByProvider(provider, model)` added; `get(model)` remains compatible.
- **`kiln auth` CLI command**: `kiln auth codex login` (device code flow), `kiln auth codex status` (token validity check), `kiln auth codex logout` (credential removal).
- **KilnError instanceof fix**: `errors.ts` patched for correct `instanceof` resolution across Vitest cross-realm prototype chains.

## v0.26.0 (2026-04-09) -- Coordination Intelligence (Phase 8.3)

### Phase 8.1: Plan Mode

- **`submit_plan` tool**: Agents in plan mode call `submit_plan` to surface a structured plan for user review instead of executing directly.
- **Review flow**: Plan output renders as a `PROPOSED PLAN` block with a structured summary and confirmation prompt.
- **Approve/execute pipeline**: `kiln run --plan` runs in approval mode. On approval, a second session executes the plan with full permissions and sandbox access.
- **`kiln plan` command**: Standalone `kiln plan <task>` subcommand with a 3-phase workflow (Explore, Intent Chat, Implementation Chat).
- **Execution boundaries**: Plan mode blocks Edit, Write, and MultiEdit tools. File reads and bash are permitted.
- **TUI plan mode**: `/plan` command mid-session, `--plan` flag on startup, PLAN badge in sidebar.

### Phase 8.2: Parallel Workers

- **`--workers N` flag**: `kiln run --workers N` spawns N parallel isolated sessions via `runParallelWorkers()`.
- **`Promise.allSettled`**: All workers run concurrently; failures are collected separately from successes.
- **Partial success**: Exit 0 if at least one worker succeeds; exit 1 only if all workers fail.
- **Per-worker summary**: After execution, the CLI prints a table of per-worker outcomes (success/fail, provider, cost, duration).
- **Session isolation**: Each worker uses `isolate: true` with a fresh session directory, preventing cross-worker state leakage.

### Phase 8.3: Coordination Intelligence

Six sub-phases implementing biologically-grounded multi-agent coordination:

**Phase 8.3a -- ThresholdAllocator** (`packages/core/src/orchestrator/threshold-allocator.ts`)
- Response-threshold task allocation (ant colony model). Agents with lower thresholds for a category are more likely to claim tasks in that category.
- Seven `TaskCategory` types: `research`, `code`, `review`, `ops`, `writing`, `triage`, `general`.
- `allocate()` (strict, returns null if no threshold exceeded) and `allocateWithFallback()` (always returns a result).
- Initialized from `AgentThresholds[]` config; thresholds can be set per category.

**Phase 8.3b -- CascadeController** (`packages/core/src/orchestrator/cascade-controller.ts`)
- Damped cascade energy model for handoff chain termination (neural field theory).
- `A(t+1) = decay * A(t) + gain - cost`. Initial energy seeded from task complexity (0.3-1.0 range).
- `shouldContinue(gain)` returns whether the chain continues; hard `maxDepth` serves as safety net.
- `CascadeSnapshot` history tracks every decision for observability.

**Phase 8.3c -- TaskChannel** (`packages/core/src/orchestrator/task-channel.ts`)
- Stigmergy coordination substrate: publish/claim/complete/fail/release lifecycle.
- Results-only publishing -- tool call logs are never published, preventing context contamination.
- Automatic dependency resolution: `unblockDependents()` transitions blocked tasks to `open` when all dependencies complete.
- Query methods: `open()`, `byStatus()`, `byAssignee()`, `counts()`.

**Phase 8.3d -- TeamComposer** (`packages/core/src/orchestrator/team-composer.ts`)
- Domain-driven team templates: `java-spring`, `react-typescript`, `python`, `generic`.
- `compose(domain, complexity)` returns `ComposedTeam` with pre-configured `ThresholdAllocator` + `CascadeController`.
- Complexity-based role filtering: `complexity < 0.4` keeps only required roles; higher complexity includes optional roles.
- `registerTemplate()` for custom templates.

**Phase 8.3e -- Adaptive EMA** (`ThresholdAllocator`)
- Outcome-based threshold adaptation via EMA over task results.
- `AdaptiveConfig`: `alpha` (smoothing), `successDelta`/`failureDelta` (step size), `floor`/`ceiling` (clamps), `hysteresisWindow` (outcomes before adaptation).
- Hysteresis prevents premature adaptation -- adaptation begins only after N outcomes recorded.
- `resetAdaptation(agentId?)` restores initial thresholds.

**Phase 8.3f -- SwarmStrategy Wiring** (`packages/core/src/orchestrator/strategies/swarm-strategy.ts`)
- `SwarmStrategy` now uses all five primitives: ThresholdAllocator for agent selection, CascadeController for handoff termination, TaskChannel for task lifecycle, adaptive EMA for outcome feedback.
- `useCoordination: boolean` flag in `SwarmConfig` enables/disables primitives.
- `StrategyContext` fields: `allocator`, `cascadeController`, `taskChannel`.
- Fallback to local `CascadeController` and first-agent selection when primitives are unavailable.

**Phase 8.3g -- Demand Signal** (`packages/core/src/orchestrator/demand-signal.ts`)
- `inferCategory()` maps `ComplexityScore` signals to `TaskCategory`.
- `buildTaskDemand(complexity, explicitCategory?)` builds a `TaskDemand` for allocation.

---

## Unreleased -- ProviderSession Direct API Backends (Phase 10)

### feat(cli): add direct provider sessions alongside CLI harness backends
- Added `ProviderSession` as a new `IKilnSession` implementation for
  `anthropic`, `openai`, `deepseek`, `openrouter`, and `ollama`.
- `SessionRegistry` now manages a unified 8-provider pool with direct-provider
  descriptors, dynamic provider iteration, and direct-provider permission
  constraint translation.
- `kiln run` now disables MCP requirements for explicitly selected direct API
  providers, while preserving harness-first behavior when no direct provider is
  requested.
- `kiln tui` now exposes direct API providers in a separate picker section and
  labels `openrouter` and `ollama` as `(free)`.
- Added `ProviderContextTracker` and `buildProviderSystemPrompt()` for the
  direct-provider path, and corrected direct-provider prompt assembly so
  governed preamble context is applied once as system context instead of being
  duplicated across system and user messages.

## Unreleased -- Codex Sandbox Enforcement

### fix(cli): preserve Codex sandbox mode in Kiln-managed runs
- `CodexSession` now passes explicit `--ask-for-approval` and `--sandbox`
  flags instead of relying on `--full-auto`.
- Codex permission translation now preserves the requested sandbox mode
  (`read-only`, `workspace-write`, `danger-full-access`) instead of collapsing
  non-danger modes to `workspace-write`.
- Updated the CLI wrapper guide to document Codex's explicit sandbox handling.

### feat(cli): add Codex ephemeral session support
- `kiln run --provider codex --ephemeral ...` now forwards Codex's native
  `--ephemeral` flag.
- Threaded `ephemeral` through `RunFlags`, provider session config, and the
  Codex wrapper spawn args.
- Added focused CLI parsing and wrapper tests for the new flag.

### feat(cli): add Codex profile support
- `kiln run --provider codex --profile <name> ...` now forwards Codex's native
  `--profile <name>` flag.
- Threaded `profile` through `RunFlags`, provider session config, and the
  Codex wrapper spawn args.
- Added focused CLI parsing and wrapper tests for the new flag.

### feat(cli): add Codex skip-git-repo-check support
- `kiln run --provider codex --skip-git-repo-check ...` now forwards Codex's
  native `--skip-git-repo-check` flag.
- Threaded `skipGitRepoCheck` through `RunFlags`, provider session config, and
  the Codex wrapper spawn args.
- Added focused CLI parsing and wrapper tests for the new flag.

### feat(cli): add Codex output-schema support
- `kiln run --provider codex --output-schema <file> ...` now forwards Codex's
  native `--output-schema <file>` flag.
- Threaded `outputSchema` through `RunFlags`, provider session config, and the
  Codex wrapper spawn args.
- Added focused CLI parsing and wrapper tests for the new flag.

### feat(cli): add Codex add-dir support
- `kiln run --provider codex --add-dir <path> ...` now forwards Codex's native
  `--add-dir <path>` flag.
- Threaded `addDir` through `RunFlags`, provider session config, and the Codex
  wrapper spawn args.
- Added focused CLI parsing and wrapper tests for the new flag.
- This first slice supports a single `--add-dir` value.

### feat(cli): add Codex local-provider support
- `kiln run --provider codex --local-provider <name> ...` now forwards Codex's
  native `--local-provider <name>` flag.
- Threaded `localProvider` through `RunFlags`, provider session config, and the
  Codex wrapper spawn args.
- Added focused CLI parsing and wrapper tests for the new flag.

### fix(cli): make OpenCode sandbox semantics explicit
- OpenCode permission translation now always emits a deterministic warning that
  OpenCode does not natively enforce Kiln sandbox modes.
- `OpenCodeSession` now surfaces explicit runtime warnings for translated
  OpenCode sandbox semantics instead of "silently ignored" messaging.
- Added focused wrapper tests for both translation warning metadata and runtime
  warning emission.

## Unreleased -- Native Developer Tools (Phase 9)

### feat(core): land tools domain foundation (Phase 9a)
- Added native developer tools foundation under `packages/core/src/tools/domain`:
  - `tool.ts` — `DevTool`, `ToolResult`, `DevToolName`, `TOOL_SCHEMAS`
  - `tool-registry.ts` — `DevToolRegistry` (throws on duplicate registration)
  - `tool-environment.ts` — Binary detection with process-wide cache, `clearToolEnvironmentCache()`
- Added tools barrel export at `packages/core/src/tools/index.ts`.
- Added root export wiring in `packages/core/src/index.ts`.
- Added tests under `packages/core/tests/tools/domain`.

### feat(core): native tool executors (Phase 9b)
- Added executors for all 7 tools: `bash`, `read`, `write`, `edit`, `grep`, `glob`, `git`.
- `bash` uses `bash -c` (no `-l` profile sourcing) with sandbox-only injection boundary.
- `read` uses line-based `offset`/`limit` matching Claude Code convention.
- `grep`/`glob` share extracted helpers (`tool-helpers.ts`): `runCommand`, `walkFiles`, `matchesGlob`, `globToRegExp`, `normalizePath`.

### feat(core): wire native tool execution events (Phase 9d)
- `DevToolExecutionBridge` in `packages/core/src/tools/tool-executor.ts`.
- Single executor closure for primary + fallback paths (no redundancy).
- Distinct error codes: `TOOL_AUTHORIZATION_DENIED` (hard deny) vs `TOOL_APPROVAL_REQUIRED` (needs approval).
- Orchestrator emits `tool_called`, `tool_authorized`, `tool_result` with annotations and task context.

## Unreleased -- TUI Route Identity + Continuity

### fix(tui): restore gateway-first continuity and actual route labeling
- `kiln tui` now starts in gateway mode by default again.
- Direct bootstrap remains available only via `KILN_TUI_TRANSPORT=direct`.
- TUI gateway turns now reuse one runtime session keyed by the WebSocket client user ID instead of behaving like fresh disconnected turns.
- Resuming a session from the sidebar now switches the active provider before assigning the resume target, so the correct provider resume state is used.
- The assistant route header in TUI is now finalized from the `done` frame's `routedProvider` and `routedModel` instead of trusting optimistic local picker state.
- Gateway completion frames now carry the routed provider/model and runtime continuity sidebar metadata together.

### fix(cli): pass prepared system prompt through all TUI bootstrap paths
- The TUI command now forwards `SessionManager.prepare(...).systemPrompt` into both gateway and direct bootstrap.
- Direct bootstrap no longer hardcodes the placeholder `"You are Kiln TUI in direct transport mode."` prompt.
- Gateway bootstrap no longer falls back to a generic assistant identity unless no prepared prompt is available.

### fix(core): inject authoritative execution identity at invocation time
- Added shared helper `packages/core/src/agents/execution-identity.ts`.
- Harness sessions and direct-provider sessions now append a `[KILN EXECUTION IDENTITY]` block to the final system prompt for the current turn.
- Runtime routing upgrades that block from `source: configured` to `source: runtime-routed` only when the routed provider/model was actually applied.
- If routing cannot be applied and Kiln falls back to the configured backend, the injected identity stays aligned with the configured backend instead of the failed route hint.

---

### feat(core): expose native dev tools as MCP surface (Phase 9e)
- `DevToolsMcpServer` in `packages/core/src/tools/mcp/dev-tools-server.ts`.
- Instance-level SDK caching (failed loads are retryable).
- CLI entrypoint: `kiln tools --mcp` (stdio).

### feat(cli): default TUI path is direct connection (Phase 9f)
- Direct TUI bootstrap is the default for `kiln tui`.
- Gateway bootstrap via `KILN_TUI_TRANSPORT=gateway` override only.

---

## Unreleased -- Plan Mode (v0.25.0)

### feat(cli): kiln plan command (Phase 8.1)
- Added `plan` command: `kiln plan <task>` — separate planning phase from execution
- Added `--plan` flag on `kiln run`: `kiln run --plan <task>`
- Uses permissionMode: "plan" (approval: "untrusted", sandbox: "read-only")
- 3-phase workflow: Explore → Intent Chat → Implementation Chat
- Execution boundaries: blocks Edit/Write/MultiEdit tools in plan mode
- Final output renders `<proposed_plan>` block to user
- TUI sidebar shows PLAN badge when active
- `/exec` command transitions from plan mode to execution mode
- TUI: `/plan` command enables plan mode mid-session
- TUI: `kiln tui --plan` starts in plan mode

### feat(cli): APC - Agentic Plan Caching
- Plan summaries cached via context-artifact cache with `plan-summary:{path}:{task}` key
- Retrieved on session resume for similar tasks (reduce re-planning cost)

### feat(docs): plan mode guide
- Added `docs/guides/plan-mode.md` with full spec
- Updated docs/README.md with Plan Mode guide link
- Updated STRATEGY.md Phase 8 with detailed Plan Mode spec

---

## Unreleased -- Diff/Change Visibility (v0.25.0)

### feat(tui): diff/change visibility in sidebar
- Added `file_changed` event type to `SessionEvent` union in CLI and TUI.
- Added `extractFileChange()` method in `CliSubscriptionExecutor` to parse tool results
  from Edit/Write/MultiEdit tools and emit structured change events.
- TUI now displays a "changes" section in the sidebar showing files modified during
  the session turn with icons: `+` (created), `~` (modified), `-` (deleted).
- Added `changedFiles: ChangedFile[]` to `ReactiveState` with `ChangedFile` interface
  containing path, changeType, linesAdded, linesRemoved, and timestamp.
- Added `renderSidebarChanges()` function and `sidebarChangesText` UI component.
- Gateway forwards `file_changed` activity events via `TuiActivityStreamer`.

---

## Unreleased -- Context Governance Foundations

### feat(tui): approval queue in sidebar with keyboard controls
- Added `PendingApproval` interface and `pendingApprovals` array to `ReactiveState`.
- TUI sidebar now displays pending approval requests below sessions.
- Keyboard controls: press 'a' to approve, 'd' to reject (when approvals exist).
- Added frame types for approval flow:
  - Inbound: `approval_requested`, `approval_received`
  - Outbound: `approve`, `reject`
- Gateway streams `approval_requested` events via `TuiActivityStreamer`
  - Subscribes to `eventBus` for approval events and forwards to WebSocket
- Gateway handles approve/reject frames via `ApprovalGateRegistry`
  - Registers orchestrator as `ApprovalTarget` at startup
  - Calls `orchestrator.continue()` on approve, emits `approval_received` on reject
- Added `emitApprovalRequested()` and `emitApprovalReceived()` methods to
  `RuntimeSessionOrchestrator` for emitting events to the event bus.

### feat(tui): session history browser in sidebar
- Added `SessionStore.list()` method to retrieve all session records.
- TUI sidebar now shows session history with provider, date, cost, and task.
- Arrow keys (up/down) or vim keys (j/k) navigate session list.
- Sessions displayed in reverse chronological order (newest first).
- Selected session highlighted with "▶" prefix.
- Press Enter on selected session to view details in command bar.
- Press Enter again to trigger resume of that session via the session manager.

### fix(tui): model list is gateway-owned, TUI has no hardcoded models
- `TuiGateway` now exposes `models: Record<string, string[]>` so callers can
  read the list synchronously without waiting for a WS connection.
- `tui.ts` pre-populates `providerModelsRef` from `gateway.models` immediately
  after `waitForGateway` — picker is correct from the first keypress.
- `app.tsx` hardcoded `PROVIDER_MODELS` replaced with `{}` — all model data
  comes from the gateway. TODO comment removed (both items resolved).
- Single source of truth: gateway queries `opencode models` + `codex app-server`
  at startup; Claude stays hardcoded there (no unauthenticated discovery path).

### fix(tui): dynamic model lists from CLI introspection at gateway startup
- `getCodexModels()` in `tui-gateway.ts` spawns `codex app-server` and sends a
  JSON-RPC `model/list` request over stdio, parsing `result.data[].id`. Falls
  back to hardcoded defaults if the process fails or times out (5 s).
- `getOpencodeModels()` (existing) runs `opencode models` and parses line-by-line.
- Both are fetched in parallel at gateway startup via `Promise.all` before the
  server begins listening, so the welcome frame always carries a fresh list.
- Claude list updated to canonical IDs + short aliases (`claude-sonnet-4-6`,
  `claude-opus-4-6`, `claude-haiku-4-5-20251001`, `sonnet`, `opus`, `haiku`).
  No runtime discovery path exists for Claude without auth or a live session.

### fix(tui): model selection wired end to end for all three providers
- `TuiOutboundFrame` provider frame carries `model?: string`; `TuiInboundFrame`
  welcome frame carries `models?: Record<string, string[]>`.
- `GatewaySession.switchProvider(provider, model?)` forwards the model over WS;
  `onWelcome` callback delivers the dynamic model list to the TUI on connect.
- `app.tsx` receives the welcome model list via `providerModelsRef` passed from
  `tui.ts`, replacing the hardcoded `PROVIDER_MODELS` for OpenCode at runtime.
- `tui-gateway.ts` runs `opencode models` at startup, stores the list, and
  includes it in the WS welcome frame under `models.opencode`. Claude and Codex
  entries remain hardcoded (no CLI enumeration API).
- `ClaudeSession`: `model?: string` added to `ClaudeSessionConfig`; passed
  directly to `sdkOptions.model` (Claude Code SDK `Options` type supports it).
- `OpenCodeSession`: model forwarded via `config.update({ body: { model } })`
  after the permissions PATCH. Format is `provider/model` per OpenCode SDK.
- `CodexSession`: `-m <model>` flag added to spawn args (landed in prior fix).
- `session-registry.ts`: `config.model` passed through to all three session
  constructors from `ProviderCreateConfig`.

### CG1 -- Explicit projected context
- Added explicit projected-context types in the CLI application layer instead of
  treating prompt memory as an anonymous string blob.
- `SessionContext` now carries `projectedContext`.
- `buildPreamble()` now renders projected context into the prompt rather than
  reading `memorySnapshot` directly.

### CG2 -- Deterministic token-budget selection
- Added reusable context-budget selection in `core/src/memory/context-budget.ts`.
- The default CLI `ContextGovernor` now selects projected context blocks under a
  token budget before prompt assembly.
- This is the first deterministic pass only; richer source selection and
  runtime/TUI integration remain pending.

### CG3 -- Initial session ledger and exact-artifact inputs
- Added explicit `SessionLedger` types in the CLI application layer.
- The CLI governor now accepts session-ledger and exact-artifact candidates in
  addition to memory snapshots.
- `run.ts` now resolves resume state before session preparation so the initial
  projected context can reflect resumed-session state.
- Session metadata now persists structured ledger state and exact artifacts.
- Resume preparation now rehydrates prior ledger/artifact state into the
  governor.
- Runtime session serialization now persists structured ledger state and exact
  artifacts.
- The shared runtime message pipeline now records ledger/artifact updates from
  routing, summaries, escalations, grounding outcomes, and tool executions.

### CG4 -- Initial cacheable context artifacts
- Added typed context-artifact cache interfaces in `core`.
- Added an in-memory context-artifact cache implementation.
- Successful CLI sessions now write a reusable cached session-summary artifact.
- Resume preparation can inject that cached summary back into projected context.
- Successful CLI sessions now also write a reusable cached project-summary
  artifact keyed by working directory.
- Successful CLI sessions now also write a reusable cached plan-summary/template
  artifact keyed by project path and normalized task.
- Successful CLI sessions now also write reusable cached module-summary
  artifacts keyed by project-relative path and current file content hash.
- Context artifacts now persist per project on disk in
  `.kiln/context-artifacts.json` instead of existing only in process memory.
- The project-backed persistent cache adapter moved from the CLI wrapper into
  `packages/runtime`, so downstream runtime consumers can share the same
  context-artifact persistence substrate.
- Runtime gateway flows now read and refresh a generic thread-summary artifact
  keyed by `appName + tenantId + userId` when a context-artifact cache is
  supplied. The TUI gateway now uses this shared runtime path.
- Runtime cache coverage now also includes bounded escalation/handoff summaries,
  context-summary bundles keyed by route/provider/task shape, and tool-result
  bundles keyed by channel/task shape.
- CLI resume now prefers cached session/project/plan/module artifacts when
  rebuilding projected context and only falls back to persisted exact artifacts
  when cached continuity is insufficient.
- CLI provider-native resume is now conditional: Kiln only forwards a resume
  session to the provider when cached continuity is too weak to trust
  reconstructed context alone.
- The first backend-aware native resume policy is now encoded: `codex` and
  `opencode` may use native resume when needed, while `claude` currently stays
  cache-first.
- The chosen resume strategy is now persisted in session metadata and printed in
  the final CLI session report.
- CLI session metadata now also records bounded resume outcome data: success,
  final provider, cost, tool count, duration, and verification result when
  available.
- The CLI now uses recent local resume outcomes as a deterministic feedback
  signal in borderline resume cases, biasing `cache-first` versus
  `provider-native` only when one strategy is measurably cheaper or more
  successful for the same provider.
- CLI reports and persisted session metadata now show whether that feedback
  merely existed or actually influenced the final resume choice, along with the
  bounded sample size considered.
- The TUI sidebar now shows resume strategy and feedback summary without
  making session history provider-owned; switching providers changes the next
  execution route, not the session namespace.
- Interactive TUI turns now refresh that sidebar metadata after completion by
  persisting minimal native-resume transcript meta and reloading the per-
  provider view.
- The TUI session factory now applies the same bounded cache-first versus
  provider-native resume policy surface as the CLI path, instead of hardcoding
  interactive resume to `provider-native | none`.
- CLI and TUI resume decisions now share one authoritative helper, reducing
  policy drift between the two interactive entry surfaces.
- The shared resume policy is now split into signal collection and strategy
  decision, making it easier to reuse in runtime/gateway paths later without
  dragging in CLI-specific artifact-key assumptions.
- The neutral presence-based resume signal collector now lives in `core`, and
  runtime support-artifact hydration uses it too, so the shared substrate now
  spans `core`, `runtime`, and `cli`.
- The neutral resume-decision layer now also lives in `core`, while the CLI
  keeps only the provider-specific wrapper semantics on top.
- Runtime support-artifact hydration now also calls the shared core decision
  layer, so governed-resume behavior is no longer limited to CLI/TUI entry
  surfaces.
- Runtime continuity decisions are now recorded in session artifacts and trace
  logs, making cache-first versus fallback continuity behavior inspectable in
  gateway flows too.
- Runtime gateway and TUI flows now persist bounded continuity outcome history
  per thread/channel so later policy slices can compare governed cache-first
  versus fallback behavior using real local outcomes.
- Runtime support-artifact hydration now reads that bounded continuity history
  back into the shared decision layer, allowing borderline cache-first versus
  fallback choices to use local runtime evidence too.
- The TUI sidebar now shows runtime continuity strategy and feedback for the
  active provider, so interactive sessions expose governed runtime decisions in
  addition to wrapper-side resume policy.
- The TUI sidebar now also shows an initial runtime context-pressure line for
  the active provider, based on cached support-artifact count, marking the
  first landed `CG6` visibility slice.
- That runtime context-pressure view now also lists the active bounded support
  sources (`thread`, `handoff`, `context`, `tools`) for the selected provider.
- The same sidebar block now shows a bounded fallback reason so operators can
  distinguish `live-session`, `no-sources`, and `sources-not-selected`.
- The same sidebar block now also distinguishes whether support sources were
  merely available or actually selected into the current turn.
- The same sidebar block now also shows a bounded selection-reason label such
  as `single-source-cache`, `multi-source-cache`, or `withheld-by-policy`.
- The CLI session report now includes a bounded context-governance summary with
  selected tokens vs budget plus selected/deferred block counts and kinds.
- The same CLI summary now includes bounded defer reasons inferred from the
  deferred projected-context blocks.
- The same CLI summary now includes selected/deferred source breakdowns from
  the real projected-context blocks.
### CG7 -- Initial context-governance config surface
- Replaced the old narrow `compaction` wrapper config shape with a first-class
  `contextGovernance` block in `kiln.yaml`.
- The first live fields are now wired into session preparation:
  - `contextGovernance.turnBudget`
  - `contextGovernance.cachePolicy`
- Optional projected-context selection can now also be biased by
  `contextGovernance.preferredSources`, letting the governor prefer
  `ledger`/`artifact`/`summary`/`memory`/`knowledge` classes without excluding
  required context.
- Optional projected-context weighting now also honors
  `contextGovernance.summaryAggressiveness`, shifting summary-vs-artifact
  preference in a bounded way while preserving required-block behavior.
- `contextGovernance.previewBeforeApply` now triggers a bounded pre-run context
  preview in the CLI path using the actual projected working set that will be
  sent into prompt assembly.
- Projected-context assembly can now be configured to use a different turn
  budget or to disable cache-backed context reconstruction explicitly.
- The CLI wrapper guide now documents the live `contextGovernance` fields with
  a concrete `kiln.yaml` example, and the docs index now links that capability
  more explicitly.

### Memory Quality (Phase 3.6)
- Added hierarchical topic key support to memory entries with `topicKey`,
  `revisionCount`, and `lastSeenAt` fields in `MemoryEntry` interface.
- Implemented topic key upsert in `SqliteMemoryStore.save()`: when `topicKey`
  is provided, the store performs an upsert (UPDATE if exists, INSERT if new)
  instead of always inserting. Revision count increments on each update.
- Added direct key lookup bypass: when search query contains "/", the store
  performs a direct topic key lookup instead of FTS5 search (Engram pattern).
- Added `deleted_at` column for soft-delete support.
- Updated MCP tool schemas in both CLI and runtime to expose `topic_key` field.
- Fixed test isolation in `vitest-bun-sqlite-mock.ts`: `:memory:` databases now
  always return a fresh instance to prevent cross-test state leakage.

### F1 -- Field substrate
- Added a new `packages/core/src/field/` bounded context.
- Landed the first field-domain substrate:
  - `FieldSignal`
  - `FieldVector`
  - `FieldSnapshot`
  - `FieldConfig`
  - `FieldStore`
- Added `InMemoryFieldStore` as the first usable implementation.
- Added `SqliteFieldStore` so field vectors can survive process restarts via Bun SQLite storage.
- Exported the field substrate from `@kilnai/core` for later EventBus, routing,
  and memory integration.
- Context-governor now queries the shared `field-service` for the current
  `category:<kind>` strength and adds a bounded boost to optional candidate scores.
- Added `FieldPropagator`, a scheduled decay+diffusion tick that re-injects
  propagation signals into the field store without altering routing yet.

### F5 -- fix: wire inhibitor and stability monitor into orchestrator lifecycle
- `Orchestrator` constructor now calls `startFieldInhibitor()` and
  `startStabilityMonitor()` alongside the existing `startFieldPropagator()`.
- Both were previously exported but never started — lateral inhibition and
  runaway/starvation detection are now active for every orchestrator instance.

### F6 -- TUI field observability
- Added `FieldSidebarInfo` to TUI state (`dominantRegions`, `saturation`,
  `entropy`, `status`).
- `render.ts` now has `renderSidebarField` which shows dominant context regions,
  saturation %, Shannon entropy, and field stability status (`=` stable, `!`
  runaway, `~` starvation, `?` unknown).
- `ui.ts` adds the `sidebarFieldText` panel below the resume block.
- `app.tsx` polls `getFieldStore().snapshot()` every 2 s, updates
  `fieldSnapshot` state, and re-renders the panel. Clears the interval on exit.

### F5 -- Propagation, inhibition, stability
- Added `FieldInhibitor` (`packages/core/src/field/field-inhibitor.ts`): lateral
  inhibition that suppresses competing regions when a dominant region (value >=
  0.6) is detected, injecting bounded negative signals (capped by
  `inhibitionStrength * dominant.value`) into the weakest non-dominant regions.
- Added `StabilityMonitor` (`packages/core/src/field/stability-monitor.ts`):
  detects runaway (single region >= 0.85 and entropy < 1.0) and starvation (mean
  region value < 0.05), fires callbacks on transitions, and fires `onStabilized`
  when returning to a healthy state.
- `field-service.ts` now exports `startFieldInhibitor`, `stopFieldInhibitor`,
  `startStabilityMonitor`, and `stopStabilityMonitor` so callers share the same
  singleton instances backed by the shared `fieldStore`.
- Both classes and their config types are exported from `@kilnai/core` via the
  field barrel.

### F4 -- Field-modulated routing
- `SessionRegistry._score()` now reads `getFieldStrength("provider:<id>")` from
  the shared `field-service` snapshot and adds a bounded +0..15 bonus to
  provider scores.
- Hard constraints (preferredProvider, cost-tier cap, capability exclusions) and
  circuit-breaker semantics are unaffected — the field bonus is a soft
  tiebreaker only.

## v0.24.5 (2026-04-03) -- TUI as Default CLI (7f)

### CLI Entry Point
- The default `kiln` command now launches the interactive TUI if `process.stdout.isTTY` is true.
- If called in a non-interactive context (like CI or piped output), it falls back to the previous default (`devCommand`).

## v0.24.4 (2026-04-03) -- TUI Routing Indicator (7e)

### Routing label in chat
- Each assistant response now shows `[opencode · opencode-o3]` (provider + model if known) or `[opencode]` if no model.
- **Bug fix:** label was using `ctx.provider` (startup arg) — stale after `/provider` switch. Now uses `ctx.state.currentProvider`.

### Sidebar provider display
- Consolidated all `sidebarProviderText` updates into `renderSidebarProvider(state, theme, ui, domain)`.
- Format: `[opencode] sequel/kiln · opencode-o3  via user` (route mode badge).
- `routeMode: "user" | "auto"` added to `ReactiveState` — defaults to `"user"`. Future automatic routing (Phase 7.5) will set `"auto"`.
- `closeProviderPicker` now sets `routeMode: "user"` explicitly on every manual provider switch.

## v0.24.2 (2026-04-03) -- TUI Event Pipeline Fixes

### `/provider` command
- Fixed `/provider` command being sent to the AI as a plain message instead of opening the provider picker.
- Root cause: `TextareaRenderable.onSubmit` guard was missing `/provider` — it correctly skipped `/clear` and `/theme` but passed `/provider` through to `sendMessage`. Added to guard.

### Tool event routing
- `activity` frames for `tool_use` and `tool_result` were silently dropped — `handleActivity` only routed `cost_update`.
- Removed the dead `case "tool_use"` / `case "tool_result"` branches from `sendMessage` (these event types are never emitted by the gateway; all mid-turn events arrive as `activity` frames).
- `handleActivity` now routes: `tool_use` → `handleToolUse`, `tool_result` → `handleToolResult`, `cost_update` → `handleCostUpdate`.

### Status bar race condition
- Command bar could remain stuck on `⟳ executing: …` after a turn completed when `tool_result` activity frames arrived from the WS after the `done` frame.
- Added `if (ctx.state.status !== "running") return` guard at the top of `handleActivity` to discard late-arriving frames.

### Token count pipeline
- Token count always showed `0` despite the gateway forwarding `inputTokens`/`outputTokens` in `cost_update` activity frames.
- Three-part fix: (1) added `inputTokens?`/`outputTokens?` to `SessionEventInternal` activity variant in `types.ts`; (2) `gateway-session.ts` now forwards the fields from the WS frame into the session event; (3) `sendMessage` passes `event.inputTokens`/`event.outputTokens` to `handleActivity` instead of hardcoded `undefined`.

## v0.24.1 (2026-04-03) -- TUI Real-Time Visibility

### Activity Bar Integration
- Moved live activity display from separate bar to command bar status area.
- Command bar now shows: spinner + phase icon + phase name + tool name + details.
- Phase icons: ⚡planning, ⟳executing, 🤔reasoning, 💬responding.
- Details truncated at 40 chars to prevent overflow.

### Sidebar Tool Counter
- Fixed duplicate tool entries in sidebar — now shows single line with call count.
- Format: "⟳ write" (single call) or "⟳ write ×3" (multiple calls).
- `toolCallCounts` added to ReactiveState, tracked in handleToolUse.

### Input Fix
- Fixed Enter key handling: input now clears AND submits correctly.
- Removed duplicate Enter handling from keypress handler (left only in TextareaRenderable.onSubmit).
- Textarea now clears via `inputTextarea.clear()` + state update.

### Extended Theme System
- Expanded from 5 to 12 built-in themes: kiln-dark, dracula, catppuccin-mocha, nord, tokyo-night, gruvbox-dark, rose-pine, kanagawa-wave, everforest-dark, ayu-dark, one-dark, night-owl.
- All themes in `packages/tui/src/theme.ts`.

## v0.24.0 (2026-04-02) -- Kiln TUI v2

### TUI Native Session Persistence
- `IKilnSession`: added `providerSessionId: string | undefined` — unified provider-native session ID across all three backends (replaces split `remoteSessionId`/`threadId` on SessionRecord).
- `SessionRecord` in `wrapper/session-store.ts`: replaced `remoteSessionId` + `threadId` with single `providerSessionId` field.
- `SessionStore`: added `clearLast(provider?: string): Promise<void>` — rewrites JSONL without last matching record.
- `ClaudeSession`, `CodexSession`, `OpenCodeSession`: all implement `providerSessionId` getter.
- OpenCode resume: fixed broken `--attach` path; now uses `client.session.get({ sessionID })` for crash-resilient restart.
- `makeResumableSessionFactory` in `tui.ts`: async factory with closure state + disk persistence; reads last session on startup, persists on dispose.

### TUI Keyboard + Input Fixes
- Printable characters now route to input BEFORE scroll handler — fixes vim keys (`hjkl`) being swallowed.
- Control characters (`cp < 32` or `cp === 127`) excluded from input — fixes Enter and Backspace being appended as text.
- Ctrl+V paste: cross-platform clipboard read (`powershell Get-Clipboard` on Windows, `pbpaste` on macOS, `xclip` on Linux).

### /clear Command
- TUI detects `/clear` input and calls `session.clear()` on the GatewaySession.
- WS protocol: `{ type: "clear" }` frame sent to gateway; gateway calls `onClear()` and replies `{ type: "cleared" }`.
- `TuiGateway` accepts optional `onClear?: () => Promise<void>` callback; clears session store on receipt.

### opencode-style Layout
- Two-column layout: `chatArea` (flex-grow) + 1px `dividerBar` + `sidebar` (width=42).
- Sidebar shows: provider, cumulative cost, working directory, turn count, last tool used.
- Status dot on input line: `●` green=idle, yellow=running, red=error.
- Sidebar auto-collapses when terminal width < 100 columns.
- Removed: header box, bottom status bar.

### Theme Token System
- New file `packages/tui/src/theme.ts`: `KilnTheme` interface (15 semantic color tokens), 5 built-in themes.
- Built-in themes: `kiln-dark` (default), `dracula`, `catppuccin-mocha`, `nord`, `tokyo-night`.
- All hardcoded hex colors in `app.tsx` replaced with `theme.*` token references.
- `--theme <name>` CLI flag on `kiln tui` command.
- `packages/tui/src/index.ts`: exports all themes, `defaultTheme`, `type KilnTheme`.

### Testing
- 4,594 tests passing (up from 4,469), zero typecheck errors.
- New test files: `tui-session-persistence.test.ts`, `session-store-clear.test.ts`, `tui-gateway-clear.test.ts`, extended `opencode-session.test.ts`.
- Fixed stale `codex-session.test.ts`: reasoning items now assert `isThinking: true` (not silently dropped).

## v0.23.2 (2026-03-26) -- MCP OAuth Discovery: Add authorization_endpoint

### Bug Fix

- **`authorization_endpoint` added to OAuth metadata**: Claude Code validates the `/.well-known/oauth-authorization-server` response against RFC 8414 schema and requires `authorization_endpoint`. Also added `code_challenge_methods_supported: ["S256"]` (PKCE) and `"code"` to `response_types_supported` — foundation for future PKCE flow. (`runtime/src/gateway/gateway-routes.ts`)

## v0.23.1 (2026-03-26) -- MCP OAuth Discovery Fix

### Bug Fix

- **OAuth discovery endpoints**: Added `GET /.well-known/oauth-authorization-server` (RFC 8414) and `GET /.well-known/oauth-protected-resource` (RFC 9728) to the gateway routes. Claude Code and other MCP HTTP clients unconditionally hit these endpoints before connecting — without them, the gateway returned 404 which crashed the client's JSON parser with "HTTP 404: Invalid OAuth error response". Both endpoints are registered only when `mcp.enabled: true` and return valid metadata JSON derived from the request origin. No OAuth token issuance — metadata only. (`runtime/src/gateway/gateway-routes.ts`)

## v0.23.0 (2026-03-26) -- MCP Phase 3: Cross-Agent Memory, Swarm Primitives, LLM Eval Scorers

### MCP Phase 3: 25 Tools Total (8 new)

Three workstreams extending the MCP tool surface for external CLI agent orchestration:

**WS1 — Cross-Agent Memory (4 tools, extended)**
- `cross_agent_memory_recall` / `cross_agent_memory_store`: now require `teamId` for proper namespace scoping. Memory stored on `"project"` layer with `_team:<teamId>` tag injection.
- `cross_agent_memory_list`: new tool — list all entries for a team with optional key prefix filter.
- `cross_agent_memory_delete`: new tool — delete a specific key from a team's shared memory (ownership-checked).

**WS2 — Swarm Primitives (6 new tools)**
- `swarm_join`: Join a named agent swarm, returns current membership list.
- `swarm_leave`: Leave a swarm and release all held claims.
- `swarm_status`: Get current members and active resource claims for a swarm.
- `swarm_broadcast`: Broadcast a message to all agents in a swarm (stored, not pushed).
- `swarm_claim`: Optimistic lock on a named resource within a swarm.
- `swarm_release`: Release a previously claimed resource (ownership-checked).
- **`SwarmStore`** (`runtime/src/mcp/swarm-store.ts`): `SqliteMemoryStore`-backed swarm state using tag conventions `_swarm:<swarmId>`, `_member:<agentId>`, `_claim:<resourceId>`, `_broadcast`.

**WS3 — LLM-Based Eval Scorers**
- `eval_score` extended: now accepts `context` (passages for faithfulness/context-relevance) and `scorerOptions` (per-scorer config).
- `evalScoreLlm` dep: routes 12 LLM-as-judge scorer names through `ProviderScorerLlmBridge` inline class.
- `LLM_SCORER_NAMES` set splits scorer requests between rule-based and LLM paths. If no scorers specified, only rule-based runs (avoids unexpected LLM costs).
- `GatewayMcpEvalConfig` (`core/src/engine/gateway/mcp-config.ts`): new type for judge LLM config (`provider`, `model?`, `apiKeyEnv?`). Parsed from `gateway.yaml` `mcp.eval` block.

**Test coverage:** 80 MCP tests (70 gateway-mcp-server + 10 swarm-store), all passing.

## v0.22.0 (2026-03-25) -- Full MCP Tool Wiring

### MCP Phase 2: All 17 Tools Now Wired

The gateway MCP server (introduced in v0.21.0) exposed 17 tool schemas but only 7 were wired to concrete gateway infrastructure. This release wires the remaining 8 dep callbacks:

- **`integration_list`**: Lists all registered integration adapters via `IntegrationRegistry.all()`.
- **`integration_execute`**: Per-tenant credential resolution + adapter execution via `IntegrationExecutor`.
- **`routing_test`**: Dry-run tenant message routing with per-rule regex diagnostics via `DefaultTenantRouter`.
- **`eval_score`**: Score input/output pairs using 5 rule-based scorers (ExactMatch, JsonValidity, Effort, RoutingAccuracy, ToolCallingAccuracy). No LLM dependency.
- **`enrichment_get`**: Retrieve enrichment data for a completed session from `SqliteEnrichmentStore`.
- **`enrichment_list`**: Paginated enrichment listing by tenant via `SqliteEnrichmentStore.listByTenant()`.
- **`budget_check`**: Fail-open budget verification via `checkBudget()` from budget middleware.
- **`budget_report`**: Fire-and-forget usage reporting via `reportUsage()` from budget middleware.

**Infrastructure changes:**
- `tenant-tool-factory.ts`: Added `getIntegrationDeps()` read-only accessor for MCP server wiring.
- `gateway-server.ts`: Wired all 8 dep closures over `loadedApps`, `IntegrationRegistry`, `SqliteEnrichmentStore`, and `budget-middleware`. Added `textParts` static import.

## v0.21.2 (2026-03-25) -- Dev Inspector + SSE Keepalive

### Bug Fixes

- **Dev Inspector**: Fix `SyntaxError: Unexpected string` at line 162 in the inline dev inspector (`/dev/`). The `onclick` handlers for timeline span detail toggle had broken quote escaping inside the template literal — `\'` was rendered as bare `'` in the HTML, breaking the JavaScript. Fixed by using `\\'` in the template literal so the served HTML contains proper `\'` escapes. (`runtime/src/gateway/dev-inspector.ts:166-168`)
- **SSE idle timeout**: Fix dev inspector showing "Disconnected" immediately after connecting. Bun.serve's default `idleTimeout` (10s) was closing the SSE stream before any events arrived. Set `idleTimeout: 255` (uWebSockets uint8 max) on `Bun.serve()` and added a 30-second keepalive heartbeat (`:keepalive` SSE comment) to the `/dev/events` stream. WebSocket connections are unaffected — they use a separate `idleTimeout` in the WebSocket handler. (`runtime/src/gateway/gateway-server.ts:1185`, `runtime/src/gateway/dev-routes.ts:55-62`)

## v0.21.0 (2026-03-24) -- Gateway MCP Server

### MCP Tool Surface for External Agents

- **`GatewayMcpConfig`** (`core/src/engine/gateway/mcp-config.ts`): New domain type for gateway-level MCP server configuration. Fields: `enabled`, optional `path` (default `/mcp`), optional `auth` (`api-key` with `keyEnv`, or `none`). Exported from `@kilnai/core`.
- **`mcp` block in `gateway.yaml`**: Top-level optional config. Parsed and validated by `parseGatewayYaml` with the same error accumulation pattern as `auth` and `observability`.
- **`GatewayMcpServer`** (`runtime/src/mcp/gateway-mcp-server.ts`): MCP server exposing 17 gateway tools via Streamable HTTP. Uses the low-level `Server` class with raw JSON Schema (no Zod dependency). Stateless per-request: fresh Server+Transport pair per request (MCP Streamable HTTP spec). `enableJsonResponse: true` for direct JSON responses. Dynamic `import("@modelcontextprotocol/sdk")` — optional peer dep, fail-open at startup.
- **17 MCP tools**: `memory_recall`, `memory_store`, `memory_delete`, `knowledge_search`, `knowledge_sources`, `cost_summary`, `safety_metrics`, `integration_list`, `integration_execute`, `routing_test`, `eval_score`, `enrichment_get`, `enrichment_list`, `cross_agent_memory_recall`, `cross_agent_memory_store`, `budget_check`, `budget_report`.
- **`GatewayMcpDeps`** (`runtime/src/mcp/gateway-mcp-types.ts`): Dependency injection interface decoupling tool handlers from concrete gateway wiring.
- **Gateway wiring**: `startGateway()` initializes `GatewayMcpServer` when `mcp.enabled: true`. Mounts on configurable path via `honoApp.all()`. Resolves API key from env var. Cleanup on shutdown.
- **`@modelcontextprotocol/sdk`**: Added as optional peer dependency to `@kilnai/runtime` (`^1.12.0`).

**Config example:**

```yaml
mcp:
  enabled: true
  path: /mcp
  auth:
    type: api-key
    keyEnv: MCP_API_KEY
```

## v0.20.0 (2026-03-14) -- Gateway JWT Auth (RS256 + HS256)

### Zero-Trust Inter-Service Authentication

- **`GatewayAuthConfig`** (`core/src/engine/gateway/auth-config.ts`): New domain type for gateway-level JWT authentication. Supports `algorithm: RS256` (JWKS) or `HS256` (shared secret). Optional `issuer` and `audience` claim validation. Exported from `@kilnai/core`.
- **`auth` block in `gateway.yaml`**: Top-level optional config. RS256 requires `jwksUri`; HS256 requires `secretEnv` (env var name). Parsed and validated by `parseGatewayYaml` with the same error accumulation pattern as `observability`.
- **`buildJwtVerifier()`** (`runtime/src/gateway/jwt-verifier.ts`): Builds a `JwtVerifyFn` from `GatewayAuthConfig`. RS256 uses `jose createRemoteJWKSet` (cached, auto-refreshing on key rotation). HS256 resolves the secret from `process.env` once at startup — fails fast if the env var is missing. Dynamic `import("jose")` so the library is only loaded when JWT auth is configured.
- **`requireJwt(verify)`** (`runtime/src/gateway/auth-middleware.ts`): New composable middleware. Extracts Bearer token from `Authorization` header, verifies via `JwtVerifyFn`, attaches decoded payload to `c.set("jwtPayload", payload)`. Returns 401 with no error detail leakage on failure.
- **`GatewayServerConfig.jwtVerifier`**: New optional field. When set, `createGatewayApp` applies `requireJwt` to all API channels (`/path/*`), admin routes (`/admin/:name/*`), outbound routes (`/outbound/:name/*`), handoff routes (`/handoff/:name/*`), and memory routes (`/api/memory/*`). Webhook channels (WhatsApp, Instagram, Messenger, Email) retain their HMAC-SHA256 auth unchanged. Health endpoint is always public.
- **`startGateway` wiring**: JWT verifier built once at startup after `parseGatewayYaml`. Startup log confirms the active mode. Auth warning suppressed for API channels when gateway-level JWT is configured.
- **Backward compatible**: No `auth` block → zero behavior change. Existing `apiKeyEnv` deployments continue working exactly as before.
- **`jose` dependency**: Added to `@kilnai/runtime` dependencies.

**Config examples:**

```yaml
# RS256 -- verify tokens issued by any Vigil-based service (e.g. SHRAD)
auth:
  algorithm: RS256
  jwksUri: "https://auth.myapp.com/.well-known/jwks.json"
  issuer: "https://auth.myapp.com"
  audience: "kiln-gateway"

# HS256 -- shared secret (same as Vigil HS256 mode)
auth:
  algorithm: HS256
  secretEnv: GATEWAY_JWT_SECRET
```

## v0.19.0 (2026-03-11) -- RAG Grounding Tier 2 (Post-Generation Rail)

### Hallucination Prevention: Post-Generation LLM Judge

- **`GroundingRail`**: Stateless post-generation judge in `core/src/safety/grounding-rail.ts`. Accepts the agent response and retrieved knowledge chunks, calls an LLM judge that returns `{ grounded, confidence, ungroundedClaims }` as structured JSON output.
- **`groundingMode: "verified"`**: New third mode extending `"off" | "strict" | "verified"`. When set, the pipeline runs the grounding rail after agent response generation. Ungrounded responses are replaced with a safe fallback message; grounded responses are passed through unchanged.
- **Model selection via `ModelCapabilityRegistry`**: The judge uses the cheapest available model with `supportsStructuredOutput`. No hardcoded provider — uses the same registry infrastructure as model routing.
- **Fail-open design**: Network errors, LLM timeouts, or JSON parse failures do not block the response. The original response is passed through with a trace warning.
- **`grounding_evaluated` event**: New `GroundingEvaluatedEvent` emitted to `EventBus` on every judge call with `grounded`, `confidence`, `ungroundedClaims`, `durationMs`, and `model`.
- **`GROUNDING_BLOCKED` conversation event**: Emitted to the product webhook when a response is replaced. Includes `confidence`, `ungroundedClaims`, and `model`.
- **Pipeline wiring**: `processInboundMessage()` in `message-pipeline.ts` accepts `groundingDeps` (rail, providerPool, modelRegistry, eventBus). `InboundMessageResult` now includes `groundingResult?: GroundingResult`.
- **`MUTABLE_TENANT_FIELDS`**: `groundingMode` was already mutable (added in v0.17.0). No admin API changes needed.
- Covered by `core/tests/safety/grounding-rail.test.ts` (unit) and `runtime/tests/gateway/message-pipeline-grounding.test.ts` (pipeline integration).

## v0.18.0 (2026-03-10) -- OpenRouter Provider Adapter

### OpenRouter Free-Tier Model Access
- **`OpenRouterAdapter`**: extends `OpenAICompatAdapter` for OpenRouter's OpenAI-compatible API (`https://openrouter.ai/api/v1`).
- **`buildHeaders()` extension point**: new `protected` method on `OpenAICompatAdapter` for provider-specific headers. OpenRouter overrides to add `HTTP-Referer` and `X-Title` attribution headers.
- **7 free models** in `MODEL_CATALOG` and `ModelCapabilityRegistry`: Nemotron 3 Nano 30B (default), Step 3.5 Flash, Trinity Large Preview, Llama 3.3 70B, Gemma 3 27B, Qwen3 Coder 480B, Mistral Small 3.1 24B.
- **Gateway wiring**: `case "openrouter"` in `createProviderFromConfig()`. Reads `OPENROUTER_APP_URL` and `OPENROUTER_APP_NAME` env vars for attribution.
- Zero new dependencies — uses raw `fetch` via inherited `OpenAICompatAdapter`.
- All free models support tool calling and streaming. Gemma 3 27B also supports vision.

## v0.17.0 (2026-03-10) -- RAG Grounding Tier 1 + Integration CapabilityAnnotations

### Hallucination Prevention: System Prompt Grounding Directive
- **`groundingMode`** field on `TenantConfig`: `"off"` (default) or `"strict"`.
- When `strict` and knowledge context exists, a grounding directive is appended after the recalled memory section, instructing the model to answer only from provided context, never fabricate data, and offer human escalation when the answer is not in context.
- Wired across all 6 channel handlers: WebSocket, WhatsApp, Instagram, Messenger, Email, and the shared message pipeline (provider-adapter REST + tenant routes).
- `groundingMode` added to `MUTABLE_TENANT_FIELDS` for admin API updates.
- Zero cost, zero latency — pure system prompt addition.

### Integration CapabilityAnnotations (Phase 3)
- `IntegrationRegistry.getCapabilities()`: surfaces `CapabilityAnnotations` (readOnly, destructive, idempotent, cacheTtl) from adapter operations as `Capability` objects.
- `TenantToolContext.capabilities`: populated from integration operations with annotations in `buildTenantToolContext()`.
- `PerCallToolConfig.perCallCapabilities`: new field carries per-tenant capabilities to the orchestrator.
- `RuntimeSessionOrchestrator.resolveCapability()`: merges dep-level (MCP/app) and per-call (integration) capabilities. Dep-level takes precedence.
- Integration tools now participate in tool authorization, cache TTL, retry/fallback, and audit logging — same as MCP and app-defined tools.

## v0.16.0 (2026-03-10) -- Zero-Trust Agent Tool Access

### Agent Tool Scoping: Explicit Opt-In
- **BREAKING:** `TenantAgentConfig.tools` now uses zero-trust semantics:
  - `tools` omitted or `tools: []` → agent gets **no tools** (previously: all tools)
  - `tools: ["*"]` → agent gets all available tools (new wildcard)
  - `tools: ["google_calendar_create_event", ...]` → agent gets only listed tools (unchanged)
- Affects `buildAgentToolContext()` in `runtime/src/tenant/agent-resolver.ts`. The no-agents path (single-agent without `TenantAgentConfig`) is unchanged — tenant-level `tools` field still controls the allowlist.
- **Migration:** Tenants with agents that had `tools: []` (meaning "all") must update to `tools: ["*"]`.

## v0.15.2 (2026-03-10) -- Integration Credential Resolution Fix

### Integration Runtime: Credential Key Mismatch
- **Fix:** `buildTenantToolContext()` now passes `integration.provider` (not `integration.credentialKey`) to `IntegrationExecutor`. Previously, after `TenantRegistry.hydrateSecrets()` replaced `[encrypted]` with the raw token, the executor would use the token as a SecretStore lookup key — which never matched. Now the credential resolver correctly looks up `tenant:{id}:integration:{provider}`.
- **Startup logging:** Gateway logs registered adapter count and provider names on startup (e.g., `Integrations: 3 adapter(s) registered (google_calendar, stripe, google_sheets)`).

## v0.15.1 (2026-03-10) -- AesSecretStore Bug Fixes

### AesSecretStore: Directory Creation + Atomic Writes
- **`mkdirSync` in constructor**: Creates parent directories on initialization. Fixes ENOENT crash in Docker containers where `.kiln/` doesn't exist on first tenant credential write.
- **Atomic `persist()`**: All writes (`set()`, `delete()`) now use tmp+rename pattern (same as `rotateKey()` already did). Prevents corrupted store file if process crashes mid-write.
- **`rotateKey()` deduplicated**: Now delegates to `persist()` instead of duplicating the atomic write logic.

## v0.15.0 (2026-03-09) -- Gateway Integration Wiring

### StartGatewayOptions: Integration & Secret Store Support
- **`integrations` option**: Pass `IntegrationAdapter[]` to `startGateway()` — adapters are registered in an `IntegrationRegistry` and wired into `buildTenantToolContext()` via `configureIntegrationDeps()`.
- **`secretKeyEnv` option**: Env var name for AES-256-GCM master key. Creates `AesSecretStore` and passes it to all `TenantRegistry` instances — enables encrypted credential storage for channel tokens, webhook secrets, and integration credentials.
- **TenantRegistry now receives SecretStore**: Multi-tenant apps automatically encrypt/hydrate sensitive fields (WhatsApp tokens, integration credentials, webhook secrets) when a secret key is configured.
- Zero breaking changes. Both options are optional. Existing gateways without `secretKeyEnv` behave identically to before.

## v0.14.0 (2026-03-09) -- Integration Runtime

### Integration Runtime (Phase 1: Core Interfaces + Runtime Wiring)
- **IntegrationAdapter interface**: Domain interface in `core/engine/domain/integration.ts` — provider, version, operations, execute(). CredentialResolver and ResolvedCredential for credential delegation.
- **IntegrationRegistry**: Adapter registry with `register()`, `get()`, `has()`, `resolveOperation()`, `getToolDefinitions()`. Tool naming: `{provider}_{operation}` with `["integration", provider]` tags.
- **IntegrationExecutor**: Per-tenant adapter execution with credential resolution via CredentialResolver, 30s timeout via AbortSignal, KilnError wrapping for adapter/credential failures.
- **LocalCredentialResolver**: SecretStore-backed credential resolution. JSON-structured credentials (type, value, headers) or plain string as bearer token. Key pattern: `tenant:{tenantId}:integration:{credentialKey}`.
- **TenantConfig.integrations[]**: Per-tenant integration config (provider, credentialKey, operations filter, config). Validation: unique providers, non-empty fields, operations sub-array.
- **Wired via buildTenantToolContext()**: Module-level `configureIntegrationDeps()`/`clearIntegrationDeps()` — zero changes to channel handlers, orchestrator, or message pipeline.
- **Credential encryption**: TenantRegistry encrypts/hydrates/deletes integration credentials alongside webhook tool secrets.
- **Admin API**: `integrations` added to MUTABLE_TENANT_FIELDS.
- **3 new error codes**: `INTEGRATION_TOOL_FAILED`, `INTEGRATION_ADAPTER_NOT_FOUND`, `CREDENTIAL_RESOLVE_FAILED` with context-aware suggestions in error catalog.
- Three tool executor types now operational: WebhookToolExecutor (HTTP POST + HMAC), IntegrationExecutor (adapter registry + credentials), McpClient (external MCP servers).

## v0.13.0 (2026-03-09) -- Widget Markdown Rendering

- **Custom markdown renderer**: Zero-dep markdown renderer in `widget/src/markdown.ts`. Supports bold, italic, inline code, fenced code blocks, ordered/unordered lists, links. Pure DOM API, no innerHTML. 20 dedicated tests.

## v0.12.0 (2026-03-09) -- WhatsApp Coexistence Auto-Handoff

### Coexistence Support
- **smb_message_echoes handling**: When a business owner responds from the WhatsApp Business App (coexistence mode), Kiln auto-transitions the session to `human_active` so the AI agent stops responding.
- **Lazy auto-release**: Configurable `autoReleaseMs` on `TenantConfig.whatsappCoexistence`. When the human has been idle past the timeout and the customer sends a new message, the session auto-transitions back to `ai_active`.
- **HUMAN_TAKEOVER event**: New conversation event type with `handoffSource: "whatsapp_coexistence"` for observability. `HANDOFF_RELEASED` is emitted on auto-release.
- **Session context preservation**: Business messages from the app are injected into session history so the AI has full context when it resumes.
- **WhatsAppCoexistenceConfig**: New `TenantConfig` field (`enabled`, `autoReleaseMs`). Admin API supports `whatsappCoexistence` as mutable field.
- **RuntimeSession.lastHumanMessageAt**: New timestamp for tracking human activity, persisted across session serialization.
- Zero breaking changes. All new fields are optional. Existing tenants see no behavioral change.

## v0.11.0 (2026-03-09) -- Eval Benchmarking & Abuse Protection

### Eval Framework (23 scorers + ConsistencyRunner)
- **ConsistencyRunner (pass^k)**: tau-bench pass^k metric. Runs same experiment k times, measures fraction of items passing ALL runs.
- **PolicyAdherenceScorer**: LLM-as-judge for business policy compliance. Config: `policies: string[]`.
- **ContextRelevanceScorer**: LLM-as-judge for RAG retrieval quality (context chunks vs query).
- **ToolTrajectoryScorer**: LLM-as-judge for tool-use sequence efficiency. Reads `metadata.toolCalls`.
- **EffortScorer**: Rule-based, bridges enrichment pipeline's Customer Effort Score into eval. Reads `metadata.effortComponents`.
- **ResolutionScorer**: Rule-based, maps resolution status to score. Reads `metadata.resolution`.
- **EvalInput.metadata**: New optional field forwarded from `DatasetItem.metadata` through `ExperimentRunner`.
- **ToolCallingAccuracyScorer**: Rule-based BFCL-style tool calling accuracy. Compares `metadata.toolCalls` vs `metadata.expectedToolCalls` using F1 (precision + recall).
- **MultiTurnConsistencyScorer**: LLM-as-judge for context retention across conversation turns. Reads `metadata.conversationHistory`.
- **SafetyPreservationScorer**: AgentDojo-inspired dual scorer (safety + utility under adversarial attack). Reads optional `metadata.attackType`.
- **RoutingAccuracyScorer**: Rule-based, compares `metadata.activeAgentId` vs `metadata.expectedAgentId`.
- **HandoffQualityScorer**: LLM-as-judge for context preservation across agent handoffs. Reads `metadata.handoffHistory`.
- **MilestoneScorer**: Rule-based, tracks intermediate checkpoint completion from `metadata.milestones`.
- **Safety adversarial dataset**: 145 test cases covering PII, content, prompt injection, policy rails, and benign controls at `packages/core/evals/safety-adversarial.jsonl`.

### Abuse Protection
- **Per-session token cap**: `TenantConfig.sessionLimits.maxTokens` enforces cumulative token limit per session. Sessions auto-escalate to `human_active` when exceeded.
- **Per-session turn limit**: `TenantConfig.sessionLimits.maxTurns` enforces max user turns per session.
- **Repetitive abuse detection**: `detectRepetitiveAbuse()` catches exact repetition, keyword spam ("continue" loops), and sequential counting attacks. Configurable window size and threshold.
- **SESSION_LIMIT_REACHED event**: New conversation event type with `limitType` (tokens/turns/abuse), `limitValue`, and `limitMax`.
- **Session token tracking**: `RuntimeSession.totalTokens` and `RuntimeSession.userTurnCount` persisted across session serialization.
- All protections integrated in `processInboundMessage()` pipeline -- applies to all 6 channels automatically.

## v0.10.0 (2026-03-09) -- Visitor Identity & Pre-Chat Form

- **localStorage persistence**: Widget userId now persists across browser sessions via `localStorage` (was `sessionStorage`). Returning visitors get their contact memory recalled automatically.
- **Identify frame**: New `identify` WebSocket frame type enables structured visitor metadata (name, email, phone, custom fields). Gateway sanitizes input (length limits, format validation, zero-width char removal) before use.
- **Pre-chat form**: Tenant-configurable pre-chat form (`TenantConfig.preChatForm`) with up to 10 fields, 3 types (text/email/phone), required/optional per field. Form config delivered via welcome frame. Returning visitors skip the form.
- **displayName on ConversationEvent**: All web channel conversation events now include `displayName` from visitor identity, enabling product backends to associate conversations with named visitors.
- **SDK identify()**: `useKilnWsChat` hook now returns `identify(visitor)` for programmatic visitor identification in React apps.
- **Visitor context injection**: Sanitized visitor info injected into system prompt alongside knowledge and contact memory context.

## v0.9.1 (2026-03-08) -- Cleanup

- **Removed 6 backward compatibility hacks**: ToolResultSanitizer dual-accept, CostTracker `byRole`, 2-segment session keys, session deserialization defaults, span mapper legacy OTel attributes, optional `sessionRegistry`.
- **Documentation consolidation**: Research docs absorbed into formal guides, doc references updated.
- 58 files changed, 419 lines of dead code removed.

## v0.9.0 (2026-03-07) -- Intelligence Layer

- **Multi-model routing**: Per-request model selection via `ModelCapabilityRegistry` (10 models), `ComplexityScorer` (5 signals), and `RulesRouter` (7 condition types). Configurable per-tenant via `TenantModelConfig`.
- **Enrichment pipeline**: Post-conversation analytics with `computeEffortScore()` (rule-based, 0-10 scale) and `LlmConversationEnricher` (sentiment, resolution, CSAT). SQLite-backed `EnrichmentStore` with admin API.
- **Observability**: `PrometheusCollector` (8 counters, 1 histogram at `GET /metrics`), `CompositeEventStore` (fan-out to multiple sinks), `BatchSpanProcessor` for OTel.
- **Cost tracking**: `CostTracker` keyed by `role:model` tuple with `recordEmbedding()` and `recordStt()` support.
- **Event infrastructure**: `SESSION_STARTED`, `CONVERSATION_CLOSED`, `CONVERSATION_ABANDONED`, `MODEL_ROUTED`, `COST_REPORT`, `CONVERSATION_ENRICHED` events. Schema version and trace ID on all events. Conversation event retry with exponential backoff.

## v0.8.0 (2026-03-07) -- Routing Observability

- **Embedding-based routing (Tier 2)**: `AgentRAG` for vector similarity agent selection when no regex matches. `EmbeddingTenantRouter` with 3-tier cascade.
- **Routing templates**: 3 built-in templates (`service-business`, `ecommerce`, `customer-support`).
- **Routing test endpoint**: `POST /tenants/:id/routing/test` for dry-run routing evaluation.
- **Admin API**: `agents` and `routing` added to mutable tenant fields.
- `routingTier` and `routingConfidence` on `AGENT_ROUTED` events.

## v0.7.0 (2026-03-07) -- Agent Handoff

- **Warm handoff briefs**: LLM-generated conversation summary injected on agent switch via `AgentHandoffSummarizer`.
- **Ping-pong guard**: `checkPingPong()` prevents rapid agent switching loops (max handoffs, cooldown, bidirectional pair block).
- **`AGENT_HANDOFF`** conversation event on every agent switch.
- Per-agent cost attribution in `CostTracker`.

## v0.6.0 (2026-03-07) -- Multi-Agent Routing

- **Multi-agent routing**: `TenantConfig.agents[]` + `routing{}` with regex Tier 1.
- **`AgentResolver`**: Single integration point for all 6 channel handlers.
- Session-level `activeAgentId` and `agentTurnHistory` tracking.
- Per-agent tool scoping (intersection of agent tools with tenant allowlist).
- `AGENT_ROUTED` conversation event.

## v0.5.0 (2026-03-07) -- Stabilization

- **Security**: Timing-safe auth via `timingSafeEqual`, indirect injection scanning on tool results, MCP tool description scanning.
- **Knowledge**: `CohereReranker` (Rerank v2, 4x over-fetch), `knowledge_gap` event.
- **Tools**: Tool result caching via `ToolCache` + `cacheTtl` annotation.
- **WebSocket**: Heartbeat (30s ping, 90s timeout).
- **Meta**: `WebhookDedup` for at-least-once delivery protection.
- **PII**: Luhn credit card validation.
- **Testing**: 48 streaming provider tests, 68 adversarial security tests.
- **Coverage**: Vitest coverage config with 80% thresholds.

## v0.4.0 (2026-03-07) -- Multi-Channel

- **Instagram DM**: Graph API v21.0, text + image, 1000 char limit.
- **Messenger**: Graph API v21.0, text + image, 2000 char limit.
- **Email**: Inbound webhook, outbound via Postmark/Resend/Generic, thread tracking (Message-ID chain), loop prevention (RFC 3834).
- **Meta foundation**: Shared `verifyMetaWebhook()` and `validateMetaSignature()` across WhatsApp, Instagram, Messenger.
- 8 total channel adapters (CLI, Web, WhatsApp, Instagram, Messenger, Slack, Email, API).

## v0.3.0 (2026-03-07) -- Tool Use

- **Tool execution loop**: Authorization (4-level annotation-driven), retry/timeout/fallback, result sanitization.
- **ToolRAG**: Embedding-based tool selection for large tool registries.
- **Webhook tools**: `WebhookToolExecutor` with HMAC-SHA256 signing.
- **Rate limiting**: `SlidingWindowRateLimiter` (per-tool, per-tenant).
- **Per-call config**: `PerCallToolConfig` (allowlist, rate limiter, additional tools) via 5th param to `processMessage()`.
- **Conversation events**: `TOOL_EXECUTED` event via `ConversationEventEmitter`.

## v0.2.0 (2026-03-06) -- Knowledge Engine

- **RAG pipeline**: `RetrievalPipeline` with recursive + markdown chunking, contextual enrichment (Anthropic pattern).
- **Vector store**: `PgVectorStore` with PostgreSQL + pgvector (halfvec + HNSW + RRF hybrid search).
- **Embedding**: OpenAI `text-embedding-3-small` (1536d) and Ollama adapters.
- **STT**: OpenAI `gpt-4o-transcribe` and Deepgram `nova-3` adapters with fail-open design.
- **Contact memory**: Per-user fact extraction via LLM (Mem0 ADD/UPDATE/DELETE/NOOP pattern), bi-temporal facts, GDPR deletion.
- **Content extraction**: Local files, URLs (Jina Reader + fallback), PDFs (unpdf).
- **Source management**: `SourceManager` with SHA-256 content deduplication and admin API.

## v0.1.x -- Foundation

- Engine primitives (Agent, Capability, Workflow, Memory, Task, Channel, Trigger) and composites (Team, Router, App).
- YAML loader with full validation and error catalog (73 error codes).
- Orchestrator with phase machine, checkpoint/resume, 3 team modes (sequential, supervisor, swarm).
- 5 provider adapters (Anthropic, OpenAI, DeepSeek, OpenRouter, Ollama).
- MCP client (Streamable HTTP, circuit breaker).
- Memory (SQLite + FTS5, 5 scopes, decay, compaction, git sync).
- Safety pipeline (PII scanner, content classifier, policy rails).
- Security (prompt injection detection, AES-256-GCM secrets, audit log with hash chaining).
- Eval framework (12 scorers, dataset loader, experiment runner, comparator).
- Human handoff (session mode state machine, escalation detection, operator messaging).
- CLI (init wizard, dev mode with hot-reload, gateway command).
- React SDK (`@kilnai/react` hooks).
- Embeddable chat widget (`@kilnai/widget`, Shadow DOM, zero deps).
- Studio dev UI (graph, playground, timeline, memory, eval, cost, safety views).
- Domain kits and skill registry.
- Sandbox (per-agent filesystem + network isolation).
