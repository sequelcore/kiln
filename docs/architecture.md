# Kiln Architecture Reference

## 1. Overview

Kiln is a domain-agnostic AI orchestration engine licensed under MIT. It provides a declarative YAML-based configuration system for composing multi-agent workflows that operate across multiple platforms and deployment contexts.

The engine addresses a specific problem: production AI deployments require more than a raw LLM call. They require phase-gated workflows, persistent memory across sessions, quality gate enforcement, multi-user session management, platform-specific message formatting, and budget control. Kiln provides these capabilities as a structured, domain-agnostic runtime.

The core artifact is the **Gateway**: a persistent Bun/Hono process that hosts multiple independent Apps in a single deployment. One process, one port, multiple Apps — each isolated by memory namespace, workspace directory, channel binding, and session lifecycle.

---

## 2. Design Philosophy

**YAML-first configuration.** App behavior is defined in YAML, not code. Teams, agents, workflows, quality gates, routing rules, and memory scopes are all declared in configuration files. TypeScript interfaces serve as the runtime validation layer; they do not encode business logic.

**Domain-agnostic engine.** The engine has no knowledge of any specific domain (coding, scientific research, trading). It knows about phase sequences, gate enforcement, agent tiers, and memory scopes. Domain-specific behavior is introduced through preset YAML files and capability implementations — not through engine conditionals.

**Primitives and composites pattern.** Six primitive interfaces define the fundamental building blocks. Three composite interfaces compose those primitives into deployable units. This separation prevents coupling between concerns and makes the engine extensible without modification.

**Zero external dependencies in the engine layer.** `packages/core/src/engine/` contains only pure TypeScript interfaces with no npm dependencies. Infrastructure implementations (SQLite, Anthropic SDK, Hono) exist in separate bounded contexts and implement the engine interfaces.

**Fail fast at boundaries.** YAML is parsed, mapped to raw types, validated against a schema, and hydrated into typed composites before any runtime operation begins. Validation errors are aggregated and surfaced as `AppLoaderError` before the process starts serving requests.

---

## 3. Engine Primitives

The six primitives are defined in `packages/core/src/engine/domain/`. Each is a pure TypeScript interface with zero dependencies.

### 3.1 Agent

An Agent is a configured LLM instance with a role, a model tier, and a tool access policy.

```typescript
export type AgentTier = "reasoning" | "coding" | "fast";

export interface Agent {
  readonly name: string;
  readonly tier: AgentTier;
  readonly tools: readonly string[];
  readonly systemPrompt?: string;
  readonly structured?: boolean;
  readonly count?: number;
  readonly sandbox?: boolean;
}
```

Tiers are resolved to concrete provider and model combinations at runtime by the `ProviderRegistry`. The tier system decouples configuration from provider specifics.

| Tier | Default Model | Role | Tool Access | Output |
|------|--------------|------|-------------|--------|
| `reasoning` | Opus 4.6 | Planning, evaluation, review | Zero tools | Structured JSON only |
| `coding` | Sonnet 4.6 | Implementation, tool execution | Full access | Free-form + tool calls |
| `fast` | Haiku 4.5 | Classification, compression, summaries | Read-only | Free-form |

The `count` field declares parallel worker instances. The `sandbox` field enables per-agent filesystem and network isolation policies. The `structured` field instructs the provider adapter to enforce JSON schema output.

### 3.2 Capability

A Capability is an MCP tool that agents can invoke, declared with safety annotations that drive engine policies.

```typescript
export interface CapabilityAnnotations {
  readonly readOnly?: boolean;
  readonly destructive?: boolean;
  readonly idempotent?: boolean;
}

export interface Capability {
  readonly name: string;
  readonly description: string;
  readonly schema: Record<string, unknown>;
  readonly tags: readonly string[];
  readonly annotations?: CapabilityAnnotations;
  readonly type?: string;
  readonly targetApp?: string;
  readonly task?: string;
  readonly timeout?: number;
}
```

The `type: "delegation"` variant enables cross-app cognitive delegation. When `type` is `"delegation"`, `targetApp` and `task` are required. The Gateway's `DelegationRegistry` resolves the target at startup and the `DelegationHandler` executes the call with schema validation.

Annotation semantics: `readOnly` tools run in parallel without locks; `destructive` tools require approval gates; `idempotent` tools are safe to retry. Unannotated capabilities default to `destructive: true` when loaded from marketplace packages.

### 3.3 Workflow

A Workflow is a configurable sequence of named phases with quality gates enforced at transitions.

