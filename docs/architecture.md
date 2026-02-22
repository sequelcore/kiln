# Kiln Architecture Reference

## 1. Overview

Kiln is a domain-agnostic AI orchestration engine licensed under MIT. It provides a declarative YAML-based configuration system for composing multi-agent workflows that operate across multiple platforms and deployment contexts.

The engine addresses a specific problem: production AI deployments require more than a raw LLM call. They require phase-gated workflows, persistent memory across sessions, quality gate enforcement, multi-user session management, platform-specific message formatting, and budget control. Kiln provides these capabilities as a structured, domain-agnostic runtime.

The core artifact is the **Gateway**: a persistent Bun/Hono process that hosts multiple independent Apps in a single deployment. One process, one port, multiple Apps -- each isolated by memory namespace, workspace directory, channel binding, and session lifecycle.

---

## 2. Design Philosophy

**YAML-first configuration.** App behavior is defined in YAML, not code. Teams, agents, workflows, quality gates, routing rules, and memory scopes are all declared in configuration files. TypeScript interfaces serve as the runtime validation layer; they do not encode business logic.

**Domain-agnostic engine.** The engine has no knowledge of any specific domain (coding, scientific research, trading). It knows about phase sequences, gate enforcement, agent tiers, and memory scopes. Domain-specific behavior is introduced through preset YAML files and capability implementations -- not through engine conditionals.

**Primitives and composites pattern.** Seven primitive interfaces define the fundamental building blocks. Three composite interfaces compose those primitives into deployable units. This separation prevents coupling between concerns and makes the engine extensible without modification.

**Zero external dependencies in the engine layer.** `packages/core/src/engine/` contains only pure TypeScript interfaces with no npm dependencies. Infrastructure implementations (SQLite, Anthropic SDK, Hono) exist in separate bounded contexts and implement the engine interfaces.

**Fail fast at boundaries.** YAML is parsed, mapped to raw types, validated against a schema, and hydrated into typed composites before any runtime operation begins. Validation errors are aggregated and surfaced as `AppLoaderError` before the process starts serving requests.

---

## 3. Engine Primitives

The seven primitives are defined in `packages/core/src/engine/domain/`. Each is a pure TypeScript interface with zero dependencies.

### 3.1 Agent

An Agent is a persona with expertise. Identity fields (name, role, goal, backstory) are assembled into a system prompt by `assembleAgentPrompt()` in a deterministic order: identity, backstory, instructions, team context, capabilities, quality gates.

```typescript
export type AgentTier = "reasoning" | "coding" | "fast";

export interface Agent {
  readonly name: string;          // Persona name (e.g., "Aria", "Marcus")
  readonly role: string;          // Expertise / function (e.g., "Senior Architect")
  readonly goal: string;          // What this agent is trying to achieve
  readonly backstory?: string;    // Personality, perspective, behavioral boundaries
  readonly tier: AgentTier;       // Model class
  readonly tools: readonly string[];  // Capability references (can be [])
  readonly instructions?: string; // Operating rules and constraints
  readonly structured?: boolean;  // Require JSON output
  readonly count?: number;        // Parallel instance pool size
  readonly sandbox?: boolean;     // Enable filesystem/network isolation
  readonly modalities?: readonly Modality[];  // Supported content types (defaults to ["text"])
}
```

System prompt auto-assembly order:

1. Identity: `"You are {name}, {role}. Your goal: {goal}"`
2. Backstory: `"{backstory}"` (if provided)
3. Instructions: `"## Operating Rules\n{instructions}"` (if provided)
4. Team context: `"Team '{teamName}', {mode} mode. Teammates: {name + role for each}"`
5. Capabilities: `"## Available Tools\n{capability descriptions}"`
6. Quality gates: `"## Quality Standards\n{gate descriptions}"` (if applicable)

Tiers are resolved to concrete provider and model combinations at runtime by the `ProviderRegistry`. The tier system decouples configuration from provider specifics.

| Tier | Default Model | Role | Tool Access | Output |
|------|--------------|------|-------------|--------|
| `reasoning` | Opus 4.6 | Planning, evaluation, review | Zero tools | Structured JSON only |
| `coding` | Sonnet 4.6 | Implementation, tool execution | Full access | Free-form + tool calls |
| `fast` | Haiku 4.5 | Classification, compression, summaries | Read-only | Free-form |

