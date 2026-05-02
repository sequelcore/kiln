# 01 - Kiln-Native Managed Agent Invocation

## Status

Phase 0 planning and Phase 1 Slice 1 doctrine are complete on 2026-05-02.
Ready to start Phase 1, Slice 2: foundation boundary and non-boundary.

Phase 1 must start from the Kiln-native managed agent invocation plan below.
Do not open an ADR yet, do not select the first adapter yet, and do not start
implementation before Slice 2 through Slice 7 have converted the doctrine into
foundation boundaries, contracts, runtime ownership, adapter taxonomy, session
evidence, and tests.

Stable dependency doctrine lives in
`docs/architecture/provider-credential-pools.md`,
`docs/guides/provider-credentials.md`, `docs/architecture/memory.md`,
`docs/guides/memory.md`, and `docs/architecture/context-governance.md`.

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

Status: next.

Define the first production foundation as exactly one parent-turn-requested,
read-only, plan-mode managed invocation admitted and executed through runtime.

The foundation request may originate from GUI first for usability, but the
request and events must be surface-neutral so CLI, TUI, SDK, IDE, and remote
surfaces can project the same evidence later.

In scope:

- one parent session and one parent turn
- one child invocation
- read-only or plan-mode execution
- explicit provider route and adapter kind
- explicit authority profile
- governed memory admission
- cancellation
- timeout
- usage capture when available
- transcript or diagnostic pointer
- result handoff to the parent turn

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

Exit criteria:

- the foundation has one explicit request path and one explicit result handoff path
- all deferred behavior is listed as later production increments
- GUI behavior is described only as a projection over canonical runtime events

Deliverable:

- exact foundation and non-foundation boundary, including request origin, allowed execution
  authority, required evidence, and deferred capabilities

### Slice 3: Canonical Core Contracts

Status: pending Slice 2.

Define core contracts before wiring execution.

Expected contracts:

- `ManagedAgentRegistry`
- `ManagedAgentProvider`
- `ManagedAgentAdapterDescriptor`
- `ManagedAgentInvocationRequest`
- `ManagedAgentInvocationPolicy`
- `ManagedAgentInvocationAdmission`
- `ManagedAgentInvocationLifecycle`
- `ManagedAgentInvocationRecord`
- `ManagedAgentResultHandoff`
- `ManagedAgentTranscriptPointer`
- `ManagedAgentUsageReport`
- `ManagedAgentDiagnosticArtifact`

Required fields:

- lineage: `parentSessionId`, `parentTurnId`, `invocationId`, `agentId`,
  `providerInvocationId`, `childSessionId`, `childTurnId`, and artifact IDs
- routing: provider route, adapter kind, model route, reasoning profile,
  credential route, execution mode, cwd/workspace, and timeout
- authority: tools, permission profile, sandbox, network policy, memory scope,
  write authority, and unsupported-field rejection
- lifecycle: requested, admitted, denied, started, progress, retry,
  result-handoff, completed, failed, cancelled, timed-out, and cleaned-up
- evidence: transcript pointer, diagnostic artifact pointer, usage/cost,
  retry/fallback causes, redaction/truncation flags, and retention policy

Exit criteria:

- contracts live in core, outside GUI state and provider adapters
- contracts are testable without invoking a real provider
- session event payloads preserve enough evidence for replay and inspection

Deliverable:

- core contract design ready for test-first implementation, with direct and
  harness adapters represented through the same provider/adapter descriptors

### Slice 4: Runtime Admission And Ownership

Status: pending Slice 3.

Introduce runtime-owned services around invocation admission, execution, and
result handoff.

Expected services and ports:

- `ManagedAgentInvocationService`
- `ManagedAgentAdmissionService`
- `ManagedAgentPolicyEvaluator`
- `ManagedAgentExecutionPort`
- `ManagedAgentResultHandoffService`
- `ManagedAgentProjectionService`

Runtime responsibilities:

- validate parent request shape
- resolve provider route and adapter descriptor
- derive authority profile
- admit governed memory and context
- select credential route without copying secrets into child state
- persist the invocation record before execution
- emit lifecycle events
- cancel, time out, and clean up child work
- persist result handoff and replay evidence

Exit criteria:

- parent agents and operator surfaces can request invocation but cannot bypass
  runtime admission
- provider selection, permission profile, tool authority, credentials, and
  memory admission are runtime-owned decisions
- provider adapters execute admitted requests but never create unmanaged child
  work directly

Deliverable:

- runtime service and port plan proving that parent turns, GUI, CLI, TUI, SDK,
  IDE, and remote surfaces request work but do not admit or execute unmanaged
  child work

### Slice 5: Adapter Taxonomy And Admission Profiles

Status: pending Slice 4.

