# Changelog

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
- **ModeBSession.lastHumanMessageAt**: New timestamp for tracking human activity, persisted across session serialization.
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
- **Session token tracking**: `ModeBSession.totalTokens` and `ModeBSession.userTurnCount` persisted across session serialization.
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