The `count` field declares parallel worker instances. The `sandbox` field enables per-agent filesystem and network isolation policies. The `structured` field instructs the provider adapter to enforce JSON schema output. The `modalities` field declares which content types the agent can process (defaults to `["text"]`); valid values are `"text"`, `"image"`, `"audio"`, and `"file"`.

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
  readonly guardrail?: Record<string, unknown>;
  readonly guardrailRetries?: number;
  readonly outputSchema?: Record<string, unknown>;
  readonly type?: string;
  readonly targetApp?: string;
  readonly task?: string;
  readonly timeout?: number;
}
```

The `type: "delegation"` variant enables cross-app cognitive delegation. When `type` is `"delegation"`, `targetApp` and `task` are required. The Gateway's `DelegationRegistry` resolves the target at startup and the `DelegationHandler` executes the call with schema validation.

Annotation semantics: `readOnly` tools run in parallel without locks; `destructive` tools require approval gates; `idempotent` tools are safe to retry. Unannotated capabilities default to `destructive: true` when loaded from marketplace packages.

The `guardrail` field defines a JSON Schema applied to agent output before acceptance. On failure, the agent retries with feedback, up to `guardrailRetries` (default 3). The `outputSchema` field enforces structured JSON output validated against the schema.

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

Memory stores support configurable exponential decay curves that reduce relevance scores over time. When a store exceeds a configurable threshold, auto-compaction summarizes older entries into compressed form and archives originals.

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

export interface IncomingMessage {
  readonly parts: readonly ContentPart[];
  readonly source: string;
  readonly userId?: string;
  readonly threadId?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface OutgoingMessage {
  readonly parts: readonly ContentPart[];
  readonly target: string;
  readonly format?: MessageFormat;
  readonly userId?: string;
  readonly threadId?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface Channel {
  readonly name: string;
  readonly defaultFormat: MessageFormat;
  readonly supportedModalities: readonly Modality[];
  receive(message: IncomingMessage): Promise<void>;
  send(response: OutgoingMessage): Promise<void>;
  stream(events: AsyncIterable<EngineEvent>): Promise<void>;
}
```

Messages use `parts: readonly ContentPart[]` -- a discriminated union of `TextPart`, `ImagePart`, `AudioPart`, and `FilePart`. Text-only messages use `[{ type: "text", text: "..." }]`. Helper functions `textParts()` and `extractText()` simplify working with text-only messages.

Agents produce content without knowledge of the destination platform. The channel adapter formats output for its target: `short` for character-constrained platforms (WhatsApp/SMS), `full` for rich-text platforms (web/Slack), and `structured` for machine consumers (REST/SSE). Each channel declares its `supportedModalities` to indicate which content types it can handle.

| Adapter | Format | Transport | Supported Modalities |
|---------|--------|-----------|---------------------|
| `CliChannel` | full | stdin/stdout | text |
| `WebChannel` | full | WebSocket (Hono) | text, image, audio, file |
| `WhatsAppChannel` | short | WhatsApp Business API | text, image, audio, file |
| `SlackChannel` | full | Slack Bot Events + Web API | text, image, file |
| `ApiChannel` | structured | HTTP REST + SSE | text, image, audio, file |
| `VoiceChannel` | full | STT/TTS pipeline | text, audio |

The `EventBridge` converts the synchronous `EventBus.emit()` push model to an `AsyncIterable<EngineEvent>` pull model for consumption by `Channel.stream()`.

### 3.7 Trigger

A Trigger is an event-driven workflow activator. Three trigger types are supported, all defined as pure TypeScript interfaces with zero dependencies.

```typescript
export type TriggerType = "webhook" | "event" | "schedule";

export interface WebhookTrigger {
  readonly name: string;
  readonly type: "webhook";
  readonly team: string;
  readonly task?: string;           // supports {{payload.field}} interpolation
  readonly enabled?: boolean;
  readonly path: string;            // e.g. "/hooks/deploy"
  readonly method?: "POST" | "PUT";
  readonly secretEnv?: string;      // env var for HMAC-SHA256 secret
}

export interface EventTrigger {
  readonly name: string;
  readonly type: "event";
  readonly team: string;
  readonly task?: string;
  readonly enabled?: boolean;
  readonly event: string;           // EventType value
  readonly filter?: Record<string, unknown>;
}

export interface ScheduleTrigger {
  readonly name: string;
  readonly type: "schedule";
  readonly team: string;
  readonly task?: string;
  readonly enabled?: boolean;
  readonly cron: string;            // 5-field: "0 2 * * *"
  readonly timezone?: string;       // IANA, default "UTC"
}

export type Trigger = WebhookTrigger | EventTrigger | ScheduleTrigger;
```

