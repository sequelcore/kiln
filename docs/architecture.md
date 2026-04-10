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
| `agents` | `@kilnai/core` | `packages/core/src/agents/` | Provider adapter interface and implementations (Anthropic, OpenAI, DeepSeek, OpenRouter, Ollama). MCP client (Streamable HTTP transport via official SDK, circuit breaker, tool description scanning for prompt injection). Tool RAG (embedding-based tool selection). Agent RAG (embedding-based agent routing). Model capability registry, complexity scorer, rules router. Sliding window rate limiter. |
| `memory` | `@kilnai/core` | `packages/core/src/memory/` | SQLite + FTS5 store (decay + compaction), gzipped JSONL store, git sync. |
| `tree` | `@kilnai/core` | `packages/core/src/tree/` | Task tree: scoring, batch selection, deepen/branch/prune. |
| `domain` | `@kilnai/core` | `packages/core/src/domain/` | Domain registry, YAML schema, 5 built-in domain kits, domain package adapter. |
| `package` | `@kilnai/core` | `packages/core/src/package/` | Package distribution: versioning, content hashing, security validation. |
| `skill` | `@kilnai/core` | `packages/core/src/skill/` | Skill system: SKILL.md format (markdown + YAML frontmatter), SkillRegistry with 3-tier progressive disclosure, runtime injection via PerCallToolConfig. |
| `eval` | `@kilnai/core` | `packages/core/src/eval/` | Evaluation: 12 scorer types, dataset JSONL loader, experiment runner with per-scorer error isolation, comparator. |
| `sandbox` | `@kilnai/core` | `packages/core/src/sandbox/` | Per-agent filesystem allowlists and network proxy policies. |
| `verification` | `@kilnai/core` | `packages/core/src/verification/` | Gate runner and verification loop (test, lint, type-check). |
| `events` | `@kilnai/core` | `packages/core/src/events/` | EventBus: synchronous emit with typed subscriber dispatch (43 typed events), multi-level streaming, ring buffer. |
| `cost` | `@kilnai/core` | `packages/core/src/cost/` | Per-role:model cache-aware cost tracking, STT + embedding cost tracking. |
| `security` | `@kilnai/core` | `packages/core/src/security/` | Audit logging (JSONL + hash chaining), prompt injection (2-tier), encrypted secrets (AES-256-GCM), Guardian review, self-audit. |
| `safety` | `@kilnai/core` | `packages/core/src/safety/` | Enterprise safety: PII scanner (2-tier, 6 types, Luhn validation for credit cards), content classifier (6 categories), 4 policy rails, indirect injection scanning on tool results. |
| `observability` | `@kilnai/core` | `packages/core/src/observability/` | OTel integration: SpanMapper (maps 43 typed events to spans), OTelExporter (implements EventStore, accepts TracerProvider), PrometheusCollector (counters + histograms, /metrics endpoint), CompositeEventStore (fan-out to multiple sinks), BatchSpanProcessor. |
| `enrichment` | `@kilnai/core` | `packages/core/src/enrichment/` | Post-conversation enrichment: effort score (rule-based, 0-10), LLM enrichment pipeline (sentiment, resolution, CSAT via single structured call). |
| `knowledge` | `@kilnai/core` | `packages/core/src/knowledge/` | RAG pipeline: chunkers (recursive, markdown), embedding adapters (OpenAI, Ollama), vector stores (InMemoryVectorStore, PgVectorStore with halfvec + HNSW + RRF hybrid search), STT adapters (OpenAI gpt-4o-transcribe, Deepgram nova-3), contextual enrichment (Anthropic pattern -- LLM-generated chunk prefixes, -49% failed retrievals), RetrievalPipeline (gap detection events), CohereReranker (Rerank v2, over-fetch 4x), knowledge modes (auto-inject context / tool-based search), content extractors (FileExtractor, UrlExtractor via Jina Reader, PdfExtractor via unpdf), SourceManager (extract -> hash -> ingest lifecycle with SHA-256 dedup), source stores (InMemorySourceStore, JsonSourceStore), ContactMemoryService (per-user fact extraction via LLM with Mem0 ADD/UPDATE/DELETE/NOOP pattern, recall at session start, GDPR forgetAll). |
| `channels` | `@kilnai/runtime` | `packages/runtime/src/channels/` | 8 channel adapters (CLI, Web, WhatsApp, Instagram, Messenger, Slack, Email, API), EventBridge, ChannelRegistry, ChannelRouter, formatForChannel. |
| `gateway` | `@kilnai/runtime` | `packages/runtime/src/gateway/` | Gateway runtime: multi-App loading, per-App isolation, Mode B routes, budget middleware, composable auth middleware (timing-safe comparisons, API key, Bearer, HMAC-SHA256, origin validation), cross-app delegation, trigger webhook mounting, dev-mode API routes (SSE, memory, cost, safety, token, orchestrator), WebSocket chat (heartbeat: 30s ping, 90s timeout), Studio static file serving, audio preprocessing (WhatsApp voice notes), knowledge pipeline wiring (auto/tool modes), STT + knowledge factories, knowledge admin CRUD routes (source management), enrichment admin CRUD routes (list, get, delete -- GDPR), lightweight dev server (`startDevServer`), webhook tool executor, integration runtime (IntegrationRegistry + IntegrationExecutor + LocalCredentialResolver), tenant tool factory, conversation event emission for tool execution, Meta webhook foundation (shared verification + HMAC-SHA256), WebhookDedup (at-least-once delivery protection for Meta channels), Instagram/Messenger/Email webhook routes, email loop guard, SqliteEmailThreadStore (persistent email threads). |
| `a2a` | `@kilnai/runtime` | `packages/runtime/src/a2a/` | A2A protocol: A2AClient (outbound delegation only). |
| `trigger` | `@kilnai/runtime` | `packages/runtime/src/trigger/` | TriggerRegistry, webhook handler (HMAC-SHA256), event listener, cron scheduler, trigger executor. |
| `session` | `@kilnai/runtime` | `packages/runtime/src/session/` | Mode B session management: ModeBSession (version tracking, optimistic concurrency, handoffCount, lastRouteChangeAt, enriched AgentTurnEntry with fromAgentId/handoffBrief), ModeBOrchestrator (AI guard, auto-reopen resolved, tool authorization, retry/fallback, result sanitization, tool result caching via cacheTtl annotation, indirect injection scanning on tool results, ToolRAG, PerCallToolConfig, per-agent cost attribution, model routing via ModelRouter + providerPool), SessionRegistry (pluggable SessionStore, save with concurrency check), SessionMode state machine (ai_active/queued/human_active/resolved), session serializer, AgentHandoffSummarizer (LLM-based warm handoff brief). |
| `tenant` | `@kilnai/runtime` | `packages/runtime/src/tenant/` | Multi-tenant management: TenantRegistry (webhook tool secret encryption, resolveByWidgetId, resolveByInstagramPageId, resolveByMessengerPageId, resolveByEmailAddress), system prompt builder, multi-agent routing (DefaultTenantRouter regex Tier 1, EmbeddingTenantRouter Tier 2 via AgentRAG, AgentResolver, ping-pong guard, warm handoff brief via AgentHandoffSummarizer), routing test endpoint, routing rule templates, multi-channel tenant resolution, model routing config. |
| `cli` | `@kilnai/cli` | `packages/cli/` | CLI commands (init, run, dev, gateway, skill, domain), formatters, MCP server. |
| `sdk` | `@kilnai/react` | `packages/sdk/` | React hooks library: KilnProvider, useKilnChat, useKilnWsChat, useKilnEvents, useKilnMemory, useKilnState, useApproval, ApiClient, SseClient. Types-only import from core. |
| `studio` | `@kilnai/studio` | `packages/studio/` | Dev UI SPA (private): React 19 + Vite + TanStack Query + @xyflow/react. 7 views (Graph, Playground, Timeline, Memory, Eval, Cost, Safety). Served at `/studio` in dev mode. |

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

