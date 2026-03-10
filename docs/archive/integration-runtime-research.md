# Integration Runtime — Deep Research

**Date:** 2026-03-09
**Status:** Research complete, ready for implementation
**Author:** Ricardo Armenta (Sequel)

## Problem

AI agents need to take real actions (book appointments, process payments, log data). Today Kiln only supports webhook tools — which require developers to build endpoints. This blocks non-technical users (Kilvo's SMB audience) and limits OpenKiln's "it actually does things" promise.

## Competitive Landscape

### 10 Platforms Analyzed

| Platform | Abstraction | Credential Model | Multi-Tenant | Integration Count |
|----------|-------------|-----------------|--------------|-------------------|
| OpenClaw | SKILL.md (markdown + frontmatter) | Env vars in SKILL.md | None (single-user) | 13,729 skills (ClawHub) |
| Composio | Toolkit/Action (managed API) | Full OAuth lifecycle, auto-refresh, entity_id scoping | Native | 1,000+ toolkits |
| Goose | MCP Extensions | Env vars per MCP config | None | Any MCP server |
| n8n | INodeType + ICredentialType (class) | Encrypted store, built-in OAuth redirect | Workspace-level | 400+ nodes |
| LangChain | BaseTool / @tool decorator | None (DIY) | None | Community-maintained |
| Voiceflow | Function/Step (V8 runtime) | Per-step config | Platform-managed | 300+ native |
| CrewAI | BaseTool (class, Pydantic) | Env vars, Composio for managed auth | None | ~50 built-in |
| Botpress | IntegrationDefinition + Implementation (Zod) | configuration + secrets split | Platform-managed (per-bot ctx) | 100+ official |
| GPT Actions | OpenAPI 3.x spec | API Key or OAuth (managed by OpenAI) | Per-GPT | Actions library |
| MCP Servers | tools/list + tools/call (JSON-RPC) | Env vars / token files / OAuth 2.1 | None (needs gateway) | 5,800+ servers |

### Four Architectural Archetypes

1. **Schema-First** (GPT Actions, MCP) — Provide API description, LLM figures it out. Low barrier, no credential lifecycle.
2. **Interface-Contract** (n8n, Botpress, LangChain, CrewAI) — Implement typed interface. Strong DX, credentials part of contract.
3. **Managed Middleware** (Composio) — Centralized platform handles auth + execution. Zero integration code. Introduces dependency.
4. **Instruction-Based** (OpenClaw, Kiln SKILL.md) — Natural language instructions + tool metadata. Most flexible, hardest to test.

### Key Patterns to Adopt

- **Botpress**: Cleanest definition/implementation split with Zod schemas. Separate `configuration` (user-visible) from `secrets` (encrypted).
- **Composio**: Multi-tenant credential model (entity_id + connected accounts). Gold standard for SaaS.
- **n8n**: `ICredentialType` as a first-class concept separate from the node. Declarative description drives UI and execution.
- **MCP**: `tools/list` + `tools/call` which Kiln already supports. Emerging MCP gateway pattern for auth/rate-limiting.

## Credential Management Architecture

### Industry Consensus: Credential Broker / Token Vault

Every production platform separates credential storage from credential usage:

```
Product Layer (Kilvo)     Engine Layer (Kiln)          External API
┌──────────────┐          ┌──────────────┐             ┌──────────┐
│ OAuth flows  │          │ Credential   │             │ Google   │
│ Token store  │ ────────>│ Resolver     │ ──────────> │ Calendar │
│ Refresh jobs │          │ (per-request │             │ API      │
│              │          │  short-lived)│             │          │
└──────────────┘          └──────────────┘             └──────────┘
```

### Three Injection Patterns

**Pattern A: Proxy (Nango, Composio)**
Agent calls proxy with connectionId. Proxy decrypts, injects token, calls upstream.
- Pros: Zero credential exposure.
- Cons: All traffic through proxy, latency.

**Pattern B: Token Exchange (Auth0, Scalekit) — RECOMMENDED**
Agent exchanges first-party token for short-lived scoped third-party token (RFC 8693).
- Pros: Agent calls APIs directly, short-lived tokens.
- Cons: Agent touches tokens briefly.

**Pattern C: Environment Injection (n8n, MCP stdio)**
Credentials as env vars at process startup.
- Pros: Simple.
- Cons: Static, not multi-tenant.

### Kiln's Current State

| Feature | Status | vs Industry |
|---------|--------|-------------|
| AES-256-GCM encryption | Done | Better than n8n (CBC), matches Nango |
| PBKDF2 key derivation (100K iterations) | Done | Industry standard |
| Key rotation support | Done | n8n and Nango lack this |
| Tenant-namespaced secrets | Done | `tenant:${id}:webhookTool:${name}` |
| Audit logging (JSONL + hash chain) | Done | Enterprise-grade |
| Per-tenant encryption keys | Missing | Shared master key |
| Token refresh with mutex | Missing | Nango pattern needed |
| Credential resolver interface | Missing | Core abstraction needed |
| GDPR cascade delete | Partial | Manual cleanup |

### Token Refresh: Single-Flight Mutex

Industry standard (Nango pattern):
1. Proactive refresh 5 minutes before expiry.
2. Single-flight mutex: only one refresh per connection at a time, others await the same Promise.
3. Retry on 401 as fallback.
4. Connection-level isolation: lock per `(tenantId, connectionId)`, not global.

### Credential Delegation (Kilvo -> Kiln)

Recommended: **Token Exchange (RFC 8693)**

1. Kilvo stores tokens in its own encrypted vault, keyed by `(tenantId, userId, integrationId)`.
2. Kiln requests credentials via secure internal API with mutual auth.
3. Kilvo responds with short-lived token (5-minute TTL).
4. Kiln uses token for tool execution, then discards. Never persists third-party tokens.

## Kiln Tool Infrastructure Map

### Current Execution Flow

```
Channel Handler (WS/WhatsApp/Instagram/Messenger/Email/REST)
  │
  ├─ resolveAgentContext(tenant, message, session)
  │   └─ buildTenantToolContext(tenant, existingBuiltins)
  │       ├─ WebhookToolExecutor(webhookConfigs)    ← webhook tools
  │       ├─ [NEW] IntegrationExecutor(integrationConfigs) ← integration tools
  │       ├─ merge existing builtins
  │       ├─ build allowlist
  │       └─ build rate limiter
  │
  ├─ orchestrator.registerTools(toolDefinitions)
  │
  └─ orchestrator.processMessage(session, parts, memory, callBuiltinTools, perCallConfig)
      │
      └─ Tool Loop (up to 10 rounds):
          ├─ 1. Allowlist check
          ├─ 2. Authorization check (4-level)
          ├─ 3. Rate limit check
          ├─ 4. Cache lookup (if cacheTtl set)
          ├─ 5. executeTool() ── callBuiltinTools.get(name)(input)
          ├─ 6. Result sanitization (PII, prompt injection)
          ├─ 7. Audit logging
          ├─ 8. Cache store
          ├─ 9. Rate limit recording
          └─ 10. Event emission (TOOL_CALLED, TOOL_RESULT)
```

### Zero-Change Integration Points

These already work for IntegrationExecutor with no modifications:

| Component | Why |
|-----------|-----|
| ModeBOrchestrator | Dispatches via `callBuiltinTools` map — any `(input) => Promise<unknown>` works |
| All 6 channel handlers | Call `resolveAgentContext()` which calls `buildTenantToolContext()` |
| Message pipeline | Emits TOOL_EXECUTED conversation events after orchestration |
| Tool authorization | Reads `Capability.annotations` — integration tools set these |
| Rate limiting | Uses `SlidingWindowRateLimiter` keyed by `(tenantId, toolName)` |
| Tool caching | Reads `annotations.cacheTtl` — integration tools can opt in |
| Result sanitization | Runs on all tool results regardless of executor type |
| Audit logging | Logs all tool executions in orchestrator loop |
| Cost tracking | LLM cost already tracked; tool-level cost extensible |

### Files to Modify

| File | Change |
|------|--------|
| `core/engine/gateway/tenant-config.ts` | Add `TenantIntegration` interface, `integrations` field, validation |
| `core/engine/domain/integration.ts` | NEW: `IntegrationAdapter`, `IntegrationOperation` interfaces |
| `core/engine/domain/credential.ts` | NEW: `CredentialResolver`, `ResolvedCredential` interfaces |
| `runtime/gateway/integration-executor.ts` | NEW: executor (parallel to WebhookToolExecutor) |
| `runtime/gateway/tenant-tool-factory.ts` | Wire integration tools after webhooks |
| `runtime/gateway/tenant-admin-routes.ts` | Add `integrations` to MUTABLE_TENANT_FIELDS |
| `runtime/tenant/tenant-registry.ts` | Encrypt/hydrate/delete integration credentials |
| `core/engine/errors.ts` | Add `INTEGRATION_TOOL_FAILED` error code |
| `core/engine/index.ts` | Barrel export new types |
| `runtime/index.ts` | Barrel export new executor |

### Files NOT Modified

| File | Why |
|------|-----|
| `session/mode-b-orchestrator.ts` | Already supports any executor via `callBuiltinTools` |
| `gateway/ws-tenant-routes.ts` | Uses `resolveAgentContext()` — auto-inherits |
| `gateway/whatsapp-webhook-routes.ts` | Same |
| `gateway/instagram-webhook-routes.ts` | Same |
| `gateway/messenger-webhook-routes.ts` | Same |
| `gateway/email-webhook-routes.ts` | Same |
| `gateway/mode-b-routes.ts` | Same |
| `gateway/message-pipeline.ts` | Already emits TOOL_EXECUTED for all tools |

## Architecture Decision

### What Kiln Builds

**IntegrationAdapter interface** (core, engine layer):
```typescript
// Pure interface, zero deps — engine domain
interface IntegrationAdapter {
  readonly provider: string;
  readonly version: string;
  readonly operations: readonly IntegrationOperation[];
  execute(
    operation: string,
    credentials: ResolvedCredential,
    input: Record<string, unknown>,
    options?: ExecutionOptions,
  ): Promise<IntegrationResult>;
}

interface IntegrationOperation {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema?: Record<string, unknown>;
  readonly annotations?: CapabilityAnnotations;
}

interface IntegrationResult {
  readonly data: unknown;
  readonly metadata?: {
    readonly durationMs: number;
    readonly rateLimitRemaining?: number;
    readonly costUsd?: number;
  };
}

interface ExecutionOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}
```

**CredentialResolver interface** (core, engine layer):
```typescript
interface CredentialResolver {
  resolve(tenantId: string, integrationId: string): Promise<ResolvedCredential>;
  invalidate(tenantId: string, integrationId: string): void;
}

interface ResolvedCredential {
  readonly type: 'bearer' | 'api_key' | 'basic' | 'custom';
  readonly value: string;
  readonly headers?: Record<string, string>;
  readonly expiresAt?: Date;
}
```

**IntegrationExecutor** (runtime, infrastructure layer):
```typescript
class IntegrationExecutor {
  constructor(
    private readonly registry: IntegrationRegistry,
    private readonly credentialResolver: CredentialResolver,
  ) {}

  handles(toolName: string): boolean;
  async execute(toolName: string, input: Record<string, unknown>): Promise<unknown>;
  getToolDefinitions(): ToolDefinition[];
}
```

**IntegrationRegistry** (runtime, infrastructure layer):
```typescript
class IntegrationRegistry {
  register(adapter: IntegrationAdapter): void;
  get(provider: string): IntegrationAdapter | undefined;
  getOperation(toolName: string): { adapter: IntegrationAdapter; operation: IntegrationOperation } | undefined;
  all(): readonly IntegrationAdapter[];
  getToolDefinitions(): ToolDefinition[];
}
```

**TenantConfig extension** (core, engine layer):
```typescript
interface TenantIntegration {
  readonly provider: string;
  readonly credentialKey: string;    // encrypted, resolved via CredentialResolver
  readonly operations?: readonly string[];  // subset filter, empty = all
  readonly config?: Record<string, unknown>;  // provider-specific settings
}

// On TenantConfig:
readonly integrations?: readonly TenantIntegration[];
```

### What Kiln Does NOT Build

- OAuth flows (Kilvo's responsibility)
- API client code (adapter packages)
- Credential UI (Kilvo Console / OpenKiln CLI)
- Marketplace / registry (growth-stage)
- Per-integration retry logic (adapter responsibility, executor provides timeout/abort)

### Adapter Package Contract

Each adapter is a separate npm package:

```
@kilnai/integration-google-calendar/
  src/
    index.ts          ← exports IntegrationAdapter implementation
    operations/
      check-availability.ts
      create-event.ts
      cancel-event.ts
      reschedule-event.ts
  package.json        ← peerDep on @kilnai/core (types only)
```

The adapter imports ONLY types from `@kilnai/core`. Zero runtime dependency on Kiln.

### Tool Naming Convention

Integration tools are namespaced: `{provider}_{operation}`

```
google_calendar_check_availability
google_calendar_create_event
stripe_create_payment_link
google_sheets_append_row
```

This prevents collisions with webhook tools and MCP tools.

### Execution Flow After Implementation

```
buildTenantToolContext(tenant, existingBuiltins)
  │
  ├─ 1. Build webhook tools (existing)
  │   WebhookToolExecutor(webhookConfigs)
  │   → callBuiltinTools.set("notify_admin", executor.execute)
  │
  ├─ 2. Build integration tools (NEW)
  │   for (const integration of tenant.integrations) {
  │     const adapter = registry.get(integration.provider);
  │     const operations = filterOperations(adapter, integration.operations);
  │     for (const op of operations) {
  │       const toolName = `${integration.provider}_${op.name}`;
  │       callBuiltinTools.set(toolName, async (input) => {
  │         const credential = await credentialResolver.resolve(tenant.tenantId, integration.credentialKey);
  │         return adapter.execute(op.name, credential, input, { timeoutMs });
  │       });
  │       toolDefinitions.push({ name: toolName, description: op.description, inputSchema: op.inputSchema, tags: ["integration", integration.provider] });
  │     }
  │   }
  │
  ├─ 3. Merge existing builtins (existing)
  ├─ 4. Build allowlist (existing — auto-includes integration tool names)
  └─ 5. Build rate limiter (existing)
```

### Three Executor Types (Final State)

```
WebhookToolExecutor     → HTTP POST + HMAC to customer endpoints
IntegrationExecutor     → Adapter registry + credential resolver (zero code for tenant)
McpClient               → External MCP servers via Streamable HTTP
```

## Credential Security Model

### Encryption Phases

**Phase 1 (Current Sprint):**
- Shared master key + tenant-namespaced keys (existing AesSecretStore pattern)
- `tenant:${id}:integration:${provider}` key naming
- Integration credentials encrypted at registration, hydrated at execution

**Phase 2 (Future):**
- Envelope encryption: per-tenant DEKs wrapped by master KEK
- Tenant deletion = destroy DEK = cryptographic erasure of all credentials

**Phase 3 (Enterprise):**
- External KMS integration (Doppler, AWS KMS, HashiCorp Vault Transit)
- BYOK for regulated industries

### Kilvo Delegation Flow

```
1. User connects Google Calendar in Kilvo Console (OAuth flow)
2. Kilvo stores OAuth tokens in its vault
3. Kilvo registers tenant integration via Kiln admin API:
   POST /api/tenants/:id
   { "integrations": [{ "provider": "google_calendar", "credentialKey": "encrypted_ref" }] }

4. On message:
   - buildTenantToolContext() finds tenant.integrations
   - credentialResolver.resolve() calls Kilvo internal API (or reads from encrypted store)
   - adapter.execute() uses resolved credential
   - credential discarded after execution
```

### Two CredentialResolver Implementations

**LocalCredentialResolver** (for OpenKiln / self-hosted):
- Reads from Kiln's own AesSecretStore
- Credentials registered directly via admin API
- Token refresh handled by a cron job or on-401 retry

**DelegatedCredentialResolver** (for Kilvo / SaaS):
- Calls Kilvo's internal token exchange API
- Returns short-lived tokens (5-minute TTL)
- Kiln never persists third-party tokens
- Mutual TLS or signed JWTs for service-to-service auth

## Implementation Plan

### Phase 1: Core Interfaces + Runtime Wiring (Kilvo launch blocker)

1. `IntegrationAdapter` + `IntegrationOperation` + `IntegrationResult` interfaces in core
2. `CredentialResolver` + `ResolvedCredential` interfaces in core
3. `IntegrationRegistry` in runtime
4. `IntegrationExecutor` in runtime (wired into `buildTenantToolContext`)
5. `TenantConfig.integrations` + validation
6. `TenantRegistry` secret encrypt/hydrate/delete for integrations
7. `MUTABLE_TENANT_FIELDS` update in admin routes
8. `INTEGRATION_TOOL_FAILED` error code
9. `LocalCredentialResolver` implementation
10. Tests for all above

### Phase 2: First-Party Adapters (Kilvo launch)

1. `@kilnai/integration-google-calendar` (check_availability, create_event, cancel_event, reschedule_event)
2. `@kilnai/integration-stripe` (create_payment_link)
3. `@kilnai/integration-google-sheets` (append_row, read_range)

### Phase 3: Credential Delegation (Kilvo SaaS mode)

1. `DelegatedCredentialResolver` implementation
2. Kilvo internal token exchange API contract
3. Single-flight mutex for token refresh
4. Proactive refresh (5-minute buffer)
5. 401 retry fallback

### Phase 4: Adapter Ecosystem (OpenKiln)

1. Adapter package template / generator
2. Dynamic adapter discovery from `node_modules`
3. Adapter validation (schema compliance, security audit)
4. Documentation for community contributors

## Sources

### Integration Platforms
- [OpenClaw Skills Documentation](https://docs.openclaw.ai/tools/skills)
- [Composio Tool Execution](https://docs.composio.dev/docs/executing-tools)
- [Composio Authentication](https://docs.composio.dev/docs/authentication)
- [Goose Architecture](https://block.github.io/goose/docs/goose-architecture/)
- [n8n Node Base Structure](https://docs.n8n.io/integrations/creating-nodes/build/reference/node-base-files/structure/)
- [n8n Credential System](https://deepwiki.com/n8n-io/n8n/4.5-credential-system)
- [Botpress Integration SDK](https://botpress.com/docs/for-developers/sdk/integration/getting-started)
- [GPT Actions](https://platform.openai.com/docs/actions/introduction)
- [MCP Tools Specification](https://modelcontextprotocol.io/specification/draft/server/tools/)

### Credential Management
- [Composio: Secure AI Agent Infrastructure Guide](https://composio.dev/blog/secure-ai-agent-infrastructure-guide)
- [Auth0 Token Vault](https://auth0.com/ai/docs/intro/token-vault)
- [Scalekit: OAuth for AI Agents](https://www.scalekit.com/blog/oauth-ai-agents-architecture)
- [Nango: OAuth Token Refresh Concurrency](https://nango.dev/blog/concurrency-with-oauth-token-refreshes)
- [MCP Authorization Spec](https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization)
- [HashiCorp Vault Multi-Tenancy](https://medium.com/hashicorp-engineering/vault-multi-tenancy-strategies-67922f1eb9d)
- [AWS Multi-Tenant Encryption](https://aws.amazon.com/blogs/architecture/simplify-multi-tenant-encryption-with-a-cost-conscious-aws-kms-key-strategy/)