| Type | Activation | Validation | Runtime |
|------|-----------|------------|---------|
| `webhook` | HTTP request to `path` | HMAC-SHA256 via `secretEnv` | Hono routes mounted per app |
| `event` | Internal EventBus emission matching `event` + `filter` | Shallow equality on filter fields | EventListener subscription |
| `schedule` | Cron expression fires at intervals | Pure cron parser (5-field, zero deps) | setTimeout chains via Scheduler |

The `task` field on all trigger types supports `{{payload.field}}` template interpolation, allowing the triggering payload to parameterize the task dispatched to the team.

The cron parser (`packages/core/src/engine/domain/cron.ts`) is a zero-dependency implementation supporting standard 5-field cron expressions with `*`, ranges, lists, and step values.

Source: `packages/core/src/engine/domain/trigger.ts`

---

## 4. Engine Composites

Three composite interfaces compose the primitives into deployable units. Each composite is defined in `packages/core/src/engine/composites/` and carries a corresponding `validate*()` function that enforces referential integrity before runtime.

### 4.1 Team

A Team is a self-contained execution unit. Teams operate independently; they do not share agents or workflows with other teams in the same App.

```typescript
export type TeamMode = "sequential" | "supervisor" | "swarm";

export interface QualityGate {
  readonly name: string;
  readonly command: string;
  readonly description: string;
  readonly required: boolean;
}

export interface Team {
  readonly name: string;
  readonly mode?: TeamMode;
  readonly manager?: string;
  readonly agents: Record<string, Agent>;
  readonly workflow: Workflow;
  readonly capabilities: readonly Capability[];
  readonly qualityGates: readonly QualityGate[];
  readonly knowledge?: TeamKnowledge;
}
```

Three team execution modes:

| Mode | Behavior | Requirements |
|------|----------|-------------|
| `sequential` (default) | Agents execute in workflow phase order | At least 1 agent |
| `supervisor` | Manager agent delegates tasks to workers by name, validates results | `manager` field pointing to an agent identifier |
| `swarm` | Agents hand control to each other via `handoff` capability, no central coordinator | At least 2 agents + a capability with `type: "handoff"` |

`validateTeam()` enforces: at least one agent, at least one workflow phase, all agent tool references must resolve to declared capabilities, all gate phase references must exist in the workflow phase list, supervisor mode requires a valid manager, swarm mode requires handoff capability and 2+ agents.

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

1. **Pattern rules** -- regex matching against the incoming message. Deterministic, zero cost. Handles approximately 80% of inputs.
2. **Classifier agent** -- a `fast`-tier LLM call for inputs that match no pattern rule. Handles approximately 15% of inputs.
3. **Fallback team** -- a statically configured team name for all unresolved inputs. Handles the remaining 5%.

`validateRouter()` enforces: `fallback` must be a non-empty string, all `match` values must be valid regular expressions, the classifier agent (if present) must have tier `"fast"`.

### 4.3 App

An App is the top-level deployment unit. It composes teams, a router, memory configuration, channel bindings, and triggers.

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
  readonly triggers?: readonly Trigger[];
  readonly eval?: EvalConfig;
}
```

`validateApp()` enforces: at least one team, at least one channel, at least one memory scope, router fallback references an existing team name, all router rule team references resolve to existing team names, trigger names are unique, webhook paths are unique, eval experiment team references resolve to existing teams, safety config validation when present. It then delegates to `validateTeam()`, `validateRouter()`, `validateTrigger()`, `validateEvalConfig()`, and `validateSafetyConfig()` for each nested composite.

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
    mode: supervisor
    manager: architect
    agents:
      architect:
        name: Aria
        role: Senior Architect
        goal: Design robust, maintainable solutions with minimal complexity
        backstory: >
          Pragmatic architect who values simplicity over cleverness.
          Always considers failure modes and edge cases first.
        tier: reasoning
        tools: []
        structured: true
      worker:
        name: Marcus
        role: Implementation Specialist
        goal: Write clean, well-tested code that follows team conventions
        backstory: >
          Detail-oriented developer who questions vague requirements before
          writing a single line. Takes pride in code that other developers
          enjoy reading.
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

triggers:
  - name: on-deploy
    type: webhook
    path: /hooks/deploy
    team: development
    task: "Deploy triggered by {{payload.user}} for {{payload.branch}}"
    secretEnv: DEPLOY_WEBHOOK_SECRET
  - name: nightly-audit
    type: schedule
    cron: "0 2 * * *"
    team: development
    task: "Run nightly security audit"
```

### 5.3 Presets

A preset is a complete, named YAML configuration for a specific domain. Presets demonstrate the engine's domain-agnosticism: distinct domains with distinct vocabulary use the same seven primitive interfaces and three composite interfaces with zero engine-layer modifications.

