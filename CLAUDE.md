# Kiln - Domain-Agnostic AI Orchestration Engine

MIT-licensed. YAML-configured AI orchestration with 7 primitives (Agent, Capability, Workflow, Memory, Task, Channel, Trigger) + 3 composites (Team, Router, App). Multi-tenant gateway, 8 channel adapters, provider adapters, cross-app delegation, eval framework, enterprise safety pipeline.

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
| orchestrator | `core/src/orchestrator/` | Phase machine, checkpoint/resume, strategies (sequential, supervisor, swarm) |
| agents | `core/src/agents/` | Provider adapters (Anthropic, OpenAI, DeepSeek, Ollama), tool cache, MCP client (Streamable HTTP, official SDK), circuit breaker, Tool RAG, sliding window rate limiter |
| memory | `core/src/memory/` | Scoped storage (user, agent, team, project, org), SQLite + FTS5, git sync, decay, compaction |
| tree | `core/src/tree/` | Task tree (scoring, deepen/branch/prune), batch executor |
| sandbox | `core/src/sandbox/` | Per-agent filesystem + network isolation |
| verification | `core/src/verification/` | Gate runner: test, lint, type-check loop |
| events | `core/src/events/` | EventBus (35 typed events, ring buffer), EventStore sink |
| security | `core/src/security/` | Audit log (JSONL + hash chain), prompt injection (2-tier), AES-256-GCM secrets, Guardian, self-audit |
| safety | `core/src/safety/` | PII scanner (2-tier, 6 types, Luhn validation), content classifier (6 categories), 4 policy rails, pipeline orchestrator, indirect injection scanning on tool results |
| cost | `core/src/cost/` | Per-role cache-aware cost tracking |
| knowledge | `core/src/knowledge/` | RAG: chunkers (recursive, markdown), embedding adapters (OpenAI, Ollama), vector stores (InMemory, PgVector with halfvec + HNSW + RRF hybrid search), STT adapters (OpenAI gpt-4o-transcribe, Deepgram nova-3), contextual enrichment (Anthropic pattern), retrieval pipeline (gap detection events), CohereReranker (Rerank v2, over-fetch 4x), knowledge modes (auto-inject / tool), content extractors (file, URL via Jina Reader, PDF via unpdf), SourceManager (extract -> hash -> ingest lifecycle), source stores (InMemory, JSON file), ContactMemoryService (per-user fact extraction via LLM, Mem0 ADD/UPDATE/DELETE/NOOP pattern, recall at session start) |
| domain | `core/src/domain/` | Domain config: tech stack detection, YAML schema, DomainRegistry. Built-in kits at `core/src/domains/*.yaml` |
| package | `core/src/package/` | Distribution: versioning, content hashing, security validation |
| skill | `core/src/skill/` | SKILL.yaml format, SkillRegistry (3-tier discovery) |
| eval | `core/src/eval/` | 12 scorers (6 rule + 6 LLM-as-judge), dataset loader, experiment runner, comparator |
| observability | `core/src/observability/` | OTel span mapper + exporter (EventStore sink) |
| gateway | `runtime/src/gateway/` | Multi-app loading, Mode B routes, budget middleware, composable auth middleware (timing-safe), conversation event emitter (incl. tool execution events), delegation, dev routes, safety/security middleware, audio preprocessing, knowledge pipeline wiring, STT/knowledge factories, webhook tool executor, tenant tool factory, Meta webhook foundation (shared verification + HMAC-SHA256), WebhookDedup (Meta at-least-once protection), Instagram/Messenger/Email webhook routes, email loop guard, SqliteEmailThreadStore, WebSocket heartbeat (30s ping, 90s timeout) |
| a2a | `runtime/src/a2a/` | A2AClient (outbound delegation only) |
| trigger | `runtime/src/trigger/` | TriggerRegistry, webhook handler (HMAC-SHA256), event listener, cron scheduler |
| session | `runtime/src/session/` | ModeBSession (version tracking, optimistic concurrency), ModeBOrchestrator (tool authorization, retry/fallback, result sanitization, ToolRAG, PerCallToolConfig, AI guard), SessionRegistry (pluggable SessionStore, save with concurrency check), SessionMode state machine (ai_active/queued/human_active/resolved), session serializer |
| tenant | `runtime/src/tenant/` | TenantRegistry (JSON persistence, resolveByWidgetId, resolveByInstagramPageId, resolveByMessengerPageId, resolveByEmailAddress, webhook tool secret encryption), system prompt builder (businessName + name identity), suggestion parser, multi-agent routing (DefaultTenantRouter, resolveAgentContext) |
| handoff | `runtime/src/gateway/handoff-routes.ts` + `runtime/src/session/escalation-detector.ts` + `runtime/src/session/context-summarizer.ts` | Human handoff: session mode state machine, escalation detection, operator messaging, AI guard |
| channels | `runtime/src/channels/` | 8 adapters (CLI, Web, WhatsApp, Instagram, Messenger, Slack, Email, API), ChannelRouter, formatForChannel |
| sdk | `sdk/src/` | React hooks (useKilnChat, useKilnWsChat, useKilnEvents, useKilnMemory, useKilnState, useApproval), ApiClient, SseClient. Types-only import from core. |
| widget | `widget/src/` | Embeddable chat widget: WsClient (auto-reconnect), KilnWidget (Shadow DOM), auto-loader (script tag data-* attrs). Welcome frame, suggestion chips, info bubbles. Zero deps, IIFE bundle. |
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

