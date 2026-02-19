# Kiln - Domain-Agnostic AI Orchestration Engine

MIT

Domain-agnostic AI orchestration engine. 6 primitives (Agent, Capability, Workflow, Memory, Task, Channel) + 3 composites (Team, Router, App) configured via YAML. Multi-tenant gateway runtime with provider adapters, budget enforcement, cross-app delegation, and 5 channel adapters. Domain config system with tech stack auto-detection, YAML schema/parser, DomainRegistry, and marketplace infrastructure (package manifest, content hashing, security validation).

## Architecture

Bun monorepo workspace: `packages/core` (engine primitives + implementations) + `packages/runtime` (gateway server + channel adapters).

### Engine Overview

```
App (YAML-configured)
+-- Router (pattern rules -> classifier -> fallback)
+-- Teams[]
|   +-- Team = Agents + Workflow + Capabilities + QualityGates
+-- Memory (scoped: user, agent:X, team:X, project:X, org)
+-- Channels[] (CLI, web, WhatsApp, Slack, API)
```

**6 Primitives:** Agent (tier-based LLM instance), Capability (MCP tool with annotations), Workflow (phase sequence + gates), Memory (scoped storage), Task (tree node with scoring), Channel (platform adapter).

**3 Composites:** Team (agents + workflow + capabilities), Router (rules -> classifier -> fallback), App (teams + router + memory + channels).

### Bounded Contexts

| Context | Location | Purpose |
|---------|----------|---------|
| engine | `packages/core/src/engine/` | Engine primitives (6) + composites (Team, Router, App) + YAML loader + gateway config (zero external deps except yaml) |
| orchestrator | `packages/core/src/orchestrator/` | Workflow implementation: phase machine (configurable phases + gates) |
| agents | `packages/core/src/agents/` | Agent implementation: provider adapters (Anthropic, OpenAI, DeepSeek, Ollama) |
| memory | `packages/core/src/memory/` | Memory implementation: scoped storage (user, agent, team, project, org) |
| tree | `packages/core/src/tree/` | Task implementation: tree manager (scoring, deepen/branch/prune, batch selection) |
| sandbox | `packages/core/src/sandbox/` | Per-agent isolation: filesystem policies, network proxy, tenant FS jails |
| verification | `packages/core/src/verification/` | Gate runner: test, lint, type-check verification loop |
| events | `packages/core/src/events/` | Event streaming (26 event types including 5 security events) |
| security | `packages/core/src/security/` | Security: audit log (JSONL + hash chaining), prompt injection detection (2-tier), encrypted secrets (AES-256-GCM), Guardian review, self-audit |
| cost | `packages/core/src/cost/` | Cost tracking: per-role, cache-aware pricing |
| domain | `packages/core/src/domain/` | Domain config: tech stack detection, YAML schema/parser, DomainRegistry, marketplace infrastructure (package manifest, content hashing, security validation) |
| gateway | `packages/runtime/src/gateway/` | Gateway runtime: multi-App loading, per-App isolation, Mode B routes, budget middleware, cross-app delegation, multi-tenant routes, WhatsApp webhooks, tenant admin CRUD |
| session | `packages/runtime/src/session/` | Mode B session management: ModeBSession, ModeBOrchestrator, SessionRegistry |
| tenant | `packages/runtime/src/tenant/` | Multi-tenant management: TenantRegistry (JSON persistence), system prompt builder, phone-to-tenant resolution |
| channels | `packages/runtime/src/channels/` | Channel adapters (CLI, Web, WhatsApp, Slack, API) + EventBridge + ChannelRegistry + ChannelRouter + MessageFormatter |

### Dependency Rules (STRICT)

1. **Engine primitives have zero external dependencies** -- pure TypeScript interfaces
2. Application layer depends on engine interfaces, never on infrastructure
3. Infrastructure implements engine interfaces
4. No cross-context imports -- communicate via shared kernel types (barrel exports)
5. Provider SDKs ONLY in `agents/infrastructure/`
6. Channel adapters ONLY in channel implementations
7. **@kilnai/runtime depends on @kilnai/core** only, never the reverse

## Commands

```bash
bun install                    # Install all workspace deps
bun run typecheck              # tsc --noEmit all packages
bun run test                   # Vitest all packages
```

## Quality Gates