```typescript
export interface Gate {
  readonly requires: readonly string[];
}

export interface Workflow {
  readonly phases: readonly string[];
  readonly gates: Record<string, Gate>;
  readonly maxIterations?: number;
}
```

Phases are plain strings. The engine enforces ordering and gate requirements without knowing the semantic meaning of any phase name. A gate with `requires: ["human_approval"]` pauses execution and waits for an explicit `approve()` or `reject()` call from the session consumer.

### 3.4 Memory

Memory provides unified, scope-based storage across five isolation boundaries.

```typescript
export type MemoryScope =
  | "user"
  | `agent:${string}`
  | `team:${string}`
  | `project:${string}`
  | "org";

export interface MemoryEntry {
  readonly id: string;
  readonly content: string;
  readonly tags: readonly string[];
  readonly createdAt: Date;
  readonly metadata?: Record<string, unknown>;
}

export interface Memory {
  store(scope: MemoryScope, entry: MemoryEntry): Promise<string>;
  recall(scope: MemoryScope, query: string, budget?: number): Promise<MemoryEntry[]>;
  forget(scope: MemoryScope, id: string): Promise<void>;
}
```

| Scope | Backend | Sync | Purpose |
|-------|---------|------|---------|
| `user` | SQLite + FTS5 at `~/.kiln/memory.db` | Local | User preferences, standards |
| `agent:{role}` | SQLite + FTS5 at `~/.kiln/agents/{role}.db` | Local | Per-role patterns with exponential decay |
| `team:{name}` | SQLite + FTS5 at `~/.kiln/teams/{name}.db` | Local | Team-specific conventions |
| `project:{path}` | Gzipped JSONL in `{projectDir}/` | Git-synced | Project knowledge, shared across developers |
| `org` | Gzipped JSONL in `{projectDir}/org/` | Git-synced | Organization-wide standards |

Auto-capture: agents decide what to store after each action. Auto-recall: all scopes are queried with the current task context on each turn. Progressive disclosure: compact index first, timeline on request, full detail on demand. Token budgets prevent context overflow. `<private>` tags are stripped before writes to git-synced scopes.

### 3.5 Task

A Task is a unit of work in a tree structure, with a scoring formula and three exploration actions.

```typescript
export type TaskStatus = "proposed" | "active" | "completed" | "pruned";
export type TreeAction = "deepen" | "branch" | "prune";

export interface Task {
  readonly id: string;
  readonly statement: string;
  readonly status: TaskStatus;
  readonly parentId?: string;
  readonly depth: number;
  readonly priority: number;
  readonly children: readonly Task[];
  readonly evidence: readonly string[];
}
```

Scoring formula: `priority * complexity_discount * evidence_bonus`. The three tree actions are: `deepen` (create a subtask at depth + 1), `branch` (create an alternative at the same depth), and `prune` (abandon the task with a reason). A configurable `maxDepth` prevents unbounded recursion. The `BatchExecutor` selects batches of tasks for concurrent execution across `parallelWorkers` coding-tier agents.

### 3.6 Channel

A Channel is an input/output adapter that connects the engine to an external platform.

```typescript
export type MessageFormat = "short" | "full" | "structured";

export interface Channel {
  readonly name: string;
  readonly defaultFormat: MessageFormat;
  receive(message: IncomingMessage): Promise<void>;
  send(response: OutgoingMessage): Promise<void>;
  stream(events: AsyncIterable<EngineEvent>): Promise<void>;
}
```

Agents produce content without knowledge of the destination platform. The channel adapter formats output for its target: `short` for character-constrained platforms (WhatsApp/SMS), `full` for rich-text platforms (web/Slack), and `structured` for machine consumers (REST/SSE).

| Adapter | Format | Transport |
|---------|--------|-----------|
| `CliChannel` | full | stdin/stdout |
| `WebChannel` | full | WebSocket (Hono) |
| `WhatsAppChannel` | short | WhatsApp Business API |
| `SlackChannel` | full | Slack Bot Events + Web API |
| `ApiChannel` | structured | HTTP REST + SSE |

The `EventBridge` converts the synchronous `EventBus.emit()` push model to an `AsyncIterable<EngineEvent>` pull model for consumption by `Channel.stream()`.

---

## 4. Engine Composites

Three composite interfaces compose the primitives into deployable units. Each composite is defined in `packages/core/src/engine/composites/` and carries a corresponding `validate*()` function that enforces referential integrity before runtime.

### 4.1 Team

