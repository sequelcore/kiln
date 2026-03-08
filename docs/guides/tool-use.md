# Tool Use

Kiln agents execute tools (capabilities) during conversations. The orchestrator runs a while-loop: the LLM decides which tools to call, the orchestrator executes them, feeds results back, and repeats until the LLM produces a final text response.

Sources: `packages/core/src/engine/domain/capability.ts`, `packages/runtime/src/session/mode-b-orchestrator.ts`, `packages/core/src/agents/tool-rag.ts`

---

## Overview

When an agent receives a message, the orchestrator enters a tool loop:

1. Send the conversation (including system prompt, history, and available tools) to the LLM.
2. If the LLM returns tool calls, execute each one and append the results to the conversation.
3. Repeat from step 1.
4. When the LLM returns a final text response (no tool calls), exit the loop.

The loop is bounded by `maxToolRounds` (default: 15). If the limit is reached, the orchestrator returns the last available response. Budget is checked before each round (after the first) -- if exhausted mid-loop, the loop breaks and returns what it has. Budget check errors are fail-open.

---

## Capabilities in app.yaml

Every tool an agent can use must be declared as a capability in the team's `capabilities` array. Agents reference capabilities by name in their `tools` list. The loader validates all references at startup.

```yaml
capabilities:
  - name: search_products
    description: Search the product catalog by query
    tags: [catalog]
    annotations:
      readOnly: true
      idempotent: true

  - name: process_refund
    description: Process a customer refund
    tags: [billing]
    annotations:
      destructive: true

  - name: update_profile
    description: Update customer profile information
    tags: [crm]
    annotations:
      cacheTtl: 300
      outputSchema:
        type: object
        properties:
          success:
            type: boolean
          updatedFields:
            type: array
            items:
              type: string
```

### Annotations

| Annotation | Type | Effect |
|-----------|------|--------|
| `readOnly` | boolean | Safe to cache/retry, no side effects. Level 0 authorization (auto-execute). |
| `destructive` | boolean | Requires higher authorization (Level 2, confirm before execution). |
| `idempotent` | boolean | Safe to retry on failure without side effects. |
| `cacheTtl` | number (seconds) | Cache tool results for this duration. |
| `guardrail` | boolean | Level 3 authorization -- always requires confirmation. |
| `outputSchema` | JSON Schema | Validates tool output structure. |

Unannotated capabilities default to `destructive: true`.

---

## Retry and Fallback

Capabilities can declare retry and fallback behavior. When a tool call fails, the orchestrator retries according to the config. If all retries are exhausted, an optional fallback tool is invoked with the same input.

```yaml
capabilities:
  - name: search_inventory
    description: Search product inventory
    retry:
      maxAttempts: 3
      backoff: exponential
      fallback: search_inventory_cache

  - name: search_inventory_cache
    description: Search cached inventory snapshot
    tags: [catalog]
    annotations:
      readOnly: true
```

| Field | Default | Description |
|-------|---------|-------------|
| `maxAttempts` | 1 | Total attempts (1 = no retry). |
| `backoff` | `none` | Backoff strategy: `none`, `linear`, `exponential`. |
| `fallback` | -- | Capability name to invoke if all retries fail. Must be declared in the same team. |

---

## Authorization

Tool execution uses a 4-level authorization model based on `CapabilityAnnotations`. The `ToolAuthorizer` inspects annotations before each tool call and returns allow or deny with a reason.

| Level | Condition | Behavior |
|-------|-----------|----------|
| 0 (auto-execute) | `readOnly: true` | Executed immediately, no approval needed. |
| 1 (audit) | No annotations (unannotated defaults to destructive, but standard tools without explicit annotations) | Executed and logged. Default for tools with no explicit `readOnly`, `destructive`, or `guardrail` annotation. |
| 2 (confirm) | `destructive: true` | Requires approval before execution. Denied tools return an error tool_result to the LLM. |
| 3 (always-confirm) | `guardrail: true` | Always requires confirmation, regardless of other annotations. |

When a tool is denied, the orchestrator returns an error tool_result to the LLM describing the denial reason. The LLM can then inform the user or attempt an alternative approach.

---

## Webhook Tools

