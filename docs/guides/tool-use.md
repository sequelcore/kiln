# Tool Use Operations

Use this guide for tool configuration, execution flow, and runtime behavior. For
the architectural role of tool execution, start with:

- [Tool Execution](../architecture/tool-execution.md)
- [Safety](../architecture/safety.md)

Kiln uses the same runtime loop for every tool category: publish the schema,
authorize the call, execute it inside the runtime boundary, and inject the
structured result back into the session.

Sources: `packages/core/src/engine/domain/capability.ts`, `packages/core/src/engine/domain/tool-execution.ts`, `packages/core/src/orchestrator/orchestrator.ts`, `packages/core/src/security/annotation-authorizer.ts`, `packages/core/src/tools/domain/tool.ts`, `packages/core/src/tools/domain/tool-registry.ts`, `packages/core/src/tools/domain/tool-environment.ts`, `packages/core/src/tools/infrastructure/*.ts`, `packages/core/src/tools/tool-executor.ts`, `packages/core/src/tools/mcp/dev-tools-server.ts`, `packages/cli/src/wrapper/session.ts`, `packages/cli/src/wrapper/session-registry.ts`

---

## Overview

When an agent receives a message, the orchestrator enters a tool loop:

1. Send the conversation, system prompt, and tool schemas to the model.
2. If the model emits tool calls, authorize and execute them.
3. Append each tool result to the conversation.
4. Repeat until the model returns a final text response.

The loop is bounded by the session's execution settings and emits tool lifecycle events through the `EventBus`.

---

## Capabilities in `app.yaml`

Every non-native tool exposed by an app is declared as a capability and referenced by agent name. The loader validates those references at startup.

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
```

### Capability annotations

| Annotation | Type | Effect |
|-----------|------|--------|
| `readOnly` | boolean | Safe to auto-execute and retry. |
| `destructive` | boolean | Classified as always-confirm. |
| `idempotent` | boolean | Safe for audited retry. |
| `cacheTtl` | number | Enables tool-result caching for the declared TTL. |
| `guardrail` | boolean | Reserved for highest-friction confirmation flows. |
| `outputSchema` | JSON Schema | Validates the returned shape. |

Unannotated capabilities default to the authorizer's configured default level.

---

## Retry and fallback

Capabilities can declare retry behavior and an optional fallback tool:

```yaml
capabilities:
  - name: search_inventory
    retry:
      maxAttempts: 3
      backoff: exponential
      fallback: search_inventory_cache
```

At execution time, Kiln uses `executeWithRetry()` from `packages/core/src/agents/tool-execution-engine.ts`:

- `maxAttempts` defaults to `3`
- `timeout` defaults to `30s`
- validation errors can short-circuit
- timeouts surface as `TOOL_EXECUTION_TIMEOUT`
- exhausted retries surface as `TOOL_RETRY_EXHAUSTED`
- `fallback` is executed through the same executor path

---

## Authorization model

Native and app-defined tools both rely on annotation-driven authorization. `AnnotationAuthorizer` maps tool annotations onto four execution levels:

| Level | Annotation shape | Result |
|-------|------------------|--------|
| `1` | `readOnly: true` | auto-execute |
| `2` | `idempotent: true` or default policy | audited execution |
| `3` | unknown tool when approval is required | approval required |
| `4` | `destructive: true` | approval required |

`DevToolExecutionBridge` converts authorization failures into explicit engine errors:

- `TOOL_AUTHORIZATION_DENIED`: hard deny
- `TOOL_APPROVAL_REQUIRED`: execution is blocked pending approval

That distinction matters because the caller can treat "never allowed" differently from "allowed after approval."

---

## Webhook tools

Webhook tools expose external HTTP endpoints as tenant-scoped tools. Kiln signs requests with HMAC-SHA256 and returns the parsed JSON response as the tool result.

Key fields on `TenantConfig.webhookTools[]`:

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Tool name shown to the model |
| `description` | Yes | Tool description |
| `url` | Yes | Endpoint to call |
| `secret` | Yes | Signing key |
| `timeout` | No | Request timeout in seconds |
| `inputSchema` | No | JSON Schema for request validation |

The webhook executor uses the same tool loop as any other capability, which means rate limiting, authorization, result sanitization, and event emission stay consistent.

---

## Integration tools

Integration tools wrap third-party APIs behind `IntegrationAdapter` implementations. The runtime handles:

- adapter registration
- credential resolution
- tool definition generation
- execution and error wrapping

Tool names follow `{provider}_{operation}`, such as `google_calendar_check_availability` or `stripe_create_payment_link`. Integration operations surface annotations, so they participate in the same authorization and retry rules as other tools.

---

## Native developer tools

The native developer tool stack lives under `packages/core/src/tools/`. It exists so Kiln can execute coding tasks without depending on an external harness backend.

### External runtime contract

MCP is Kiln's shared external runtime contract for native developer tools. Any
agent host, wrapper, plugin, or installer that needs Kiln tools should consume
the MCP projection or another projection from the canonical registry. It should
not copy tool schemas, own a private executor, or invent a second authorization
surface.

Packaging layers can describe how tools are used. They may provide:

- prompt or instruction payload
- policy hints for the host
- allowed tool groups
- workflow steps
- host installation metadata

They cannot own:

- authorization decisions
- tool execution
- telemetry or audit records
- result sanitization
- private tool executors for Kiln builtin tools

The canonical path remains: registry schema, runtime authorization, execution
bridge, telemetry, audit, and structured result reinjection.

### Domain contracts

`packages/core/src/tools/domain/tool.ts` defines the core types:

```ts
export type ToolInput = {
  readonly name: string;
  readonly input: Record<string, unknown>;
};