Consumer applications ship preset YAML files that wire into Kiln's runtime. The `loadPresetConfig()` function bridges an `App` composite to an `OrchestratorConfig` for Mode A sessions.

---

## 6. Runtime Modes

The Gateway supports two distinct runtime modes. The mode is determined per App by the `mode` field in `gateway.yaml`.

### 6.1 Mode A -- Claude Code Sessions

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

### 6.2 Mode B -- Provider-Adapter Sessions

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
- `start()` -- `idle` -> `running`
- `advance(gateResult?)` -- advances to the next phase if gates pass; returns a `Promise<Phase | null>` when an approval gate is encountered
- `approve()` -- `awaiting_approval` -> `running`, advances past the approval phase
- `reject(reason)` -- `awaiting_approval` -> `running`, stays on the current phase
- `fail(error)` -- any -> `failed`
- `cancel()` -- any -> `cancelled`

The approval phase is derived from `OrchestratorConfig.approvalAfterPhase`. If a gate's `requires` array contains `"human_approval"`, the preset loader sets this field automatically.

`PhaseChangedEvent` is emitted on every successful transition. `ApprovalRequestedEvent` and `ApprovalReceivedEvent` are emitted at the approval gate. `ErrorEvent` is emitted on gate failure.

### 7.2 Orchestrator

`Orchestrator` (`packages/core/src/orchestrator/orchestrator.ts`) is the top-level session coordinator. It owns the `PhaseMachine`, `EventBus`, `CostTracker`, `TaskTree`, `BatchExecutor`, `ProviderRegistry`, and `GitSyncManager`.

Key responsibilities:

- **Session lifecycle** -- `start(task)` generates a session ID and starts the phase machine.
- **Checkpointing** -- workflow state (phase, task tree, memory snapshot) is persisted to SQLite after each phase transition. `resume(checkpointId)` restores from any checkpoint. `fork(checkpointId)` creates alternative branches for A/B testing.
- **Plan loading** -- `loadPlan(plan)` hydrates the `TaskTree` from the Architect's structured JSON output.
- **Implement loop** -- `runImplementLoop(handler)` selects task batches and executes them concurrently via `BatchExecutor`. Results carry evidence strings that update task scoring.
- **Interrupt/Resume** -- `interrupt()` pauses execution at any point, checkpoints state, and emits `interrupt_requested`. External input resumes via `Command(resume=value)`.
- **Verification** -- `runVerification(gates, cwd, fixHandler?)` instantiates a `GateRunner` and `VerificationLoop`, executes the verification loop, and stores the result.
- **Memory sync** -- `initMemorySync(projectPath)` and `flushMemory(store)` manage git-synced memory through `GitSyncManager`.

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

### 7.4 Execution Strategies

Three execution strategies are available via the `strategies/` module:

| Strategy | Behavior |
|----------|----------|
| `SequentialStrategy` | Agents execute tasks one at a time in order |
| `SupervisorStrategy` | Manager agent delegates tasks to workers by name |
| `SwarmStrategy` | Active agent hands off to another via handoff capability |

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

## 10. Security Architecture

Seven security layers provide defense-in-depth, all opt-in via configuration:

### 10.1 Prompt Injection Detection (2-Tier)

`PromptScanner` implements a two-tier detection pipeline:

- **Tier 1 (Heuristic):** 20+ regex patterns across 10 categories (role override, instruction injection, context manipulation, etc.). Zero-cost, runs on every input. Returns threat count and categories.
- **Tier 2 (Deep):** Secondary LLM call that analyzes the input for sophisticated injection attempts that bypass regex. Only triggered when Tier 1 is inconclusive or for high-security contexts.

The gateway security middleware (`packages/runtime/src/gateway/security-middleware.ts`) scans incoming messages and blocks or warns based on configuration.

### 10.2 Guardian Review

`Guardian` provides secondary LLM review for capabilities annotated as `destructive`. Before a destructive tool executes, a secondary model evaluates the action, agent context, and arguments. Configurable `blockOnError` (fail-closed vs fail-open) and `bypassForReadOnly` (skip review for read-only tools). Emits `guardian_reviewed` events and logs to audit trail.

### 10.3 Encrypted Secrets

`AesSecretStore` encrypts sensitive values with AES-256-GCM. Key derivation uses PBKDF2 with configurable iterations. Atomic key rotation re-encrypts all values without downtime. `TenantRegistry` automatically encrypts sensitive tenant fields (API keys, webhook secrets).

### 10.4 Audit Logging