Key responsibilities: session lifecycle, checkpointing (persist to SQLite after each phase transition), plan loading (hydrate `TaskTree` from architect structured output), implement loop (select batches, execute via `BatchExecutor`), interrupt/resume (pause at any point, checkpoint, resume via command), verification (instantiate `GateRunner` + `VerificationLoop`), memory sync, cost recording (`recordUsage()` public API for MCP/CLI consumers).

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

56 error codes are organized by bounded context. Each code maps to a context-aware suggestion via `getErrorSuggestion(code, context)` in `packages/core/src/engine/error-catalog.ts`.

| Context | Example Codes |
|---------|---------------|
| engine | `INVALID_YAML`, `MISSING_FIELD`, `UNKNOWN_TEAM`, `CIRCULAR_REFERENCE` |
| domain | `DOMAIN_NOT_FOUND`, `INVALID_DOMAIN_YAML`, `DOMAIN_ALREADY_REGISTERED` |
| tenant | `TENANT_NOT_FOUND`, `TENANT_ISOLATION_VIOLATION`, `DUPLICATE_TENANT` |
| routing | `ROUTING_FAILED`, `ROUTING_AGENT_NOT_FOUND` |
| provider | `PROVIDER_NOT_FOUND`, `API_KEY_MISSING`, `RATE_LIMITED`, `CONTEXT_LENGTH_EXCEEDED` |
| budget | `BUDGET_EXHAUSTED`, `TIER_RESTRICTED`, `BILLING_ENDPOINT_UNREACHABLE` |
| config | `INVALID_GATEWAY_CONFIG`, `PORT_IN_USE`, `APP_LOAD_FAILED` |
| agent intelligence | `TOOL_CALL_FAILED`, `GUARDRAIL_FAILED`, `MCP_CONNECTION_FAILED`, `CIRCUIT_OPEN` |
| security | `INJECTION_DETECTED`, `AUDIT_CHAIN_BROKEN`, `SECRET_DECRYPTION_FAILED` |
| skill | `SKILL_NOT_FOUND`, `INVALID_SKILL_YAML` |
| package | `LIFECYCLE_SCRIPT_DETECTED`, `PATH_TRAVERSAL_DETECTED`, `CONTENT_HASH_MISMATCH` |
| session | `INVALID_SESSION_TRANSITION`, `CONCURRENT_SESSION_MODIFICATION` |
| trigger | `WEBHOOK_SIGNATURE_INVALID`, `TRIGGER_EXECUTION_FAILED`, `INVALID_CRON` |
| eval | `DATASET_NOT_FOUND`, `SCORER_NOT_FOUND`, `EXPERIMENT_CYCLE_DETECTED` |

## Event System

43 typed events are emitted by the engine and broadcast to all connected channels. Source: `packages/core/src/events/event-bus.ts`.

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
| `cost_update` | `inputTokens`, `outputTokens`, `totalCostUsd`, `byRoleModel`. Requires `model` in `OrchestratorDeps`; defaults to $0 if missing. |
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
| `agent_routed` | `agentId`, `agentName`, `previousAgentId`, `routingTier`, `matchedPattern`, `confidence` |
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

## Multi-Model Routing

Model routing selects which LLM handles each request based on message complexity, budget, and operator-defined rules. The architecture separates interfaces (core) from orchestration (runtime).

**ModelRouter interface** (`packages/core/src/engine/domain/model-router.ts`): defines `RoutingRequest`, `RoutingDecision`, `RoutingRule`, and `ModelCapabilityProfile`. The `ModelRouter.route(request)` method returns a `RoutingDecision` with the selected model, provider, and reasoning.

**ModelCapabilityRegistry** (`packages/core/src/agents/model-capability-registry.ts`): ships 17 built-in model profiles across 5 providers with capability flags (reasoning, tool use, structured output, vision, speed, cost). The `eligible(request)` method filters profiles by required capabilities.

**ComplexityScorer** (`packages/core/src/agents/complexity-scorer.ts`): stateless scorer that evaluates 5 signals (message length, tool count, conversation depth, structured output requirement, modality) to produce a 0-1 complexity score in <1ms. No LLM calls.

**RulesRouter** (`packages/core/src/agents/rules-router.ts`): Tier 1 rules-based model routing. Evaluates priority-ordered `RoutingRule` entries (complexity thresholds, message patterns, tool requirements) and returns the first match. Falls back to the app's default model when no rule matches.

