# 17 Kiln Tool Execution — Applied Today

## Research Prompt

```
You are a senior research architect studying Kiln's tool execution and approval system using cybernetics, nervous systems, and immune systems together.

Kiln's current tool execution architecture:

1. Native dev tools (tools/ bounded context):
   - DevTool interface, DevToolName type, TOOL_SCHEMAS (7 tools: bash, read, write, edit, grep, glob, git)
   - DevToolRegistry: register (throws on duplicate), lookup, list
   - ToolEnvironment: binary detection (rg, fd, jq, git), process-wide cache
   - Tool helpers: shared sandbox helpers, grep/glob fallback utils

2. DevToolExecutionBridge (tools/tool-executor.ts):
   - Authorization levels: deny, approval-required
   - Retry/fallback logic
   - Event emission on tool execution

3. ModeBOrchestrator (session/):
   - Tool authorization
   - Retry/fallback
   - Result sanitization
   - Tool RAG (embedding-based tool selection)
   - PerCallToolConfig (allowlist, rateLimiter, additionalTools, skillInstructions, perCallCapabilities)
   - AI guard (prevents tool use during human_active mode)
   - Model routing via ModelRouter + providerPool

4. Permission system (cli/wrapper/):
   - KilnPermissionPolicy: tools, commands, file governance, data firewall
   - KilnPermissionApproval: never, on-request, on-failure, untrusted
   - KilnSandboxMode: read-only, workspace-write, danger-full-access
   - Permission normalizer: safe defaults base + user rule merge (last-match-wins)
   - translatePermission(): maps Kiln policy to backend-native format

5. Webhook tools:
   - WebhookToolExecutor: HTTP POST + HMAC-SHA256 for external tool calls
   - Tenant tool factory: buildTenantToolContext() assembles per-tenant tool infrastructure

6. Integration tools:
   - IntegrationRegistry: adapter registry with getToolDefinitions()
   - IntegrationExecutor: per-tenant adapter execution with credential resolution (30s timeout)
   - LocalCredentialResolver: SecretStore-backed

7. MCP tools:
   - MCP client: Streamable HTTP via official SDK, circuit breaker
   - DevToolsMcpServer: MCP stdio surface for native dev tools
   - GatewayMcpServer: 25 tools (memory, knowledge, cost, safety, routing, eval, enrichment, cross-agent memory, swarm)

8. Safety on tool results:
   - Indirect injection scanning on tool results
   - Result sanitization in ModeBOrchestrator
   - Sliding window rate limiter (per-tool, per-tenant)

I need a design analysis for:
- real tool execution
- approval gating
- trust boundaries
- safety interrupts
- per-session state
- observability

Output:
1. Biological interpretation (cybernetic + nervous + immune)
2. Clean software architecture assessment
3. Which control loop owns approval
4. Which subsystem owns trust
5. Which subsystem owns interruption and resumption
6. How to avoid fake capability claims

End with these sections:
- Mechanisms
- Software Abstractions
- Direct Kiln Mappings
- Risks / Misuse
- Where The Analogy Breaks
- Actionable Research Follow-Ups
```