External systems can expose HTTP endpoints as tools via per-tenant webhook tool configuration. Webhook tools are executed by the `WebhookToolExecutor`.

### Configuration

Webhook tools are configured on `TenantConfig.webhookTools[]` via the tenant admin API:

```json
{
  "webhookTools": [
    {
      "name": "check_order_status",
      "description": "Check the status of a customer order",
      "url": "https://api.example.com/tools/order-status",
      "secret": "whsec_abc123...",
      "timeout": 30,
      "inputSchema": {
        "type": "object",
        "properties": {
          "orderId": { "type": "string" }
        },
        "required": ["orderId"]
      }
    }
  ]
}
```

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `name` | Yes | -- | Tool name (must be unique within the tenant). |
| `description` | Yes | -- | Description shown to the LLM. |
| `url` | Yes | -- | HTTP endpoint to POST to. |
| `secret` | Yes | -- | HMAC-SHA256 signing key. |
| `timeout` | No | 30 | Request timeout in seconds. |
| `inputSchema` | No | -- | JSON Schema for input validation. |

### Request Format

The executor sends an HTTP POST to the configured URL:

```
POST https://api.example.com/tools/order-status
Content-Type: application/json
X-Kiln-Signature: sha256=<hmac>
X-Kiln-Timestamp: <iso>

{
  "tool": "check_order_status",
  "input": { "orderId": "ORD-12345" },
  "timestamp": "2026-03-07T18:30:00.000Z"
}
```

The `X-Kiln-Signature` header contains `sha256=` followed by the HMAC-SHA256 hex digest of the JSON request body, computed using the tool's `secret`.

### Response

The endpoint must return a JSON response. The parsed JSON is returned as the tool result to the LLM.

### Error Handling

| Error Type | Behavior |
|------------|----------|
| Timeout | AbortController cancels the request after `timeout` seconds. |
| HTTP 5xx | Retryable (if retry config is set on the capability). |
| HTTP 4xx | Not retryable -- returned as error tool_result. |
| Network error | Retryable (if retry config is set). |

---

## Per-Tenant Tool Config

Tenants can have custom tool configurations managed via the tenant admin API (`PATCH /admin/{appName}/tenants/:id`).

### Tool Allowlist

The `tools` field is a string array that restricts which tools are available to the tenant's sessions. When omitted, all tools are available.

```json
{
  "tools": ["search_products", "check_order_status", "get_faq"]
}
```

### Tool Config

The `toolConfig` object controls execution limits and rate limiting:

```json
{
  "toolConfig": {
    "maxIterationsPerSession": 10,
    "rateLimits": {
      "defaultPerMinute": 60,
      "perTool": {
        "process_refund": 5,
        "send_email": 10
      }
    }
  }
}
```

| Field | Default | Max | Description |
|-------|---------|-----|-------------|
| `toolConfig.maxIterationsPerSession` | 10 | 50 | Max tool rounds per message. |
| `toolConfig.rateLimits.defaultPerMinute` | 60 | -- | Default sliding window rate limit per tool. |
| `toolConfig.rateLimits.perTool` | -- | -- | Per-tool rate limit overrides (tool name to requests/minute). |

---

## Per-Call Tool Configuration

The orchestrator is shared across tenants. Rather than mutating orchestrator-level state, per-tenant tool infrastructure is passed as the 5th parameter to `processMessage()`. This includes the tool allowlist, rate limiter instance, and any additional tools (e.g., webhook tools) scoped to the tenant.

```typescript
const result = await orchestrator.processMessage(
  session,
  message,
  systemPrompt,
  tools,
  {
    allowedTools: ["search_products", "get_faq"],
    rateLimiter: tenantRateLimiter,
    additionalTools: webhookToolDefinitions,
  }
);
```

`additionalTools` are merged locally for the duration of the call -- they are not registered on the orchestrator and do not persist across invocations. This avoids tool accumulation when the same orchestrator serves many tenants.

The `TenantToolFactory.buildTenantToolContext()` constructs this configuration from `TenantConfig`, handling webhook tool instantiation, allowlist intersection, and rate limiter setup.

---

## Rate Limiting

The `SlidingWindowRateLimiter` enforces per-tool, per-tenant rate limits using an in-memory sliding window (60-second window).