**ModeBOrchestrator integration**: accepts an optional `ModelRouter` and `providerPool` (map of provider name to adapter). When configured, each `processMessage()` call routes through the ModelRouter before selecting the provider adapter. The selected model is recorded on the response for cost tracking and observability.

## Conversation Enrichment

Post-conversation enrichment extracts analytics from completed sessions. The bounded context lives in `packages/core/src/enrichment/` (interfaces + rule-based scorers) and `packages/runtime/src/enrichment/` (persistence + runner).

**ConversationEnrichment** (`enrichment/types.ts`): the enrichment record type containing effort score, sentiment, resolution status, CSAT prediction, topic tags, and metadata.

**Customer Effort Score** (`enrichment/effort-score.ts`): rule-based scorer (0-10 scale) that analyzes conversation signals -- turn count, escalation events, agent handoffs, repeat questions. Zero LLM cost, runs synchronously.

**LlmConversationEnricher** (`enrichment/enrichment-pipeline.ts`): single LLM call with structured JSON output to extract sentiment, resolution, CSAT, and topic tags. PII guard strips sensitive data before sending to the LLM.

**SqliteEnrichmentStore** (`runtime/src/enrichment/sqlite-enrichment-store.ts`): SQLite-backed persistence with WAL mode and cursor-based pagination.

**EnrichmentRunner** (`runtime/src/enrichment/enrichment-runner.ts`): fire-and-forget runner triggered on session close. Calls effort scorer + LLM enricher, persists results, emits `conversation_enriched` event.

**Admin API** (`runtime/src/gateway/enrichment-admin-routes.ts`): CRUD routes at `/enrichment` (list with cursor pagination, get by session ID, delete for GDPR compliance).

## Observability Infrastructure

**PrometheusCollector** (`runtime/src/observability/prometheus-collector.ts`): implements the `EventStore` interface to collect metrics from engine events. Tracks counters (messages processed, tool calls, errors, routing decisions) and histograms (response latency, token usage). Exposes a `/metrics` endpoint in Prometheus text exposition format.

**CompositeEventStore** (`runtime/src/observability/composite-event-store.ts`): fan-out adapter that forwards events to multiple `EventStore` sinks (e.g., OTelExporter + PrometheusCollector simultaneously).

**Lifecycle events**: three new event types support enrichment and observability -- `CONVERSATION_CLOSED` (emitted on session resolve/expire), `CONVERSATION_ABANDONED` (emitted on session expire without resolution), `SESSION_STARTED` (wired to existing session creation).

## Security Architecture

Seven layers provide defense-in-depth, all opt-in via configuration.

**Prompt Injection Detection.** `PromptScanner`: Tier 1 runs 20+ regex patterns (zero cost) on every input; Tier 2 triggers an LLM deep scan for high-security contexts. Gateway middleware blocks or warns based on config. Also scans MCP tool descriptions at discovery time and tool results for indirect injection attempts (emits `security_alert` events). Source: `packages/core/src/security/prompt-scanner.ts`.

**Guardian Review.** Secondary LLM review for `destructive`-annotated capabilities. Configurable `blockOnError` (fail-closed vs fail-open) and `bypassForReadOnly`. Source: `packages/core/src/security/guardian.ts`.

**Encrypted Secrets.** `AesSecretStore`: AES-256-GCM with PBKDF2 key derivation. Atomic key rotation re-encrypts all values without downtime. Source: `packages/core/src/security/secret-store.ts`.

**Audit Logging.** `JsonlAuditLog`: append-only JSONL with SHA-256 hash chaining per entry, making the chain tamper-evident. `verifyChain()` validates integrity. Source: `packages/core/src/security/audit-log.ts`.

**Tenant Isolation.** Memory namespace enforcement (`SqliteMemoryStore` auto-tags by tenant and blocks cross-tenant queries) + filesystem jail (`createTenantSandbox()` restricts agent filesystem access to tenant-specific directories).

**Self-Audit Daemon.** `SelfAudit` runs periodic health checks: secrets encrypted, audit chain intact, tenant isolation enforced, configuration valid. Source: `packages/core/src/security/self-audit.ts`.

**Safety Pipeline.** `SafetyPipeline` orchestrates three stages on both input and output: PII detection (regex + optional LLM, 6 types including Luhn-validated credit cards, redact/block), content classification (6 categories, configurable thresholds), policy rails (topic, competitor, escalation, compliance). Short-circuits on block. Fail-open on errors. Source: `packages/core/src/safety/`.

**Gateway Auth Layer.** Four composable Hono middleware functions in `packages/runtime/src/gateway/auth-middleware.ts`: `requireApiKey` (X-Api-Key header), `requireBearer` (Authorization: Bearer), `requireWebhookSignature` (HMAC-SHA256 via configurable header), `isOriginAllowed` (origin validation utility for WebSocket). All secret comparisons use timing-safe equality (`timingSafeEqual`) to prevent timing attacks. Each channel type has one natural auth mechanism configured via `gateway.yaml` env var fields (`apiKeyEnv`, `appSecretEnv`, `adminTokenEnv`). Two-level origin validation for WebSocket widgets: channel-level `allowedOrigins` default, overridden by `TenantConfig.allowedOrigins`. All auth is optional — missing config logs a startup warning and runs unauthenticated.

## Key Entry Points

### Core (`packages/core/src/`)