A Team is a self-contained execution unit. Teams operate independently; they do not share agents or workflows with other teams in the same App.

```typescript
export interface QualityGate {
  readonly name: string;
  readonly command: string;
  readonly description: string;
  readonly required: boolean;
}

export interface Team {
  readonly name: string;
  readonly agents: Record<string, Agent>;
  readonly workflow: Workflow;
  readonly capabilities: readonly Capability[];
  readonly qualityGates: readonly QualityGate[];
  readonly knowledge?: TeamKnowledge;
}
```

`validateTeam()` enforces: at least one agent, at least one workflow phase, all agent tool references must resolve to declared capabilities, all gate phase references must exist in the workflow phase list.

### 4.2 Router

A Router dispatches incoming messages to teams using a three-layer priority chain.

```typescript
export interface PatternRule {
  readonly match: string;
  readonly team: string;
}

export interface Router {
  readonly rules: readonly PatternRule[];
  readonly classifier?: Agent;
  readonly fallback: string;
}
```

Routing layers in priority order:

1. **Pattern rules** — regex matching against the incoming message. Deterministic, zero cost. Handles approximately 80% of inputs.
2. **Classifier agent** — a `fast`-tier LLM call for inputs that match no pattern rule. Handles approximately 15% of inputs.
3. **Fallback team** — a statically configured team name for all unresolved inputs. Handles the remaining 5%.

`validateRouter()` enforces: `fallback` must be a non-empty string, all `match` values must be valid regular expressions, the classifier agent (if present) must have tier `"fast"`.

### 4.3 App

An App is the top-level deployment unit. It composes teams, a router, memory configuration, and channel bindings.

```typescript
export interface MemoryConfig {
  readonly scopes: readonly MemoryScope[];
  readonly backend: string;
  readonly sync?: string;
}

export interface App {
  readonly name: string;
  readonly teams: Record<string, Team>;
  readonly router: Router;
  readonly memory: MemoryConfig;
  readonly channels: readonly string[];
}
```

`validateApp()` enforces: at least one team, at least one channel, at least one memory scope, router fallback references an existing team name, all router rule team references resolve to existing team names. It then delegates to `validateTeam()` and `validateRouter()` for each nested composite.

---

## 5. YAML Configuration

Apps are configured in YAML files. The loader pipeline operates in three stages: parse, validate, hydrate.

### 5.1 Loader Pipeline

```
YAML string
    |
    v
yaml.parse()           -- raw unknown structure
    |
    v
mapApp()               -- typed Raw* intermediaries, field-level error collection
    |
    v
AppLoaderError?        -- thrown if any mapping errors were collected
    |
    v
validateAppGraph()     -- referential integrity checks via validateApp()
    |
    v
App                    -- typed, validated composite ready for runtime
```

`parseAppYaml(content: string): App` is the single public entry point. `AppLoaderError` aggregates all field-level errors across the entire document so the operator sees every problem in one pass.

Source: `packages/core/src/engine/loader/app-loader.ts`

### 5.2 Example App YAML

```yaml
name: my-app
channels: [web, cli]

memory:
  scopes: [user, "agent:*", "project:*"]
  backend: sqlite+fts5
  sync: git

router:
  rules:
    - match: "bug|fix|error"
      team: hotfix
  classifier:
    tier: fast
  fallback: development

teams:
  development:
    agents:
      architect:
        tier: reasoning
        tools: []
        structured: true
      worker:
        tier: coding
        count: 2
        sandbox: true
        tools: [memory_save, phase_advance, verify_run]
    workflow:
      phases: [analyze, research, architect, implement, verify, synthesize]
      gates:
        architect:
          requires: [human_approval]
        verify:
          requires: [tests_pass, typecheck, lint]
    capabilities:
      - name: memory_save
        description: Save a memory entry
        schema: {}
        tags: [memory]
      - name: phase_advance
        description: Advance to the next workflow phase
        schema: {}
        tags: [workflow]
      - name: verify_run
        description: Execute quality gates
        schema: {}
        tags: [verification]
    qualityGates:
      - name: typecheck
        command: tsc --noEmit
        description: TypeScript type checking
        required: true
```

### 5.3 Presets

A preset is a complete, named YAML configuration for a specific domain. Presets demonstrate the engine's domain-agnosticism: distinct domains with distinct vocabulary use the same six primitive interfaces and three composite interfaces with zero engine-layer modifications.

Consumer applications ship preset YAML files that wire into Kiln's runtime. The `loadPresetConfig()` function bridges an `App` composite to an `OrchestratorConfig` for Mode A sessions.