## Commit Format

```
type(scope): description
```

Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`

Scopes: core, engine, orchestrator, agents, domain, package, skill, memory, tree, events, cost, sandbox, verification, security, safety, observability, knowledge, eval, a2a, runtime, gateway, trigger, session, tenant, channel, cli, sdk, widget, studio, docs

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
| `engine/errors.ts` | KilnError base class (73 codes) + KilnErrorCode union type |
| `engine/error-catalog.ts` | getErrorSuggestion(): context-aware suggestions + doc URLs |
| `orchestrator/orchestrator.ts` | Session lifecycle, checkpoint/resume, strategy-based execution |
| `orchestrator/phase-machine.ts` | Configurable phases + gates |
| `agents/infrastructure/anthropic.ts` | Anthropic SDK adapter (retry, streaming, structured outputs) |
| `agents/infrastructure/openai.ts` | OpenAI adapter |
| `agents/infrastructure/deepseek.ts` | DeepSeek adapter |
| `agents/infrastructure/ollama.ts` | Ollama adapter (local models) |
| `agents/mcp-client.ts` | MCP client (Streamable HTTP via official SDK, circuit breaker) |
| `agents/tool-rag.ts` | Embedding-based tool selection |
| `agents/sliding-window-rate-limiter.ts` | In-memory sliding window rate limiter (per-tool, per-tenant) |
| `engine/domain/rate-limiter.ts` | RateLimiter, RateLimitConfig, RateLimitResult interfaces |
| `engine/domain/tool-execution.ts` | RetryStrategy, ToolAuthorizer, ToolExecutionResult interfaces |
| `memory/sqlite-store.ts` | SQLite + FTS5 memory (decay, compaction, tenant namespacing) |
| `safety/safety-pipeline.ts` | PII -> content -> rails pipeline (fail-open) |
| `eval/experiment-runner.ts` | Generate outputs, score with error isolation |
| `knowledge/retrieval-pipeline.ts` | Ingest (chunk -> embed -> store) + retrieve (embed -> search -> rerank) |
| `knowledge/source-manager.ts` | Source lifecycle: extract -> hash -> ingest, content dedup via SHA-256 |
| `knowledge/infrastructure/pgvector-store.ts` | PgVectorStore: PostgreSQL + pgvector (halfvec, HNSW, RRF hybrid search) |
| `knowledge/infrastructure/file-extractor.ts` | Local file content extraction (text, markdown) |
| `knowledge/infrastructure/url-extractor.ts` | URL extraction via Jina Reader + raw fetch fallback |
| `knowledge/infrastructure/pdf-extractor.ts` | PDF extraction via unpdf (optional dep, dynamic import) |
| `agents/infrastructure/openai-stt.ts` | OpenAI STT adapter (gpt-4o-transcribe, fetch-based, withRetry) |
| `agents/infrastructure/deepgram-stt.ts` | Deepgram STT adapter (nova-3, fetch-based, withRetry) |
| `knowledge/contact-memory.ts` | ContactMemoryServiceImpl: per-user fact extraction (LLM), recall, forget, forgetAll (GDPR) |
| `knowledge/infrastructure/cohere-reranker.ts` | Cohere Rerank v2 adapter (over-fetch 4x, KnowledgeRerankerConfig) |

### Runtime (`packages/runtime/src/`)

| File | Purpose |
|------|---------|
| `gateway/gateway-server.ts` | startGateway() + startDevServer(): Bun.serve, multi-app, Mode B, triggers, dev mode, lightweight Mode A dashboard |
| `gateway/gateway-routes.ts` | Hono app factory: health + per-App routes + A2A + webhooks |
| `gateway/auth-middleware.ts` | Composable auth: requireApiKey, requireBearer, requireWebhookSignature, isOriginAllowed |
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
| `gateway/ws-tenant-routes.ts` | Multi-tenant WebSocket: welcome frame (greeting + FAQ suggestions), AI follow-up suggestion chips, audio preprocessing, knowledge retrieval, BUDGET_EXHAUSTED error code, conversation event emission |
| `gateway/audio-preprocessor.ts` | Audio preprocessing: MediaDownloader (WhatsApp two-step, generic), fail-open transcription |
| `gateway/stt-factory.ts` | Resolve SttProviderConfig to concrete SttAdapter |
| `gateway/knowledge-factory.ts` | Resolve KnowledgeConfig to RetrievalPipeline + VectorStore + close(), createSourceManager() |
| `gateway/context-formatter.ts` | formatKnowledgeContext, formatContactContext, mergeContextSources -- shared by WS tenant, WhatsApp, Mode B |
| `gateway/knowledge-admin-routes.ts` | Knowledge source CRUD: /sources (list, create, get, reindex, delete) |
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
| `gateway/tenant-tool-factory.ts` | buildTenantToolContext(): per-tenant tool infrastructure (webhook tools, allowlist, rate limiter) |
| `tenant/tenant-router.ts` | DefaultTenantRouter: regex-based multi-agent routing (Tier 1 + fallback) |
| `tenant/agent-resolver.ts` | resolveAgentContext() + resolveAgentContextAsync(): single integration point for all channel handlers (routing, prompt overlay, tool scoping, warm handoff brief, ping-pong guard) |
| `tenant/ping-pong-guard.ts` | checkPingPong(): stateless guard preventing agent switching loops (maxHandoffs, cooldown, bidirectional pair) |
| `session/agent-handoff-summarizer.ts` | AgentHandoffSummarizer: LLM-generated warm handoff brief on agent switch |
| `gateway/message-pipeline.ts` | Shared processInboundMessage pipeline (budget, session, orchestrate, events, tool event emission) |
| `gateway/trace-context.ts` | TraceContext: per-request trace ID + structured logging |
| `trigger/trigger-registry.ts` | Per-app lifecycle, webhook app, event listener, scheduler |

### CLI (`packages/cli/src/`)

| File | Purpose |
|------|---------|
| `index.ts` | Command dispatch (init, run, dev, domain, gateway, skill, memory, config, status) |
| `commands/init.ts` | Interactive wizard: generates app.yaml + gateway.yaml |
| `commands/dev.ts` | Dev mode with YAML hot-reload |

## Documentation

See `docs/` for full documentation:

| Guide | Content |
|-------|---------|
| [Getting Started](docs/getting-started.md) | Installation, init wizard, first app |
| [Concepts](docs/concepts.md) | 7 primitives, 3 composites, YAML-first philosophy |
| [App YAML](docs/configuration/app-yaml.md) | Complete app.yaml field reference |
| [Gateway YAML](docs/configuration/gateway-yaml.md) | Gateway config, Mode A/B, billing |
| [Tool Use](docs/guides/tool-use.md) | Agentic actions, authorization, webhook tools, rate limiting |
| [Channels](docs/guides/channels.md) | 8 channel adapters (CLI, Web, WhatsApp, Instagram, Messenger, Slack, Email, API) |
| [Architecture](docs/architecture.md) | Contributor internals, TypeScript interfaces |