| File | Purpose |
|------|---------|
| `engine/domain/agent.ts` | Agent interface (name, role, goal, backstory, tier, tools, modalities) |
| `engine/domain/capability.ts` | Capability interface (schema, tags, annotations: cacheTtl, guardrail, outputSchema) |
| `engine/domain/workflow.ts` | Workflow interface (phases, gates) |
| `engine/domain/memory.ts` | Memory interface (5 scopes, store/recall/forget) |
| `engine/domain/task.ts` | Task interface (tree structure, statuses, actions) |
| `engine/domain/channel.ts` | Channel interface (receive/send/stream), IncomingMessage/OutgoingMessage with `ContentPart[]` |
| `engine/domain/content.ts` | ContentPart union (Text, Image, Audio, File) + helpers (textPart, textParts, extractText, hasModality) |
| `engine/domain/trigger.ts` | Trigger union (Webhook, Event, Schedule) + validateTrigger() |
| `engine/composites/app.ts` | App composite (includes `events?: EventsConfig`) + validateApp() |
| `engine/composites/team.ts` | Team composite + validateTeam() |
| `engine/composites/router.ts` | Router composite + validateRouter() |
| `engine/loader/app-loader.ts` | YAML -> App (parseAppYaml, validateAppGraph) |
| `engine/errors.ts` | KilnError base class (76 codes) + KilnErrorCode union type |
| `engine/error-catalog.ts` | getErrorSuggestion(): context-aware suggestions + doc URLs |
| `orchestrator/orchestrator.ts` | Session lifecycle, checkpoint/resume, strategy-based execution |
| `orchestrator/threshold-allocator.ts` | `ThresholdAllocator`: response-threshold task allocation (ant colony model). Per-agent per-category thresholds, `allocate()` (strict), `allocateWithFallback()` (least-resistant). Adaptive EMA learning: `recordOutcome()` adjusts thresholds via `AdaptiveConfig` (alpha, successDelta, failureDelta, floor/ceiling, hysteresisWindow). `resetAdaptation(agentId?)` restores initial state. 7 `TaskCategory` types. |
| `orchestrator/demand-signal.ts` | `inferCategory()` maps `ComplexityScore` signals to `TaskCategory`, `buildTaskDemand()` builds `TaskDemand` from complexity. |
| `orchestrator/cascade-controller.ts` | `CascadeController`: damped cascade energy model for handoff chain termination (neural field theory). `A(t+1) = decay * A(t) + gain - cost`. Initial energy from complexity (0.3–1.0 range). `shouldContinue(gain)` returns whether chain continues. Hard `maxDepth` safety net. History tracking via `CascadeSnapshot`. |
| `orchestrator/task-channel.ts` | `TaskChannel`: stigmergy coordination substrate (Workforce task channel pattern). `publish()` → `claim()` → `complete()`/`fail()`/`release()` lifecycle. Auto-unblocks dependents. Results-only publishing (no tool call logs). Queries: `open()`, `byStatus()`, `byAssignee()`, `counts()`. |
| `orchestrator/team-composer.ts` | `TeamComposer`: domain-driven team templates (4 built-in: java-spring, react-typescript, python, generic). `compose(domain, complexity)` returns `ComposedTeam` with pre-configured `ThresholdAllocator` + `CascadeController`. Roles: required vs on-demand (complexity < 0.4 filters). `pipelineOrder` for sequential chains. `BUILTIN_TEMPLATES` frozen array. |
| `orchestrator/phase-machine.ts` | Configurable phases + gates |
| `agents/infrastructure/anthropic.ts` | Anthropic SDK adapter (retry, streaming, structured outputs) |
| `agents/infrastructure/openai.ts` | OpenAI adapter |
| `agents/infrastructure/deepseek.ts` | DeepSeek adapter |
| `agents/infrastructure/openrouter.ts` | OpenRouter adapter (free-tier models via OpenAI-compat API) |
| `agents/infrastructure/ollama.ts` | Ollama adapter (local models) |
| `agents/infrastructure/codex-oauth-auth.ts` | OAuth device code flow (PKCE), token storage/refresh at `~/.kiln/auth/codex-oauth.json`, auto-refresh 120s before expiry |
| `agents/infrastructure/codex-oauth.ts` | `CodexOAuthAdapter`: ProviderAdapter for OpenAI Responses API at `chatgpt.com/backend-api/codex/responses`, $0 marginal cost, 401 retry with token refresh |
| `agents/mcp-client.ts` | MCP client (Streamable HTTP via official SDK, circuit breaker) |
| `agents/tool-rag.ts` | Embedding-based tool selection |
| `agents/agent-rag.ts` | Embedding-based agent routing (Tier 2) |
| `agents/sliding-window-rate-limiter.ts` | In-memory sliding window rate limiter (per-tool, per-tenant) |
| `engine/domain/rate-limiter.ts` | RateLimiter, RateLimitConfig, RateLimitResult interfaces |
| `engine/domain/integration.ts` | IntegrationAdapter, IntegrationOperation, IntegrationResult, CredentialResolver, ResolvedCredential interfaces |
| `engine/domain/tool-execution.ts` | RetryStrategy, ToolAuthorizer, ToolExecutionResult interfaces |
| `tools/domain/tool.ts` | `DevTool`, `ToolResult`, `DevToolName`, `TOOL_SCHEMAS` (7 tools) |
| `tools/domain/tool-registry.ts` | `DevToolRegistry` register (throws on duplicate)/lookup/list |
| `tools/domain/tool-environment.ts` | Binary detection (`rg`, `fd`, `jq`, `git`), process-wide cache, `clearToolEnvironmentCache()` |
| `tools/infrastructure/tool-helpers.ts` | Shared sandbox helpers + extracted grep/glob fallback utils (`runCommand`, `walkFiles`, `matchesGlob`, `globToRegExp`, `normalizePath`) |
| `tools/tool-executor.ts` | `DevToolExecutionBridge`: authorization (deny vs approval-required), retry/fallback, event emission |
| `tools/mcp/dev-tools-server.ts` | `DevToolsMcpServer`: MCP stdio surface, instance-level SDK caching |
| `tools/index.ts` | Tools bounded-context barrel export |
| `index.ts` | Root `@kilnai/core` export surface (includes `./tools/index.js`) |
| `memory/sqlite-store.ts` | SQLite + FTS5 memory (decay, compaction, tenant namespacing) |
| `safety/safety-pipeline.ts` | PII -> content -> rails pipeline (fail-open) |
| `eval/experiment-runner.ts` | Generate outputs, score with error isolation |
| `eval/consistency-runner.ts` | tau-bench pass^k metric: run experiment k times, measure consistency |
| `knowledge/retrieval-pipeline.ts` | Ingest (chunk -> embed -> store) + retrieve (embed -> search -> rerank) |
| `knowledge/source-manager.ts` | Source lifecycle: extract -> hash -> ingest, content dedup via SHA-256, content push (ingestContent) |
| `knowledge/infrastructure/pgvector-store.ts` | PgVectorStore: PostgreSQL + pgvector (halfvec, HNSW, RRF hybrid search) |
| `knowledge/infrastructure/file-extractor.ts` | Local file content extraction (text, markdown) |
| `knowledge/infrastructure/url-extractor.ts` | URL extraction via Jina Reader + raw fetch fallback |
| `knowledge/infrastructure/pdf-extractor.ts` | PDF extraction via unpdf (optional dep, dynamic import) |
| `agents/infrastructure/openai-stt.ts` | OpenAI STT adapter (gpt-4o-transcribe, fetch-based, withRetry) |
| `agents/infrastructure/deepgram-stt.ts` | Deepgram STT adapter (nova-3, fetch-based, withRetry) |
| `knowledge/contact-memory.ts` | ContactMemoryServiceImpl: per-user fact extraction (LLM), recall, forget, forgetAll (GDPR) |
| `knowledge/infrastructure/cohere-reranker.ts` | Cohere Rerank v2 adapter (over-fetch 4x, KnowledgeRerankerConfig) |
| `domains/routing-templates.ts` | 3 built-in routing templates (service-business, ecommerce, customer-support) |
| `engine/domain/model-router.ts` | ModelRouter, ModelCapabilityProfile, RoutingRequest, RoutingDecision, RoutingRule interfaces |
| `agents/model-capability-registry.ts` | Built-in model capability profiles (17 models across 5 providers), eligible() filtering |
| `agents/complexity-scorer.ts` | Stateless complexity scoring (5 signals, <1ms) |
| `agents/rules-router.ts` | Rules-based model routing (Tier 1, priority-ordered) |
| `enrichment/types.ts` | ConversationEnrichment, CompletedSession, EnrichmentStore, ConversationEnricher interfaces |
| `enrichment/effort-score.ts` | Customer Effort Score (rule-based, 0-10 scale, zero LLM) |
| `enrichment/enrichment-pipeline.ts` | LlmConversationEnricher (single-call, structured JSON, PII guard) |

