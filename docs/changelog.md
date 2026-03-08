# Changelog

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
- 4 provider adapters (Anthropic, OpenAI, DeepSeek, Ollama).
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
