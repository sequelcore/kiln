# 01 - Kiln-Native Managed Agent Invocation

## Status

The original six-slice canonical planning plan is complete. Slices 1-6 define
the managed-agent doctrine, foundation boundary, core contracts, runtime
ownership, adapter taxonomy, and session event/replay projection rules.

The roadmap was then expanded with a documented implementation-proof extension:
Slice 7 converts the plan into a test-first verification sequence, Slice 8
proves one admitted `foundation-readonly-plan` adapter path, and Slice 9 closes
the long-term expansion order. Slices 7-9 are complete as of 2026-05-04.

Do not open an ADR yet. Do not treat the original six planning slices as
unfinished. The remaining work belongs to the proof extension, not to the
canonical planning phase.

Stable dependency doctrine lives in
`docs/architecture/provider-credential-pools.md`,
`docs/guides/provider-credentials.md`, `docs/architecture/memory.md`,
`docs/guides/memory.md`, and `docs/architecture/context-governance.md`.

## Scope Accounting

This roadmap has two layers:

| Layer | Slices | Status | Meaning |
| --- | --- | --- | --- |
| Original canonical planning plan | 1-6 | Complete on 2026-05-02 | Defines the official Kiln-native design and boundaries. |
| Implementation-proof extension | 7-9 | Complete on 2026-05-04 | Proves the design with tests, one first adapter path, and the future expansion order. |

The expanded slices are intentional, but they must be read as an extension:

- Slice 7 is not another design slice; it is the test-first verification plan.
- Slice 8 is not another planning slice; it is the first real implementation
  proof for one read-only child invocation path.
- Slice 9 is not required before implementation proof; it records the expansion
  order after one replayable path exists.

Completion accounting:

- Original `01` planning objective: complete.
- Current expanded `01` roadmap objective: complete. The next work belongs to
  later implementation roadmaps, not additional hidden slices in `01`.

## Goal

Make Kiln the control plane for admitting, invoking, supervising, replaying,
and learning from managed agent work across providers, harnesses, and operator
surfaces.

The feature is not a GUI-only subagent button. It is a runtime/session feature
where GUI, CLI, TUI, YAML apps, future IDE surfaces, and remote operator
surfaces all submit the same Kiln-native invocation request and project the
same lifecycle evidence.

## Required Capabilities

- Invoke managed work across provider families: direct API providers,
  OAuth-backed providers, wrapper providers, local harnesses, CLI harnesses,
  and future remote execution surfaces.
- Let each child invocation own its provider route, model, credential route,
  execution mode, working directory, timeout, tool authority, and permission
  profile.
- Represent parent-child lineage with stable `parentSessionId`,
  `parentTurnId`, `invocationId`, `agentId`, and child session or child turn
  references.
- Emit canonical lifecycle events for requested, admitted, started, progress,
  retry, result handoff, completed, failed, cancelled, timed out, and cleaned
  up states.
- Support sequential pipelines, fan-out/fan-in parallelism, bounded
  concurrency, DAG-shaped workflows, cancellation, partial success, and
  provider-aware scheduling.
- Persist enough replay data for every operator surface to answer who invoked
  whom, under which policy, with which tools, what changed, what it cost, and
  what evidence was returned.

## Memory Dependency

Managed agents depend on governed memory.

The implemented memory architecture defines how memory is admitted into a child
invocation, which scopes are visible, how provenance records the
agent/session/turn that used or produced memory, and how write proposals are
reviewed before becoming durable memory.

Without that boundary, managed agents would fall back to oversized prompts,
provider-local memories, duplicate instruction files, and unauditable child
context.

## Non-Goals

- Do not implement managed agents as GUI-local state.
- Do not let a provider directly spawn another provider.
- Do not treat `kiln run --agent`, YAML app agent routing, or `--workers N` as
  the managed-agent substrate.
- Do not give child invocations implicit access to parent permissions,
  workspace write scope, memory scope, or provider credentials.
- Do not preserve provider-native subagent behavior as the source of truth.
- Do not make Claude, Codex, OpenCode, Hermes, OpenClaw, or any other provider
  family the base model for Kiln core.

## Architecture Boundary

The parent agent may request an invocation, but Kiln admits and executes it.

```text
operator surface or parent turn
  -> managed agent invocation request
  -> runtime admission and policy
  -> child invocation with explicit route/scope/authority
  -> canonical session events, artifacts, memory evidence, and result handoff
  -> shared projection to GUI / CLI / TUI / IDE / remote surfaces
```

Cross-provider invocation is valid only through this boundary. For example, a
`codex-oauth` parent may request a `claude-code` wrapper reviewer, but Kiln
must choose the route, permission profile, tool surface, memory admission,
credential route, transcript policy, and result handoff contract.

## Relation to Existing Capabilities

- `kiln run --agent <name>` selects one agent profile for one CLI run. It does
  not create a managed child invocation.
- `kiln run --workers N` runs isolated parallel workers for the same CLI task.
  It does not provide parent-child lineage, policy inheritance, cancellation,
  memory admission, or replayable lifecycle evidence.
- YAML app agents and teams define app routing and tenant behavior. They are
  not the operator workflow substrate by themselves.
- Existing `agent_invocation_*` session events are the beginning of the replay
  contract, not the complete invocation engine.

## Phase 0: Evidence And Canonical Planning

Phase 0 reduced the roadmap into contract-first slices. These slices are not
optional polish; they prevent the first production increment from becoming a
GUI-local subagent feature or a wrapper around existing CLI worker behavior.

### Slice 0: Dependency Readiness Check

Status: completed on 2026-05-02.

Slice 0 checks whether the prerequisite substrates are implemented enough to
support managed child invocations. It is a readiness audit, not the
managed-agent design.

| Dependency | Readiness | Decision |
|---|---:|---|
| Provider credential pooling | Ready enough for foundation planning | No substrate blocker |
| Governed memory | Ready enough for foundation planning | No substrate blocker |
| Memory Lattice projection | Ready enough for foundation planning | No substrate blocker |
| Lifecycle policy | Partially ready | Child-invocation provenance convention must be defined before foundation coding |
| Context admission | Ready enough for foundation planning | No substrate blocker |

Readiness evidence:

- provider credential pooling has core pool, pooled adapter, state port,
  runtime file loading, watcher support, provider-specific services, health
  persistence, and secret-free status/observability tests. Key references:
  `packages/core/src/agents/credential-pool/pool.ts`,
  `packages/core/src/agents/credential-pool/pooled-adapter.ts`,
  `packages/runtime/src/agents/credential-pool/credential-pool-factory.ts`,
  `packages/runtime/src/agents/credential-pool/credential-watcher.ts`,
  `packages/core/tests/agents/credential-pool.test.ts`, and
  `packages/runtime/tests/agents/credential-pool.test.ts`.
- governed memory has explicit memory authority separate from generic tool
  permission. `MemoryMutationService` enforces scope, layer, operation, and
  audit-write authority. Key references:
  `packages/core/src/memory/domain/authority.ts`,
  `packages/core/src/memory/service.ts`,
  `packages/core/src/memory/sqlite-repository.ts`,
  `packages/core/tests/memory/mutation-service.test.ts`, and
  `packages/core/tests/context/governor-memory-admission.test.ts`.
- Memory Lattice projection exposes bounded `kiln://memory/...` resources for
  graph, nodes, lifecycle, neighbors, provenance, relations, and admissions.
  Tests cover scoped reads, denied cross-scope reads, missing-scope rejection,
  unauthorized-layer rejection, and model-callable `resource_read` access. Key
  references: `packages/core/src/memory/graph/projector.ts`,
  `packages/core/src/memory/resources/graph-resource-provider.ts`,
  `packages/core/tests/memory/graph/projector.test.ts`, and
  `packages/core/tests/memory/resources/resource-provider.test.ts`.
- lifecycle policy has pure policy contracts, an evaluator that proposes
  actions without mutating records, scoped forgetting, promotion criteria, and
  an application service that routes archive, forget, redact, and promote
  operations through `MemoryMutationService`. Key references:
  `packages/core/src/memory/lifecycle/policy.ts`,
  `packages/core/src/memory/lifecycle/evaluator.ts`,
  `packages/core/src/memory/lifecycle/service.ts`,
  `packages/core/tests/memory/lifecycle/service.test.ts`,
  `packages/core/tests/memory/lifecycle/evaluator.test.ts`,
  `packages/core/tests/memory/lifecycle/forgetting.test.ts`, and
  `packages/core/tests/memory/lifecycle/promotion.test.ts`.
- context admission is owned by `DefaultContextGovernor`; memory, procedural,
  and coordination context candidates are tested as governed admissions.
  Runtime tests reject governed runtime context without a
  `DefaultContextGovernor` audit. Key references:
  `packages/core/src/context/governor.ts`,
  `packages/core/src/context/projected-context.ts`,
  `packages/runtime/src/session/support/context/runtime-turn-system-prompt.ts`,
  `packages/core/tests/context/governor.test.ts`,
  `packages/core/tests/context/governor-memory-admission.test.ts`, and
  `packages/runtime/tests/session/runtime-session-orchestrator.test.ts`.

Slice 0 blocker before foundation coding:

- Child-invocation provenance is not yet canonical because Slice 2 has not
  defined final `parentSessionId`, `parentTurnId`, `invocationId`, `agentId`,
  `childSessionId`, and `childTurnId` persistence rules.

Slice 2 must define how child invocation identity maps into:

- `MemoryProvenance`
- context-admission records
- lifecycle actions
- child memory authority derivation
- result handoff resource-link envelope

Verification executed on 2026-05-02:

```bash
cmd.exe /c "node_modules\.bin\vitest.exe run packages/core/tests/agents/credential-pool.test.ts packages/runtime/tests/agents/credential-pool.test.ts packages/runtime/tests/agents/credential-watcher.test.ts packages/core/tests/memory/mutation-service.test.ts packages/core/tests/memory/resources/resource-provider.test.ts packages/core/tests/context/governor-memory-admission.test.ts packages/core/tests/memory/lifecycle/service.test.ts packages/core/tests/memory/lifecycle/evaluator.test.ts packages/core/tests/memory/lifecycle/forgetting.test.ts packages/core/tests/memory/lifecycle/promotion.test.ts"
```

Result: 10 test files passed, 87 tests passed.

### Slice 0.5: Provider Agent Semantics And Market Exploration

Before finalizing Kiln's managed-agent contracts, research current provider
surfaces and market direction. This slice is evidence gathering for an official
architecture decision; it must not make provider-native semantics the source of
truth for Kiln.

Status: completed on 2026-05-02. Evidence covers local Sequel clones,
installed CLI surfaces, current official/provider material, external security
and market material, issue-linked user-pain signals, and a second-pass
freshness check. Clean upstream-tracking research clones were fast-forwarded
on 2026-05-02; Codex was switched to `main` and verified against `origin/main`
after stashing unrelated local tracked edits.

Initial local source inventory:

| Surface | Local evidence | Observed version | Initial read |
| --- | --- | --- | --- |
| Claude Code | Installed binary at `C:\Users\R3XED\.local\bin\claude.exe` | `2.1.123 (Claude Code)` | Official docs confirm subagents as separate specialized instances with their own context, tools, permissions, model controls, hooks, memory, foreground/background execution, and optional worktree isolation. |
| Codex CLI/local repo | `C:\Proyectos\Sequel\codex`, branch `main`, commit `2ffb32db9`, remote `https://github.com/Sequela02/codex.git`; tracked local edits stashed as `slice-0.5-tracked-before-main-pull-2026-05-02`; untracked `NUL` remains | `codex-cli 0.128.0` | Local code has real subagent/thread machinery: `spawn_agent`, `SubAgentSource`, depth limits, inherited execution policy, cancellation tokens, parent notifications, background job runners, and `x-openai-subagent` request headers. This is implementation evidence, not official OpenAI product contract. |
| OpenCode | `C:\Proyectos\Sequel\opencode`, branch `dev`, fast-forwarded from `f033d2d8f` to `becf57ee6`, remote `https://github.com/anomalyco/opencode`; clean after pull | `opencode 1.14.31` | Local source and docs model `primary` agents and `subagent` agents. The task tool creates child sessions with `parentID`, resumes via `task_id`, inherits selected parent deny/external-directory rules, passes model and permissions, and cancels child sessions through the parent abort signal. Latest local code also has a worktree control-plane adapter. |
| Hermes | `C:\Proyectos\Sequel\hermes-agent`, branch `main`, fast-forwarded from `5dda4cab4` to `af9812279`, remote `https://github.com/NousResearch/hermes-agent`; clean after pull | `hermes` not on PATH | Local tests and runtime files show first-class delegation behavior: `delegate_task`, active child tracking, interrupt propagation, `parent_session_id`, `subagent.progress`, `subagent.tool`, `subagent.thinking`, and `subagent_stop` hooks. Latest local tests add timeout diagnostics, ACP cancellation, ACP usage mapping, and SSE disconnect cancellation evidence. |
| OpenClaw | `C:\Proyectos\Sequel\openclaw`, branch `main`, commit `f73826360492fdefb140af4da9093064f96e9b8e`, remote `https://github.com/openclaw/openclaw.git`; clean after clone on 2026-05-02 | n/a | Source confirms native `sessions_spawn`, child session keys, registry persistence, depth/child limits, context fork/isolate modes, sandbox checks, run timeouts, thread-bound session mode, kill/steer control, completion announce flow, and auth read-through. |
| ECC / OpenClaw migration evidence | `C:\Proyectos\Sequel\everything-claude-code`, branch `main`, fast-forwarded from `4e66b2882` to `841beea45`, remote `https://github.com/affaan-m/everything-claude-code`; clean after pull | n/a | Migration and cross-harness docs frame Hermes/OpenClaw as source systems whose reusable behavior should be translated into ECC-native skills, hooks, commands, session adapters, and control-plane surfaces. Treat as architecture evidence, not a runtime provider. |

