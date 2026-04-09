# Kiln - Domain-Agnostic AI Orchestration Engine

Apache-2.0 licensed. YAML-configured AI orchestration with 7 primitives (Agent, Capability, Workflow, Memory, Task, Channel, Trigger) + 3 composites (Team, Router, App). Multi-tenant gateway, 8 channel adapters, provider adapters, cross-app delegation, eval framework, enterprise safety pipeline.

## Architecture

Bun monorepo with 6 packages:

| Package | Scope | Purpose |
|---------|-------|---------|
| `packages/core` | `@kilnai/core` | Engine primitives, implementations, YAML loader |
| `packages/runtime` | `@kilnai/runtime` | Gateway server, channel adapters, triggers |
| `packages/cli` | `@kilnai/cli` | CLI commands, init wizard, dev mode |
| `packages/sdk` | `@kilnai/react` | React hooks (KilnProvider, useKilnChat, useKilnWsChat, useKilnEvents, useKilnMemory, useKilnState, useApproval) |
| `packages/widget` | `@kilnai/widget` | Embeddable chat widget (Shadow DOM, auto-reconnect WS, zero deps) |
| `packages/studio` | `@kilnai/studio` | Dev UI SPA (private, served at `/studio` in dev mode) |

### Bounded Contexts

| Context | Location | Purpose |
|---------|----------|---------|
| engine | `core/src/engine/` | 7 primitives + 3 composites + YAML loader + gateway config + cron parser. Zero external deps except `yaml`. |
| orchestrator | `core/src/orchestrator/` | Phase machine, checkpoint/resume, strategies (sequential, supervisor, swarm). Coordination Intelligence: ThresholdAllocator (ant colony), CascadeController (neural field), TaskChannel (stigmergy), TeamComposer (domain templates), adaptive EMA learning. SwarmStrategy wired to all 5 primitives. |
| agents | `core/src/agents/` | Provider adapters (Anthropic, OpenAI, DeepSeek, OpenRouter, Ollama), tool cache, MCP client (Streamable HTTP, official SDK), circuit breaker, Tool RAG, model capability registry, complexity scorer, rules router, sliding window rate limiter |
| memory | `core/src/memory/` | Scoped storage (user, agent, team, project, org), SQLite + FTS5, git sync, decay, compaction |
| tree | `core/src/tree/` | Task tree (scoring, deepen/branch/prune), batch executor |
| sandbox | `core/src/sandbox/` | Per-agent filesystem + network isolation |
| verification | `core/src/verification/` | Gate runner: test, lint, type-check loop |
| events | `core/src/events/` | EventBus (43 typed events, ring buffer), EventStore sink |
| security | `core/src/security/` | Audit log (JSONL + hash chain), prompt injection (2-tier), AES-256-GCM secrets, Guardian, self-audit |
| safety | `core/src/safety/` | PII scanner (2-tier, 6 types, Luhn validation), content classifier (6 categories), 4 policy rails, grounding rail (post-generation LLM judge, model-routed, fail-open), pipeline orchestrator, indirect injection scanning on tool results |
| cost | `core/src/cost/` | Per-role:model cache-aware cost tracking, STT + embedding cost tracking |
| knowledge | `core/src/knowledge/` | RAG: chunkers (recursive, markdown), embedding adapters (OpenAI, Ollama), vector stores (InMemory, PgVector with halfvec + HNSW + RRF hybrid search), STT adapters (OpenAI gpt-4o-transcribe, Deepgram nova-3), contextual enrichment (Anthropic pattern), retrieval pipeline (gap detection events), CohereReranker (Rerank v2, over-fetch 4x), knowledge modes (auto-inject / tool), content extractors (file, URL via Jina Reader, PDF via unpdf) with ExtractionOptions (auth headers), SourceManager (extract -> hash -> ingest lifecycle, content push), source stores (InMemory, JSON file), ContactMemoryService (per-user fact extraction via LLM, Mem0 ADD/UPDATE/DELETE/NOOP pattern, recall at session start) |
| domain | `core/src/domain/` | Domain config: tech stack detection, YAML schema, DomainRegistry. Built-in kits at `core/src/domains/*.yaml` |
| package | `core/src/package/` | Distribution: versioning, content hashing, security validation |
| skill | `core/src/skill/` | SKILL.md format (markdown + YAML frontmatter), SkillRegistry (3-tier discovery, progressive disclosure), SkillGenerator (auto-generate post-session, two-phase when transcript available), SkillCaptureService (Phase 1: extractSummary → JSON; Phase 2: generateSkill → SKILL.md), PersistedTranscriptEvent type, runtime injection via PerCallToolConfig.skillInstructions |
| tools | `core/src/tools/` | Native developer tools (Phase 9): `DevTool`, `DevToolRegistry`, `ToolEnvironment`, 7 executors (`bash`, `read`, `write`, `edit`, `grep`, `glob`, `git`), `DevToolExecutionBridge`, `DevToolsMcpServer`. Shared fallback helpers in `tool-helpers.ts`. |
| enrichment | `core/src/enrichment/` | Post-conversation enrichment: effort score, LLM enrichment pipeline, sentiment/resolution/CSAT |
| eval | `core/src/eval/` | 23 scorers (11 rule + 12 LLM-as-judge), dataset loader, experiment runner, comparator, consistency runner (pass^k) |
| observability (core) | `core/src/observability/` | OTel span mapper (exhaustive event-to-span mapping) + OTelExporter (EventStore sink) |
| observability (runtime) | `runtime/src/observability/` | PrometheusCollector (EventStore sink, dynamic prom-client import), CompositeEventStore (fan-out to multiple sinks) |
| mcp (runtime) | `runtime/src/mcp/` | GatewayMcpServer (Streamable HTTP, stateless per-request, 25 tools: memory CRUD, knowledge, cost, safety, integrations, routing, eval, enrichment, cross-agent memory, swarm primitives), GatewayMcpDeps, SwarmStore, tool schemas, dynamic SDK import |
| gateway | `runtime/src/gateway/` | Multi-app loading, Mode B routes, budget middleware, composable auth middleware (timing-safe, API key + JWT RS256/HS256 via JWKS), conversation event emitter (incl. tool execution events), delegation, dev routes, safety/security middleware, audio preprocessing, knowledge pipeline wiring, STT/knowledge factories, webhook tool executor, integration runtime (IntegrationRegistry + IntegrationExecutor + LocalCredentialResolver), tenant tool factory, Meta webhook foundation (shared verification + HMAC-SHA256), WebhookDedup (Meta at-least-once protection), Instagram/Messenger/Email webhook routes, email loop guard, SqliteEmailThreadStore, WebSocket heartbeat (30s ping, 90s timeout), WhatsApp coexistence auto-handoff (smb_message_echoes) |
| a2a | `runtime/src/a2a/` | A2AClient (outbound delegation only) |
| trigger | `runtime/src/trigger/` | TriggerRegistry, webhook handler (HMAC-SHA256), event listener, cron scheduler |
| session | `runtime/src/session/` | ModeBSession (version tracking, optimistic concurrency, token/turn tracking), ModeBOrchestrator (tool authorization, retry/fallback, result sanitization, ToolRAG, PerCallToolConfig, AI guard, model routing via ModelRouter + providerPool), SessionRegistry (pluggable SessionStore, save with concurrency check), SessionMode state machine (ai_active/queued/human_active/resolved), session serializer, repetitive abuse detector |
| tenant | `runtime/src/tenant/` | TenantRegistry (JSON persistence, resolveByWidgetId, resolveByInstagramPageId, resolveByMessengerPageId, resolveByEmailAddress, webhook tool secret encryption), system prompt builder (businessName + name identity), suggestion parser, multi-agent routing (DefaultTenantRouter, resolveAgentContext), model routing config |
| handoff | `runtime/src/gateway/handoff-routes.ts` + `runtime/src/session/escalation-detector.ts` + `runtime/src/session/context-summarizer.ts` | Human handoff: session mode state machine, escalation detection, operator messaging, AI guard |
| channels | `runtime/src/channels/` | 8 adapters (CLI, Web, WhatsApp, Instagram, Messenger, Slack, Email, API), ChannelRouter, formatForChannel |
| sdk | `sdk/src/` | React hooks (useKilnChat, useKilnWsChat, useKilnEvents, useKilnMemory, useKilnState, useApproval), ApiClient, SseClient. Types-only import from core. |
| widget | `widget/src/` | Embeddable chat widget: WsClient (auto-reconnect, localStorage persistence, identify frame), KilnWidget (Shadow DOM, pre-chat form, markdown renderer), auto-loader (script tag data-* attrs). Welcome frame, suggestion chips, info bubbles. Zero deps, IIFE bundle. |
| studio | `studio/src/` | React 19 + Vite + TanStack Query + @xyflow/react. 7 views (Graph, Playground, Timeline, Memory, Eval, Cost, Safety). |