### Runtime (`packages/runtime/src/`)

| File | Purpose |
|------|---------|
| `gateway/gateway-server.ts` | startGateway() + startDevServer(): Bun.serve, multi-app, Mode B, triggers, dev mode, lightweight Mode A dashboard, integration adapter wiring (StartGatewayOptions.integrations + secretKeyEnv), MCP server wiring (optional, gateway.yaml `mcp` block) |
| `gateway/gateway-routes.ts` | Hono app factory: health + per-App routes + A2A + webhooks |
| `gateway/auth-middleware.ts` | Composable auth: requireApiKey, requireBearer, requireWebhookSignature, requireJwt, isOriginAllowed |
| `gateway/jwt-verifier.ts` | JWT verification: buildJwtVerifier() -- RS256 via JWKS (jose createRemoteJWKSet) or HS256 via shared secret |
| `gateway/mode-b-routes.ts` | POST /message, GET/DELETE /sessions |
| `gateway/delegation-handler.ts` | DelegationRegistry, executeDelegation() (Kiln-native + A2A) |
| `gateway/budget-middleware.ts` | checkBudget(), reportUsage() -- fail-open |
| `gateway/conversation-event-emitter.ts` | Fire-and-forget POST of conversation events to product webhooks, env var resolution for headers |
| `gateway/whatsapp-webhook-routes.ts` | WhatsApp webhook: tenant resolution, persistent memory (SQLite), builtin notify_owner tool, audio preprocessing, knowledge retrieval, tenant-level billing override, conversation event emission |
| `gateway/instagram-webhook-routes.ts` | Instagram webhook: tenant resolution, full pipeline |
| `gateway/messenger-webhook-routes.ts` | Messenger webhook: tenant resolution, full pipeline |
| `gateway/email-webhook-routes.ts` | Email webhook: inbound parsing, thread tracking, auto-reply |
| `gateway/meta-webhook-foundation.ts` | Shared Meta verification + HMAC-SHA256 |
| `gateway/email-loop-guard.ts` | Auto-reply detection (RFC 3834), ignored senders |
| `gateway/email-thread-store.ts` | Email thread tracking via Message-ID chain |
| `gateway/sqlite-email-thread-store.ts` | SQLite-backed email thread store (persistent across restarts) |
| `gateway/webhook-dedup.ts` | Meta webhook message deduplication (at-least-once delivery protection) |
| `gateway/ws-tenant-routes.ts` | Multi-tenant WebSocket: welcome frame (greeting + FAQ suggestions + preChatForm), identify frame handling (visitor sanitization, displayName passthrough), AI follow-up suggestion chips, audio preprocessing, knowledge retrieval, BUDGET_EXHAUSTED error code, conversation event emission |
| `gateway/visitor-sanitizer.ts` | Visitor input sanitization: length limits, format validation (email/phone), zero-width char removal, system prompt formatting |
| `gateway/audio-preprocessor.ts` | Audio preprocessing: MediaDownloader (WhatsApp two-step, generic), fail-open transcription |
| `gateway/stt-factory.ts` | Resolve SttProviderConfig to concrete SttAdapter |
| `gateway/knowledge-factory.ts` | Resolve KnowledgeConfig to RetrievalPipeline + VectorStore + close(), createSourceManager() |
| `gateway/context-formatter.ts` | formatKnowledgeContext, formatContactContext, mergeContextSources -- shared by WS tenant, WhatsApp, Mode B |
| `gateway/knowledge-admin-routes.ts` | Knowledge source CRUD: /sources (list, create with auth headers, get, reindex, delete), content push (/sources/:id/content) |
| `gateway/contact-memory-admin-routes.ts` | Contact memory CRUD: /facts (list, forget, forgetAll -- GDPR) |
| `gateway/memory-routes.ts` | Production memory routes: /api/memory (all modes) |
| `gateway/dev-routes.ts` | Dev-mode: /dev/state, /dev/events (SSE), /dev/memory, /dev/cost, /dev/safety, /dev/token, /dev/run |
| `gateway/dev-token-store.ts` | In-memory sliding-window TTL token store for dev-mode WebSocket auth |
| `gateway/dev-orchestrator.ts` | DevOrchestrator: bridges core Orchestrator with ApprovalGateRegistry and gateway EventBus |
| `channels/whatsapp-channel.ts` | WhatsApp Business API webhook adapter |
| `channels/instagram-channel.ts` | Instagram DM adapter (Graph API v21.0, text + image) |
| `channels/instagram-api.ts` | Instagram send API (raw fetch) |
| `channels/messenger-channel.ts` | Messenger adapter (Graph API v21.0, text + image) |
| `channels/messenger-api.ts` | Messenger send API (raw fetch) |
| `channels/email-channel.ts` | Email adapter (full format, text + file) |
| `channels/email-api.ts` | Email transport (Postmark, Resend, Generic) |
| `channels/email-template.ts` | HTML email rendering (inline CSS, branding) |
| `channels/slack-channel.ts` | Slack Bot Events + Web API adapter |
| `session/session-registry.ts` | Multi-user session management + cleanup, save() with optimistic concurrency, SESSION_EXPIRED event emission |
| `session/session-mode.ts` | SessionMode type (ai_active, queued, human_active, resolved), transition validator |
| `session/session-store.ts` | SessionStore interface (async get/set/delete/deleteByPrefix/keys) |
| `session/in-memory-session-store.ts` | Map-based SessionStore for dev mode and tests |
| `session/redis-session-store.ts` | Redis adapter with dynamic ioredis import, key prefix, TTL |
| `session/session-serializer.ts` | JSON roundtrip for ModeBSession (handles Dates, ContentPart[], SessionMode) |
| `session/escalation-detector.ts` | EscalationDetector interface, DefaultEscalationDetector (keywords + loop detection) |
| `session/context-summarizer.ts` | ContextSummarizer interface, DefaultContextSummarizer (LLM-based) |
| `gateway/handoff-routes.ts` | Handoff API: /handoff, /release, /operator-message, /session-history |
| `gateway/webhook-tool-executor.ts` | WebhookToolExecutor: HTTP POST + HMAC-SHA256 for external tool calls |
| `gateway/integration-registry.ts` | IntegrationRegistry: adapter registry with register(), get(), resolveOperation(), getToolDefinitions() |
| `gateway/integration-executor.ts` | IntegrationExecutor: per-tenant adapter execution with credential resolution (30s timeout) |
| `gateway/local-credential-resolver.ts` | LocalCredentialResolver: SecretStore-backed credential resolution (JSON structured or plain bearer) |
| `gateway/tenant-tool-factory.ts` | buildTenantToolContext(): per-tenant tool infrastructure (webhook tools, integration tools, allowlist, rate limiter) |
| `tenant/tenant-router.ts` | DefaultTenantRouter (regex Tier 1), EmbeddingTenantRouter (Tier 2 via AgentRAG, async routeAsync) |
| `tenant/agent-resolver.ts` | resolveAgentContext() + resolveAgentContextAsync(): single integration point for all channel handlers (routing, prompt overlay, tool scoping, warm handoff brief, ping-pong guard, Tier 2 embedding) |
| `gateway/routing-test-routes.ts` | POST /tenants/:id/routing/test (dry-run routing), GET /routing/templates |
| `gateway/enrichment-admin-routes.ts` | Enrichment CRUD: /enrichment (list, get, delete -- GDPR) |
| `tenant/ping-pong-guard.ts` | checkPingPong(): stateless guard preventing agent switching loops (maxHandoffs, cooldown, bidirectional pair) |
| `session/agent-handoff-summarizer.ts` | AgentHandoffSummarizer: LLM-generated warm handoff brief on agent switch |
| `gateway/message-pipeline.ts` | Shared processInboundMessage pipeline (budget, session, orchestrate, events, tool event emission) |
| `gateway/trace-context.ts` | TraceContext: per-request trace ID + structured logging |
| `trigger/trigger-registry.ts` | Per-app lifecycle, webhook app, event listener, scheduler |
| `enrichment/sqlite-enrichment-store.ts` | SQLite-backed EnrichmentStore (WAL, cursor pagination) |
| `enrichment/enrichment-runner.ts` | Fire-and-forget post-conversation enrichment runner |
| `observability/prometheus-collector.ts` | PrometheusCollector EventStore (counters, histograms, /metrics) |
| `observability/composite-event-store.ts` | Fan-out to multiple EventStore sinks |
| `mcp/gateway-mcp-server.ts` | GatewayMcpServer: MCP Streamable HTTP server exposing 25 gateway tools (stateless per-request, dynamic SDK import, optional api-key auth) |
| `mcp/gateway-mcp-types.ts` | GatewayMcpDeps: dependency injection interface for all 25 gateway capabilities |
| `mcp/tool-schemas.ts` | JSON Schema definitions for 25 MCP tools (memory, knowledge, cost, safety, integrations, routing, eval, enrichment, cross-agent memory, swarm primitives) |
| `mcp/swarm-store.ts` | SwarmStore: SqliteMemoryStore-backed swarm state (join/leave/status/broadcast/claim/release) with _swarm:/_member:/_claim: tag conventions |
| `gateway/tui-gateway.ts` | `startTuiGateway()`: in-process gateway on port 4801 for TUI WS connections; `TuiGatewayOptions.onClear` callback — handles `{ type: "clear" }` WS frame, calls `onClear()`, replies `{ type: "cleared" }`. |