`JsonlAuditLog` provides append-only JSONL audit logs with SHA-256 hash chaining. Each entry includes the hash of the previous entry, making the chain tamper-evident. 16 audit action types cover capability execution, memory access, tenant operations, and security events. `verifyChain()` validates the entire chain for integrity.

### 10.5 Tenant Isolation

Two isolation mechanisms:
- **Memory namespace enforcement:** `SqliteMemoryStore` auto-tags entries with tenant ID and blocks cross-tenant queries.
- **Filesystem jail:** `createTenantSandbox()` creates per-tenant filesystem policies that restrict agent access to tenant-specific directories.

### 10.6 Self-Audit Daemon

`SelfAudit` runs periodic health checks: verifies secrets are encrypted, audit chain is intact, tenant isolation is enforced, and configuration is valid. Produces a `SecurityAuditReport` JSON document.

### 10.7 Safety Pipeline (PII + Content Policy)

`SafetyPipeline` (`packages/core/src/safety/safety-pipeline.ts`) orchestrates enterprise safety checks as a three-stage pipeline applied to both input and output messages:

1. **PII Detection.** `PiiScanner` runs two-tier detection (regex heuristics + optional LLM deep scan) for 6 PII types: email, phone, SSN, credit card, IP address, date of birth. Configurable actions per type: `detect` (log only), `redact` (mask with `[REDACTED]`), `block` (reject message). Supports allowlists for permitted values (e.g., `support@company.com`).

2. **Content Classification.** `ContentClassifier` runs two-tier classification across 6 categories: hate, violence, sexual, self-harm, harassment, misinformation. Configurable thresholds and actions per category. Returns confidence scores.

3. **Policy Rails.** Four built-in rail types enforce content policies:
   - `TopicRail` -- block/allow specific topics via keyword matching
   - `CompetitorRail` -- prevent discussing competitor products
   - `EscalationRail` -- auto-escalate sensitive topics to human agents
   - `ComplianceRail` -- enforce regulatory language requirements

The pipeline short-circuits on block: if PII detection blocks a message, content classification and rails are skipped. All stages are fail-open: scanner errors are logged but do not block message processing.

The gateway integrates the safety pipeline via Hono middleware (`packages/runtime/src/gateway/safety-middleware.ts`) that scans both incoming and outgoing messages. Safety events (`pii_detected`, `content_classified`, `policy_evaluated`) are emitted for observability.

YAML configuration:

```yaml
safety:
  pii:
    detect: [email, phone, ssn, credit_card]
    action: redact
    allowlist: ["support@company.com"]
  content:
    enabled: true
    categories:
      hate: { threshold: 0.7, action: block }
      violence: { threshold: 0.8, action: block }
    deepScan: false
  rails:
    - type: topic
      block: [medical_advice, legal_advice]
      escalate: [billing_dispute]
    - type: competitor
      competitors: [CompetitorA, CompetitorB]
      response: "I can only discuss our products."
```

Source: `packages/core/src/safety/`, `packages/runtime/src/gateway/safety-middleware.ts`

---

## 11. Triggers

Three trigger types activate workflows in response to external or internal events.

### 11.1 Trigger Runtime

`TriggerRegistry` (`packages/runtime/src/trigger/trigger-registry.ts`) manages per-app trigger lifecycle:

1. **Registration:** Triggers are parsed from app YAML and registered per app.
2. **Webhook mounting:** For webhook triggers, Hono routes are created and mounted on the gateway. HMAC-SHA256 signature validation (`validateWebhookSignature()`) uses timing-safe comparison.
3. **Event listeners:** For event triggers, `EventListener` subscribes to the EventBus and evaluates filter conditions (shallow equality matching).
4. **Scheduler:** For schedule triggers, `Scheduler` uses `nextFireTime()` from the cron parser to set up setTimeout chains.
5. **Execution:** `executeTrigger()` interpolates `{{payload.field}}` templates in the task string and dispatches to the target team.

Four trigger event types are emitted: `webhook_received`, `trigger_fired`, `trigger_failed`, `schedule_fired`.

---

## 12. Skills and Packages

### 12.1 Skills

Skills are reusable capability bundles defined in `SKILL.yaml`:

```yaml
name: web-search
description: Search the web and extract content
tools: [browser_search, browser_extract]
triggers: [search, lookup, find online]
tags: [web, search]
instructions: |
  Use this skill when the user asks about current events or needs
  information that may not be in the knowledge base.
```

`SkillRegistry` discovers skills via 3-tier priority: workspace (`./skills/`) > user (`~/.kiln/skills/`) > builtin. Additionally, `discoverFromPackage()` loads skills from installed domain packages.