export type ToolResult = {
  readonly output: string;
  readonly isError: boolean;
  readonly metadata?: Record<string, unknown>;
};

export interface DevTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly annotations?: DevToolAnnotations;
  execute(input: ToolInput, sandbox?: unknown): Promise<ToolResult>;
}
```

The seven built-in tool names are:

- `bash`
- `read`
- `write`
- `edit`
- `grep`
- `glob`
- `git`

### Built-in tool schemas

`TOOL_SCHEMAS` is the source of truth for names, descriptions, input schemas, and annotations. Those schemas are used both by native callers and by the MCP surface.

### Tool reference

| Tool | Purpose | Key params | Output shape |
|------|---------|------------|--------------|
| `bash` | Run a shell command through `bash -c` | `command`, `timeout`, `cwd` | `ToolResult.output` is combined stdout+stderr; metadata includes `cwd`, `command`, `timeoutMs` |
| `read` | Read file content from disk | `filePath`, `offset`, `limit` | `output` is the selected line window; metadata includes `filePath`, `offset`, `limit`, `totalLines` |
| `write` | Replace full file contents | `filePath`, `content` | `output` is a confirmation string; metadata includes `filePath`, `bytesWritten` |
| `edit` | Replace one or all string matches in a file | `filePath`, `oldString`, `newString`, `replaceAll` | `output` is a replacement summary or an error; metadata includes `filePath`, `replacements`, `replaceAll` |
| `grep` | Search file content by regex | `pattern`, `path`, `glob`, `outputMode` | `output` is newline-delimited matches, file paths, or counts; metadata includes `path`, `strategy`, `outputMode` |
| `glob` | Match files by glob pattern | `pattern`, `path` | `output` is newline-delimited relative file paths; metadata includes `path`, `strategy`, `count` |
| `git` | Run a git subcommand | `subcommand`, `args` | `output` is combined stdout+stderr; metadata includes `cwd`, `command` |

### Executor behavior

The built-in executors are intentionally small and predictable:

- `BashTool` validates `cwd`, validates the command string against the sandbox policy, clamps timeout to `300000ms`, and executes with `execFile("bash", ["-c", command])`.
- `ReadTool` uses line-based slicing, not byte offsets.
- `WriteTool` creates parent directories before writing.
- `EditTool` supports single replacement and `replaceAll`, and fails if the target string is not found.
- `GrepTool` uses `rg` when available and falls back to a recursive file walk plus JavaScript `RegExp`.
- `GlobTool` uses `fd` when available and falls back to the same recursive walker plus glob matching helpers.
- `GitTool` executes `git` directly and validates the reconstructed command string before running it.

All seven tools return `ToolResult`; failures are regular tool results when possible, not uncaught process exceptions.

---

## ToolEnvironment

`ToolEnvironment` records the detected developer-tool binaries:

```ts
export interface ToolEnvironment {
  readonly rg?: BinaryInfo;
  readonly fd?: BinaryInfo;
  readonly jq?: BinaryInfo;
  readonly git?: BinaryInfo;
}
```

`detectToolEnvironment()` probes:

- `rg`
- `fd`
- `jq`
- `git`

It caches the first successful detection result process-wide, and `clearToolEnvironmentCache()` resets that cache for tests or PATH changes.

### Resolution order

Kiln's developer tool stack is designed around three layers:

1. Vendored binaries from `@kilnai/tools` platform packages for `rg`, `fd`, and `jq`
2. System binaries discovered from PATH
3. Pure TypeScript fallback inside the executor when no binary is available

In the current core source, `detectToolEnvironment()` performs the PATH probe and the fallback logic lives in `GrepTool` and `GlobTool`. The vendored resolver is packaged separately in `packages/tools`, which publishes platform-specific optional dependencies such as `@kilnai/tools-win32-x64`.

`git` is different: Kiln detects it from PATH, but there is no pure TypeScript git fallback.

---

## DevToolRegistry

`DevToolRegistry` is the runtime index for developer tools:

```ts
export class DevToolRegistry {
  register(tool: DevTool): void;
  lookup(name: string): DevTool | undefined;
  list(): readonly DevTool[];
  has(name: string): boolean;
  get size(): number;
}
```

Design choice:

- registration is explicit
- lookup is by stable string name
- duplicate registration throws immediately

That matters because the registry is the composition boundary for both the orchestrator and the MCP server. Silent replacement would make authorization, audit logging, and debugging unreliable.

### Custom registration example

```ts
import { DevToolRegistry, type DevTool, type ToolInput, type ToolResult } from "@kilnai/core";