Initial installed binary inventory:

| Binary | Result |
| --- | --- |
| `claude --version` | `2.1.123 (Claude Code)` |
| `codex --version` | `codex-cli 0.128.0` |
| `opencode --version` | `1.14.31` |
| `hermes --version` | Not found on PATH |

Preliminary naming and semantics matrix:

| Provider or surface | Native term | Child work shape | Controller | Kiln treatment |
| --- | --- | --- | --- | --- |
| Claude Code | `subagent`, `agent teams`, `forks` | Separate context window, custom prompt, tool/model/permission controls, automatic or explicit invocation, optional background/worktree behavior | Claude Code runtime with operator and configuration controls | Strong foundation candidate, but adapter must normalize `subagent`, `team`, and `fork` into a single Kiln invocation model instead of copying Claude names into core. |
| Claude Agent SDK | `subagent` via Agent tool | Programmatic separate agent instances spawned by the main agent; messages can expose parent linkage through tool-use metadata | SDK application and allowed tools | Good contract reference for parent/child lineage and result handoff. |
| Codex CLI local implementation | `spawn_agent`, `subagent`, `agent job`, `guardian subagent` | Spawned Codex threads, optional forked context, background jobs, depth and concurrency limits, notifications, inherited services and policies | Codex runtime with model-visible tool constraints | Strong local implementation evidence; the canonical plan must separate local fork behavior from official OpenAI app/cloud behavior. |
| OpenAI Codex app/cloud | `agents`, `threads`, `worktrees`, `skills`, `automations` | Multiple long-running agents across isolated worktrees/cloud sandboxes with progress review and reusable skills/automations | User/app/cloud control plane | Market signal for parallel work, review queues, isolated execution, and recurring background tasks; not enough by itself for Kiln lineage contracts. |
| OpenCode | `primary agent`, `subagent`, `task` | Primary agents invoke subagents into child sessions; task output returns a result block and resumable `task_id` | OpenCode session/tool runtime | Strong foundation comparison for parent session ID, resumability, permission narrowing, and manual `@agent` invocation. |
| Hermes | `delegate_task`, `subagent_*` events/hooks | Parent delegates to children, relays progress/thinking/tool events, tracks active children, propagates interrupts, stores parent session lineage | Hermes CLI/gateway runtime | Strong local evidence for lifecycle event vocabulary and interruption behavior; should influence Kiln event envelope. |
| GitHub Agent HQ / Copilot coding agent | `agent session`, `coding agent` | Asynchronous repository/issue/PR-attached sessions, draft PRs, reviewable logs, multi-agent comparison | GitHub workflow and enterprise controls | Product benchmark for collaboration, review, audit, and repository-native handoff. |
| Conductor / Temporal / Camunda | `workflow`, `agentic workflow`, `durable execution`, `human-in-the-loop` | Explicit workflow graph, retries, state, observability, durable execution, human approval | Workflow engine | Pattern evidence that enterprise agent execution should be durable, observable, retryable, and governable. |
| OpenHands | `harness`, `orchestrator`, `control plane` | Cloud/container runtimes with policies, routing, budgets, secrets controls, observability, audit | Software-agent control plane | Strong market signal for Kiln's control-plane posture: authority, budget, audit, and runtime isolation matter as much as spawn mechanics. |
| LangGraph / CrewAI / Microsoft Agent Framework | `agent`, `crew`, `flow`, `workflow`, `handoff`, `supervisor` | Multi-agent application graphs with explicit routing, state, checkpoints, or handoffs | Application framework | Useful for orchestration vocabulary, but not direct child-process provider evidence unless wrapped by a Kiln adapter. |
| Google Jules | `asynchronous coding agent`, `tasks`, `plans`, `diffs` | Cloud VM task execution against GitHub repositories, parallel tasks, visible plans/reasoning, GitHub issue integration, and subscription-based limits | Google Labs cloud service | Strong product signal for asynchronous cloud agents, but not enough for Kiln production admission unless an API exposes lineage, cancellation, logs, authority profile, and result handoff. |

Preliminary 2026-05-02 market and user-needs read:

- The visible market is converging on supervised multi-agent work rather than
  unbounded autonomy: parallel execution, isolated worktrees or cloud sandboxes,
  resumable sessions, reviewable diffs, logs, and human approval paths.
- Providers disagree on vocabulary. `subagent`, `agent session`, `task`, `crew`,
  `workflow`, `fork`, `automation`, and `coding agent` overlap but do not mean
  the same thing. Kiln needs canonical terms and provider adapters must map into
  them.
- Enterprise-facing signals emphasize control planes: routing, credential and
  secret boundaries, budgets, audit trails, policy enforcement, durable retries,
  and human-in-the-loop gates.
- Developer-facing signals emphasize ergonomics: context isolation, less context
  pollution, parallel exploration, child transcript visibility, cancellation,
  predictable permissions, and easy review of produced changes.
- The official decision should bias toward `managed agent invocation` as the
  core term. `subagent` should remain an adapter/native-provider term because
  several important surfaces use non-subagent vocabulary.

Preliminary behaviors for the canonical plan:

| Normalize | Reject for foundation | Defer |
| --- | --- | --- |
| parent/child lineage, child invocation ID, provider session ID, lifecycle events, cancellation, authority profile, credential route, model route, cwd/worktree, result handoff, cost/budget metadata | provider-native terms in core contracts, unbounded nested delegation, implicit permission inheritance without recorded authority profile, child work without observable lifecycle, prompt-only "agent" profiles without execution lineage | agent teams with peer-to-peer communication, scheduled automations, durable workflow replay, cloud sandbox provisioning, cross-provider result comparison, marketplace-style agent discovery |

Second-pass local implementation findings:

| Surface | Newly verified behavior | Kiln implication |
| --- | --- | --- |
| OpenCode latest local checkout | `TaskTool` creates or resumes a child session, records `parentID`, returns a resumable `task_id`, carries selected parent deny/external-directory permissions, derives the child model from either the subagent config or parent message, and cancels the child session from the parent abort signal. | Kiln's child invocation envelope should include `parentSessionId`, `childSessionId`, `resumeToken`, `authorityProfile`, `modelRoute`, and `cancellationToken` even for local terminal providers. |
| OpenCode control-plane adapter | Latest local checkout includes `packages/opencode/src/control-plane/adapters/worktree.ts`, which creates/removes git worktree-backed workspaces and returns a local target directory. | Worktree isolation should be an adapter capability, not a core assumption. Kiln should record `workspaceIsolation=worktree|shared|cloudSandbox|unknown`. |
| Hermes latest local checkout | Timeout diagnostic tests require a structured `subagent-timeout-<sid>-<ts>.log` with task index, subagent ID, timeout, duration, goal, child config, tool schema size, activity summary, and worker stack. | Kiln should require terminal/runtime adapters to expose a diagnostic artifact URI for timed-out children when available. |
| Hermes ACP adapter | ACP tests show `cancel(session_id)` sets a cancel event, cancelled prompts return `stop_reason=cancelled`, and prompt responses map usage fields including input, output, total, reasoning, and cache-read tokens. | Kiln events should distinguish `cancelRequested`, `cancelObserved`, and final `cancelled` status; usage should be normalized but retain provider-specific token classes. |
| Hermes gateway | SSE disconnect tests require `agent.interrupt("SSE client disconnected")` and cancellation of the running task on client disconnect. | Parent/runtime disconnects must become explicit child cancellation causes, not generic failures. |
| ECC latest local checkout | `docs/architecture/cross-harness.md` separates durable workflow assets from harness-specific adapters and marks cross-harness sessions as alpha. | Kiln should keep provider adapters thin and keep canonical lifecycle, memory, and authority contracts in Kiln core. |
| Codex `main` local checkout | `spawn_agent` emits begin/end events, enforces delegation depth, validates role/model/reasoning overrides, supports `fork_context`, records `SubAgentSource::ThreadSpawn`, and starts child threads with inherited services, cwd, sandbox, approval policy, shell/network policy, cancellation token, and parent notification plumbing. `send_input`, `wait_agent`, `close_agent`, and `resume_agent` expose interrupt, timeout, previous-status, and rollout-resume behavior. | Kiln's canonical child invocation should include `parentThreadId`, `childThreadId`, `depth`, `agentRole`, `modelRoute`, `reasoningProfile`, `forkContext`, `authorityProfile`, `cwd`, `sandboxProfile`, `waitTimeout`, `closePreviousStatus`, `resumeSource`, and structured status events. |
| Codex token and header plumbing | Codex exposes per-agent total token usage, formats open subagents into parent environment context, and marks spawned child requests with `x-openai-subagent: collab_spawn`. | Kiln should normalize usage while preserving provider token classes and should store provider-native lineage headers/labels as adapter metadata, not core contract names. |
| Codex CSV fanout jobs | `agent_jobs` supports batch child execution from CSV-like inputs with default concurrency 16, max concurrency 64, 30-minute item timeout, progress events for totals/pending/running/completed/failed/ETA, and cancellation that stops new workers while existing work drains or times out. | Bulk fanout is valuable but should not be foundation scope. Treat it as a later adapter capability after single child invocation lifecycle, cancellation, and result handoff are stable. |
| OpenClaw local checkout | `src/agents/tools/sessions-spawn-tool.ts` exposes native `runtime="subagent"` and optional `runtime="acp"`, validates unsupported routing fields, supports `agentId`, `model`, `thinking`, `cwd`, `runTimeoutSeconds`, `thread`, `mode`, `cleanup`, `sandbox`, `context`, `lightContext`, and inline attachments. ACP fields are explicitly ignored or rejected for native subagents where inappropriate. | Kiln should model runtime kind, execution mode, timeout, sandbox requirement, context mode, attachment policy, and provider-specific unsupported-field validation as explicit admission concerns. |
| OpenClaw spawn engine | `src/agents/subagent-spawn.ts` builds child keys as `agent:<targetAgentId>:subagent:<uuid>`, enforces valid agent IDs, target allowlists, `requireAgentId`, default max depth 1, max active children 5, sandboxed-parent cannot spawn unsandboxed child, context `fork` only for same-agent spawns, and default isolated context. It patches child session metadata with depth, role, control scope, model/thinking, `spawnedBy`, workspace, and context-engine preparation before starting the child run. | Kiln should make child identity, spawn depth, child capability role, controller scope, target-agent policy, workspace inheritance, sandbox inheritance, and fork-context eligibility canonical rather than provider-specific afterthoughts. |
| OpenClaw subagent registry and lifecycle | `src/agents/subagent-registry.types.ts` records `runId`, `childSessionKey`, `controllerSessionKey`, `requesterSessionKey`, requester origin/display key, task, cleanup, model, agent/workspace dirs, timeout, spawn mode, timings, outcome, announce retries, pause/yield state, cleanup flags, and attachment retention. `subagent-registry.ts` restores/persists runs, reconciles orphans, retries terminal lifecycle grace windows, cleans browser sessions on lifecycle end, and emits announce/completion behavior. | Kiln should persist a first-class invocation record with retry/recovery metadata, not reconstruct state from transcripts. Timed-out or orphaned children need explicit recoverability and cleanup state. |
| OpenClaw control and auth | `src/agents/subagent-control.ts` lets only owning controller sessions kill or steer their children, cascades kill to descendants, marks `abortedLastRun`, clears queues, and restarts steer runs with a new `runId`. `docs/auth-credential-semantics.md` defines auth read-through: child/secondary agents can resolve main-agent auth profiles at runtime without copying secrets. | Kiln should keep controller ownership and descendant cancellation explicit, treat steer/restart as a new invocation attempt, and reject OpenClaw-style additive auth fallback for the foundation unless represented as an explicit credential-route policy. |

Final retry, transcript, and cost-depth findings:

| Surface | Newly verified depth | Kiln implication |
| --- | --- | --- |
| Codex `main` local checkout | `codex_thread.rs` persists rollout JSONL, reconstructs history, tracks total token usage, supports rollout materialization, and supports resume/fork behavior. `client.rs` includes stream retry, fallback, unauthorized recovery, and provider retry budget behavior. `codex_delegate.rs` forwards child cancellation but sets `persist_extended_history=false` for delegated subagents. | Codex can supply lineage, lifecycle, cancellation, and usage evidence, but transcript export must use rollout/materialized history and parent lifecycle events instead of assuming every delegated child has an extended standalone transcript. |
| OpenCode latest local checkout | ACP code sends `usage_update` events with used tokens, context size, and USD cost from assistant messages. Session APIs expose messages, children, fork, share, abort, and async prompt behavior. Prompt and command responses include normalized usage, and cancellation routes through `session.abort`. | OpenCode is a strong comparison provider for transcript replay, child-session visibility, usage, cost, and cancellation. Kiln should still record provider-native cost as adapter metadata because currency and pricing rules are provider-owned. |
| Hermes latest local checkout | Bedrock and auxiliary adapters extract input, output, total, reasoning, and cache token classes where available. Runtime paths classify context overflow, rate limits, overloads, unsupported parameters, auth refresh, provider fallback, and connection failures into retry or fallback behavior. Agent-loop docs describe conversation history, retry/fallback model switching, interruptible calls, and usage metadata. | Hermes confirms retry causes and provider switches must be first-class invocation diagnostics. Kiln should record retry attempt count, retry cause, fallback provider/model, and final stop reason instead of flattening retries into one terminal status. |
| OpenClaw local checkout | `sessions_history` returns bounded inspectable history but redacts tool payload text, strips image data, truncates text, and removes `details`, `usage`, and `cost` from returned messages. Provider transports separately compute token usage and cost. Registry lifecycle already records run IDs, terminal retry state, orphan recovery, and cleanup behavior. | OpenClaw confirms transcript inspection and billing evidence are separate surfaces. Kiln must not treat a redacted provider history view as the audit ledger, and must preserve explicit redaction/truncation flags in transcript pointers. |
| Claude Code official costs docs | Claude Code exposes cost and token visibility at the product level, including cost inspection and usage-monitoring guidance, but provider docs do not make Kiln's child-level attribution contract for us. | Claude-family adapters remain foundation candidates, but each adapter must prove child lineage, result handoff, cancellation, usage, and transcript pointers before admission. |

User-pain signals from issue-linked changelogs:

Source: `C:\Proyectos\Sequel\openclaw\CHANGELOG.md`, inspected from the clean
`main` checkout cloned on 2026-05-02.

| Repeated pain | Evidence shape | Kiln response |
| --- | --- | --- |
| Silent or ambiguous completion | OpenClaw changelog entries reference yielded results, missing visible replies, direct-completion fallback, duplicate announces, and parents waking early before a child result is available. | Terminal child state must be replayable and delivered through a canonical result handoff, not only through provider chat text. |
| Control, cancellation, and orphan cleanup | OpenClaw fixes reference stale/orphan sessions, stop cascade, descendant kill behavior, cleanup retries, and archived-session cleanup. | Child invocations need persisted controller ownership, descendant cancellation semantics, cleanup state, and timeout/orphan recovery evidence. |
| Permissions and routing ambiguity | OpenClaw fixes reference `allowAgents`, ambiguous multi-channel delivery, sandbox/tool filtering, owner-only controls, and cross-agent bound-account routing. | Foundation admission must include authority profile, credential route, target-agent policy, and explicit rejection for unsupported or ambiguous provider fields. |
| Cost, context, and fanout pressure | OpenClaw fixes reference unbounded fanout/timeouts, duplicate task tokens, timeout partials, and memory-agent behavior. | Bulk fanout and nested teams stay out of the foundation increment until single-child budget, context, timeout, and usage reporting are stable. |
| Transcript and debuggability gaps | OpenClaw changelog entries reference opt-in transcript persistence for debugging, redacted history behavior, and terminal failed-session output. | Transcript pointers must declare persistence, redaction, truncation, and diagnostic artifact availability instead of promising a universal full transcript. |

Initial external evidence inventory:

| Source | Evidence captured |
| --- | --- |
| Claude Code subagents docs, `https://code.claude.com/docs/en/sub-agents` | Subagents have separate context windows, custom system prompts, specific tools, permissions, models, hooks, memory, and optional isolation. |
| Claude Code costs docs, `https://code.claude.com/docs/en/costs` | Claude Code documents cost and token visibility as a product concern; Kiln still needs adapter-level attribution for child invocations. |
| Claude Agent SDK subagents docs, `https://code.claude.com/docs/en/agent-sdk/subagents` | SDK subagents are separate agent instances invoked through the Agent tool and can expose parent linkage in streamed message metadata. |
| OpenCode agents docs, `https://opencode.ai/docs/agents/` | OpenCode explicitly separates primary agents from subagents, supports automatic/manual invocation, child session navigation, model inheritance, and permissions. |
| OpenAI Codex app launch, `https://openai.com/index/introducing-the-codex-app/` | Codex app positions multi-agent parallel work, long-running tasks, worktrees, skills, automations, and reviewable progress as product primitives. |
| Anthropic multi-agent research post, `https://www.anthropic.com/engineering/multi-agent-research-system` | Orchestrator-worker pattern with specialized parallel subagents is a proven lab architecture, with reliability and coordination concerns. |
| GitHub Agent HQ launch, `https://github.blog/news-insights/company-news/pick-your-agent-use-claude-and-codex-on-agent-hq/` | GitHub exposes Copilot, Claude, Codex, and custom agents as asynchronous, reviewable repository-native sessions with logs, artifacts, PRs, and controls. |
| OpenHands control-plane post, `https://openhands.dev/blog/agent-control-plane` | Software-agent operations require harness, orchestrator, and control-plane layers with budgets, policies, secrets controls, observability, and audit. |
| Orkes Conductor AI orchestration docs, `https://orkes.io/content/ai-orchestration` | Workflow engines frame agentic workflows as governed, observable orchestration rather than unmanaged prompt chains. |
| Temporal AWS AI Competency announcement, `https://temporal.io/news/temporal-achieves-the-aws-ai-competency` | Durable execution is being positioned for production-grade autonomous AI workflows with model coordination, approvals, and failure recovery. |
| Microsoft Agent Framework overview, `https://learn.microsoft.com/en-us/agent-framework/overview/` | Agent frameworks are converging on explicit workflow graphs, state, telemetry, middleware, type-safe routing, and human-in-the-loop support. |
| Google Jules public availability, `https://blog.google/technology/google-labs/jules-now-available/` | Jules moved from beta toward a public async coding-agent product with GitHub issues integration, reusable setups, higher paid limits, and multi-agent workflow positioning. |
| LangGraph overview, `https://docs.langchain.com/langgraph` | LangGraph markets durable execution, human-in-the-loop, memory, debugging/observability, and long-running stateful agents as core orchestration primitives. |
| CrewAI docs, `https://docs.crewai.com/core-concepts/Agents/` and `https://docs.crewai.com/concepts/crews` | CrewAI vocabulary centers on agents, crews, tasks, flows, checkpointing, hierarchical/sequential processes, callbacks, guardrails, and human-in-the-loop triggers. |
| Camunda 2026 agentic orchestration report post, `https://camunda.com/blog/2026/01/closing-agentic-ai-vision-reality-gap-camunda-2026-state-of-agentic-orchestration-automation-report/` | Camunda reports a gap between agentic AI ambition and production reality, with agents often siloed instead of embedded in end-to-end governed processes. |
| OpenClaw subagents docs, `https://docs.openclaw.ai/tools/subagents` | OpenClaw subagents are background runs with immediate run IDs, one-shot or persistent session modes, optional model/thinking/timeout overrides, session keys shaped like `agent:<agentId>:subagent:<uuid>`, requester-route announce delivery, runtime-derived completion status, nested stop cascade, and additive auth fallback from the main agent. |
| OWASP Top 10 for Agentic Applications 2026, `https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/` | OWASP frames autonomous agents that plan, act, and decide across workflows as a distinct security domain needing operational controls, not just model-level safety. |
| OWASP Agentic Skills Top 10, `https://owasp.org/www-project-agentic-skills-top-10/` | Agent skills are treated as a vulnerable behavior/execution layer; guidance emphasizes verified publishers, scanning, permission manifests, sandboxing, network restrictions, audit logging, inventory, approval workflows, and incident response. |
| Kaspersky OpenClaw risk analysis, `https://www.kaspersky.com/blog/moltbot-enterprise-risk-management/55317/` | Security analysis highlights OpenClaw's broad host/account access, untrusted inputs, prompt-injection exposure, insecure defaults, plaintext secrets, malicious skills, and the need for enterprise governance before deployment. |
| MITRE ATLAS OpenClaw investigation, `https://www.mitre.org/sites/default/files/2026-02/PR-26-00176-1-MITRE-ATLAS-OpenClaw-Investigation.pdf` | MITRE records OpenClaw-specific agent risks around exposed control interfaces, poisoned skills, one-click RCE, prompt-injection command-and-control, credential access, and privileged execution through agent capabilities. |

Open evidence gaps before a later ADR:

- Resolve or ignore the untracked `NUL` artifact in the Codex checkout before
  calling the repository fully clean. The tracked Codex shell/test edits were
  stashed before switching to `main`; `main` is at `origin/main` commit
  `2ffb32db9`.
- Inspect Codex `multi_agents_v2` only if Slice 1 intends to rely on
  peer-to-peer inter-agent messaging rather than parent-orchestrated child runs.
- Provider-specific transcript export and exact billing validation move to
  adapter QA after the canonical plan. Slice 0.5 only requires evidence that each foundation
  candidate can expose inspectable transcript pointers, redaction state, usage,
  and cost when the provider supports cost.
- Public forum or social-media deep dives are not required for Slice 0.5 because
  issue-linked changelog signals already expose repeated workflow gaps without
  treating hype as evidence.

Foundation admission criteria:

| Required evidence | Minimum provider obligation |
| --- | --- |
| Lineage | Expose or reconstruct `parentSessionId`, `parentTurnId`, Kiln `invocationId`, provider child ID, and result/artifact IDs. |
| Lifecycle | Emit or reconstruct accepted, running, progress, completed, failed, cancelled, and timed-out states with timestamps. |
| Cancellation | Support cancellation request, cancellation observation, final cancellation or failed-cancel status, and descendant behavior when applicable. |
| Authority | Record model route, reasoning/profile controls, tool permissions, sandbox/workspace, cwd, network policy, credential route, and unsupported-field rejection. |
| Result handoff | Provide final text or structured result, artifact pointers, file/diff pointers when applicable, and a durable transcript or diagnostic pointer. |
| Usage and cost | Provide token usage when available, provider token classes where available, cost when available, retry attempts, fallback causes, timeout diagnostics, and explicit `unknown` values when unavailable. |
| Transcript and audit | Provide inspectable transcript pointers with provider IDs plus redaction, truncation, persistence, and retention flags. |

Foundation evidence set:

- Claude-family providers remain strong foundation candidates, but admission depends on
  proving child lineage, cancellation, result handoff, transcript pointer, and
  usage/cost attribution through the selected adapter.
- Codex local/CLI is a strong implementation-evidence candidate for invocation
  contracts, lifecycle, cancellation, rollout-backed transcript reconstruction,
  usage, and parent notification behavior.
- OpenCode is a strong comparison and possible adapter candidate for
  child-session visibility, resumability, permission narrowing, cancellation,
  usage, and cost.
- Hermes and OpenClaw are comparison/control-plane evidence for lifecycle,
  retries, diagnostics, cleanup, and policy boundaries. They should not enter
  foundation unless a concrete adapter is selected and passes the admission criteria.
- Codex app/cloud, Jules, GitHub Agent HQ, workflow engines, and agent
  frameworks remain market/control-plane evidence until API-level lineage,
  lifecycle, authority, and result-handoff evidence exists.

Canonical planning decision from pre-slices:

- Slice 0.5 is complete enough to decide the core term as
  `managed agent invocation`. `subagent`,
  `task`, `session`, `thread`, `crew`, `fork`, and `automation` should remain
  provider-native terms mapped by adapters.
- Kiln's base model is not Claude-family, Codex-family, OpenCode-family,
  Hermes, or OpenClaw. Kiln's base model is a governed control-plane
  invocation with admission, authority, lineage, lifecycle, replay evidence,
  transcript pointers, usage/cost evidence, and result handoff.
- Direct provider APIs and harness-backed providers use the same core contract.
  Direct adapters map provider API runs, threads, sessions, tools, usage,
  transcripts, and cancellation into Kiln evidence. Harness adapters wrap local
  CLI/runtime behavior, capture events/artifacts, constrain cwd/sandbox and
  credentials where possible, and map local session identifiers into Kiln
  evidence.
- Ready to use Claude-family, Codex local/CLI, OpenCode, Hermes, and OpenClaw as
  the main validation evidence set for the plan, with Hermes/OpenClaw treated as
  control-plane comparison unless selected as explicit adapters. OpenAI Codex
  app/cloud, Jules, GitHub Agent HQ, LangGraph, CrewAI,
  Temporal/Conductor/Camunda, and OpenHands remain market/control-plane
  evidence until API-level integration evidence is gathered.
- Not ready to approve bulk fanout, nested peer-to-peer agent teams, marketplace
  skill execution, scheduled automations, or OpenClaw-style additive auth
  fallback as foundation behavior.