### TUI (`packages/tui/src/`)

| File | Purpose |
|------|---------|
| `app.tsx` | Main TUI application: two-column layout (chatArea + divider + sidebar), printable-first key routing, Ctrl+V paste, /clear command, theme token rendering, sidebar auto-collapse < 100 cols. |
| `theme.ts` | `KilnTheme` interface (15 semantic tokens), 5 built-in themes: `kiln-dark`, `dracula`, `catppuccin-mocha`, `nord`, `tokyo-night`. `defaultTheme = kilnDark`. `themes: Record<string, KilnTheme>` export. |
| `gateway-session.ts` | `GatewaySession`: WS-based session adapter implementing `IKilnSession`-compatible interface; `clear()` sends `{ type: "clear" }` frame and awaits `{ type: "cleared" }` with 5s timeout. |
| `ws-client.ts` | `WsClient`: Bun WebSocket client for TUI↔gateway; `TuiOutboundFrame` includes `{ type: "clear" }`; `TuiInboundFrame` includes `{ type: "cleared" }`. |
| `types.ts` | Shared TUI type definitions. |
| `index.ts` | Re-exports: `startTui`, all 5 themes, `defaultTheme`, `themes`, `type KilnTheme`. |

### CLI (`packages/cli/src/`)

| File | Purpose |
|------|---------|
| `index.ts` | Command dispatch (init, run, dev, domain, gateway, skill, memory, config, status, cron, sync) |
| `commands/auth.ts` | `kiln auth codex login\|status\|logout` — OAuth device code flow, token status, credential removal |
| `commands/mcp-config.ts` | `kiln mcp-config` command: `--client claude-code\|codex\|opencode\|all` (default: claude-code); `--name`, `--command`, `--args` overrides; async, writes to disk. |
| `commands/init.ts` | Interactive wizard: generates app.yaml + gateway.yaml |
| `commands/dev.ts` | Dev mode with YAML hot-reload |
| `commands/cron.ts` | `kiln cron` command: list, add, remove, run subcommands for schedule triggers. Dynamic import of `@kilnai/runtime` for Scheduler + EventBus. |
| `wrapper/session.ts` | `KilnPermissionAction`, `KilnPermissionApproval` (`never`\|`on-request`\|`on-failure`\|`untrusted`), `KilnSandboxMode` (`read-only`\|`workspace-write`\|`danger-full-access`), `KilnToolPermissionRule`, `KilnCommandPermissionRule`, `KilnFileGovernancePolicy`, `KilnDataFirewallRule`, `KilnAgentPermissionScope`, `KilnPermissionPolicy` (all fields optional), `SessionCapabilities.permissionPolicy`, `SessionEvent` discriminated union, `IKilnSession` interface with `providerSessionId: string \| undefined` |
| `wrapper/session-manager.ts` | SessionManager: pre-session setup (domain detection, system prompt via buildPreamble, MCP path, memorySnapshot passthrough) + post-session report (duration, cost aggregation). Falls back to `defaultBuildSystemPrompt` if `KilnAppConfig.buildSystemPrompt` is omitted. |
| `wrapper/preamble-builder.ts` | Pure functions `buildPreamble(ctx, policy, agent?)` and `buildProviderSystemPrompt(basePrompt, constraintInstructions?)` — assembles `<kiln-preamble>` XML for harness sessions and plain system prompts for direct provider sessions. |
| `config.ts` | `KilnAppConfig`: `buildSystemPrompt` now optional with `defaultBuildSystemPrompt` as sensible default (calls `buildPreamble`). `SystemPromptOptions` with `task`, `domain`, `memorySnapshot?`, `projectPath`. |
| `wrapper/provider-session.ts` | `ProviderSession` implementing `IKilnSession` for direct API backends (`anthropic`, `openai`, `deepseek`, `openrouter`, `ollama`); resolves provider credentials, maps provider stream events to `SessionEvent`, and supports governed direct-provider prompt assembly. |
| `wrapper/provider-context.ts` | `ProviderContextTracker`: direct-provider token accumulation and compaction-threshold checks for Kiln-managed context windows. |
| `wrapper/session-registry.ts` | `translatePermission()` for harness backends, `translatePermissionForProvider()` for direct API backends, `ProviderCreateConfig` with `permissionPolicy`, `DEFAULT_POLICY`, SessionRegistry + circuit breaker: unified 8-provider pool, priority-ordered selection, capability filtering, 30s suppression, half-open probing. |
| `wrapper/claude-code-process.ts` | ClaudeSession implementing IKilnSession: async generator `run()`, `dispose()`, `sessionId`, `capabilities`; `permissionPolicy` field on config; `derivePermissionPolicy()` helper computing `permissionPolicy` from SDK-level flags (`permissionMode`, `allowDangerouslySkipPermissions`); yields `SessionEvent` variants: text_delta, tool_use, cost_update, completed, error |
| `wrapper/opencode-session.ts` | OpenCodeSession implementing IKilnSession: spawns `opencode serve`, connects via SDK (HTTP), maps ACP SSE events to `SessionEvent`; `sandboxMode` + `permissionPolicy` on config; applies permissions and MCP server (Phase 2e) via `PATCH /config` after server is ready; requires opencode >= v1.3.6 |
| `wrapper/codex-session.ts` | CodexSession implementing IKilnSession: spawns `codex exec --json`, parses JSONL events, maps to `SessionEvent` variants; `sandboxMode` + `permissionPolicy` on config; `derivePermissionPolicy()` helper; `approvalMode` correctly wired to spawn args (was previously hardcoded to "never"); `costTrackingMode: "computed"`; requires codex >= v0.117.0 |
| `wrapper/worktree-manager.ts` | WorktreeManager: git worktree lifecycle (allocate, release, pruneStale, list); porcelain parser uses newline format (not null-byte); `WorktreeHandle` with path, branch, sessionId; `WorktreeError` with stdout/stderr; `GitRunner` interface for testability. |
| `wrapper/local-session.ts` | LocalSession (planned, Phase 5): llama-server + TurboQuant KV cache compression — see STRATEGY.md for details and blockers. |
| `wrapper/permission-normalizer.ts` | `SAFE_DEFAULTS_TOOL_RULES`, `SAFE_DEFAULTS_COMMAND_RULES`, `SAFE_DEFAULTS_FILE_GOVERNANCE`, `SAFE_DEFAULTS_DATA_FIREWALL` constants; `normalizePermissionPolicy()` — applies safe-defaults base, merges user rules (last-match-wins for tools/commands by key), deduplicates globs |
| `wrapper/index.ts` | Re-exports `KilnPermissionPolicy`, `KilnPermissionApproval`, `KilnSandboxMode`, granular rule types, `translatePermission`, `buildPreamble`, all `BackendConfig` types; `WrapperConfig.permissionPolicy: KilnPermissionPolicy` |
| `commands/run.ts` | `kiln run` command: `permissionPolicy?: KilnPermissionPolicy` on `RunFlags`; registry-driven session selection with circuit breaker fallback. Direct API providers bypass MCP requirements when explicitly selected. Real `toolCount` + `turnDepth` tracking. Persists `.kiln/sessions/{id}/meta.json` + `transcript.jsonl` per session (fail-open). Plan mode + `--workers N` flag. |
| `application/plan-exit-tool.ts` | `PlanSubmission` interface, `PLAN_EXIT_TOOL_NAME = "submit_plan"`, `planExitToolSchema` — tool schema the planning agent calls to submit its completed plan for user review |
| `application/agent-loader.ts` | `KilnAgentDefinition` type, `loadAgentDefinitions(projectPath)`, `findAgent()` — loads `*.md` agent definitions from `~/.kiln/agents` + `.kiln/agents`, project overrides global |
| `commands/skill.ts` | `kiln skill` subcommands: `list`, `install`, `publish`, `capture`. |
| `commands/skill-capture.ts` | `kiln skill capture [sessionId] --last --scope project\|user --yes --dry-run` — two-phase interactive skill promotion: loads transcript → SkillCaptureService.extractSummary → generateSkill → user review → write SKILL.md. |
| `wrapper/session-store.ts` | `SessionStore`: append-only JSONL index at `.kiln/sessions.jsonl`. `SessionRecord.providerSessionId` — unified provider-native session ID. `TranscriptStore`: per-session `meta.json` + `transcript.jsonl` persistence. |
| `commands/tui.ts` | `kiln tui` command: `--provider`, `--theme` flags; `makeResumableSessionFactory()` async factory with disk persistence + `onClear` callback; starts `startTuiGateway()` in-process, connects via WS. |
| `config/global-config.ts` | `KilnGlobalConfig` schema + loader — reads/writes `~/.kiln/config.yaml` (XDG-aware) |
| `config/config-merger.ts` | `loadKilnConfig(projectPath)` — merges `~/.kiln/config.yaml` (global base) + `.kiln/kiln.yaml` (project override) |
| `config/env-config.ts` | `resolveEffectiveProvider/Model()` — priority chain: CLI flag > env > `~/.kiln/config.yaml` > undefined |
| `mcp/config-generator.ts` | `generateMcpConfig(client, serverDef, projectPath)`: writes to `.mcp.json` (Claude Code), `~/.codex/config.toml` (Codex), `~/.config/opencode/opencode.json` (OpenCode). |
| `sync/security-sync.ts` | `syncPermissions()` — translates kiln.yaml permissions to each backend's native format. Merge-only. |
| `sync/agent-sync.ts` | `syncAgents()` — translates `KilnAgentDefinition` to Claude Code `.md`, Codex `.toml`, OpenCode `.md` |
| `sync/skill-sync.ts` | `syncSkills()` — copies skill dirs to all three CLI skill directories |
| `sync/agents-md-sync.ts` | `syncAgentsMd()` — generates GFM `AGENTS.md` from kiln.yaml + agent definitions |
| `sync/hook-sync.ts` | `syncHooks()` — copies `autoformat.sh` to `.claude/hooks/` and `.codex/hooks/`, registers in `.claude/settings.json` |
| `commands/sync.ts` | `kiln sync [--permissions] [--hooks] [--agents] [--agents-md] [--skills] [--all]` — prints per-backend result table |
| `commands/auth.ts` | `kiln auth codex login` (device code + PKCE), `status` (token validity), `logout` (credential removal) |

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
│   │       ├── domain/                   # domain-registry.ts, yaml-schema.ts, domain-package-adapter.ts
│   │       ├── domains/                  # react-ts.yaml, python.yaml, docs.yaml, support.yaml, data-pipeline.yaml
│   │       ├── package/                  # types.ts, security.ts, yaml-schema.ts, yaml-parser.ts
│   │       ├── skill/                    # skill-registry.ts, md-parser.ts, types.ts
│   │       ├── eval/                     # scorers/, dataset-loader.ts, experiment-runner.ts, comparator.ts
│   │       ├── knowledge/                # chunkers, embedding adapters, vector store, retrieval pipeline
│   │       ├── security/                 # audit-log.ts, prompt-scanner.ts, secret-store.ts, guardian.ts
│   │       └── safety/                   # pii-scanner.ts, content-classifier.ts, rails.ts, safety-pipeline.ts
│   ├── runtime/                          # @kilnai/runtime
│   │   └── src/
│   │       ├── gateway/                  # gateway-server.ts, gateway-routes.ts, auth-middleware.ts, handoff-routes.ts, message-pipeline.ts, trace-context.ts, dev-routes.ts, ws-routes.ts, dev-token-store.ts, dev-orchestrator.ts, approval-registry.ts, instagram-webhook-routes.ts, messenger-webhook-routes.ts, email-webhook-routes.ts, meta-webhook-foundation.ts, email-loop-guard.ts, email-thread-store.ts, sqlite-email-thread-store.ts, webhook-dedup.ts
│   │       ├── session/                  # mode-b-session.ts, mode-b-orchestrator.ts, session-registry.ts, session-mode.ts, session-store.ts, session-serializer.ts, escalation-detector.ts, context-summarizer.ts
│   │       ├── tenant/                   # tenant-registry.ts, system-prompt-builder.ts
│   │       ├── channels/                 # cli-, web-, whatsapp-, instagram-, messenger-, slack-, email-, api-channel.ts, channel-router.ts, whatsapp-api.ts, instagram-api.ts, messenger-api.ts, email-api.ts, email-template.ts
│   │       ├── trigger/                  # trigger-registry.ts, webhook-handler.ts, scheduler.ts
│   │       └── a2a/                      # a2a-client.ts
│   ├── cli/                              # @kilnai/cli
│   │   └── src/
│   │       ├── commands/                 # init.ts, dev.ts, gateway.ts, skill.ts
│   │       └── formatters.ts
│   ├── sdk/                              # @kilnai/react
│   │   └── src/
│   │       ├── provider.tsx
│   │       ├── use-kiln-chat.ts
│   │       ├── use-kiln-ws-chat.ts
│   │       ├── use-kiln-events.ts
│   │       ├── use-kiln-memory.ts
│   │       ├── use-kiln-state.ts
│   │       ├── use-approval.ts
│   │       ├── api-client.ts
│   │       └── sse-client.ts
│   └── studio/                           # @kilnai/studio (private)
│       └── src/
│           ├── routes/                   # graph.tsx, playground.tsx, timeline.tsx, memory.tsx, eval.tsx, cost.tsx, safety.tsx
│           ├── hooks/                    # use-app-graph.ts
│           └── styles/                   # tokens.css
├── docs/
│   ├── architecture.md                   # This document
│   ├── guides/                           # User guides (multi-tenant, delegation, domains, eval, knowledge)
│   └── sdk/                              # SDK docs (react-hooks, studio)
├── CLAUDE.md
├── CONTRIBUTING.md
└── package.json
```
