# Architecture Reference (Contributors)

This document is for contributors. For user documentation, see the [guides](guides/).

## Design Philosophy

**YAML-first configuration.** App behavior is defined in YAML, not code. Teams, agents, workflows, quality gates, routing rules, and memory scopes are all declared in configuration files. TypeScript interfaces serve as the runtime validation layer; they do not encode business logic.

**Domain-agnostic engine.** The engine has no knowledge of any specific domain. It knows about phase sequences, gate enforcement, agent tiers, and memory scopes. Domain-specific behavior is introduced through preset YAML files and capability implementations — not through engine conditionals.

**Primitives and composites pattern.** Seven primitive interfaces define the fundamental building blocks. Three composite interfaces compose those primitives into deployable units. This separation prevents coupling between concerns and makes the engine extensible without modification.

**Zero external dependencies in the engine layer.** `packages/core/src/engine/` contains only pure TypeScript interfaces with no npm dependencies. Infrastructure implementations (SQLite, Anthropic SDK, Hono) exist in separate bounded contexts and implement the engine interfaces.

**Fail fast at boundaries.** YAML is parsed, mapped to raw types, validated against a schema, and hydrated into typed composites before any runtime operation begins. Errors are aggregated and surfaced as `AppLoaderError` before the process starts serving requests.

## Bounded Contexts

| Context | Package | Location | Purpose |
|---------|---------|----------|---------|
| `engine` | `@kilnai/core` | `packages/core/src/engine/` | 7 primitives + 3 composites + YAML loader + gateway config types + cron parser. Zero external dependencies. |
| `orchestrator` | `@kilnai/core` | `packages/core/src/orchestrator/` | Phase machine, orchestrator, checkpoint/resume/fork, configurable phase sequence and gate enforcement. |
| `agents` | `@kilnai/core` | `packages/core/src/agents/` | Provider adapter interface and implementations (Anthropic, OpenAI, DeepSeek, Ollama). MCP client (Streamable HTTP transport via official SDK, circuit breaker). Tool RAG (embedding-based tool selection). |
| `memory` | `@kilnai/core` | `packages/core/src/memory/` | SQLite + FTS5 store (decay + compaction), gzipped JSONL store, git sync. |
| `tree` | `@kilnai/core` | `packages/core/src/tree/` | Task tree: scoring, batch selection, deepen/branch/prune. |
| `domain` | `@kilnai/core` | `packages/core/src/domain/` | Domain registry, YAML schema, 5 built-in domain kits, marketplace adapter. |
| `package` | `@kilnai/core` | `packages/core/src/package/` | Package distribution: versioning, content hashing, security validation. |
| `skill` | `@kilnai/core` | `packages/core/src/skill/` | Skill system: SKILL.yaml format, SkillRegistry with 3-tier discovery. |
| `eval` | `@kilnai/core` | `packages/core/src/eval/` | Evaluation: 12 scorer types, dataset JSONL loader, experiment runner with per-scorer error isolation, comparator. |
| `sandbox` | `@kilnai/core` | `packages/core/src/sandbox/` | Per-agent filesystem allowlists and network proxy policies. |
| `verification` | `@kilnai/core` | `packages/core/src/verification/` | Gate runner and verification loop (test, lint, type-check). |
| `events` | `@kilnai/core` | `packages/core/src/events/` | EventBus: synchronous emit with typed subscriber dispatch (32 event types), multi-level streaming, ring buffer. |
| `cost` | `@kilnai/core` | `packages/core/src/cost/` | Per-role, cache-aware cost tracking. |
| `security` | `@kilnai/core` | `packages/core/src/security/` | Audit logging (JSONL + hash chaining), prompt injection (2-tier), encrypted secrets (AES-256-GCM), Guardian review, self-audit. |
| `safety` | `@kilnai/core` | `packages/core/src/safety/` | Enterprise safety: PII scanner (2-tier, 6 types), content classifier (6 categories), 4 policy rails. |
| `observability` | `@kilnai/core` | `packages/core/src/observability/` | OTel integration: SpanMapper (maps 32 event types to spans), OTelExporter (implements EventStore, accepts TracerProvider). |
| `knowledge` | `@kilnai/core` | `packages/core/src/knowledge/` | RAG pipeline: chunkers (recursive, markdown), embedding adapters (OpenAI, Ollama), InMemoryVectorStore, RetrievalPipeline, knowledge_search capability auto-injection. |
| `channels` | `@kilnai/runtime` | `packages/runtime/src/channels/` | Channel adapters (CLI, Web, WhatsApp, Slack, API, Voice), EventBridge, ChannelRegistry, ChannelRouter, MessageFormatter. |
| `gateway` | `@kilnai/runtime` | `packages/runtime/src/gateway/` | Gateway runtime: multi-App loading, per-App isolation, Mode B routes, budget middleware, cross-app delegation, trigger webhook mounting, dev-mode API routes, Studio static file serving, lightweight dev server (`startDevServer`). |
| `a2a` | `@kilnai/runtime` | `packages/runtime/src/a2a/` | A2A protocol: Agent Card generation, JSON-RPC 2.0 server, A2ATaskStore, A2AClient. |
| `trigger` | `@kilnai/runtime` | `packages/runtime/src/trigger/` | TriggerRegistry, webhook handler (HMAC-SHA256), event listener, cron scheduler, trigger executor. |
| `session` | `@kilnai/runtime` | `packages/runtime/src/session/` | Mode B session management: ModeBSession, ModeBOrchestrator, SessionRegistry. |
| `tenant` | `@kilnai/runtime` | `packages/runtime/src/tenant/` | Multi-tenant management: TenantRegistry, system prompt builder, phone-to-tenant resolution. |
| `cli` | `@kilnai/cli` | `packages/cli/` | CLI commands (init, run, dev, gateway, skill, domain), formatters, MCP server. |
| `sdk` | `@kilnai/react` | `packages/sdk/` | React hooks library: KilnProvider, useKilnChat, useKilnEvents, useKilnMemory, useKilnState, ApiClient, SseClient. Types-only import from core. |
| `studio` | `@kilnai/studio` | `packages/studio/` | Dev UI SPA (private): React 19 + Vite + TanStack Query + @xyflow/react. Served at `/studio` in dev mode. |