### 12.2 Packages

The package bounded context (`packages/core/src/package/`) handles distribution:

- **`PackageManifest`** -- base type with name, version, description, author, license
- **`DomainPackageManifest`** -- extends with domain config (quality gates, tool tags, detect patterns)
- **`SkillPackageManifest`** -- extends with skill config (tools, triggers, instructions)
- **Security validation:** `validatePackageSecurity()` blocks forbidden lifecycle scripts, `validatePackageFiles()` detects path traversal and absolute paths, `computeContentHash()` provides SHA-256 integrity verification

---

## 13. Error Handling

`KilnError` (`packages/core/src/engine/errors.ts`) is the base error class for all Kiln errors:

```typescript
export class KilnError extends Error {
  readonly code: KilnErrorCode;
  readonly context: Record<string, unknown>;
  readonly retryable: boolean;
  readonly suggestion?: string;
  readonly docUrl?: string;
}
```

55 error codes are organized by bounded context (engine, domain, tenant, provider, budget, config, agent intelligence, security, skill, package, trigger, eval). Each code maps to a context-aware suggestion via `getErrorSuggestion(code, context)` in `packages/core/src/engine/error-catalog.ts`.

---

## 14. Developer Tools

### 14.1 `kiln init`

Interactive CLI wizard that generates `app.yaml` and `gateway.yaml`:
- Select domain kit (react-ts, python, docs, support, data-pipeline)
- Choose provider (Anthropic, OpenAI, DeepSeek, Ollama)
- Configure channels (CLI, Web, WhatsApp, Slack, API)
- Select team mode (sequential, supervisor, swarm)
- `--non-interactive` flag for CI/CD

### 14.2 `kiln dev`

Development mode with hot-reload:
- Starts gateway with `devMode: true`
- `YamlWatcher` monitors YAML files with `fs.watch` + 300ms debounce
- On change, reloads app configuration without restart

### 14.3 Inline Web Debugger

When `devMode` is true, the gateway serves an inline HTML debugger at `/dev/`:
- Self-contained HTML page (zero external deps, vanilla JS)
- SSE-connected to `/dev/events` for real-time event streaming
- Endpoints: `/dev/state`, `/dev/memory`, `/dev/cost`, `/dev/apps`, `/dev/triggers`
- Read-only -- no mutations from the debugger

---

## 15. Bounded Contexts

| Context | Package | Location | Purpose |
|---------|---------|----------|---------|
| `engine` | `@kilnai/core` | `packages/core/src/engine/` | 7 primitives + 3 composites + YAML loader + gateway config types + cron parser. Zero external dependencies. |
| `orchestrator` | `@kilnai/core` | `packages/core/src/orchestrator/` | Phase machine, orchestrator, checkpoint/resume/fork, configurable phase sequence and gate enforcement. |
| `agents` | `@kilnai/core` | `packages/core/src/agents/` | Provider adapter interface and implementations: Anthropic, OpenAI, DeepSeek, Ollama. MCP client (SSE transport, circuit breaker protected). Tool RAG (embedding-based tool selection). |
| `memory` | `@kilnai/core` | `packages/core/src/memory/` | Scoped storage implementations: SQLite + FTS5 (with decay + compaction), gzipped JSONL, git sync. |
| `tree` | `@kilnai/core` | `packages/core/src/tree/` | Task tree manager: scoring, batch selection, deepen/branch/prune actions. |
| `domain` | `@kilnai/core` | `packages/core/src/domain/` | Domain registry, YAML schema, 5 built-in domain kits, backward-compatible marketplace adapter. |
| `package` | `@kilnai/core` | `packages/core/src/package/` | Package distribution: versioning, content hashing, security validation, YAML schema. |
| `skill` | `@kilnai/core` | `packages/core/src/skill/` | Skill system: SKILL.yaml format, SkillRegistry with 3-tier discovery + domain package discovery. |
| `eval` | `@kilnai/core` | `packages/core/src/eval/` | Evaluation framework: 12 scorer types (6 rule-based + 6 LLM-as-judge), dataset JSONL loader, experiment runner with per-scorer error isolation, experiment comparator. |
| `sandbox` | `@kilnai/core` | `packages/core/src/sandbox/` | Per-agent filesystem allowlists and network proxy policies. |
| `verification` | `@kilnai/core` | `packages/core/src/verification/` | Gate runner, verification loop: test, lint, type-check. |
| `events` | `@kilnai/core` | `packages/core/src/events/` | EventBus: synchronous emit with typed subscriber dispatch (32 event types), multi-level streaming, ring buffer. |
| `cost` | `@kilnai/core` | `packages/core/src/cost/` | Per-role, cache-aware cost tracking. |
| `security` | `@kilnai/core` | `packages/core/src/security/` | Audit logging (JSONL + hash chaining), prompt injection (2-tier), encrypted secrets (AES-256-GCM), Guardian review, self-audit. |
| `safety` | `@kilnai/core` | `packages/core/src/safety/` | Enterprise safety pipeline: PII scanner (2-tier, 6 types), content classifier (6 categories), 4 policy rails (topic, competitor, escalation, compliance). |
| `channels` | `@kilnai/runtime` | `packages/runtime/src/channels/` | Channel adapters (CLI, Web, WhatsApp, Slack, API, Voice), EventBridge, ChannelRegistry, ChannelRouter, MessageFormatter. Multimodal `ContentPart[]` message primitives with per-channel `supportedModalities`. |
| `gateway` | `@kilnai/runtime` | `packages/runtime/src/gateway/` | Gateway runtime: multi-App loading, per-App isolation, Mode B routes, budget middleware, cross-app delegation (Kiln-native + A2A), A2A route mounting, trigger webhook mounting, dev-mode API routes, inline web debugger. |
| `a2a` | `@kilnai/runtime` | `packages/runtime/src/a2a/` | A2A protocol: Agent Card generation, JSON-RPC 2.0 server (tasks/send, sendSubscribe, get, cancel), A2ATaskStore, A2AClient for outbound delegation. |
| `trigger` | `@kilnai/runtime` | `packages/runtime/src/trigger/` | TriggerRegistry, webhook handler (HMAC-SHA256), event listener, cron scheduler, trigger executor. |
| `session` | `@kilnai/runtime` | `packages/runtime/src/session/` | Mode B session management: ModeBSession, ModeBOrchestrator, SessionRegistry. |
| `tenant` | `@kilnai/runtime` | `packages/runtime/src/tenant/` | Multi-tenant management: TenantRegistry, system prompt builder, phone-to-tenant resolution. |
| `cli` | `@kilnai/cli` | `packages/cli/` | CLI commands (init, run, dev, gateway, skill, domain), formatters, MCP server. |