### Dependency Rules (STRICT)

1. Engine primitives have zero external dependencies -- pure TypeScript interfaces
2. Application layer depends on engine interfaces, never infrastructure
3. Infrastructure implements engine interfaces
4. No cross-context imports -- communicate via barrel exports
5. Provider SDKs ONLY in `agents/infrastructure/`
6. Channel adapters ONLY in channel implementations
7. `@kilnai/runtime` depends on `@kilnai/core` only, never reverse
8. `@kilnai/react` imports only types from `@kilnai/core` -- never implementations
9. `@kilnai/studio` depends on `@kilnai/react` + UI libs -- runtime serves its `dist/` as static files

## Commands

```bash
bun install                    # Install all workspace deps
bun run typecheck              # tsc -b (project references across all packages)
bun run test                   # Vitest all packages
```

**WARNING:** Always use `bun run test`, never `bun test`. The latter invokes Bun's built-in test runner without Vitest config, causing false failures from mock leakage.

## Quality Gates

- TypeScript: `bun run typecheck` -- zero errors
- Tests: `bun run test` -- all pass
- No `@temper` references: `grep -r "@temper" packages/` -- zero results

## Git Workflow

### Branching

| Branch | Purpose | Merges to |
|--------|---------|-----------|
| `main` | Production-ready. Always green. Tagged releases. | -- |
| `feat/<scope>/<short-name>` | New features | `main` via PR |
| `fix/<scope>/<short-name>` | Bug fixes | `main` via PR |
| `refactor/<scope>/<short-name>` | Code improvements | `main` via PR |
| `chore/<short-name>` | Deps, CI, tooling | `main` via PR |