## Dependency Rules

1. Engine primitives have zero external dependencies. `packages/core/src/engine/domain/` contains only TypeScript `interface` and `type` declarations.
2. Application layer depends on engine interfaces, not on infrastructure. Orchestrator, tree manager, and phase machine consume engine interfaces; they do not import from `agents/infrastructure/` or `memory/`.
3. Infrastructure implements engine interfaces. SQLite stores, provider adapters, and Hono routes implement engine interfaces without the engine knowing about their specifics.
4. No cross-context imports. Bounded contexts communicate through shared kernel types (`packages/core/src/engine/index.ts`), not through direct cross-directory imports.
5. Provider SDKs are restricted to adapter implementations. `@anthropic-ai/sdk`, `openai`, and similar packages appear only in `packages/core/src/agents/infrastructure/`.
6. Channel adapters are restricted to channel implementations. Platform-specific SDKs appear only in `packages/runtime/src/channels/`.
7. `@kilnai/runtime` depends on `@kilnai/core` only, never the reverse.
8. `@kilnai/react` imports only types from `@kilnai/core` — never implementations, never runtime.
9. `@kilnai/studio` depends on `@kilnai/react` and UI libraries. The runtime serves its `dist/` as static files and never imports Studio code.

## Engine Interfaces

The seven primitives and three composites are defined as pure TypeScript interfaces in `packages/core/src/engine/`.