---

## 16. Event Streaming

32 event types are emitted by the engine and broadcast to all connected channels.

### Core Events

| Event | Key Payload Fields |
|-------|--------------------|
| `phase_changed` | `phase`, `phaseName`, `phaseDescription` |
| `task_started` | `taskId`, `statement`, `parentId` |
| `task_completed` | `taskId`, `action`, `status` |
| `tool_called` | `toolName`, `taskId`, `workerIndex` |
| `tool_result` | `toolName`, `taskId`, `durationMs`, `success` |
| `thinking` | `role`, `content` |
| `verification_result` | `passed`, `iteration`, `maxIterations`, `checks` |
| `cost_update` | `inputTokens`, `outputTokens`, `totalCostUsd`, `byRole` |
| `memory_saved` | `memoryId`, `layer`, `tags` |
| `memory_recalled` | `query`, `resultsCount` |
| `memory_sync` | `imported`, `entries`, `developers` |
| `approval_requested` | `taskId`, `description` |
| `approval_received` | `taskId`, `approved` |
| `worker_assigned` | `workerIndex`, `taskId` |
| `error` | `message`, `code`, `taskId` |
| `trace_span` | `span` (TraceSpan) |

### Agent Intelligence Events

| Event | Key Payload Fields |
|-------|--------------------|
| `handoff_requested` | `fromAgent`, `toAgent`, `reason`, `context` |
| `handoff_completed` | `fromAgent`, `toAgent`, `accepted` |
| `interrupt_requested` | `checkpointId`, `reason`, `resumeSchema` |
| `interrupt_resumed` | `checkpointId`, `resumeValue` |

### Security Events

| Event | Key Payload Fields |
|-------|--------------------|
| `injection_scanned` | `safe`, `threats`, `tier`, `inputPreview` |
| `guardian_reviewed` | `approved`, `capabilityName`, `agentName`, `riskLevel` |
| `audit_entry` | `action`, `actor`, `outcome`, `resource` |
| `tenant_isolation_violation` | `tenantId`, `attemptedResource`, `blockedBy` |
| `security_alert` | `severity`, `category`, `message` |

### Trigger Events

| Event | Key Payload Fields |
|-------|--------------------|
| `webhook_received` | `path`, `appName`, `triggerName`, `method` |
| `trigger_fired` | `triggerName`, `triggerType`, `team`, `task` |
| `trigger_failed` | `triggerName`, `triggerType`, `error` |
| `schedule_fired` | `triggerName`, `cron`, `team` |