When a tool call exceeds its rate limit:

- The call is not executed.
- An error tool_result is returned to the LLM with a `retry-after` indication.
- The LLM can inform the user or attempt a different tool.

Per-tenant isolation ensures one tenant's rate limits do not affect another. Expired entries are auto-pruned on each check.

---

## Tool Events

Tool execution emits events at two levels:

### Internal EventBus

Available in dev mode via `GET /dev/events` (SSE) and through the OTel exporter:

| Event | Key Payload Fields |
|-------|--------------------|
| `tool_called` | `toolName`, `input`, `tenantId`, `sessionId` |
| `tool_authorized` | `toolName`, `level`, `allowed`, `reason` |
| `tool_result` | `toolName`, `durationMs`, `success`, `retryCount` |

### Conversation Events

Emitted to the product backend via `ConversationEventEmitter` (fire-and-forget POST):

| Event Type | Payload |
|------------|---------|
| `TOOL_EXECUTED` | `toolName`, `durationMs`, `success`, `resultSummary` |

Conversation events are configured in `gateway.yaml` under `conversationEvents`. See [Gateway YAML Reference](../configuration/gateway-yaml.md) for setup.

---

## Result Sanitization

Tool results pass through the safety pipeline before being fed back to the LLM. The pipeline applies:

1. **PII scanner** -- detects and redacts personally identifiable information (6 types).
2. **Content classifier** -- checks for unsafe content (6 categories).
3. **Indirect injection scanner** -- runs `PromptScanner.scanHeuristic()` on tool results to detect prompt injection attempts embedded in external data (e.g., a malicious instruction hidden in a database record or API response). Detections emit a `security_alert` event with severity `high` and category `indirect_injection`.

Sanitized results are logged with `success_sanitized` status in the audit log. The original unsanitized result is never stored or forwarded.

The safety pipeline is fail-open: if sanitization fails, the original result is used to avoid blocking the conversation.

---

## Tool Result Caching

Capabilities annotated with `cacheTtl` have their results cached in the `ToolCache`. When the same tool is called with identical input within the TTL window, the cached result is returned without executing the tool. This reduces latency and cost for frequently-called read-only tools.

```yaml
capabilities:
  - name: get_product_details
    description: Get product details by ID
    tags: [catalog]
    annotations:
      readOnly: true
      cacheTtl: 300    # cache results for 5 minutes
```

The orchestrator checks the cache before each tool execution. On a cache hit, the cached result is returned immediately and a `tool_cache_hit` event is emitted via the EventBus. Cache misses proceed with normal tool execution, and the result is stored in the cache for future calls.

Cache keys are derived from the tool name and serialized input. The cache is in-memory and scoped per-session.

---

## ToolRAG

When an app has more than 30 tools, embedding-based tool selection filters to the most relevant tools per message. This reduces token usage and improves tool selection accuracy.

The existing `tool-rag.ts` implementation uses capability descriptions as the embedding corpus. At query time, it embeds the user message and selects the top-k most relevant tools via cosine similarity.

ToolRAG is fail-open: if the embedding or selection fails, all tools are passed to the LLM as a fallback.

---

## MCP Tool Description Scanning

When MCP servers are connected, the `McpClient` discovers tools from each server. As a security measure, tool descriptions are scanned for prompt injection patterns using `PromptScanner.scanHeuristic()` at discovery time. Tools with suspicious descriptions (e.g., containing hidden instructions or override attempts) are filtered out and never registered as available capabilities.

This prevents a compromised or malicious MCP server from injecting prompt manipulation through tool descriptions. Filtered tools are logged as warnings but do not block the remaining tools from the same server.

To enable MCP tool scanning, pass a `PromptScanner` instance via `McpClientOptions.promptScanner`.

---

## Budget Integration

The tool loop integrates with the billing middleware:

- Budget is checked before each round (after the first).
- If budget is exhausted mid-loop, the loop breaks and returns the last available response.
- Budget check errors are fail-open -- a billing service outage never blocks tool execution.
- The `BUDGET_EXHAUSTED` error code is returned to the LLM if budget runs out, allowing it to inform the user.

---

## YAML Reference

See [App YAML Reference](../configuration/app-yaml.md) for the full `capabilities:` configuration schema.