```typescript
// packages/core/src/engine/domain/agent.ts
export type AgentTier = "reasoning" | "coding" | "fast";

export interface Agent {
  readonly name: string;
  readonly role: string;
  readonly goal: string;
  readonly backstory?: string;
  readonly tier: AgentTier;
  readonly tools: readonly string[];
  readonly instructions?: string;
  readonly structured?: boolean;
  readonly count?: number;
  readonly sandbox?: boolean;
  readonly modalities?: readonly Modality[];
}

// packages/core/src/engine/domain/capability.ts
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

// packages/core/src/engine/domain/workflow.ts
export interface Workflow {
  readonly phases: readonly string[];
  readonly gates: Record<string, Gate>;
  readonly maxIterations?: number;
}

// packages/core/src/engine/domain/memory.ts
export type MemoryScope = "user" | `agent:${string}` | `team:${string}` | `project:${string}` | "org";

export interface Memory {
  store(scope: MemoryScope, entry: MemoryEntry): Promise<string>;
  recall(scope: MemoryScope, query: string, budget?: number): Promise<MemoryEntry[]>;
  forget(scope: MemoryScope, id: string): Promise<void>;
}

// packages/core/src/engine/domain/task.ts
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

// packages/core/src/engine/domain/channel.ts
export interface Channel {
  readonly name: string;
  readonly defaultFormat: MessageFormat;
  readonly supportedModalities: readonly Modality[];
  receive(message: IncomingMessage): Promise<void>;
  send(response: OutgoingMessage): Promise<void>;
  stream(events: AsyncIterable<EngineEvent>): Promise<void>;
}

// packages/core/src/engine/domain/trigger.ts
export type Trigger = WebhookTrigger | EventTrigger | ScheduleTrigger;

// packages/core/src/engine/composites/team.ts
export type TeamMode = "sequential" | "supervisor" | "swarm";

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

// packages/core/src/engine/composites/router.ts
export interface Router {
  readonly rules: readonly PatternRule[];
  readonly classifier?: Agent;
  readonly fallback: string;
}

// packages/core/src/engine/composites/app.ts
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

## Orchestration

### PhaseMachine

`PhaseMachine` (`packages/core/src/orchestrator/phase-machine.ts`) is a linear state machine over a configurable phase sequence.

States: `idle` -> `running` -> `awaiting_approval` -> `completed` | `failed` | `cancelled`

| Transition | Description |
|-----------|-------------|
| `start()` | `idle` -> `running` |
| `advance(gateResult?)` | Advances to the next phase if gates pass; emits `approval_requested` if gate requires `human_approval` |
| `approve()` | `awaiting_approval` -> `running`, advances past approval phase |
| `reject(reason)` | `awaiting_approval` -> `running`, stays on current phase |
| `fail(error)` | Any -> `failed` |
| `cancel()` | Any -> `cancelled` |

### Orchestrator

`Orchestrator` (`packages/core/src/orchestrator/orchestrator.ts`) owns the `PhaseMachine`, `EventBus`, `CostTracker`, `TaskTree`, `BatchExecutor`, `ProviderRegistry`, and `GitSyncManager`.

Key responsibilities: session lifecycle, checkpointing (persist to SQLite after each phase transition), plan loading (hydrate `TaskTree` from architect structured output), implement loop (select batches, execute via `BatchExecutor`), interrupt/resume (pause at any point, checkpoint, resume via command), verification (instantiate `GateRunner` + `VerificationLoop`), memory sync.

### BatchExecutor and Strategies

`BatchExecutor` selects tasks from the `TaskTree` in batches up to `parallelWorkers` in size. Workers within a batch receive sibling context to prevent duplicate work.

| Strategy | Behavior |
|----------|----------|
| `SequentialStrategy` | Agents execute tasks one at a time in order |
| `SupervisorStrategy` | Manager agent delegates tasks to workers by name |
| `SwarmStrategy` | Active agent hands off to another via handoff capability |

## Error Handling

`KilnError` is the base error class for all Kiln errors. Source: `packages/core/src/engine/errors.ts`.

```typescript
export class KilnError extends Error {
  readonly code: KilnErrorCode;
  readonly context: Record<string, unknown>;
  readonly retryable: boolean;
  readonly suggestion?: string;
  readonly docUrl?: string;
}
```

55 error codes are organized by bounded context. Each code maps to a context-aware suggestion via `getErrorSuggestion(code, context)` in `packages/core/src/engine/error-catalog.ts`.

| Context | Example Codes |
|---------|---------------|
| engine | `INVALID_YAML`, `MISSING_FIELD`, `UNKNOWN_TEAM`, `CIRCULAR_REFERENCE` |
| domain | `DOMAIN_NOT_FOUND`, `INVALID_DOMAIN_YAML`, `DOMAIN_ALREADY_REGISTERED` |
| tenant | `TENANT_NOT_FOUND`, `TENANT_ISOLATION_VIOLATION`, `DUPLICATE_TENANT` |
| provider | `PROVIDER_NOT_FOUND`, `API_KEY_MISSING`, `RATE_LIMITED`, `CONTEXT_LENGTH_EXCEEDED` |
| budget | `BUDGET_EXHAUSTED`, `TIER_RESTRICTED`, `BILLING_ENDPOINT_UNREACHABLE` |
| config | `INVALID_GATEWAY_CONFIG`, `PORT_IN_USE`, `APP_LOAD_FAILED` |
| agent intelligence | `TOOL_CALL_FAILED`, `GUARDRAIL_FAILED`, `MCP_CONNECTION_FAILED`, `CIRCUIT_OPEN` |
| security | `INJECTION_DETECTED`, `AUDIT_CHAIN_BROKEN`, `SECRET_DECRYPTION_FAILED` |
| skill | `SKILL_NOT_FOUND`, `INVALID_SKILL_YAML` |
| package | `LIFECYCLE_SCRIPT_DETECTED`, `PATH_TRAVERSAL_DETECTED`, `CONTENT_HASH_MISMATCH` |
| trigger | `WEBHOOK_SIGNATURE_INVALID`, `TRIGGER_EXECUTION_FAILED`, `INVALID_CRON` |
| eval | `DATASET_NOT_FOUND`, `SCORER_NOT_FOUND`, `EXPERIMENT_CYCLE_DETECTED` |

## Event System

32 event types are emitted by the engine and broadcast to all connected channels. Source: `packages/core/src/events/event-bus.ts`.

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

### Streaming Levels

| Level | Includes |
|-------|----------|
| `state` | Cost, memory, audit, trace |
| `phase` | State + phase transitions, tasks, security, triggers |
| `tool` | Phase + tool calls, verification |
| `token` | All events including thinking |

`EventBus.onLevel(level, callback)` subscribes to all events at or above the specified level.

## Security Architecture

Seven layers provide defense-in-depth, all opt-in via configuration.

**Prompt Injection Detection.** `PromptScanner`: Tier 1 runs 20+ regex patterns (zero cost) on every input; Tier 2 triggers an LLM deep scan for high-security contexts. Gateway middleware blocks or warns based on config. Source: `packages/core/src/security/prompt-scanner.ts`.

**Guardian Review.** Secondary LLM review for `destructive`-annotated capabilities. Configurable `blockOnError` (fail-closed vs fail-open) and `bypassForReadOnly`. Source: `packages/core/src/security/guardian.ts`.

**Encrypted Secrets.** `AesSecretStore`: AES-256-GCM with PBKDF2 key derivation. Atomic key rotation re-encrypts all values without downtime. Source: `packages/core/src/security/secret-store.ts`.

**Audit Logging.** `JsonlAuditLog`: append-only JSONL with SHA-256 hash chaining per entry, making the chain tamper-evident. `verifyChain()` validates integrity. Source: `packages/core/src/security/audit-log.ts`.

**Tenant Isolation.** Memory namespace enforcement (`SqliteMemoryStore` auto-tags by tenant and blocks cross-tenant queries) + filesystem jail (`createTenantSandbox()` restricts agent filesystem access to tenant-specific directories).

**Self-Audit Daemon.** `SelfAudit` runs periodic health checks: secrets encrypted, audit chain intact, tenant isolation enforced, configuration valid. Source: `packages/core/src/security/self-audit.ts`.

**Safety Pipeline.** `SafetyPipeline` orchestrates three stages on both input and output: PII detection (regex + optional LLM, 6 types, redact/block), content classification (6 categories, configurable thresholds), policy rails (topic, competitor, escalation, compliance). Short-circuits on block. Fail-open on errors. Source: `packages/core/src/safety/`.

## Project Structure

```
kiln/
├── packages/
│   ├── core/                              # @kilnai/core
│   │   └── src/
│   │       ├── engine/
│   │       │   ├── domain/               # 7 primitives (zero deps)
│   │       │   ├── composites/           # 3 composites + validate*()
│   │       │   ├── loader/               # app-loader.ts, preset-loader.ts
│   │       │   └── gateway/              # config types
│   │       ├── orchestrator/             # phase-machine.ts, orchestrator.ts, strategies/
│   │       ├── agents/
│   │       │   └── infrastructure/       # anthropic.ts, openai.ts, deepseek.ts, ollama.ts
│   │       ├── memory/                   # sqlite-store.ts, project-store.ts, decay-curves.ts
│   │       ├── tree/                     # task-tree.ts
│   │       ├── events/                   # event-bus.ts
│   │       ├── cost/                     # cost-tracker.ts
│   │       ├── sandbox/                  # policies.ts
│   │       ├── verification/             # verification-loop.ts
│   │       ├── domain/                   # domain-registry.ts, yaml-schema.ts, marketplace.ts
│   │       ├── domains/                  # react-ts.yaml, python.yaml, docs.yaml, support.yaml, data-pipeline.yaml
│   │       ├── package/                  # types.ts, security.ts, yaml-schema.ts, yaml-parser.ts
│   │       ├── skill/                    # skill-registry.ts, yaml-schema.ts, yaml-parser.ts
│   │       ├── eval/                     # scorers/, dataset-loader.ts, experiment-runner.ts, comparator.ts
│   │       ├── knowledge/                # chunkers, embedding adapters, vector store, retrieval pipeline
│   │       ├── security/                 # audit-log.ts, prompt-scanner.ts, secret-store.ts, guardian.ts
│   │       └── safety/                   # pii-scanner.ts, content-classifier.ts, rails.ts, safety-pipeline.ts
│   ├── runtime/                          # @kilnai/runtime
│   │   └── src/
│   │       ├── gateway/                  # gateway-server.ts, gateway-routes.ts, dev-routes.ts, ws-routes.ts
│   │       ├── session/                  # mode-b-session.ts, mode-b-orchestrator.ts, session-registry.ts
│   │       ├── tenant/                   # tenant-registry.ts, system-prompt-builder.ts
│   │       ├── channels/                 # cli-, web-, whatsapp-, slack-, api-, voice-channel.ts + speech/
│   │       ├── trigger/                  # trigger-registry.ts, webhook-handler.ts, scheduler.ts
│   │       └── a2a/                      # agent-card-generator.ts, a2a-server-routes.ts, a2a-client.ts
│   ├── cli/                              # @kilnai/cli
│   │   └── src/
│   │       ├── commands/                 # init.ts, dev.ts, gateway.ts, skill.ts
│   │       └── formatters.ts
│   ├── sdk/                              # @kilnai/react
│   │   └── src/
│   │       ├── provider.tsx
│   │       ├── use-kiln-chat.ts
│   │       ├── use-kiln-events.ts
│   │       ├── use-kiln-memory.ts
│   │       ├── use-kiln-state.ts
│   │       ├── api-client.ts
│   │       └── sse-client.ts
│   └── studio/                           # @kilnai/studio (private)
│       └── src/
│           ├── routes/                   # graph.tsx, playground.tsx, timeline.tsx, memory.tsx, eval.tsx
│           ├── hooks/                    # use-app-graph.ts, use-yaml.ts
│           └── styles/                   # tokens.css
├── docs/
│   ├── architecture.md                   # This document
│   ├── guides/                           # User guides (multi-tenant, delegation, domains, eval)
│   └── sdk/                              # SDK docs (react-hooks, studio)
├── CLAUDE.md
├── CONTRIBUTING.md
└── package.json
```