- Slice 1 should start with one observable child invocation per parent turn,
  explicit authority profile, cancellable lifecycle, result handoff, usage
  capture, and adapter metadata for provider-native identifiers.

Provider exploration must answer:

- what each surface calls agents, subagents, workers, tasks, automations,
  threads, sessions, teams, reviewers, or delegated runs
- whether child work is first-class or only prompt/profile selection
- whether a parent model can request child work, or only the operator/runtime
  can start it
- what inputs Kiln can force: cwd, model, provider route, credential home,
  execution mode, timeout, tools, permissions, memory scope, branch/worktree,
  and output limits
- what outputs Kiln can observe: lifecycle events, progress, transcripts,
  tool calls, file changes, cost, errors, cancellation, and result handoff
- what lineage is visible or reconstructable: parent session, parent turn,
  child session, child turn, invocation ID, provider session, and artifacts
- whether permissions are inherited implicitly, configured explicitly, or not
  inspectable

Initial provider and repository targets:

- Claude Code and Claude Agent SDK
- Codex CLI, Codex app, Codex cloud, and Codex IDE surfaces
- OpenCode primary agents and subagents
- Hermes, OpenClaw, and any local Sequel execution harnesses intended as
  managed child providers
- Conductor-style and durable orchestration systems, including Orkes/Netflix
  Conductor, Temporal, Camunda, OpenHands control-plane surfaces, LangGraph,
  CrewAI, AutoGen, and comparable workflow or multi-agent runtimes
- GitHub Copilot coding agent, Jules, Cursor, OpenHands, AutoGen, and other
  relevant market references only as comparison signals
- trending AI coding agents, agent platforms, and orchestration products as of
  2026-05-02, including both established vendors and fast-moving open-source
  projects

Evidence sources must include both local and external material:

- local clones under `C:\Proyectos\Sequel`, including any checked-out Claude
  Code, Codex, Hermes, OpenClaw, OpenCode, or internal Sequel harness
  repositories
- installed CLI binaries and their reported versions
- official provider documentation and changelogs
- research papers, lab engineering posts, product launch posts, and market
  reports
- user feedback from public issue trackers, forums, and communities when it
  exposes repeated workflow gaps

Inspect local clones first for adapter mechanics, actual command surfaces, and
implementation constraints. Record each local repository's path, branch, commit
SHA, version tag when available, dirty/clean status, and whether it appears to
track upstream. Use web docs and papers to validate official semantics, product
direction, user needs, and market positioning.

For each target, pull or inspect the latest version if needed before recording
evidence. Pull only dedicated research checkouts or clean upstream-tracking
repositories. Do not update active product repositories with uncommitted work
without explicit approval. If a local repository or installed binary is stale,
update a research checkout or record the exact observed version and date.
Production Kiln code must not depend on unverified stale behavior.

Research output:

- provider capability matrix with native terms, spawn mechanism, controller,
  authority controls, lifecycle visibility, lineage support, cancellation,
  output handoff, and caveats
- naming and semantics matrix that separates provider vocabulary from Kiln's
  canonical vocabulary
- orchestration-pattern matrix comparing provider-native subagents,
  conductor-style workflows, durable execution engines, asynchronous coding
  agents, IDE agents, terminal agents, and cloud sandbox agents
- market and user-needs summary from current official docs, lab posts, product
  launches, enterprise controls, and user feedback
- 2026-05-02 trend snapshot covering which tools are gaining visible adoption,
  which workflow patterns are converging, and which claims are still marketing
  without enough lifecycle, authority, or replay evidence
- source inventory covering local clone paths, commits, binary versions, web
  docs, papers, posts, and issue/forum evidence
- explicit list of behaviors Kiln should normalize, reject, or defer

Later ADR gate:

- write or update an ADR only after the canonical plan is refactored and the
  first contract slice is understood
- confirm `managed agent invocation` as the canonical product and contract term
- confirm which provider-native concepts are adapter evidence only
- confirm the foundation's supported adapter families and the required observability
  evidence required for admission

Early market signals to verify during this slice:

- OpenAI positions Codex as a command center for multiple agents, parallel
  work, long-running tasks, isolated worktrees, skills, automations, progress
  review, and configurable security
- Anthropic's multi-agent research architecture emphasizes orchestrator-worker
  patterns, parallel search, separate context windows, memory for long-running
  plans, and production reliability risks
- Claude Code and OpenCode both expose explicit subagent concepts with
  independent context, specialized prompts or descriptions, model/tool controls,
  and automatic or manual invocation
- GitHub Copilot coding agent and Jira integration signal demand for
  asynchronous autonomous work that preserves existing review and approval
  workflows
- Orkes Conductor, Temporal, and Camunda signal enterprise demand for durable,
  observable, retryable, human-in-the-loop agentic workflows rather than
  ungoverned prompt-only autonomy
- OpenHands and similar software-agent control-plane projects signal demand for
  isolated runtimes, scalable agent execution, traceability, and operational
  governance around code-changing agents
- User-facing gaps to evaluate include transparency, inspectable subagent
  conversations, predictable permission boundaries, cost control, cancellation,
  and result traceability

Exit criteria:

- the future ADR input packet cites current sources and local version evidence
- local clone, binary, official-doc, paper, lab-post, and user-feedback evidence
  are clearly separated so implementation mechanics are not confused with
  product positioning
- the 2026-05-02 trend snapshot distinguishes real adoption or implementation
  evidence from vendor positioning and unsourced community claims
- the matrices are complete enough to map at least one Claude-family, one
  Codex-family, and one OpenCode-family child invocation into Kiln's canonical
  request without leaking provider-native semantics into core contracts
- any provider that cannot expose enough authority or lifecycle evidence is
  excluded from the foundation plan or admitted only through a constrained adapter
  profile

## Canonical Sustained Plan

The plan below is the implementation roadmap after Slice 0 and Slice 0.5. It is
not an ADR. It is the working plan that turns the evidence into Kiln-native
slices before any later ADR locks a final decision.

Final decisions applied to every slice:

- Kiln owns the base model: a governed control-plane invocation with runtime
  admission, authority, lineage, lifecycle, replay evidence, transcript
  pointers, usage/cost evidence, and result handoff.
- Provider-native words are adapter vocabulary only. `subagent`, `task`,
  `thread`, `session`, `fork`, `crew`, `workflow`, and `automation` do not
  become core contract names.
- Direct providers and harness-backed providers share one core contract.
- Every provider or harness enters through an admission profile; unsupported,
  ambiguous, or unverifiable behavior fails closed.
- This is a long-term production feature roadmap. The first production
  foundation is intentionally small: one read-only, plan-mode child invocation
  per parent turn. Fanout, writes, peer-to-peer teams, scheduled automation, and
  durable workflows are later professional increments, not discarded scope.
- GUI may be the first usable surface, but GUI is a projection over canonical
  runtime/session events.

### Slice 1: Kiln Doctrine And Vocabulary

Status: completed on 2026-05-02.

State the feature in Kiln terms before creating contracts or adapters.

Doctrine outcome:

- Kiln is not adding "subagents" as a provider feature. Kiln is adding a
  governed invocation primitive for child work.
- The durable unit is the invocation, not the provider's agent object, chat
  thread, task, workflow node, worktree, or background process.
- Runtime admission is part of the feature, not a wrapper around it. Parent
  turns and operator surfaces may request managed work, but Kiln decides
  whether and how the work is admitted.
- Provider behavior is evidence. Kiln contracts are control-plane doctrine.

Canonical vocabulary:

| Term | Meaning | Doctrine |
| --- | --- | --- |
| `ManagedAgentInvocation` | The durable governed unit of child work requested by a parent turn or operator surface and admitted by Kiln runtime. | This is the central product and contract term. |
| `ManagedAgentProvider` | A provider, runtime, CLI harness, cloud product, or internal Sequel harness that can execute admitted managed work. | A provider is not trusted until it passes an admission profile. |
| `ManagedAgentAdapter` | The boundary that maps provider-native behavior into Kiln lifecycle, authority, evidence, and result contracts. | Adapters translate; they do not define core semantics. |
| `ManagedAgentAdapterDescriptor` | The declared capabilities, limits, evidence quality, and unsupported-field behavior of an adapter. | The descriptor lets admission fail closed before execution. |
| `ManagedAgentInvocationRequest` | A surface-neutral request for one managed invocation. | GUI, CLI, TUI, SDK, IDE, and remote surfaces submit the same shape. |
| `AdmissionProfile` | A named policy envelope describing which managed invocation shape is allowed. | The foundation starts with `foundation-readonly-plan`; other profiles come later. |
| `AuthorityProfile` | The admitted tool, permission, sandbox, workspace, network, credential, memory, model, and reasoning envelope. | No child receives implicit parent authority. |
| `CredentialRoute` | The runtime-selected route by which a child may use provider credentials without copying secrets into child state. | Credential access is explicit and auditable. |
| `MemoryAdmission` | The governed context and memory allowed into the child invocation. | Memory is admitted through governors, not prompt stuffing or provider-local memory. |
| `ManagedAgentInvocationRecord` | The durable record linking request, admission, lifecycle, provider metadata, result handoff, and replay evidence. | Replay and audit read this record plus session events. |
| `ManagedAgentLifecycleEvent` | A canonical event describing request, admission, execution, progress, retry, cancellation, timeout, result, failure, or cleanup state. | Provider events map into this vocabulary. |
| `ManagedAgentTranscriptPointer` | A pointer to inspectable provider or harness conversation evidence, with redaction, truncation, persistence, and retention flags. | A transcript pointer is evidence, not the canonical ledger. |
| `ManagedAgentUsageReport` | Token, cost, retry, fallback, and provider usage evidence with explicit unknown values. | Usage is normalized without hiding provider token classes. |
| `ManagedAgentDiagnosticArtifact` | A bounded artifact for timeout, failure, retry, environment, or harness diagnostics. | Diagnostics must be linked without bloating parent context. |
| `ManagedAgentResultHandoff` | The bounded result, artifact pointers, transcript pointer, diagnostic pointers, usage/cost evidence, and memory-write proposals returned to the parent turn. | The parent receives evidence, not raw provider state. |
| `ProviderMetadata` | Provider-native IDs, labels, headers, run IDs, thread IDs, task IDs, child keys, and other adapter-specific evidence. | Provider metadata is preserved but does not become core naming. |

Forbidden core vocabulary:

| Provider-native word | Seen in evidence | Kiln mapping rule |
| --- | --- | --- |
| `subagent` | Claude Code, Claude Agent SDK, OpenCode, OpenClaw, Hermes events | Adapter metadata only. Map to `ManagedAgentInvocation`. |
| `task` | OpenCode, Jules, provider products | Adapter metadata only. A task may request or represent an invocation but is not the core unit. |
| `thread`, `session`, `run` | Codex, Claude-family, OpenCode, GitHub/Codex/Jules-style products | Provider lineage IDs only. Map into `parentSessionId`, `providerInvocationId`, `childSessionId`, and `ProviderMetadata`. |
| `fork`, `worktree`, `cloud sandbox` | Codex, Claude Code, OpenCode, Codex app/cloud, Jules | Adapter capability or workspace isolation metadata, not the invocation model. |
| `crew`, `team`, `agent team` | CrewAI, Claude multi-agent research/product language, market material | Later orchestration vocabulary only. Not allowed in foundation core contracts. |
| `workflow`, `DAG`, `automation` | Temporal, Conductor, Camunda, LangGraph, Microsoft Agent Framework, Codex automations | Future durable orchestration evidence only. Not Slice 1-8 core behavior. |
| `skill` | Claude Code, Codex app/cloud, OWASP Agentic Skills evidence | Tool/capability metadata only. Marketplace or skill execution is a later professional increment. |
| `delegate_task`, `spawn_agent`, `sessions_spawn` | Hermes, Codex CLI, OpenClaw | Provider command names only. Map to adapter execution methods below core. |

Provider-to-Kiln mapping rules:

- Claude Code `subagent`, Claude Agent SDK `subagent`, Codex `spawn_agent`,
  OpenCode `task`, Hermes `delegate_task`, and OpenClaw `sessions_spawn` all
  map to `ManagedAgentInvocation`.
- Provider-native parent/child IDs are never discarded. They are stored as
  `ProviderMetadata` and linked to Kiln lineage fields.
- Provider-native transcripts are not replay authority. Kiln stores canonical
  lifecycle/session evidence and links transcript resources with redaction,
  truncation, persistence, and retention flags.
- Provider-native usage and cost fields are normalized into
  `ManagedAgentUsageReport` while preserving provider token classes and explicit
  `unknown` values.
- Provider-native retry, fallback, timeout, orphan recovery, and cleanup signals
  become lifecycle or diagnostic evidence, not generic failures.

Direct and harness adapter doctrine:

| Adapter family | What it wraps | Same Kiln contract? | Doctrine |
| --- | --- | ---: | --- |
| Direct provider adapter | Provider APIs or SDKs that expose runs, sessions, tools, usage, transcripts, and cancellation directly. | Yes | Map API-native evidence into Kiln request, admission, lifecycle, transcript, usage, and result handoff records. |
| Harness adapter | Local CLI/runtime/harness behavior, stdout/events/files/transcripts, local session IDs, and process control. | Yes | Capture evidence honestly, constrain cwd/sandbox/credentials where possible, and mark unsupported or unverifiable behavior explicitly. |
| Market evidence only | Product surfaces or frameworks without enough API/control evidence. | No runtime admission | Keep as roadmap evidence until an adapter can prove lineage, lifecycle, authority, cancellation, transcript, usage, and result handoff. |