---

## 6. Runtime Modes

The Gateway supports two distinct runtime modes. The mode is determined per App by the `mode` field in `gateway.yaml`.

### 6.1 Mode A — Claude Code Sessions

Mode A delegates execution to Claude Code via the `@anthropic-ai/claude-agent-sdk`. It is used for deep, phase-gated coding and research workflows.

```
Incoming request
    |
    v
Pre-session setup
  -- Domain detection (project file scanning)
  -- Memory recall (all scopes, task-scoped query)
  -- System prompt construction
  -- MCP server configuration (stdio path resolution)
    |
    v
Agent SDK query()
  -- Returns AsyncGenerator<SDKMessage>
  -- MCP server provides tools over stdio
  -- Events stream to web console via WebSocket
    |
    v
Post-session teardown
  -- Extract learnings from session events
  -- Write new memory entries to appropriate scopes
  -- Generate session summary report
  -- Git-sync project and org memory scopes
```

Mode A requires an Anthropic API key or a BYOK provider key. It operates single-session-per-task. The `PresetLoader` bridges the `App` composite to an `OrchestratorConfig` by extracting workflow phases, `human_approval` gate detection, and parallel worker count from the target team.

### 6.2 Mode B — Provider-Adapter Sessions

Mode B is used by multi-user conversational Apps. It calls provider adapters directly without spawning a subprocess.

```
Incoming message (WhatsApp / Slack / API / Web)
    |
    v
ChannelRouter -- identity resolution, pattern matching
    |
    v
Budget middleware -- GET budgetEndpoint; enforce tier limits
    |
    v
ModeBOrchestrator.processMessage()
  -- Load session from SessionRegistry (or create new)
  -- Recall memory (user scope)
  -- Append to conversation history
  -- Call provider adapter directly
  -- Report token usage (POST usageEndpoint, fire-and-forget)
    |
    v
Channel adapter -- format and deliver response
```

Mode B supports concurrent sessions keyed by `appName:userId`. The `SessionRegistry` manages idle timeouts and cleanup. Billing logic (subscriptions, invoices) remains in the product's backend API; the engine only enforces budgets via the declared endpoints.

**Budget enforcement** is declared per App in YAML:

```yaml
billing:
  budgetEndpoint: https://api.example.com/billing/budget/{userId}
  usageEndpoint: https://api.example.com/billing/usage/{userId}
  overBudgetMessage: "You have reached your monthly limit."
  tiers:
    free:    { agents: [fast] }
    pro:     { agents: [fast, coding] }
    premium: { agents: [fast, coding, reasoning] }
```

`checkBudget()` is fail-open: if the budget endpoint is unreachable, the call proceeds. `reportUsage()` is fire-and-forget. `checkTier()` enforces the agent tier allowed for the user's subscription tier synchronously.

---

## 7. Orchestration

### 7.1 PhaseMachine

`PhaseMachine` (`packages/core/src/orchestrator/phase-machine.ts`) is a linear state machine over a configurable phase sequence.

States: `idle`, `running`, `awaiting_approval`, `completed`, `failed`, `cancelled`.

Transitions:
- `start()` — `idle` -> `running`
- `advance(gateResult?)` — advances to the next phase if gates pass; returns a `Promise<Phase | null>` when an approval gate is encountered
- `approve()` — `awaiting_approval` -> `running`, advances past the approval phase
- `reject(reason)` — `awaiting_approval` -> `running`, stays on the current phase
- `fail(error)` — any -> `failed`
- `cancel()` — any -> `cancelled`

The approval phase is derived from `OrchestratorConfig.approvalAfterPhase`. If a gate's `requires` array contains `"human_approval"`, the preset loader sets this field automatically.

`PhaseChangedEvent` is emitted on every successful transition. `ApprovalRequestedEvent` and `ApprovalReceivedEvent` are emitted at the approval gate. `ErrorEvent` is emitted on gate failure.

### 7.2 Orchestrator

`Orchestrator` (`packages/core/src/orchestrator/orchestrator.ts`) is the top-level session coordinator. It owns the `PhaseMachine`, `EventBus`, `CostTracker`, `TaskTree`, `BatchExecutor`, `ProviderRegistry`, and `GitSyncManager`.

Key responsibilities:

- **Session lifecycle** — `start(task)` generates a session ID and starts the phase machine.
- **Plan loading** — `loadPlan(plan)` hydrates the `TaskTree` from the Architect's structured JSON output.
- **Implement loop** — `runImplementLoop(handler)` selects task batches and executes them concurrently via `BatchExecutor`. Results carry evidence strings that update task scoring.
- **Verification** — `runVerification(gates, cwd, fixHandler?)` instantiates a `GateRunner` and `VerificationLoop`, executes the verification loop, and stores the result.
- **Memory sync** — `initMemorySync(projectPath)` and `flushMemory(store)` manage git-synced memory through `GitSyncManager`.

The `ArchitectPlan` interface defines the reasoning agent's structured output:

```typescript
export interface ArchitectPlan {
  readonly tasks: readonly {
    readonly id: string;
    readonly statement: string;
    readonly priority: number;
    readonly parentId: string | null;
  }[];
  readonly approach: string;
  readonly risks: readonly string[];
  readonly estimatedComplexity: string;
}
```

### 7.3 BatchExecutor

`BatchExecutor` selects tasks from the `TaskTree` in batches up to `parallelWorkers` in size. Within a batch, each task is assigned to a worker index. Workers are aware of their siblings in the batch (sibling context prevents duplicate work). Completed tasks return evidence strings and a `success` flag that update the scoring of subsequent batch selections.

---

## 8. Agent Tiers and Policies

| Property | `reasoning` | `coding` | `fast` |
|----------|-------------|----------|--------|
| Default model | Opus 4.6 | Sonnet 4.6 | Haiku 4.5 |
| Tools | None | Full capability set | Read-only capabilities |
| Output format | Structured JSON | Free-form + tool calls | Free-form |
| Sandbox | Read-only filesystem | Read-write within workspace | No filesystem access |
| Network | None during implementation | Package managers + full web during research | None |
| Parallel instances | 1 | Configurable via `count` | 1 |

The `reasoning` tier has zero tools by design. It receives context, produces a structured plan, and exits. It never executes tool calls. This prevents it from short-circuiting the plan with premature implementation actions.

The `fast` tier serves as the classifier in the Router when an LLM classifier is configured. Its low latency and low cost make it suitable for high-frequency routing decisions.

Provider SDKs map tiers to models through `ProviderRegistry`. BYOK (Bring Your Own Key) allows substituting any provider for any tier at the gateway configuration level.

---

## 9. Dependency Rules

These rules are enforced by convention and package boundary.

1. **Engine primitives have zero external dependencies.** `packages/core/src/engine/domain/` contains only TypeScript `interface` and `type` declarations.
2. **Application layer depends on engine interfaces, not on infrastructure.** The orchestrator, tree manager, and phase machine consume engine interfaces; they do not import from `agents/infrastructure/` or `memory/`.
3. **Infrastructure implements engine interfaces.** SQLite stores, provider adapters, and Hono routes implement engine interfaces without the engine knowing about their specifics.
4. **No cross-context imports.** Bounded contexts communicate through shared kernel types (`packages/core/src/engine/index.ts`), not through direct cross-directory imports.
5. **Provider SDKs are restricted to adapter implementations.** `@anthropic-ai/sdk`, `openai`, and similar packages appear only in `packages/core/src/agents/infrastructure/`.
6. **Channel adapters are restricted to channel implementations.** Platform-specific SDKs and webhook logic appear only in `packages/runtime/src/channels/`.
7. **`@kilnai/runtime` depends on `@kilnai/core` only, never the reverse.**

---

## 10. Bounded Contexts

