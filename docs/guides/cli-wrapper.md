# CLI Wrapper Architecture

## Overview

Kiln wraps 3 CLI backends (Claude Code, Codex CLI, OpenCode) behind a unified IKilnSession interface. The wrapper layer handles subprocess lifecycle, permission translation, session resume, config sync, and cost tracking.

## IKilnSession Interface

Defined in `packages/cli/src/wrapper/session.ts`. All session implementations must satisfy this contract.

The interface:
- `run(options: SessionRunOptions): AsyncIterable<SessionEvent>` -- async generator yielding events
- `dispose(): Promise<void>` -- cleanup subprocess
- `capabilities: SessionCapabilities` -- static metadata about the backend
- `sessionId: string` -- unique identifier

### SessionEvent

SessionEvent is a discriminated union with 6 variants:

| Variant | Fields | Description |
|---------|--------|-------------|
| `text_delta` | `content: string` | Streaming text output |
| `tool_use` | `toolName: string`, `input: unknown`, `source?: "native" \| "mcp"`, `mcpSelector?: string` | Tool invocation (with optional MCP source and selector) |
| `tool_result` | `toolName: string`, `output: string` | Tool output |
| `cost_update` | `usd: number`, `mode: CostTrackingMode`, `inputTokens?: number`, `outputTokens?: number`, `cacheReadTokens?: number` | Per-turn cost with USD, token counts, and tracking mode |
| `completed` | `totalUsd: number`, `durationMs: number`, `isError: boolean`, `isPreflightCrash: boolean` | Session end with total cost, duration, error status |
| `error` | `code: string`, `message: string`, `isRetryable: boolean` | Structured error with code, message, retryability |

### SessionCapabilities

SessionCapabilities describes what each backend supports:

| Field | Type | Description |
|-------|------|-------------|
| `mcp` | `boolean` | MCP support |
| `streaming` | `boolean` | Streaming output |
| `resumable` | `boolean` | Session resume capability |
| `resume` | `boolean` | Can resume previous session |
| `costTrackingMode` | `CostTrackingMode` | `native` \| `computed` \| `none` |
| `supportedTools` | `readonly string[]` | Tool allowlist |
| `maxContextTokens` | `number \| null` | Context window size (null = unknown) |
| `priority` | `number` | Ordering for SessionRegistry selection |
| `fallbackTo` | `string \| null` | Next backend to try on failure |
| `permissionPolicy` | `KilnPermissionPolicy` | The KilnPermissionPolicy applied to this session |

### SessionRunOptions

| Field | Type | Description |
|-------|------|-------------|
| `prompt` | `string` | The prompt to send to the backend |
| `cwd?` | `string` | Working directory |
| `env?` | `Record<string, string>` | Environment variables |
| `abortSignal?` | `AbortSignal` | Abort controller signal |

## Backend Implementations

| Aspect | ClaudeSession | CodexSession | OpenCodeSession |
|--------|--------------|--------------|-----------------|
| Spawn | subprocess (claude -p) | subprocess (codex exec --json) | opencode serve + SDK |
| Output format | SDK events | JSONL stream | ACP SSE events |
| Resume | reuseEnvironmentId, --resume | --conversation-id (deferred) | stored remoteSessionId, --attach |
| Cost tracking | native (SDK reports USD) | computed (token counts + models.dev) | none |
| Permission delivery | settings.json rules | config.toml approval_policy | PATCH /config |
| MCP config | .mcp.json in project | config.toml mcp_servers | PATCH /config mcp block |
| Bare mode | --bare (skips hooks/skills/plugins) | N/A | N/A (uses serve mode) |

Key implementation files:
- `packages/cli/src/wrapper/claude-code-process.ts`
- `packages/cli/src/wrapper/codex-session.ts`
- `packages/cli/src/wrapper/opencode-session.ts`

## Permission Policy

KilnPermissionPolicy is the canonical permission model. All fields are optional:

```typescript
export interface KilnPermissionPolicy {
  readonly approval?: KilnPermissionApproval;
  readonly sandbox?: KilnSandboxMode;
  readonly safeDefaults?: boolean;
  readonly auditLog?: boolean;
  readonly tools?: readonly KilnToolPermissionRule[];
  readonly commands?: readonly KilnCommandPermissionRule[];
  readonly fileGovernance?: KilnFileGovernancePolicy;
  readonly dataFirewall?: readonly KilnDataFirewallRule[];
  readonly agentScopes?: readonly KilnAgentPermissionScope[];
}
```

### Permission Types