- TypeScript: `tsc --noEmit` -- zero errors
- Testing: `vitest` -- all pass
- No `@temper` references: `grep -r "@temper" packages/` -- zero results

## Commit Format

```
type(scope): description
```

Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`

Scopes: core, engine, orchestrator, agents, domain, memory, tree, events, cost, sandbox, verification, security, runtime, gateway, session, tenant, channel, docs

## Key Files

### Core (`packages/core/src/`)

| File | Purpose |
|------|---------|
| `engine/domain/agent.ts` | Engine primitive: Agent interface (name, role, goal, backstory, instructions, tier, tools) |
| `engine/domain/prompt-assembler.ts` | Pure function: assembleAgentPrompt() -- identity fields + context -> system prompt |
| `engine/errors.ts` | KilnError base class (code, context, retryable) + KilnErrorCode union type |
| `engine/domain/capability.ts` | Engine primitive: Capability interface (schema, tags, annotations, guardrail, outputSchema) |
| `engine/domain/workflow.ts` | Engine primitive: Workflow interface (string phases, gates) |
| `engine/domain/memory.ts` | Engine primitive: Memory interface (5 scopes, store/recall/forget) |
| `engine/domain/task.ts` | Engine primitive: Task interface (tree structure, statuses, actions) |
| `engine/domain/channel.ts` | Engine primitive: Channel interface (receive/send/stream) |
| `engine/composites/team.ts` | Engine composite: Team (agents + workflow + capabilities + gates + mode + manager) + validateTeam() |
| `engine/composites/router.ts` | Engine composite: Router (pattern rules + classifier + fallback) + validateRouter() |
| `engine/composites/app.ts` | Engine composite: App (teams + router + memory + channels) + validateApp() |
| `engine/loader/app-loader.ts` | YAML -> App loader (parseAppYaml, validateAppGraph, AppLoaderError) |
| `engine/loader/preset-loader.ts` | App -> OrchestratorConfig bridge (loadPresetConfig, PresetLoaderError) |
| `engine/gateway/gateway-config.ts` | Gateway config types + validateGatewayConfig() |
| `engine/gateway/mode-b-config.ts` | Mode B config types + validateModeBConfig() |
| `engine/gateway/delegation-config.ts` | Delegation types + isDelegationCapability() + validateDelegation() |
| `engine/gateway/tenant-config.ts` | Tenant config types + validateTenantConfig() |
| `orchestrator/phase-machine.ts` | Configurable phase machine: uses config.phases, configurable approval gate |
| `orchestrator/orchestrator.ts` | Orchestrator: session lifecycle, checkpoint/resume, interrupt/resume, strategy-based execution |
| `orchestrator/strategies/index.ts` | Strategy pattern: SequentialStrategy, SupervisorStrategy, SwarmStrategy |
| `orchestrator/guardrails.ts` | Pure JSON Schema validation + retry loop for structured output |
| `orchestrator/interrupt.ts` | Interrupt/resume types (InterruptRequest, ResumeCommand, InterruptState) |
| `agents/infrastructure/anthropic.ts` | Anthropic SDK adapter (retry, streaming, structured outputs) |
| `agents/infrastructure/openai.ts` | OpenAI adapter |
| `agents/infrastructure/deepseek.ts` | DeepSeek adapter |
| `agents/infrastructure/ollama.ts` | Ollama adapter (local models) |
| `memory/sqlite-store.ts` | SQLite + FTS5 memory store (configurable decay + auto-compaction + tenant namespace enforcement) |
| `memory/decay-curves.ts` | Pure decay functions: exponential, linear, step curves |
| `memory/compactor.ts` | MemoryCompactor: tag-based grouping, deterministic summarization, archival |
| `memory/project-store.ts` | Git-synced gzipped JSONL project memory |
| `tree/task-tree.ts` | Task tree: scoring, selection, deepen/branch/prune |
| `events/event-bus.ts` | Event emission and subscription (26 event types) |
| `cost/cost-tracker.ts` | Per-role cache-aware cost tracking |
| `sandbox/policies.ts` | Per-agent filesystem + network isolation policies + createTenantSandbox() |
| `verification/verification-loop.ts` | Gate runner: test -> lint -> type-check loop |
| `domain/index.ts` | Domain config: DomainConfig interface, QualityGate re-export, mergeDomainConfigs(), barrel exports |
| `domain/domain-registry.ts` | DomainRegistry: register, detect by file patterns, detectAndMerge, loadInstalledDomains (configurable path) |
| `domain/yaml-schema.ts` | DomainYaml interfaces + validateDomainYaml() |
| `domain/yaml-parser.ts` | parseDomainYaml(), loadDomainYaml(), DomainYamlError |
| `domain/marketplace.ts` | Package manifest, content hashing, security validation, default annotations, file path validation |
| `domain/schema/domain.schema.json` | JSON Schema draft-07 for domain.yaml IDE autocomplete |
| `security/types.ts` | Security interfaces: AuditLog, SecretStore, PromptScanResult, GuardianReviewResult, SecurityConfig |
| `security/audit-log.ts` | JsonlAuditLog: append-only JSONL + SHA-256 hash chaining, query, verifyChain() |
| `security/prompt-scanner.ts` | PromptScanner: Tier 1 heuristic (20+ regex patterns) + Tier 2 deep LLM scan |
| `security/secret-store.ts` | AesSecretStore: AES-256-GCM encryption, PBKDF2 key derivation, atomic key rotation |
| `security/guardian.ts` | Guardian: secondary LLM review for destructive capabilities |
| `security/self-audit.ts` | SelfAudit: periodic security health checks (secrets, audit chain, tenant isolation, config) |

### Runtime (`packages/runtime/src/`)

| File | Purpose |
|------|---------|
| `gateway/gateway-routes.ts` | Pure Hono app factory: health + per-App API routes |
| `gateway/gateway-server.ts` | startGateway(): Bun.serve, Mode B + multi-tenant runtime init |
| `gateway/app-resolver.ts` | resolveApps(): YAML path resolution, memory namespacing |
| `gateway/mode-b-routes.ts` | Mode B Hono sub-app: POST /message, GET/DELETE /sessions |
| `gateway/budget-middleware.ts` | checkBudget(), reportUsage(), checkTier() -- fail-open by design, circuit breaker wrapped |
| `gateway/config-validator.ts` | validateStartupConfig(), assertValidStartupConfig() -- fail-fast env var validation |
| `gateway/health-registry.ts` | HealthRegistry: register subsystem checkers, checkAll(), aggregateStatus() |
| `gateway/delegation-handler.ts` | DelegationRegistry, executeDelegation() |
| `gateway/delegation-routes.ts` | Delegation Hono sub-app: POST /delegate, GET /delegation-targets |
| `gateway/tenant-routes.ts` | Tenant Hono sub-app: POST /message, GET/DELETE /sessions |
| `gateway/whatsapp-webhook-routes.ts` | WhatsApp webhook: GET /webhook (verify), POST /webhook (messages) |
| `gateway/tenant-admin-routes.ts` | Tenant admin CRUD: GET/POST/PATCH/DELETE /tenants |
| `session/mode-b-session.ts` | ModeBSession: conversation history, idle timeout, tenant scoping |
| `session/mode-b-orchestrator.ts` | ModeBOrchestrator.processMessage(): provider adapter call + memory |
| `session/session-registry.ts` | SessionRegistry: multi-user session management + cleanup |
| `gateway/security-middleware.ts` | Hono middleware: prompt injection scanning on incoming messages |
| `tenant/tenant-registry.ts` | TenantRegistry: in-memory Map + JSON persistence, CRUD, optional encrypted secrets |
| `tenant/system-prompt-builder.ts` | buildTenantSystemPrompt(): TenantConfig -> system prompt |
| `channels/event-bridge.ts` | EventBridge: sync EventBus -> AsyncIterable for Channel.stream() |
| `channels/channel-registry.ts` | ChannelRegistry: multi-channel management (broadcast + targeted) |
| `channels/channel-router.ts` | ChannelRouter: incoming message -> identity -> pattern matching -> team |
| `channels/message-formatter.ts` | Unified message formatting + channel format adaptation |
| `channels/cli-channel.ts` | CliChannel: stdin/stdout adapter (format: full) |
| `channels/web-channel.ts` | WebChannel: WebSocket adapter (format: full) |
| `channels/whatsapp-channel.ts` | WhatsAppChannel: Business API webhook adapter (format: short) |
| `channels/slack-channel.ts` | SlackChannel: Bot Events + Web API adapter (format: full) |
| `channels/api-channel.ts` | ApiChannel: REST + SSE streaming adapter (format: structured) |