Define adapter kinds before writing the first adapter.

Adapter kinds:

| Adapter kind | Shape | Examples | Admission stance |
| --- | --- | --- | --- |
| Direct provider adapter | Calls a provider API or SDK that exposes sessions, runs, usage, cancellation, and transcripts directly. | Claude Agent SDK, future OpenAI/Codex APIs, hosted agent APIs. | Admit only if lineage, lifecycle, authority, cancellation, usage, and result handoff can be mapped explicitly. |
| Harness adapter | Wraps a local CLI/runtime/harness and captures events, files, stdout, transcripts, and provider-local IDs. | Claude Code CLI, Codex CLI, OpenCode, Hermes, OpenClaw, internal Sequel harnesses. | Admit only if cwd, sandbox/workspace, credentials, cancellation, transcript pointers, and cleanup behavior can be constrained or honestly marked unknown. |
| Market evidence only | Product or framework evidence without sufficient API-level control. | Codex app/cloud without adapter evidence, Jules, GitHub Agent HQ, LangGraph, CrewAI, Temporal, Conductor, Camunda. | Do not admit to the foundation increment. Use as evidence for future orchestration and control-plane needs. |

Admission profiles:

- `foundation-readonly-plan`: one child, read-only, plan mode, bounded tools,
  no write authority, bounded timeout, transcript pointer required
- `diagnostic-only`: allowed to inspect but not execute child work when a
  provider lacks cancellation or authority evidence
- `rejected`: provider cannot expose enough lifecycle, authority, or result
  evidence

Exit criteria:

- first adapter selection is a data-backed choice, not a provider preference
- direct and harness adapters share one Kiln contract
- providers that cannot meet the admission criteria fail closed

Deliverable:

- adapter taxonomy, admission profiles, and adapter selection rubric for the
  first proof implementation

### Slice 6: Session Events, Replay, And Projections

Status: pending Slice 5.

Extend session evidence so every operator surface can answer what happened
without provider-local knowledge.

Required event families:

- invocation requested, admitted, denied, and started
- provider progress, provider retry, fallback, and warning
- cancellation requested, cancellation observed, and cancellation terminal state
- timeout observed and diagnostic artifact attached
- result handoff emitted and parent turn linked
- transcript pointer attached with redaction/truncation/persistence flags
- usage/cost attached with provider token classes and unknown values preserved
- cleanup completed or cleanup failed

Projection rules:

- GUI, CLI, TUI, SDK, IDE, and remote surfaces read the same canonical events
- provider-native IDs remain adapter metadata
- provider-native transcripts are pointers/resources, not the canonical ledger
- memory writes from children are proposals unless the authority profile grants
  explicit write admission

Exit criteria:

- session reload reconstructs parent-child lineage and lifecycle evidence
- GUI renders invocation state from canonical events only
- CLI/TUI/IDE future consumers can project the same events without GUI-specific
  DTOs

Deliverable:

- canonical event families and projection rules for replay, GUI display,
  future CLI/TUI/SDK/IDE display, result handoff, transcript pointers, usage,
  cancellation, timeout, and cleanup

### Slice 7: Test-First Verification Plan

Status: pending Slice 6.

Write failing tests before implementing runtime behavior.

Required tests:

- invocation cannot bypass runtime policy
- child invocation has explicit provider route, adapter kind, execution mode,
  permission profile, tool authority, working directory, timeout, credential
  route, and memory scope
- denied admission emits replayable failure evidence
- session reload preserves parent-child lineage and lifecycle evidence
- cancellation request and terminal cancellation are distinct
- timeout attaches a diagnostic artifact pointer when the adapter provides one
- transcript pointer records redaction, truncation, persistence, and retention
  flags
- usage/cost report preserves provider token classes and explicit unknowns
- GUI projection renders from canonical events only

Exit criteria:

- tests fail for the missing managed-agent engine before implementation starts
- verification gates are tied to the foundation boundary, not future fan-out or DAG
  behavior

Deliverable:

- failing test plan and exact test files for contract, runtime admission,
  session replay, projection, cancellation, timeout, transcript, and usage
  behavior

### Slice 8: First Adapter Proof

Status: pending Slice 7.

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

- one adapter executes an admitted read-only plan invocation
- lifecycle, cancellation, transcript pointer, usage/cost evidence, and result
  handoff are replayable
- no provider-native term leaks into core contract names

Deliverable:

- one working adapter proof for `foundation-readonly-plan`, chosen by evidence and
  admission fit rather than provider preference

### Slice 9: Long-Term Expansion Order

Status: pending Slice 8.

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

Deliverable:

- ordered expansion backlog for write authority, bounded parallelism,
  fanout/fanin, scheduling, isolation, durable workflows, nested teams, and
  scheduled automations