Authority doctrine:

- parent turns request managed work; Kiln runtime admits or denies it
- parent permissions, memory, credentials, cwd, sandbox, network, and write
  scope are never inherited implicitly
- write authority is out of the foundation increment and requires explicit policy plus memory/write
  proposals later
- OpenClaw-style additive auth fallback is rejected for the foundation unless represented
  as a future explicit credential-route policy
- unsupported or ambiguous provider fields fail closed during admission

Evidence doctrine:

- the canonical ledger is Kiln session/lifecycle evidence, not provider chat
  history
- transcript pointers are inspection resources with declared redaction,
  truncation, persistence, and retention behavior
- usage/cost evidence must distinguish provider token classes when available
  and preserve `unknown` instead of inventing numbers
- timeout, retry, fallback, cancellation, orphan recovery, and cleanup evidence
  must remain visible because the pre-slice research found repeated user pain
  around silent completion, stuck children, unclear ownership, and missing
  debuggability
- result handoff returns bounded parent-readable output plus links, artifacts,
  diagnostics, usage, transcript pointers, and memory-write proposals

Naming decision:

- Keep `ManagedAgentInvocation` as the central name. It is clearer and more
  usable than `RegulatedAgentInvocation`, while the doctrine still makes
  regulation explicit through admission, authority, lifecycle, and evidence.
- Use governed/regulatory language in services, policies, docs, and behavior;
  keep the type name product-readable.

Exit criteria:

- this roadmap has one canonical vocabulary table: met
- direct-provider and harness-provider behavior are described as adapter
  mappings, not separate core models: met
- Slice 2 can define contracts without picking Claude, Codex, OpenCode, Hermes,
  or OpenClaw as the foundation: met

Deliverable:

- completed in this roadmap section. Slice 2 can now define the exact foundation
  boundary without reopening provider vocabulary or adapter-family doctrine.

### Slice 2: Foundation Boundary And Non-Boundary

Status: completed on 2026-05-02.

Define the first production foundation as exactly one parent-turn-requested,
read-only, plan-mode managed invocation admitted and executed through runtime.

The foundation request may originate from GUI first for usability, but the
request and events must be surface-neutral so CLI, TUI, SDK, IDE, and remote
surfaces can project the same evidence later.

Foundation principle:

- The foundation is small because it must be correct, replayable, governed, and
  extensible, not because the feature is temporary or prototype-grade.
- The first increment proves the complete control loop for one child invocation:
  request, admission, authority, execution, lifecycle, evidence, result
  handoff, projection, and replay.
- Every later capability must compose with this loop instead of bypassing it.

Admission profile:

| Profile | Allowed shape | Reason |
| --- | --- | --- |
| `foundation-readonly-plan` | One child invocation, one parent turn, plan/read-only execution, bounded timeout, explicit authority profile, transcript or diagnostic pointer, usage when available, result handoff. | Proves the professional substrate without mixing in writes, fanout, scheduling, or provider-native delegation semantics. |

Request boundary:

| Boundary | Foundation decision |
| --- | --- |
| Request origin | Parent turn or operator surface. GUI may expose the first button/control, but it submits the same runtime request shape as CLI, TUI, SDK, IDE, and remote surfaces. |
| Parent scope | Exactly one parent session and one parent turn. |
| Child scope | Exactly one managed child invocation. |
| Execution mode | Plan/read-only only. No workspace mutation, memory mutation, or provider write authority. |
| Provider route | Explicit provider route and adapter kind. No implicit provider selection. |
| Authority | Explicit `AuthorityProfile`; no implicit inheritance of parent tools, credentials, memory, cwd, workspace, network, or write scope. |
| Memory | Governed memory/context admission only. Provider-local memory cannot be the source of truth. |
| Lifecycle | Requested, admitted or denied, started, progress, cancellation, timeout, failure, result handoff, completion, and cleanup evidence must be representable. |
| Transcript | Transcript pointer or diagnostic pointer required, with redaction/truncation/persistence/retention flags when known. |
| Usage | Usage and cost captured when available; unknowns remain explicit. |
| Result | Bounded result handoff to the parent turn, with artifact/resource links instead of unbounded child transcript injection. |

In foundation scope:

- one parent session and one parent turn
- one child invocation
- read-only or plan-mode execution
- explicit provider route and adapter kind
- explicit authority profile
- governed memory admission
- cancellation request and terminal cancellation evidence
- timeout and timeout diagnostic evidence when available
- usage capture when available
- transcript or diagnostic pointer
- result handoff to the parent turn
- surface-neutral projection over canonical runtime/session evidence

Out of scope:

- write authority
- fan-out/fan-in
- DAG orchestration
- peer-to-peer agent teams
- marketplace skill execution
- scheduled automations
- provider-native subagent preservation
- unbounded nested delegation
- OpenClaw-style additive auth fallback

Explicit non-boundaries:

- A GUI button is not the feature. GUI is only the first possible projection and
  request surface.
- A provider CLI wrapper is not the feature. Harnesses are adapters under Kiln
  admission.
- A child chat transcript is not the feature. Transcript pointers are evidence;
  Kiln lifecycle/session records are the replay ledger.
- A task runner is not the feature. Existing worker flags, YAML app routing, or
  provider-local subagent behavior cannot bypass runtime admission.
- A successful child answer is not enough. The foundation must prove authority,
  lifecycle, cancellation, timeout, usage, transcript/diagnostic evidence, and
  result handoff.

Professional quality standard:

- The foundation must follow Sequel/Kiln standards: clean architecture,
  explicit boundaries, no provider leakage into core, no dead compatibility
  hacks, fail-closed admission, and test-first implementation.
- Later slices must be able to add writes, fanout, scheduling, durable
  workflows, and nested teams without rewriting the foundation contract.
- Any provider or harness that cannot expose enough evidence is excluded from
  the foundation increment rather than patched around with prompt conventions.

Exit criteria:

- the foundation has one explicit request path and one explicit result handoff
  path: met
- all deferred behavior is listed as later production increments: met
- GUI behavior is described only as a projection over canonical runtime events:
  met
- the first production increment is framed as professional foundation work, not
  a disposable prototype: met
- Slice 3 can define contracts without reopening execution scope, write
  authority, fanout, or provider-native delegation behavior: met

Deliverable:

- completed in this roadmap section. Slice 3 can now define canonical core
  contracts for the `foundation-readonly-plan` boundary.

### Slice 3: Canonical Core Contracts

Status: completed on 2026-05-02.

Define core contracts before wiring execution.

Contract placement:

- Core owns type definitions and pure validation for managed invocation
  requests, admission records, lifecycle state, authority profiles, result
  handoff, transcript pointers, usage reports, and diagnostic artifacts.
- Runtime owns execution services and adapter orchestration in Slice 4.
- Provider and harness adapters own provider-native mapping below the core
  contract. They do not define canonical semantics.
- GUI, CLI, TUI, SDK, IDE, and remote surfaces own projections and request
  initiation only.

Existing integration points to preserve:

| Existing contract | Current role | Slice 3 decision |
| --- | --- | --- |
| `SessionEventEnvelope` | Canonical session-event envelope with session, sequence, timestamp, turn, parent event, and source. | Managed invocation lifecycle evidence should extend this envelope instead of creating a parallel event stream. |
| `agent_invocation_requested/started/completed/failed/cancelled` | Seed event family already consumed by GUI/TUI projections. | Keep as compatibility seed, but broaden the future event payloads to include admission, authority, transcript, usage, retry, timeout, result handoff, and cleanup evidence. |
| `SessionProviderIdentity` | Provider/model/request identity for routed events and assistant messages. | Reuse for provider/model route where possible; add provider invocation metadata separately so provider IDs do not become core IDs. |
| `SessionTokenUsage` and `SessionCost` | Token and cost evidence for session events. | Reuse or wrap in `ManagedAgentUsageReport` while preserving provider token classes and explicit unknowns. |
| `MemoryProvenance` | Memory source/session/turn/tool/actor provenance. | Child invocation identity must map into provenance through `sessionId`, `turnId`, `actor`, and a future invocation-aware source convention. |
| `MemoryContextAdmission` and `DefaultContextGovernor` audit | Governed memory/context admission evidence. | Child memory admission must use the same governor/audit path, not provider-local memory or prompt stuffing. |

Core contract set:

| Contract | Purpose | Foundation requirement |
| --- | --- | --- |
| `ManagedAgentRegistry` | Lists known managed providers/adapters and their descriptors. | Pure registry lookup; no execution side effects. |
| `ManagedAgentProvider` | Canonical provider identity independent from native provider vocabulary. | Supports direct and harness providers without separate core models. |
| `ManagedAgentAdapterDescriptor` | Declares adapter kind, capabilities, limits, unsupported fields, evidence quality, and admission profiles. | Admission can fail closed before execution. |
| `ManagedAgentInvocationRequest` | Surface-neutral request for one managed invocation. | Includes parent lineage, goal, profile, requested provider route, execution mode, authority hints, memory scope, timeout, and output bounds. |
| `ManagedAgentInvocationPolicy` | Pure policy input describing what is allowed for a request. | Separates requested authority from admitted authority. |
| `ManagedAgentInvocationAdmission` | Runtime decision to admit or deny a request. | Records admitted profile, authority profile, memory admission references, credential route, and denial reason when rejected. |
| `ManagedAgentAuthorityProfile` | Canonical authority envelope for tools, permissions, sandbox, workspace, network, credentials, memory, model, reasoning, and write scope. | Defaults to fail-closed; no implicit parent inheritance. |
| `ManagedAgentInvocationLifecycle` | Canonical lifecycle state model. | Represents requested, admitted, denied, started, progress, retry, cancellation, timeout, result handoff, completion, failure, and cleanup. |
| `ManagedAgentInvocationRecord` | Durable aggregate tying request, admission, lifecycle, provider metadata, evidence, and result handoff together. | Replay and audit use this record plus canonical session events. |
| `ManagedAgentResultHandoff` | Bounded result returned to the parent turn. | Contains summary, resource/artifact links, transcript pointer, diagnostic links, usage report, and memory-write proposals. |
| `ManagedAgentTranscriptPointer` | Inspectable transcript/resource pointer with evidence quality flags. | Must include redaction, truncation, persistence, retention, provider IDs, and access scope when known. |
| `ManagedAgentUsageReport` | Usage, cost, retry, fallback, and token-class evidence. | Preserves provider token classes and explicit `unknown` values. |
| `ManagedAgentDiagnosticArtifact` | Bounded diagnostic evidence for timeout, failure, cleanup, retry, or harness runtime state. | Linked by URI/resource ID instead of injecting large diagnostics into parent context. |
| `ManagedAgentProviderMetadata` | Provider-native IDs, headers, labels, task IDs, thread IDs, child keys, and adapter-specific evidence. | Preserved as metadata; never promoted to core naming. |

Required field groups:

| Group | Fields |
| --- | --- |
| Lineage | `parentSessionId`, `parentTurnId`, `invocationId`, `agentId`, `providerInvocationId`, `childSessionId`, `childTurnId`, `requestEventId`, `admissionEventId`, `resultEventId`, and artifact IDs. |
| Routing | provider route, adapter kind, model route, reasoning profile, credential route, execution mode, cwd/workspace, workspace isolation, timeout, and output bounds. |
| Authority | tool allowlist/denylist, permission profile, sandbox policy, network policy, memory scope, write authority, credential route, unsupported-field rejection, and inherited-authority denial evidence. |
| Memory/context | governed context admission IDs, admitted memory scopes/layers, deferred memory/context evidence, and child memory-write proposal policy. |
| Lifecycle | requested, admitted, denied, started, progress, retry, fallback, cancellation requested, cancellation observed, cancelled, timed out, result handoff, completed, failed, cleanup completed, and cleanup failed. |
| Evidence | transcript pointer, diagnostic artifact pointer, usage/cost report, provider metadata, retry/fallback causes, redaction/truncation flags, retention policy, and unknown-field markers. |

Foundation request shape:

| Field | Foundation rule |
| --- | --- |
| `profile` | Must be `foundation-readonly-plan`. |
| `executionMode` | Must be plan/read-only. |
| `writeAuthority` | Must be false/none. |
| `parentSessionId` and `parentTurnId` | Required. |
| `requestedProviderRoute` | Required, but final route is admitted by runtime. |
| `adapterKind` | Required as direct, harness, or future compatible kind. |
| `authorityHints` | Allowed as request input, but not trusted until converted to `ManagedAgentAuthorityProfile`. |
| `memoryScope` | Required or explicitly none; must pass governed admission. |
| `timeout` | Required and bounded. |
| `resultHandoffPolicy` | Required to prevent unbounded child output injection. |

Contract invariants:

- Core contracts are explicit data contracts and pure validators; they do not
  execute providers, spawn processes, or read provider credentials.
- Request and admission are separate records. A request never implies authority.
- Denial is a first-class result with replayable evidence.
- Provider-native IDs are preserved but cannot replace Kiln lineage IDs.
- Transcript and diagnostic data are pointers/resources with flags, not the
  canonical ledger.
- Usage and cost can be `unknown`, but missing evidence must be explicit.
- The foundation contract must be extensible to later writes, fanout,
  scheduling, worktree/cloud isolation, durable workflows, and nested teams
  without changing the meaning of a single invocation.

Session-event decision:

- Existing `agent_invocation_*` events remain the compatibility seed.
- Slice 6 will decide the exact event-family expansion, but Slice 3 requires
  every event payload to be derivable from `ManagedAgentInvocationRecord`.
- No GUI-specific DTO may be the source of truth for invocation state.
- Existing projections should be able to keep rendering coarse
  requested/started/completed/failed/cancelled states while richer evidence is
  added incrementally.

Exit criteria:

- contracts live in core, outside GUI state and provider adapters: met as a
  design constraint
- contracts are testable without invoking a real provider: met as a design
  constraint through pure request/admission/lifecycle/evidence shapes
- session event payloads preserve enough evidence for replay and inspection:
  met as a requirement for Slice 6 event expansion

Deliverable:

- completed in this roadmap section. Slice 4 can now define runtime admission
  and ownership against these core contract boundaries.

### Slice 4: Runtime Admission And Ownership

Status: completed on 2026-05-02.

Introduce runtime-owned services around invocation admission, execution, and
result handoff.

Runtime ownership principle:

- Runtime owns admission, execution coordination, lifecycle persistence,
  cancellation, timeout, cleanup, and result handoff.
- Core owns contracts and pure validation.
- Adapters execute only admitted work.
- Operator surfaces and parent turns request work but cannot create child work
  directly.
- Existing session infrastructure remains the replay substrate:
  `RuntimeSession.appendSessionEvents` enforces ordered canonical event
  persistence, `RuntimeSessionOrchestrator` owns provider/tool execution flow,
  and `DefaultContextGovernor` owns admitted context.

Existing runtime seams to respect:

| Existing seam | Current role | Slice 4 ownership decision |
| --- | --- | --- |
| `RuntimeSession` | Persists conversation history, session ledger, exact artifacts, canonical session events, active agent state, and optimistic versioning. | Managed invocation records and lifecycle events must persist through runtime session state or a runtime-owned store linked to session events. |
| `RuntimeSession.appendSessionEvents` | Validates `kilnSessionId` and event sequence before appending canonical events. | Managed invocation events must use this ordered event path; no GUI-local event store. |
| `RuntimeSessionOrchestrator` | Coordinates provider calls, routing, tool execution, approval gate, telemetry, and fallback response behavior. | Managed invocation execution is a sibling runtime service, not a GUI wrapper and not provider-owned orchestration. |
| `RuntimeSessionToolExecutor` and approval gate | Enforce tool execution and approval behavior through runtime dependencies. | Child tool authority must be derived by runtime admission and passed into execution ports explicitly. |
| `DefaultContextGovernor` | Projects governed context and records memory admissions. | Child context and memory must pass through the same governor path before execution. |
| `MemoryAuthorityPolicy` and memory mutation services | Enforce scope, layer, and operation authority for model-facing memory access and route durable mutations through governed services. | Child memory read/write authority must be explicit, fail-closed, and separate from generic tool authority. |
| `CredentialPoolFactory`, `CredentialPool`, and pooled adapters | Load provider credentials, health state, lease/outcome/cooldown state, and retry behavior through runtime infrastructure. | Child credential access must be a runtime-selected credential route, not copied secrets, provider-local rotation, or provider-local fallback. |
| Memory lifecycle evaluator and application service | Keep lifecycle evaluation pure and route material lifecycle changes through validated application services. | Managed invocation lifecycle evidence may inform memory lifecycle later, but runtime must not mutate memory lifecycle outside governed services. |
| `runtime-session-event-ledger.ts` | Maps runtime events into canonical session events for surfaces. | Slice 6 should extend this projection family for managed invocation evidence. Slice 4 must require every lifecycle transition to be eventable. |

Expected runtime services and ports:

- `ManagedAgentInvocationService`
- `ManagedAgentAdmissionService`
- `ManagedAgentPolicyEvaluator`
- `ManagedAgentExecutionPort`
- `ManagedAgentResultHandoffService`
- `ManagedAgentProjectionService`

Service ownership:

| Service or port | Owner | Responsibility | Must not do |
| --- | --- | --- | --- |
| `ManagedAgentInvocationService` | Runtime | Orchestrates request validation, admission, record creation, execution dispatch, lifecycle persistence, cancellation/timeout coordination, and result handoff. | Must not call provider-native spawn APIs before admission. |
| `ManagedAgentAdmissionService` | Runtime using core validators | Converts request plus provider descriptor into admitted or denied invocation evidence. | Must not trust requested authority or inherited parent scope. |
| `ManagedAgentPolicyEvaluator` | Core/runtime boundary | Applies admission profiles, authority constraints, memory/context rules, credential-route policy, timeout bounds, and unsupported-field rejection. | Must not execute providers or inspect provider-local state that belongs to adapters. |
| `ManagedAgentExecutionPort` | Runtime port implemented by adapters later | Executes an already admitted invocation and streams lifecycle/evidence updates back to runtime. | Must not broaden authority, choose credentials, or create unmanaged child sessions. |
| `ManagedAgentResultHandoffService` | Runtime | Produces bounded parent-turn result handoff with links, transcript pointer, diagnostics, usage, and memory-write proposals. | Must not inject unbounded child transcript into parent context. |
| `ManagedAgentProjectionService` | Runtime/projection layer | Builds surface-neutral projection records from canonical invocation/session events. | Must not make GUI DTOs the source of truth. |

Runtime responsibilities:

- validate parent request shape
- resolve provider route and adapter descriptor
- derive authority profile
- admit governed memory and context
- select credential route without copying secrets into child state
- enforce memory authority separately from tool authority
- preserve provider credential retry/cooldown semantics as runtime evidence
- persist the invocation record before execution
- emit lifecycle events
- cancel, time out, and clean up child work
- persist result handoff and replay evidence

Foundation runtime flow:

1. Parent turn or operator surface submits `ManagedAgentInvocationRequest`.
2. Runtime validates shape and resolves `ManagedAgentAdapterDescriptor`.
3. `ManagedAgentAdmissionService` evaluates `foundation-readonly-plan`.
4. Runtime derives `ManagedAgentAuthorityProfile`, credential route, timeout,
   memory scope, and result handoff policy.
5. `DefaultContextGovernor` admits or defers child context/memory.
6. Runtime persists `ManagedAgentInvocationRecord` before execution.
7. Runtime emits requested/admitted or denied lifecycle evidence.
8. Runtime calls `ManagedAgentExecutionPort` with only admitted authority.
9. Adapter streams provider-native progress into runtime-owned lifecycle
   updates; runtime records canonical evidence.
10. Runtime handles cancellation, timeout, retry/fallback evidence, and cleanup.
11. `ManagedAgentResultHandoffService` emits bounded parent-turn handoff.
12. `ManagedAgentProjectionService` exposes the same evidence to GUI, CLI, TUI,
    SDK, IDE, and remote surfaces.

Admission fail-closed rules:

- missing parent session, parent turn, profile, provider route, adapter kind, or
  timeout denies admission
- requested write authority denies `foundation-readonly-plan`
- missing credential route denies admission unless the profile explicitly
  allows credentialless diagnostic work
- missing governed memory/context admission evidence denies admission when
  memory scope is requested
- unsupported provider fields deny admission unless the adapter descriptor marks
  them as safely ignored and auditable
- adapters without cancellation or transcript/diagnostic evidence cannot be
  admitted to `foundation-readonly-plan`
- memory read/write authority denies by default unless the admitted profile and
  `MemoryAuthorityPolicy` allow the exact scope, layer, and operation
- provider credential auth failures remain non-retryable unless the credential
  pool marks a later route as explicitly available

Cancellation and timeout ownership:

- Runtime owns cancellation request state, terminal cancellation state, and
  timeout deadlines.
- Adapters may observe and execute cancellation, but they do not define the
  canonical cancellation contract.
- Timeout must produce lifecycle evidence and a diagnostic artifact pointer when
  the adapter can provide one.
- Cleanup success or failure remains visible; it is not hidden behind terminal
  completion.

Result handoff ownership:

- Runtime owns the parent-turn handoff.
- The adapter may provide raw output, transcript IDs, files, logs, usage, and
  diagnostics.
- Runtime normalizes those into bounded summary, resource links, transcript
  pointer, diagnostic artifact pointers, usage report, and memory-write
  proposals.
- Parent context receives the bounded handoff, not raw child state.

Projection ownership:

- GUI may initiate and display the first foundation invocation, but runtime
  events remain the source of truth.
- CLI, TUI, SDK, IDE, and remote surfaces must be able to render the same
  invocation from canonical session/runtime evidence.
- Existing coarse `agent_invocation_*` projections can remain while Slice 6
  expands event detail.

Exit criteria:

- parent agents and operator surfaces can request invocation but cannot bypass
  runtime admission: met
- provider selection, permission profile, tool authority, credentials, and
  memory admission are runtime-owned decisions: met
- provider adapters execute admitted requests but never create unmanaged child
  work directly: met
- cancellation, timeout, cleanup, result handoff, and projection ownership are
  assigned to runtime: met
- Slice 5 can now define adapter taxonomy without giving adapters ownership of
  admission or canonical semantics: met

Deliverable:

- completed in this roadmap section. Slice 5 can now define adapter taxonomy
  and admission profiles against these runtime ownership boundaries.

### Slice 5: Adapter Taxonomy And Admission Profiles

Status: completed on 2026-05-02.

Define adapter kinds before writing the first adapter.

Taxonomy principle:

- Adapters are evidence translators and execution ports, not semantic owners.
- Every adapter is admitted through declared capabilities, evidence quality, and
  fail-closed unsupported-field behavior.
- Direct providers and harness-backed providers share the same core
  `ManagedAgentInvocation` contract. The adapter family changes how evidence is
  gathered, not what Kiln requires.
- Product and framework surfaces that cannot expose enough control-plane
  evidence remain market evidence only until a real adapter can prove the
  admission profile.

Adapter kinds:

| Adapter kind | Shape | Examples | Admission stance |
| --- | --- | --- | --- |
| Direct provider adapter | Calls a provider API or SDK that exposes sessions, runs, usage, cancellation, and transcripts directly. | Claude Agent SDK, future OpenAI/Codex APIs, hosted agent APIs. | Admit only if lineage, lifecycle, authority, cancellation, usage, transcript/diagnostic evidence, and result handoff can be mapped explicitly. |
| Harness adapter | Wraps a local CLI/runtime/harness and captures events, files, stdout, transcripts, and provider-local IDs. | Claude Code CLI, Codex CLI, OpenCode, Hermes, OpenClaw, internal Sequel harnesses. | Admit only if cwd, sandbox/workspace, credentials, cancellation, transcript pointers, cleanup behavior, and provider-local IDs can be constrained or honestly marked unknown. |
| Control-plane comparison adapter | Represents a system whose implementation informs Kiln behavior but is not selected for the foundation proof yet. | Hermes, OpenClaw, OpenHands-style control-plane patterns. | Use for validation and future adapter planning; do not execute foundation work unless promoted to direct or harness adapter and admitted. |
| Market evidence only | Product or framework evidence without sufficient API-level control. | Codex app/cloud without adapter evidence, Jules, GitHub Agent HQ, LangGraph, CrewAI, Temporal, Conductor, Camunda. | Do not admit to the foundation increment. Use as evidence for future orchestration and control-plane needs. |

Capability gates:

| Gate | Required for `foundation-readonly-plan` | Notes |
| --- | --- | --- |
| Lineage | Required | Must expose or reconstruct parent session, parent turn, Kiln invocation ID, provider child ID, and result/artifact IDs. |
| Lifecycle | Required | Must map request, admission, start, progress, terminal state, timeout, cancellation, and cleanup into runtime-owned evidence. |
| Authority | Required | Must accept explicit tool, permission, sandbox/workspace, network, memory, credential, model, and reasoning constraints or fail closed. |
| Cancellation | Required | Must support cancellation request and terminal cancellation evidence, or be rejected for the foundation profile. |
| Timeout | Required | Must support a bounded timeout and terminal timeout evidence. Diagnostic artifact is required when the adapter can provide it. |
| Transcript/diagnostic pointer | Required | Must provide inspectable evidence pointer with redaction, truncation, persistence, and retention flags when known. |
| Usage/cost | Required when available | Must preserve provider token classes and explicit `unknown` values. Cost can be unknown if provider lacks cost evidence. |
| Credential route | Required unless credentialless | Must use runtime-selected credential route or declare credentialless execution. No secret copying into child state. |
| Result handoff | Required | Must return bounded summary and resource/artifact pointers instead of raw child state. |
| Cleanup | Required | Must expose cleanup success/failure or declare cleanup unsupported and fail admission if cleanup is needed. |