| Context | Package | Location | Purpose |
|---------|---------|----------|---------|
| `engine` | `@kilnai/core` | `packages/core/src/engine/` | 6 primitives + 3 composites + YAML loader + gateway config types. Zero external dependencies. |
| `orchestrator` | `@kilnai/core` | `packages/core/src/orchestrator/` | Phase machine, orchestrator, configurable phase sequence and gate enforcement. |
| `agents` | `@kilnai/core` | `packages/core/src/agents/` | Provider adapter interface and implementations: Anthropic, OpenAI, DeepSeek, Ollama. |
| `memory` | `@kilnai/core` | `packages/core/src/memory/` | Scoped storage implementations: SQLite + FTS5, gzipped JSONL, git sync. |
| `tree` | `@kilnai/core` | `packages/core/src/tree/` | Task tree manager: scoring, batch selection, deepen/branch/prune actions. |
| `domain` | `@kilnai/core` | `packages/core/src/domain/` | Domain registry, YAML schema, marketplace types and security validation. |
| `sandbox` | `@kilnai/core` | `packages/core/src/sandbox/` | Per-agent filesystem allowlists and network proxy policies. |
| `verification` | `@kilnai/core` | `packages/core/src/verification/` | Gate runner, verification loop (Ralph pattern): test, lint, type-check. |
| `events` | `@kilnai/core` | `packages/core/src/events/` | EventBus: synchronous emit with typed subscriber dispatch (16 event types). |
| `cost` | `@kilnai/core` | `packages/core/src/cost/` | Per-role, cache-aware cost tracking. |
| `channels` | `@kilnai/runtime` | `packages/runtime/src/channels/` | Channel adapters (CLI, Web, WhatsApp, Slack, API), EventBridge, ChannelRegistry, ChannelRouter, MessageFormatter. |
| `gateway` | `@kilnai/runtime` | `packages/runtime/src/gateway/` | Gateway runtime: multi-App loading, per-App isolation, Mode B route mounting, budget middleware, cross-app delegation. |
| `session` | `@kilnai/runtime` | `packages/runtime/src/session/` | Mode B session management: ModeBSession, ModeBOrchestrator, SessionRegistry. |
| `tenant` | `@kilnai/runtime` | `packages/runtime/src/tenant/` | Multi-tenant management: TenantRegistry, system prompt builder, phone-to-tenant resolution. |

---

## 11. Event Streaming

16 event types are emitted by the engine and broadcast to all connected channels.

| Event | Key Payload Fields |
|-------|--------------------|
| `phase_changed` | `phase`, `phaseName`, `phaseDescription` |
| `phase_completed` | `phase`, `duration`, `gates` |
| `task_created` | `taskId`, `statement`, `depth` |
| `task_started` | `taskId`, `workerId` |
| `task_completed` | `taskId`, `action`, `result` |
| `task_pruned` | `taskId`, `reason` |
| `tool_called` | `toolName`, `args` |
| `tool_result` | `toolName`, `output` |
| `gate_result` | `gate`, `passed`, `output` |
| `memory_captured` | `scope`, `tags`, `preview` |
| `memory_recalled` | `scope`, `count` |
| `approval_requested` | `description` |
| `approval_received` | `approved` |
| `cost_update` | `role`, `tokens`, `cost` |
| `error` | `message`, `code`, `recoverable` |
| `session_completed` | `summary`, `totalCost` |

`WebChannel` forwards events as WebSocket messages to the console. `CliChannel` formats them for stdout. `ApiChannel` delivers them as SSE frames. The `EventBridge` component converts the synchronous `EventBus` push model to `AsyncIterable<EngineEvent>` for the `Channel.stream()` interface.

Source: `packages/core/src/events/event-bus.ts`

---

## 12. Project Structure

```
kiln/
├── packages/
│   ├── core/                              # Engine layer + infrastructure
│   │   └── src/
│   │       ├── engine/
│   │       │   ├── domain/               # 6 primitives (zero deps)
│   │       │   ├── composites/           # 3 composites + validate*()
│   │       │   ├── loader/               # app-loader.ts, preset-loader.ts
│   │       │   └── gateway/              # gateway-config.ts, mode-b-config.ts, delegation-config.ts
│   │       ├── orchestrator/             # phase-machine.ts, orchestrator.ts
│   │       ├── agents/
│   │       │   └── infrastructure/       # anthropic.ts, openai.ts, deepseek.ts, ollama.ts
│   │       ├── memory/                   # sqlite-store.ts, project-store.ts
│   │       ├── tree/                     # task-tree.ts
│   │       ├── events/                   # event-bus.ts
│   │       ├── cost/                     # cost-tracker.ts
│   │       ├── sandbox/                  # policies.ts
│   │       ├── verification/             # verification-loop.ts
│   │       └── domain/                   # domain-registry.ts, yaml-schema.ts, marketplace.ts
│   └── runtime/                          # Gateway + channels
│       └── src/
│           ├── gateway/                  # gateway-server.ts, gateway-routes.ts, app-resolver.ts
│           ├── session/                  # mode-b-session.ts, mode-b-orchestrator.ts, session-registry.ts
│           ├── tenant/                   # tenant-registry.ts, system-prompt-builder.ts
│           └── channels/                 # cli-, web-, whatsapp-, slack-, api-channel.ts
├── docs/
│   ├── architecture.md                   # This document
│   ├── gateway.md                        # Gateway runtime reference
│   ├── channels.md                       # Channel adapter reference
│   ├── marketplace.md                    # Domain marketplace reference
│   └── preset-format.md                  # Preset YAML format reference
├── CLAUDE.md
└── package.json
```