| Type | Values |
|------|--------|
| `KilnPermissionApproval` | `never` \| `on-request` \| `on-failure` \| `untrusted` |
| `KilnSandboxMode` | `read-only` \| `workspace-write` \| `danger-full-access` |
| `KilnPermissionAction` | `allow` \| `ask` \| `deny` |

### Granular Rules

```typescript
export interface KilnToolPermissionRule {
  readonly tool: string;
  readonly action: KilnPermissionAction;
  readonly reason?: string;
}

export interface KilnCommandPermissionRule {
  readonly pattern: string;
  readonly action: KilnPermissionAction;
  readonly shell?: "bash" | "sh" | "zsh" | "any";
  readonly reason?: string;
}

export interface KilnFileGovernancePolicy {
  readonly denyGlobs?: readonly string[];
  readonly askGlobs?: readonly string[];
  readonly allowGlobs?: readonly string[];
  readonly excludeFromContext?: boolean;
}

export interface KilnDataFirewallRule {
  readonly destination: KilnDataDestination | string;
  readonly action: "allow" | "redact" | "deny";
  readonly classifications?: readonly string[];
  readonly reason?: string;
}

export interface KilnAgentPermissionScope {
  readonly agent: string;
  readonly inherit?: boolean;
  readonly tools?: readonly KilnToolPermissionRule[];
  readonly commands?: readonly KilnCommandPermissionRule[];
  readonly fileGovernance?: KilnFileGovernancePolicy;
  readonly mcpTools?: readonly string[];
}
```

### Translation

`translatePermission()` in `packages/cli/src/wrapper/session-registry.ts` converts policy to backend-native format:
- Claude Code: settings.json allow/deny rules
- Codex CLI: config.toml approval_policy + sandbox_mode
- OpenCode: opencode.json permission.default

Unsupported granular rules are expressed as constraint instructions injected into the system prompt.

### Normalization

`normalizePermissionPolicy()` in `packages/cli/src/wrapper/permission-normalizer.ts` applies SAFE_DEFAULTS base rules and merges user rules with last-match-wins semantics.

## Session Resume

SessionStore (`packages/cli/src/wrapper/session-store.ts`) provides lightweight session indexing:
- Append-only JSONL at `.kiln/sessions.jsonl`
- Used for `--resume` and `--last` lookups
- Fail-open: if write fails, session still runs

TranscriptStore provides per-session persistence:
- `.kiln/sessions/{id}/meta.json`: session metadata
- `.kiln/sessions/{id}/transcript.jsonl`: full event log
- Used by skill capture pipeline

Resume per backend:
- Claude Code: reuseEnvironmentId passed to SDK, --resume flag on kiln run
- OpenCode: remoteSessionId stored and reused, --attach flag
- Codex: thread_id via --conversation-id (deferred: upstream support incomplete)

## Config Sync

### kiln mcp-config

Generates MCP server configuration for one or all backends:
- `--client claude-code`: writes `{project}/.mcp.json`
- `--client codex`: writes `~/.codex/config.toml` (via smol-toml)
- `--client opencode`: writes `~/.config/opencode/opencode.json` (JSONC-safe)
- `--client all`: writes all three
- Merge-only semantics: existing keys preserved, only Kiln-managed entries updated

### kiln sync

- `--permissions`: reads kiln.yaml, calls translatePermission() per backend, writes native config
- `--hooks`: copies autoformat.sh to backend hook directories
- `--all`: both

## System Prompt Injection

`buildPreamble(ctx, policy, agent?)` in `packages/cli/src/wrapper/preamble-builder.ts` assembles a kiln-preamble XML block injected on every prompt:

Sections (each omitted when empty):
- `role`: agent name, role, goal, backstory
- `task`: the current prompt/instruction
- `domain`: project type, tool tags, quality gates
- `constraints`: approval mode, sandbox mode
- `memory`: memory snapshot (200-line cap with truncation notice)
- `instructions`: additional directives

All content is XML-escaped. The preamble includes a static kiln-compaction-recovery section for context window management.

## SessionRegistry

SessionRegistry (`packages/cli/src/wrapper/session-registry.ts`) manages backend selection:
- Priority-ordered: backends sorted by SessionCapabilities.priority
- Capability filtering: only backends matching required features are considered
- Circuit breaker: failed backends suppressed for 30 seconds, then half-open probe
- Fallback chain: if preferred backend fails or is suppressed, next by priority is tried

## Related

- [Gateway Configuration](../configuration/gateway-yaml.md) -- Mode B session lifecycle
- [Hooks](hooks.md) -- hook system and lifecycle events
- [Skills](skills.md) -- skill format and capture pipeline
- [Observability](observability.md) -- cost tracking and metrics