### Safety Events

| Event | Key Payload Fields |
|-------|--------------------|
| `pii_detected` | `direction`, `piiTypes`, `action`, `count`, `tier` |
| `content_classified` | `direction`, `categories`, `blocked`, `tier` |
| `policy_evaluated` | `railType`, `allowed`, `reason`, `direction` |

### Multi-Level Streaming

Events are assigned to streaming levels via `EVENT_LEVEL_MAP`:

| Level | Includes | Use Case |
|-------|----------|----------|
| `state` | State-level events only (cost, memory, audit, trace) | Dashboard summaries |
| `phase` | State + phase-level (transitions, tasks, security, triggers) | Progress tracking |
| `tool` | State + phase + tool-level (tool calls, verification) | Developer debugging |
| `token` | All events including token-level (thinking) | Full observability |

`EventBus.onLevel(level, callback)` subscribes to all events at or above the specified level. `EventBridge` supports level filtering for channel adapters.

`WebChannel` forwards events as WebSocket messages. `CliChannel` formats them for stdout. `ApiChannel` delivers them as SSE frames. The `EventBridge` component converts the synchronous `EventBus` push model to `AsyncIterable<EngineEvent>` for the `Channel.stream()` interface.

Source: `packages/core/src/events/event-bus.ts`

---

## 17. Project Structure

```
kiln/
├── packages/
│   ├── core/                              # Engine layer + infrastructure
│   │   └── src/
│   │       ├── engine/
│   │       │   ├── domain/               # 7 primitives (zero deps)
│   │       │   ├── composites/           # 3 composites + validate*()
│   │       │   ├── loader/               # app-loader.ts, preset-loader.ts
│   │       │   └── gateway/              # gateway-config.ts, mode-b-config.ts, delegation-config.ts
│   │       ├── orchestrator/             # phase-machine.ts, orchestrator.ts, strategies/
│   │       ├── agents/
│   │       │   └── infrastructure/       # anthropic.ts, openai.ts, deepseek.ts, ollama.ts
│   │       ├── memory/                   # sqlite-store.ts, project-store.ts, decay-curves.ts, compactor.ts
│   │       ├── tree/                     # task-tree.ts
│   │       ├── events/                   # event-bus.ts, trace.ts
│   │       ├── cost/                     # cost-tracker.ts
│   │       ├── sandbox/                  # policies.ts
│   │       ├── verification/             # verification-loop.ts
│   │       ├── domain/                   # domain-registry.ts, yaml-schema.ts, marketplace.ts
│   │       ├── domains/                  # 5 built-in domain kits (react-ts, python, docs, support, data-pipeline)
│   │       ├── package/                  # types.ts, security.ts, yaml-schema.ts, yaml-parser.ts
│   │       ├── skill/                    # skill-registry.ts, yaml-schema.ts, yaml-parser.ts
│   │       ├── eval/                     # scorers/, dataset-loader.ts, experiment-runner.ts, experiment-comparator.ts, scorer-factory.ts
│   │       ├── security/                 # audit-log.ts, prompt-scanner.ts, secret-store.ts, guardian.ts, self-audit.ts
│   │       └── safety/                  # pii-scanner.ts, content-classifier.ts, rails.ts, safety-pipeline.ts
│   ├── runtime/                          # Gateway + channels + triggers
│   │   └── src/
│   │       ├── gateway/                  # gateway-server.ts, gateway-routes.ts, dev-routes.ts, dev-inspector.ts
│   │       ├── session/                  # mode-b-session.ts, mode-b-orchestrator.ts, session-registry.ts
│   │       ├── tenant/                   # tenant-registry.ts, system-prompt-builder.ts
│   │       ├── channels/                 # cli-, web-, whatsapp-, slack-, api-, voice-channel.ts + speech/
│   │       └── trigger/                  # trigger-registry.ts, webhook-handler.ts, event-listener.ts, scheduler.ts
│   └── cli/                              # CLI commands + MCP server
│       └── src/
│           ├── commands/                 # init.ts, dev.ts, gateway.ts, skill.ts
│           └── formatters.ts             # CLI output formatters
├── docs/
│   ├── architecture.md                   # This document
│   ├── evolution-plan.md                 # Vision, roadmap, design principles
│   ├── gateway.md                        # Gateway runtime reference
│   ├── channels.md                       # Channel adapter reference
│   ├── marketplace.md                    # Domain marketplace reference
│   ├── consumer-guide.md                 # Consumer integration guide
│   └── preset-format.md                  # Preset YAML format reference
├── CLAUDE.md
└── package.json
```