Admission profiles:

| Profile | Allowed behavior | Required evidence | Typical use |
| --- | --- | --- | --- |
| `foundation-readonly-plan` | One child, one parent turn, plan/read-only execution, bounded tools, no write authority, bounded timeout, explicit authority profile. | Lineage, lifecycle, cancellation, timeout, transcript/diagnostic pointer, usage when available, credential route, result handoff, cleanup state. | First production foundation proof. |
| `diagnostic-only` | Inspect adapter capability or provider state without executing managed child work. | Capability descriptor, reason execution is not admitted, and diagnostic output. | Provider research, health checks, or explaining why a provider is not admitted. |
| `comparison-only` | Use provider implementation evidence to validate Kiln doctrine without runtime execution. | Source/version evidence and mapped capability gaps. | Hermes/OpenClaw/OpenHands-style control-plane comparison until promoted. |
| `rejected` | No execution. | Denial reason and missing/unsafe capability list. | Providers that cannot expose enough lifecycle, authority, cancellation, transcript, or result evidence. |

Adapter descriptor requirements:

- adapter kind
- provider/native surface name
- supported admission profiles
- supported execution modes
- lifecycle events exposed or reconstructable
- cancellation behavior
- timeout behavior
- transcript and diagnostic evidence behavior
- usage and cost evidence behavior
- credential route behavior
- cwd/workspace/sandbox behavior
- tool and permission constraint behavior
- memory/context behavior
- unsupported-field policy: reject, safely ignore with audit, or unsupported
- cleanup behavior
- known provider-native IDs and metadata fields

Unsupported-field policy:

| Policy | Meaning | Foundation stance |
| --- | --- | --- |
| `reject` | The adapter refuses a requested field it cannot honor. | Preferred default. |
| `ignore-with-audit` | The adapter safely ignores a provider-native field and records that fact. | Allowed only when ignoring cannot broaden authority or hide evidence. |
| `unsupported` | The adapter cannot represent the field safely. | Denies `foundation-readonly-plan`. |

First adapter selection rubric:

| Criterion | Weight | Reason |
| --- | ---:| --- |
| Clean lineage and lifecycle evidence | High | Foundation replay depends on stable parent/child identity and terminal states. |
| Explicit authority constraint support | High | Kiln cannot admit child work if provider/harness authority is implicit. |
| Cancellation and timeout evidence | High | Pre-slice user-pain evidence showed stuck/silent child work is a core risk. |
| Transcript/diagnostic pointer quality | High | Debuggability and audit cannot rely on opaque provider history. |
| Result handoff clarity | High | Parent context must receive bounded evidence, not raw child state. |
| Usage/cost evidence | Medium | Cost must be captured when available and unknown when unavailable. |
| Implementation complexity | Medium | First proof should minimize hidden behavior, not maximize provider coverage. |
| Market importance | Low | Market signal validates direction but does not override control-plane evidence. |

Candidate stance after Slice 5:

- Claude-family remains a strong candidate because official docs expose
  subagents and cost visibility, but it still needs adapter proof for
  child-level attribution and transcript/result handoff.
- Codex local/CLI remains a strong candidate because local implementation
  evidence covers fork/resume, cancellation, rollout-backed history, usage, and
  parent notifications.
- OpenCode remains a strong candidate because local implementation evidence
  covers child sessions, resumability, permission narrowing, cancellation,
  usage/cost, and transcript replay.
- Hermes and OpenClaw remain comparison/control-plane evidence unless promoted
  deliberately to an admitted harness adapter.
- Codex app/cloud, Jules, GitHub Agent HQ, workflow engines, and agent
  frameworks remain market/control-plane evidence until API-level lineage,
  authority, lifecycle, cancellation, transcript, and result-handoff evidence
  exists.

Exit criteria:

- first adapter selection is a data-backed choice, not a provider preference:
  met
- direct and harness adapters share one Kiln contract: met
- providers that cannot meet the admission criteria fail closed: met
- adapter descriptor requirements and unsupported-field policy are explicit:
  met
- Slice 6 can now define event/replay projections without making adapter-native
  events the source of truth: met

Deliverable:

- completed in this roadmap section. Slice 6 can now define session events,
  replay, and projections for admitted adapter evidence.

### Slice 6: Session Events, Replay, And Projections

Status: completed on 2026-05-02.

Extend session evidence so every operator surface can answer what happened
without provider-local knowledge.

Projection principle:

- Canonical session events are the replay ledger for operator surfaces.
- `ManagedAgentInvocationRecord` is the durable aggregate; session events are
  its ordered projection into conversation/session history.
- Provider-native transcripts, logs, thread IDs, run IDs, and task IDs are
  evidence pointers or metadata. They are not the ledger.
- GUI, CLI, TUI, SDK, IDE, and remote surfaces must be able to reconstruct the
  same invocation state from canonical events without provider-local knowledge.
- Existing coarse `agent_invocation_*` events remain compatible while richer
  payloads are added.

Existing projection seams to preserve:

| Existing seam | Current behavior | Slice 6 decision |
| --- | --- | --- |
| `CanonicalSessionEventKind` | Includes `agent_invocation_requested`, `agent_invocation_started`, `agent_invocation_completed`, `agent_invocation_failed`, and `agent_invocation_cancelled`. | Keep these as the stable coarse event family and enrich payloads instead of replacing them immediately. |
| `RuntimeSession.appendSessionEvents` | Enforces `kilnSessionId` and sequence ordering. | Managed invocation events must append through the same ordered path. |
| `session-serializer` and runtime session storage | Persist and reload canonical session events. | Replay must reconstruct invocation state from serialized canonical events. |
| `gateway-contracts` `OperatorSessionEvent` | Surfaces receive canonical event kind plus payload. | New managed invocation evidence must remain payload-driven and surface-neutral. |
| `presentOperatorEventPayload` / `agentPresentation` | Presents coarse invocation events to inline/activity/inspector surfaces. | Keep coarse rendering while adding richer details for admission, authority, transcript, usage, timeout, and handoff. |
| GUI session store timeline | Builds timeline entries from canonical session events. | GUI must continue to derive invocation state from events, not from GUI-local managed-agent state. |
| TUI gateway session mapper | Maps canonical events to activity output when the presentation targets activity surfaces. | TUI must receive the same canonical invocation evidence through gateway frames. |

Required event families for foundation:

| Family | Coarse event compatibility | Required evidence |
| --- | --- | --- |
| Request | `agent_invocation_requested` | `invocationId`, parent lineage, requested profile, requested provider route, adapter kind, input summary, request source. |
| Admission | `agent_invocation_requested` payload or future `agent_invocation_admitted/denied` expansion | admitted/denied status, admitted profile, authority profile summary, credential route, memory admission IDs, denial reason. |
| Start | `agent_invocation_started` | provider route, adapter descriptor ID, attempt, child/provider IDs when known, timeout deadline, admitted execution mode. |
| Progress | future progress expansion or runtime activity events linked by `invocationId` | provider-native progress, step labels, retry/fallback warnings, bounded progress summaries. |
| Retry/fallback | future expansion or started/failed payload fields | attempt count, cause, provider/model fallback, retryable/non-retryable classification. |
| Cancellation | `agent_invocation_cancelled` plus future requested/observed distinction | requested by, requested at, observed at, terminal state, adapter response, descendant behavior when applicable. |
| Timeout | `agent_invocation_failed` with timeout status or future timed-out event | timeout deadline, observed duration, diagnostic artifact pointer, cleanup state. |
| Result handoff | `agent_invocation_completed` | result summary, output message/resource IDs, artifact links, transcript pointer, diagnostic pointers, memory-write proposals. |
| Usage/cost | `cost_updated` linked by `invocationId` or invocation payload usage report | token classes, cost when known, unknown markers, provider billing metadata. |
| Cleanup | future cleanup expansion or terminal payload | cleanup completed/failed, retained artifacts, removed temporary resources, cleanup error. |

Event payload requirements:

| Payload group | Required fields |
| --- | --- |
| Lineage | `invocationId`, `agentId`, `parentSessionId`, `parentTurnId`, `childSessionId` when known, `childTurnId` when known, provider invocation IDs in metadata. |
| Admission | `profile`, `admissionStatus`, `authorityProfileId` or summary, `credentialRouteId`, memory/context admission IDs, denial reason if denied. |
| Provider metadata | provider route, adapter kind, adapter descriptor ID, provider-native IDs, model/reasoning route, workspace/sandbox descriptor. |
| Lifecycle | lifecycle state, attempt, started/completed timestamps or duration, retry/fallback cause, cancellation cause, timeout cause, cleanup status. |
| Evidence pointers | transcript pointer, diagnostic artifact pointers, result artifact/resource links, redaction/truncation/persistence/retention flags. |
| Usage | token usage, provider token classes, cost, billing mode, explicit `unknown` values, usage source. |
| Handoff | bounded result summary, output message ID, parent turn link, memory-write proposal links. |

Replay reconstruction rules:

- Sort canonical events by `kilnSessionId`, `sequence`, timestamp, and event ID
  using existing session-event ordering rules.
- Group invocation events by `invocationId`.
- Reconstruct the current invocation state from the latest lifecycle event and
  attached evidence pointers.
- Preserve denied admissions as terminal invocation records.
- Preserve cancellation request and terminal cancellation separately when both
  are available.
- Treat missing transcript, usage, or cleanup details as explicit `unknown`
  evidence, not absence of state.
- Provider-native IDs may help lookup external evidence, but cannot be required
  to reconstruct Kiln state.

Projection rules:

- GUI, CLI, TUI, SDK, IDE, and remote surfaces read the same canonical events
- provider-native IDs remain adapter metadata
- provider-native transcripts are pointers/resources, not the canonical ledger
- memory writes from children are proposals unless the authority profile grants
  explicit write admission
- low-signal telemetry stays out of inline transcript surfaces unless it is
  necessary for operator action
- high-signal lifecycle changes, failures, cancellations, result handoffs, and
  approval needs can target inline/activity/inspector surfaces
- raw provider or harness output must be summarized and linked as resources
  when it is large, redacted, truncated, or noisy

Surface-specific expectations:

| Surface | Required behavior |
| --- | --- |
| GUI | Timeline derives invocation state from canonical events and shows richer details through inspector/activity surfaces. |
| TUI | Gateway session maps invocation events to activity entries without needing provider-specific logic. |
| CLI | Can render a compact invocation lifecycle and link transcript/diagnostic resources from the same events. |
| SDK/React | Receives stable event payloads usable for custom projections without provider vocabulary. |
| IDE/remote future surfaces | Reuse gateway/operator event frames; no separate invocation state namespace. |

Backward compatibility path:

- Keep the five existing coarse `agent_invocation_*` event kinds during the
  foundation implementation.
- Add richer payload fields first.
- Slice 7 tests should lock reconstruction from the coarse family plus payload
  evidence.
- Later event-kind expansion is allowed only if coarse events become
  insufficient for replay clarity; expansion must preserve projection behavior
  for existing GUI/TUI consumers.

Session/replay quality gates:

- every admitted or denied invocation has at least one canonical session event
- every terminal invocation has completed, failed, cancelled, or timed-out
  evidence
- every result handoff links back to parent session and parent turn
- transcript pointers include redaction/truncation/persistence/retention flags
  when known
- usage reports preserve provider token classes or explicit unknowns
- cleanup state remains visible when the adapter exposes it
- session reload reconstructs the same invocation state as live operation

Exit criteria:

- session reload reconstructs parent-child lineage and lifecycle evidence: met
  as a projection requirement
- GUI renders invocation state from canonical events only: met as a projection
  requirement
- CLI/TUI/IDE future consumers can project the same events without GUI-specific
  DTOs: met as a gateway/operator contract requirement
- coarse event compatibility and richer payload evolution are both documented:
  met
- Slice 7 can now write tests for replay, projection, cancellation, timeout,
  transcript, usage, and result handoff behavior: met

Deliverable:

- completed in this roadmap section. Slice 7 can now turn these event/replay
  requirements into failing tests.

### Slice 7: Test-First Verification Plan

Status: completed on 2026-05-02.

Write failing tests before implementing runtime behavior. Slice 7 defines the
test plan only; the tests themselves are written at the start of Slice 8 so the
first adapter proof begins red and stays inside the foundation boundary.

Test-first principle:

- The first failing tests must describe Kiln-owned admission, lifecycle,
  evidence, and projection behavior before any adapter runtime exists.
- A provider harness can only be proven after core contracts and runtime
  admission fail for the missing managed invocation engine.
- The test plan must exercise the `foundation-readonly-plan` profile only:
  one parent turn, one child invocation, bounded read-only authority, explicit
  provider route, explicit credential route, governed memory/context, bounded
  timeout, cancellation, transcript pointer, usage evidence, result handoff, and
  replayable session evidence.
- No test may require fan-out, DAG execution, write authority, recurring
  automations, provider-native teams, or provider-native vocabulary in core
  names.

Existing seams to extend:

| Surface | Existing evidence | Slice 8 test use |
| --- | --- | --- |
| Core session events | `packages/core/tests/events/session-event.test.ts` covers the coarse `agent_invocation_*` family. | Extend payload and identity assertions for parent/child lineage, admission profile, authority, transcript, usage, timeout, and handoff evidence. |
| Runtime session persistence | `packages/runtime/tests/session/runtime-session.test.ts` and `packages/runtime/tests/session/session-serializer.test.ts` append, order, serialize, and reload canonical session events. | Prove denied, admitted, terminal, cancellation, timeout, and result-handoff events survive reload without provider-local state. |
| Gateway projection | `packages/gateway-contracts/tests/operator-event-presentation.test.ts` renders operator event payloads. | Prove managed invocation details are projected through canonical payloads with redacted/linked evidence. |
| GUI projection | `packages/gui/tests/session-store.test.ts` and `packages/gui/tests/timeline-visibility.test.ts` already render coarse invocation events. | Prove GUI state derives from canonical events only and never from GUI-local managed-agent state. |
| TUI projection | `packages/tui/tests/gateway-session.test.ts` maps gateway session events to terminal activity. | Prove TUI receives the same invocation lifecycle through gateway frames. |
| Context admission | `packages/core/tests/context/governor-memory-admission.test.ts` and `packages/runtime/tests/session/runtime-session-orchestrator.test.ts` lock `DefaultContextGovernor` ownership. | Prove child memory/context admission carries parent lineage and cannot bypass governor evidence. |
| Credential route | `packages/core/tests/agents/credential-pool.test.ts` and runtime provider credential-pool tests cover credential leasing and secret-free status. | Prove managed invocation accepts a credential route reference and never copies secrets into child records/events. |

First failing-test sequence:

| Order | Target file | Required behavior | Expected initial failure |
| ---:| --- | --- | --- |
| 1 | `packages/core/tests/managed-agent/invocation-contracts.test.ts` | `ManagedAgentInvocationRequest`, `ManagedAgentAdmissionDecision`, `ManagedAgentInvocationRecord`, adapter descriptors, authority profile, transcript pointer, diagnostic pointer, usage report, and result handoff preserve the Slice 3 contract. | Managed invocation contract module does not exist. |
| 2 | `packages/core/tests/managed-agent/admission-policy.test.ts` | `foundation-readonly-plan` denies missing provider route, adapter kind, execution mode, permission profile, tool authority, working directory, timeout, credential route or credentialless declaration, and memory scope. | Admission policy does not exist and current coarse session events cannot enforce request completeness. |
| 3 | `packages/runtime/tests/managed-agent/invocation-service.test.ts` | Runtime-owned service is the only path to execute a child invocation; direct adapter execution without an admitted decision is rejected. | Runtime has provider/session plumbing but no managed invocation service boundary. |
| 4 | `packages/runtime/tests/managed-agent/context-and-credential-admission.test.ts` | Child invocation context uses `DefaultContextGovernor` audit evidence and credential route IDs; no secret values or implicit parent memory/write scope enter the child request. | No child-specific governor/credential admission path exists. |
| 5 | `packages/runtime/tests/session/managed-invocation-session-events.test.ts` | Requested, denied, admitted/start, completed, failed, cancelled, timed-out, cleanup, and result-handoff evidence append as canonical session events with stable sequence ordering. | Current event family is coarse and lacks required managed invocation payloads. |
| 6 | `packages/runtime/tests/session/session-serializer.test.ts` | Serialized/reloaded sessions reconstruct denied admissions and admitted terminal states with parent-child lineage, cancellation request, terminal cancellation, timeout, transcript, usage, and handoff evidence. | Serializer preserves current coarse payloads but does not reconstruct the richer managed invocation state. |
| 7 | `packages/gateway-contracts/tests/managed-invocation-presentation.test.ts` | Operator event presentation exposes high-signal invocation state and evidence pointers while keeping raw provider transcript/log output out of inline payloads. | No managed invocation-specific presentation contract exists. |
| 8 | `packages/gui/tests/managed-invocation-projection.test.ts` | GUI timeline/inspector state reconstructs from canonical events only, including denial, cancellation, timeout, usage unknowns, and transcript retention flags. | GUI currently renders coarse entries but does not reconstruct the full managed invocation record. |
| 9 | `packages/tui/tests/managed-invocation-gateway-session.test.ts` | TUI activity projection consumes the same gateway event frames as GUI/remote surfaces and does not need provider-specific logic. | TUI has no managed invocation projection test. |
| 10 | `packages/runtime/tests/managed-agent/result-handoff.test.ts` | Parent receives a bounded result summary plus resource/artifact pointers, not raw child state; child memory writes become proposals unless authority grants writes. | Result handoff contract does not exist. |

Required test fixtures:

- `FakeManagedAgentAdapter` for an admitted direct provider route that returns
  bounded result, transcript pointer, usage report, and cleanup evidence.
- `FakeHarnessAdapter` for a harness-style child session with provider-native
  child IDs and transcript/log pointers.
- `DeniedDescriptorAdapter` that lacks one required capability at a time so
  admission fails closed with replayable denial evidence.
- `TimeoutAdapter` that records a timeout, optional diagnostic artifact pointer,
  and cleanup state.
- `CancellationObserverAdapter` that separates cancellation request time from
  terminal cancellation observation.
- `UnknownUsageAdapter` that reports provider token classes it knows and
  explicit `unknown` values for missing token/cost classes.
- `TranscriptPointerFixture` with redaction, truncation, persistence, retention,
  and external-resource flags.

Verification order for Slice 8:

1. Add core contract and admission tests first.
2. Add runtime admission and no-bypass tests second.
3. Add context/credential admission tests before any adapter execution path.
4. Add session event append, serialization, and reload tests before projection.
5. Add gateway, GUI, and TUI projection tests from canonical events.
6. Add the first adapter proof only after the above tests fail for missing
   production code.

Commands to run when Slice 8 starts implementing tests and code:

```bash
cmd.exe /c "node_modules\.bin\vitest.exe run packages/core/tests/managed-agent/invocation-contracts.test.ts packages/core/tests/managed-agent/admission-policy.test.ts"
cmd.exe /c "node_modules\.bin\vitest.exe run packages/runtime/tests/managed-agent/invocation-service.test.ts packages/runtime/tests/managed-agent/context-and-credential-admission.test.ts packages/runtime/tests/session/managed-invocation-session-events.test.ts packages/runtime/tests/session/session-serializer.test.ts"
cmd.exe /c "node_modules\.bin\vitest.exe run packages/gateway-contracts/tests/managed-invocation-presentation.test.ts packages/gui/tests/managed-invocation-projection.test.ts packages/tui/tests/managed-invocation-gateway-session.test.ts"
cmd.exe /c "bun run typecheck"
cmd.exe /c "bun run test"
```

Out of scope for Slice 8 tests:

- real provider calls, network calls, or live external credentials
- write-authority child execution
- multiple children, parallel fan-out/fan-in, DAG workflows, scheduler behavior,
  recurring automations, and nested teams
- provider selection policy beyond the single adapter proof
- Claude-, Codex-, OpenCode-, Hermes-, or OpenClaw-native terms as core
  contract names

Exit criteria:

- exact failing-test files are named for contracts, admission, runtime service,
  context/credential admission, session replay, gateway projection, GUI
  projection, TUI projection, cancellation, timeout, transcript, usage, and
  result handoff: met
- tests are ordered so the first adapter proof cannot bypass Kiln runtime
  policy: met
- verification gates are tied to the foundation boundary, not future fan-out,
  DAG, write authority, or scheduled automation behavior: met
- Slice 8 can start by writing failing tests before production code: met

Deliverable:

- completed in this roadmap section. Slice 8 can now write the failing tests
  and implement the first adapter proof against the `foundation-readonly-plan`
  boundary.

### Slice 8: First Adapter Proof

Status: completed on 2026-05-04.

Started implementation on 2026-05-02:

- added core managed-invocation contracts for requests, adapter descriptors,
  invocation records, transcript pointers, diagnostics, usage reports, and
  bounded result handoff
- added fail-closed `foundation-readonly-plan` admission policy
- added runtime invocation service boundary so adapters execute only after an
  admitted core decision
- verified the first Slice 8 increment with targeted managed-agent tests and
  full TypeScript typecheck

Continued implementation on 2026-05-03:

- added runtime context/credential admission helper requiring
  `DefaultContextGovernor` audit evidence, explicit child memory/write
  authority, credential route IDs, and secret-free child request/evidence
- added canonical session-event mapping for requested, denied, started,
  completed, cancelled, timed-out, and failed managed invocations
- kept the coarse `agent_invocation_*` event family while adding structured
  `managedInvocationEvidence` payload for child lineage, transcript pointers,
  diagnostics, usage unknowns, and result handoff
- verified the expanded Slice 8 increment with targeted core/runtime
  managed-invocation tests, session serializer/runtime-session regression
  tests, and full TypeScript typecheck

Completed proof on 2026-05-04:

- selected the OpenCode-configured CLI harness path for the first proof because
  the existing CLI subscription boundary exposes lifecycle, cost, cleanup, and
  transcript-relevant events while direct HTTP provider adapters do not yet
  expose managed child-session evidence
- added `ManagedCliHarnessAdapter`, a real runtime adapter around the injected
  `CliSessionFactory` boundary
- proved one admitted `foundation-readonly-plan` invocation through
  `RuntimeManagedAgentInvocationService`
- recorded child session ID, transcript pointer, usage/cost evidence, bounded
  result handoff, timeout diagnostics, and canonical replay events
- kept the proof deterministic with fake CLI sessions; no live provider call or
  external credential is required for the foundation test

Implement exactly one adapter after Slices 1-7 define the contract and tests.

Selection rule:

- choose the adapter that can satisfy `foundation-readonly-plan` with the least hidden
  behavior, the clearest lifecycle evidence, and the cleanest transcript/result
  handoff
- do not choose a provider because its vocabulary matches Kiln; choose it
  because it satisfies the admission profile

Candidate evidence:

- Claude-family surfaces have strong official subagent and cost documentation
  but still need adapter proof for child attribution
- Codex local/CLI has strong implementation evidence for fork/resume,
  cancellation, rollout-backed history, usage, and parent notifications
- OpenCode has strong child-session, permission narrowing, cancellation,
  usage/cost, and transcript-replay evidence
- Hermes/OpenClaw have strong lifecycle, timeout, retry, cleanup, and
  control-plane evidence, but should remain comparison evidence unless selected
  deliberately

Exit criteria:

- one adapter executes an admitted read-only plan invocation: met by
  `ManagedCliHarnessAdapter` configured with provider route `opencode` and
  execution mode `cli-harness`
- lifecycle, timeout, transcript pointer, usage/cost evidence, and result
  handoff are replayable: met through structured `managedInvocationEvidence`
  on canonical `agent_invocation_*` events
- no provider-native term leaks into core contract names: met

Deliverable:

- completed in runtime and tests. Slice 9 can now record the expansion order
  after one replayable single-child path exists.

### Slice 9: Long-Term Expansion Order

Status: completed on 2026-05-04.

Slice 9 closes `01` after the first replayable single-child path. It does not
authorize every expansion immediately; it fixes the order in which later
roadmaps must add capability without weakening the Kiln control-plane boundary.

Post-proof baseline:

- first replayable child path: `ManagedCliHarnessAdapter` configured for
  provider route `opencode` and execution mode `cli-harness`
- admitted profile: `foundation-readonly-plan`
- proven evidence: child session ID, canonical lifecycle events, structured
  `managedInvocationEvidence`, transcript pointer, usage/cost report, timeout
  diagnostics, result handoff, and session replay projection
- proof constraint: deterministic fake CLI sessions; no live provider call or
  external credential is required for the foundation test

Only after one single-child path is replayable:

1. Add write authority through explicit policy and memory/write proposals.
2. Add multiple child invocations with bounded concurrency.
3. Add fan-out/fan-in result aggregation.
4. Add provider-aware scheduling and budget control.
5. Add worktree/cloud-sandbox isolation as adapter capabilities.
6. Add durable workflow replay and human approval gates.
7. Add nested or peer-to-peer agent teams only with explicit controller
   ownership, budget, cancellation, and replay contracts.
8. Add scheduled automations only after durable lifecycle and authority
   evidence are production-grade.

Sustained verification gates:

- every expansion has contract tests before implementation
- parallelism is bounded, observable, cancellable, and replayable
- no child receives implicit parent permissions, memory, credentials, or write
  scope
- provider-specific behavior remains adapter metadata unless promoted through a
  later ADR

Closure decision:

- `01` is now closed as the canonical managed-agent invocation foundation.
- Later work should start a new roadmap or implementation phase rather than
  extending `01` again.
- The next implementation roadmap is
  `docs/roadmap/01.5-managed-agent-write-authority.md`; it begins with
  provider-neutral write-authority proposals and approval boundaries before
  broader managed-agent expansion.

Deliverable:

- completed. Ordered expansion backlog recorded for write authority, bounded
  parallelism, fanout/fanin, scheduling, isolation, durable workflows, nested
  teams, and scheduled automations.