Examples: `feat/agents/openrouter-adapter`, `fix/gateway/credential-resolution`, `refactor/session/cleanup`

### Pull Requests

- Every change goes through a PR -- no direct pushes to `main`
- PR title follows commit format: `type(scope): description`
- Squash merge to `main` (single clean commit per feature)
- All quality gates must pass before merge (typecheck, tests, no `@temper` refs)
- PR body: `## Summary` (1-3 bullets) + `## Test plan` (checklist)

### Releases

- Tag `main` after merging: `git tag vX.Y.Z`
- Semver: `feat` = minor bump, `fix` = patch bump, breaking = major bump
- All 5 packages share the same version (monorepo lockstep)
- Bump versions in all `package.json` files before tagging
- Changelog entry in `docs/changelog.md` required for every version

### Commit Format

```
type(scope): description
```

Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`

Scopes: core, engine, orchestrator, agents, domain, package, skill, memory, tree, events, cost, sandbox, verification, security, safety, observability, knowledge, enrichment, eval, a2a, runtime, gateway, trigger, session, tenant, channel, cli, sdk, widget, studio, docs

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
| `commands/mcp-config.ts` | `kiln mcp-config` command: `--client claude-code|codex|opencode|all` (default: claude-code); `--name`, `--command`, `--args` overrides; async, writes to disk. |
| `commands/init.ts` | Interactive wizard: generates app.yaml + gateway.yaml |
| `commands/dev.ts` | Dev mode with YAML hot-reload |
| `commands/cron.ts` | `kiln cron` command: list, add, remove, run subcommands for schedule triggers. Dynamic import of `@kilnai/runtime` for Scheduler + EventBus. |
| `wrapper/session.ts` | `KilnPermissionAction`, `KilnPermissionApproval` (`never`\|`on-request`\|`on-failure`\|`untrusted`), `KilnSandboxMode` (`read-only`\|`workspace-write`\|`danger-full-access`), `KilnToolPermissionRule`, `KilnCommandPermissionRule`, `KilnFileGovernancePolicy`, `KilnDataFirewallRule`, `KilnAgentPermissionScope`, `KilnPermissionPolicy` (all fields optional), `SessionCapabilities.permissionPolicy`, `SessionEvent` discriminated union, `IKilnSession` interface with `providerSessionId: string | undefined` |
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
| `commands/run.ts` | `kiln run` command: `permissionPolicy?: KilnPermissionPolicy` on `RunFlags`; registry-driven session selection with circuit breaker fallback. Direct API providers bypass MCP requirements when explicitly selected. Real `toolCount` + `turnDepth` tracking. Persists `.kiln/sessions/{id}/meta.json` + `transcript.jsonl` per session (fail-open). Passes transcript to `SkillGenerator.maybeGenerate()` for two-phase capture. Prints capture hint in cli-wrapper mode without API key. Plan mode: after session, extracts `submit_plan` tool call from transcript, renders `PROPOSED PLAN` block, prompts `Approve and execute? [y/N]`, re-runs in execute mode on approval. `--workers N` flag: spawns N parallel isolated sessions via `runParallelWorkers()` (`Promise.allSettled`, each with `isolate: true`); prints per-worker success/fail summary; exits 1 only if all workers fail. |
| `application/plan-exit-tool.ts` | `PlanSubmission` interface, `PLAN_EXIT_TOOL_NAME = "submit_plan"`, `planExitToolSchema` — tool schema the planning agent calls to submit its completed plan for user review |
| `application/agent-loader.ts` | `KilnAgentDefinition` type, `loadAgentDefinitions(projectPath)`, `findAgent()` — loads `*.md` agent definitions from `~/.kiln/agents` + `.kiln/agents`, project overrides global |
| `commands/skill.ts` | `kiln skill` subcommands: `list`, `install`, `publish`, `capture`. |
| `commands/skill-capture.ts` | `kiln skill capture [sessionId] --last --scope project\|user --yes --dry-run` — two-phase interactive skill promotion: loads transcript → SkillCaptureService.extractSummary → generateSkill → user review → write SKILL.md. |
| `wrapper/session-store.ts` | `SessionStore`: append-only JSONL index at `.kiln/sessions.jsonl` (lightweight, used for --resume/--last). `clearLast(provider?)` rewrites JSONL without last matching record (used by /clear). `SessionRecord.providerSessionId` — unified provider-native session ID (replaces split remoteSessionId/threadId). `TranscriptStore`: per-session `.kiln/sessions/{id}/meta.json` + `transcript.jsonl` persistence; `init`, `append`, `finalize`, `readMeta`, `readTranscript`, `listSessions`. |
| `commands/tui.ts` | `kiln tui` command: `--provider`, `--theme` flags; supports both harness and direct API providers, `makeResumableSessionFactory()` async factory with disk persistence + `onClear` callback; starts `startTuiGateway()` in-process, connects via WS. |
| `config/global-config.ts` | `KilnGlobalConfig` schema + loader — reads/writes `~/.kiln/config.yaml` (XDG-aware), `readGlobalConfig()`, `writeGlobalConfig()`, `defaultGlobalConfig()` |
| `config/config-merger.ts` | `loadKilnConfig(projectPath)` — merges `~/.kiln/config.yaml` (global base) + `.kiln/kiln.yaml` (project override); `globalToKilnYaml()` conversion helper |
| `config/env-config.ts` | `resolveEffectiveProvider/Model()` — priority chain: CLI flag > `KILN_PROVIDER`/`KILN_MODEL` env > `~/.kiln/config.yaml` > undefined |
| `mcp/config-generator.ts` | `McpClient = "claude-code" \| "codex" \| "opencode" \| "all"`; `McpServerDef` interface; `generateMcpConfig(client, serverDef, projectPath)` async dispatcher; `generateClaudeCodeMcp`: writes `{projectPath}/.mcp.json`, merges `mcpServers.<name>` only; `generateCodexMcp`: reads/writes `~/.codex/config.toml` via smol-toml, merges `mcp_servers.<name>` only; `generateOpenCodeMcp`: reads/writes `~/.config/opencode/opencode.json` (JSONC-safe), merges `mcp.<name>` only. `generateConfig()` retained for backward compat (stdout JSON). |
| `sync/security-sync.ts` | `syncPermissions(kilnYaml, projectPath)` — reads `permissions` from kiln.yaml, calls `translatePermission()` for each backend, writes native permission format to each backend's config file. Claude Code: `.claude/settings.json` permissions allow/deny rules; Codex: `~/.codex/config.toml` approval_policy + sandbox_mode; OpenCode: `~/.config/opencode/opencode.json` permission.default. Merge-only semantics, errors collected per-backend. |
| `sync/agent-sync.ts` | `syncAgents(projectPath)` — translates `KilnAgentDefinition` to Claude Code `.md`, Codex `.toml`, OpenCode `.md`; writes to each CLI's agents directory |
| `sync/skill-sync.ts` | `syncSkills(projectPath)` — copies skill dirs from `~/.kiln/skills/` + `.kiln/skills/` to `~/.claude/skills/`, `~/.codex/skills/`, `~/.config/opencode/skills/` |
| `sync/agents-md-sync.ts` | `syncAgentsMd(projectPath)` — generates GFM `AGENTS.md` from kiln.yaml + agent definitions; included in `kiln sync` (all) and `kiln sync --agents-md` |
| `sync/hook-sync.ts` | `syncHooks(projectPath, kilnDir)` — copies `autoformat.sh` from `.kiln/hooks/` to `.claude/hooks/` and `.codex/hooks/` (non-Windows only). Creates default hook if source doesn't exist. Registers hook in `.claude/settings.json` hooks section. |
| `commands/sync.ts` | `kiln sync [--permissions] [--hooks] [--agents] [--agents-md] [--skills] [--all]` — reads kiln.yaml from project, calls the requested sync operations (or all sync operations when no flags are passed), prints per-backend result table. Exit 0 on partial success, exit 1 only if all backends fail. |

## Backlog

See [STRATEGY.md](STRATEGY.md) for roadmap and phase status.

### Phase 7 — Kiln TUI (COMPLETE v0.25.0)

All sub-phases complete: 7a (package scaffold), 7b (conversation shell), 7c (TUI Gateway integration), 7d (budget panel), 7e (routing indicator), 7f (interactive default), 7g (diff/change visibility). Kiln TUI is now a full terminal product surface.

### Integration Runtime Phase 4 (MCP Surface)

Expose integration adapters as MCP tools (same implementation, two surfaces). Phases 1-3 complete. Phase 4 MCP wiring complete (v0.22.0): `integration_list` and `integration_execute` wired.

### MCP-First Orchestration Layer

Kiln as production runtime for CLI agents (Claude Code, Codex CLI, Goose) via MCP. Phase 1 (gateway MCP server, 17 tool schemas) complete. Phase 2 (full wiring of all 17 tools) complete in v0.22.0. Phase 3 complete in v0.23.0: cross-agent memory with teamId scoping, 6 swarm primitives (join/leave/status/broadcast/claim/release), LLM-based eval scorers via ProviderScorerLlmBridge. 25 tools total. OAuth discovery endpoints (RFC 8414 + RFC 9728) added in v0.23.1-v0.23.2 — Claude Code now connects cleanly. Pending: OAuth 2.1 token endpoint + PKCE + Vigil delegation.

### OpenKiln (Personal AI Agent)

OpenKiln is a downstream product built on Kiln, not an engine phase.
See STRATEGY.md Phase 7 for the TUI that powers OpenKiln.

### kiln run v2 (cross-CLI)

kiln run v2 (cross-CLI): See STRATEGY.md Phase 1 — COMPLETE (v0.23.2). Server reuse via `--attach` deferred to Phase 3 (blocked on OpenCode upstream session persistence).

### kiln mcp-config (Phase 2b + 2e)

`kiln mcp-config` (Phase 2b): writes MCP config for all 3 backends from a single command. Targets: `{project}/.mcp.json` (Claude Code), `~/.codex/config.toml` (Codex, smol-toml), `~/.config/opencode/opencode.json` (OpenCode, JSONC-safe). Merge-only semantics — existing keys are preserved. `McpClient = "claude-code" | "codex" | "opencode" | "all"`.

OpenCode runtime MCP (Phase 2e): `OpenCodeSession` calls `client.config.update({ body: { mcp: { kiln: { type: "local", command: ["node", mcpServerEntryPath], enabled: true } } } })` after the permissions PATCH, using `mcpServerEntryPath` from `SessionContext`. Fail-open on both permission and MCP config PATCH. `mcpServerEntryPath` passed from `SessionManager.prepare()` via `run.ts` session config.

## Documentation

See [docs/README.md](docs/README.md) for the full documentation index.

## Research Protocol

For cross-backend features: RESEARCH phase should include reviewing
`C:\Proyectos\Sequel\opencode` and `C:\Proyectos\Sequel\codex`
for how each backend handles the feature before designing the Kiln implementation.