const echoTool: DevTool = {
  name: "echo_json",
  description: "Echo structured JSON input back to the caller.",
  inputSchema: {
    type: "object",
    properties: {
      payload: { type: "object" },
    },
    required: ["payload"],
  },
  annotations: {
    readOnly: true,
    idempotent: true,
  },
  async execute(input: ToolInput): Promise<ToolResult> {
    return {
      output: JSON.stringify(input.input.payload, null, 2),
      isError: false,
      metadata: { tool: "echo_json" },
    };
  },
};

const registry = new DevToolRegistry();
registry.register(echoTool);
```

---

## DevToolExecutionBridge

`DevToolExecutionBridge` is the execution layer between the registry and the caller. It is used directly by the orchestrator and by the MCP server.

### Request shape

```ts
export interface DevToolExecutionRequest {
  readonly name: string;
  readonly input: Record<string, unknown>;
  readonly sandbox?: unknown;
  readonly retry?: RetryConfig;
}
```

### What it does

- resolves the primary tool from the registry
- validates fallback registration before execution begins
- authorizes the tool before execution
- delegates retry and timeout handling to `executeWithRetry()`
- re-validates tool registration for each attempt
- guarantees that the returned value conforms to `ToolResult`

### Authorization flow

`authorizeRequest()` exposes the decision without executing the tool. `execute()` performs the same check again before each run:

1. lookup tool
2. classify annotations through `ToolAuthorizer`
3. allow immediately, require approval, or deny
4. if approved, execute with retry/fallback

Error codes:

- `TOOL_AUTHORIZATION_DENIED`: execution is blocked
- `TOOL_APPROVAL_REQUIRED`: approval is required before execution
- `INTERNAL_ERROR`: missing primary tool, missing fallback tool, or invalid result shape

### Retry and fallback

Retries and fallback are not duplicated across tools. The bridge supplies a single executor closure to `executeWithRetry()`, which then applies:

- bounded timeout
- retry attempts
- error classification
- optional fallback tool invocation

### Event emission

The bridge itself focuses on execution. `Orchestrator.executeDevTool()` wraps it and emits:

- `tool_called`
- `tool_authorized`
- `tool_result`

Those events include authorization level, annotations, duration, success, and a result summary. The design keeps the bridge reusable while preserving observability at the orchestration boundary.

---

## DevToolsMcpServer

`DevToolsMcpServer` exposes the registered developer tools as MCP tools.

### Why it exists

Kiln's developer tools are useful beyond Kiln's own orchestrator. By
projecting the canonical registry through MCP, external agents can consume the
same tool implementations over stdio.

### How it works

- `listTools()` maps canonical developer tool definitions into MCP tool descriptors
- `callTool()` delegates to `DevToolExecutionBridge`
- successful calls return JSON-formatted text content
- failed calls return `isError: true`

The server lazily loads `@modelcontextprotocol/sdk`, caches the resolved modules on the instance, and clears the in-flight promise if initialization fails so a later retry can succeed.

### CLI entrypoint

`packages/cli/src/commands/tools.ts` wires the stdio transport:

```bash
kiln tools --mcp
```

That command:

1. builds a default `DevToolRegistry`
2. registers `bash`, `read`, `write`, `edit`, `grep`, `glob`, and `git`
3. creates `DevToolExecutionBridge`
4. starts `DevToolsMcpServer` on stdio

This is the consumption path for external MCP-compatible agents.

---

## Permission enforcement

Permission enforcement for native developer tools has two layers.

### Core execution layer

Inside `@kilnai/core`, the immediate gate is annotation-based:

- `read`, `grep`, and `glob` are `readOnly`
- `bash` and `write` are destructive
- `edit` and `git` are non-read-only but not marked destructive in the schema

`AnnotationAuthorizer` turns those annotations into execution levels before the bridge runs the tool.

### Wrapper policy layer

At the CLI wrapper layer, `KilnPermissionPolicy` controls what the backend is allowed to attempt:

- harness backends receive native permission translations where supported
- unsupported granular rules are rendered as constraint instructions
- direct API backends use `translatePermissionForProvider()` and inject constraints into the provider system prompt

That means the wrapper can restrict which tool calls a backend should make, while the core runtime still performs final authorization on the concrete developer tool that is about to execute.

For direct API backends, this is advisory rather than native sandbox enforcement. The provider sees policy constraints in the system prompt; the runtime still owns actual tool execution.

OAuth and direct API backends now use the same runtime-owned execution path
when their provider execution profile advertises tool support. The model emits
tool intent through the provider-native tool-calling protocol, and Kiln executes
the concrete developer tools locally through its own orchestrator, approval,
telemetry, and file-change pipeline.

---

## Per-tenant tool configuration

Tenants can further scope runtime tool behavior with:

- tool allowlists
- per-tool rate limits
- max iterations per session
- tenant-specific webhook and integration tool registration

These controls are passed into the orchestrator as per-call tool context instead of mutating global state. That keeps one orchestrator instance safe for multi-tenant use.

---

## Tool events

Tool execution emits two families of events.

### Internal EventBus events

| Event | Key fields |
|-------|------------|
| `tool_called` | `toolName`, `toolInput`, `annotations`, `authorizationLevel`, `taskId` |
| `tool_authorized` | `toolName`, `level`, `allowed`, `reason` |
| `tool_result` | `toolName`, `durationMs`, `success`, `isError`, `retryAttempt`, `resultSummary` |

### Conversation events

Gateway-side runtime sessions also emit `TOOL_EXECUTED` for downstream product integrations.

---

## Result sanitization

Tool results can flow through the safety pipeline before they are reinjected into the model context. Kiln uses the same sanitization principles across tool categories:

- PII detection and redaction
- content classification
- indirect prompt-injection scanning on returned content

The pipeline is intentionally fail-open so a safety-service outage does not freeze tool execution.

---

## Tool selection and scaling

When a session has many tools, Kiln can reduce the prompt footprint by ranking relevant tools before each round. Tool descriptions and annotations still remain the source of truth; ToolRAG only narrows the candidate set.

For large installations, that matters because developer tools, webhook tools, integration tools, and MCP tools all compete for context budget.

---

## Related

- [CLI Wrapper](cli-wrapper.md)
- [Gateway YAML Reference](../configuration/gateway-yaml.md)
- [Skills](skills.md)
- [Observability](observability.md)
