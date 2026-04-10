# CLI Wrapper Architecture

## Overview

Kiln wraps multiple execution backends behind a single `IKilnSession` contract. That keeps the run loop, transcript handling, approval memory, reporting, and provider selection logic independent from any one agent runtime.

There are two backend families:

- harness backends: Claude Code, Codex CLI, OpenCode
- direct API backends: Anthropic, OpenAI, OpenRouter, DeepSeek, Ollama

Sources: `packages/cli/src/wrapper/session.ts`, `packages/cli/src/wrapper/session-registry.ts`, `packages/cli/src/wrapper/provider-session.ts`, `packages/cli/src/wrapper/provider-context.ts`, `packages/cli/src/wrapper/preamble-builder.ts`, `packages/cli/src/commands/run.ts`, `packages/cli/src/commands/tui.ts`

## `IKilnSession`

Every backend implements the same interface:

```ts
export interface IKilnSession {
  run(options: SessionRunOptions): AsyncIterable<SessionEvent>;
  dispose(): Promise<void>;
  readonly capabilities: SessionCapabilities;
  readonly sessionId: string;
  readonly providerSessionId: string | undefined;
}
```

### `SessionEvent`

`SessionEvent` is the stream contract seen by the CLI and TUI.

| Variant | Fields | Description |
|---------|--------|-------------|
| `text_delta` | `content`, `isThinking?` | Streaming text output |
| `tool_use` | `toolName`, `input`, `source?`, `mcpSelector?` | Tool invocation |
| `tool_result` | `toolName`, `output` | Tool output |
| `file_changed` | `path`, `changeType`, `linesAdded?`, `linesRemoved?` | File mutation event |
| `cost_update` | `usd`, `mode`, `inputTokens?`, `outputTokens?`, `cacheReadTokens?` | Incremental cost/token data |
| `completed` | `totalUsd`, `durationMs`, `isError`, `isPreflightCrash` | End-of-session marker |
| `error` | `code`, `message`, `isRetryable` | Structured failure |

### `SessionCapabilities`

`SessionCapabilities` describes runtime behavior:

| Field | Description |
|-------|-------------|
| `mcp` | Whether the backend can use MCP directly |
| `streaming` | Whether the backend streams output |
| `resumable` | Whether the backend exposes resumable semantics |
| `resume` | Whether Kiln can reattach to prior sessions |
| `costTrackingMode` | `native`, `computed`, or `none` |
| `supportedTools` | Tool allowlist when the backend exposes one |
| `maxContextTokens` | Known context limit or `null` |
| `priority` | Registry ordering weight |
| `fallbackTo` | Explicit next backend, if any |
| `permissionPolicy` | The normalized Kiln permission policy attached to the session |

## Harness backends

The harness path shells out to external agent runtimes:

| Backend | Transport | Notes |
|---------|-----------|-------|
| Claude Code | SDK / subprocess | Native cost reporting |
| Codex CLI | `codex exec --json` | Computed cost tracking |
| OpenCode | `opencode serve` + SDK | MCP-capable, runtime config patching |

Harness backends are the path to use when you need runtime-native MCP support, provider-owned resume semantics, or the backend's own tool execution surface.

## Direct API backends

`ProviderSession` is the direct-API implementation of `IKilnSession`. It talks to Kiln's provider adapters directly instead of launching a subprocess.

### When to use `ProviderSession`

Use a direct API backend when you want:

- no subprocess lifecycle
- lower startup latency
- direct provider selection from Kiln
- a unified provider pool shared with harness backends

Use a harness backend when you need:

- MCP support
- native tool execution from the external runtime
- backend-owned session resume or attach flows

### Supported providers

| Provider | Env var | Default model | Cost tier | Priority |
|----------|---------|---------------|-----------|----------|
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-sonnet-4-6` | high | 4 |
| `openai` | `OPENAI_API_KEY` | `gpt-4o` | high | 5 |
| `openrouter` | `OPENROUTER_API_KEY` | user-selected | low | 6 |
| `deepseek` | `DEEPSEEK_API_KEY` | `deepseek-chat` | medium | 7 |
| `ollama` | none, `OLLAMA_BASE_URL` optional | user-selected | local | 8 |

The priority values come from both `ProviderSession` and the registry descriptors in `session-registry.ts`.

### `ProviderSessionConfig`

`ProviderSession` is configured with:

```ts
export interface ProviderSessionConfig {
  readonly provider: "anthropic" | "openai" | "deepseek" | "openrouter" | "ollama";
  readonly model?: string;
  readonly task: string;
  readonly systemPrompt?: string;
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly permissionPolicy: KilnPermissionPolicy;
  readonly constraintInstructions?: readonly string[];
}
```

Design choice:

- `task` is explicit because direct API sessions do not reconstruct a harness-side task object
- `env` can override process environment on a per-run basis
- `constraintInstructions` carries wrapper-level policy translation into the provider prompt

### How `ProviderSession` runs

`ProviderSession.run()`:

1. resolves provider credentials from `options.env`, then `config.env`, then `process.env`
2. instantiates the provider adapter
3. detects whether the prompt already contains a structured Kiln preamble
4. builds the final provider system prompt with `buildProviderSystemPrompt()`
5. streams provider events and maps them into `SessionEvent`
6. updates context accounting when the provider signals completion

`dispose()` is a no-op because there is no subprocess or socket to tear down.

`providerSessionId` is always `undefined` in V1.

### `AgentStreamEvent` to `SessionEvent`

`ProviderSession` translates provider stream output into the wrapper contract:

| Provider event | Session event | Notes |
|----------------|---------------|-------|
| `thinking` | `text_delta` | `isThinking: true` |
| `text` | `text_delta` | standard streamed output |
| `tool_use` | `tool_use` | parses JSON payload for `name` and `input` |
| `tool_result` | `tool_result` | currently emitted with empty `toolName` |
| `done` | `cost_update` then `completed` | computed cost mode, zero USD in V1 |

Parse failures on provider `tool_use` payloads surface as `error` events with code `PROVIDER_TOOL_USE_PARSE_ERROR`.

Any outer execution failure surfaces as `PROVIDER_SESSION_ERROR`.

### Permission policy

Direct API providers do not natively implement Kiln's granular permission model. `translatePermissionForProvider()` handles that by converting the `KilnPermissionPolicy` into prompt-side constraints:

- every granular rule becomes an unsupported rule for direct providers
- those rules are rendered into `constraintInstructions`
- `buildProviderSystemPrompt()` appends them under `[KILN POLICY CONSTRAINTS]`

That means:

- constraints are injected into the provider system prompt
- they are not natively enforced by the provider transport
- native execution remains a Kiln responsibility, not a provider responsibility

This is an explicit design tradeoff: lower latency and simpler transport in exchange for weaker native enforcement than a harness backend can provide.

### `ProviderContextTracker`

`ProviderContextTracker` gives Kiln a backend-independent way to watch context pressure for direct API sessions.

Config:

```ts
new ProviderContextTracker({
  maxContextTokens: 128000,
  compactionThreshold: 0.85,
});
```

Current behavior:

- accumulates input and output token counts
- computes `compactionThresholdTokens` as `floor(maxContextTokens * compactionThreshold)`
- exposes `shouldTriggerCompaction(pendingTokens?)`
- supports `reset(tokens?)`

In `ProviderSession`, the tracker updates on provider `done` events using `inputTokens` and `outputTokens` when present.

## SessionRegistry

`SessionRegistry` is the backend pool and fallback selector for both harness and direct API sessions.

### What it manages

- provider registration
- requirement filtering
- score-based selection
- health state via a shared circuit breaker
- provider construction

### Current provider pool

The default registry contains eight backends:

- `claude`
- `codex`
- `opencode`
- `anthropic`
- `openai`
- `openrouter`
- `deepseek`
- `ollama`

### Selection behavior

`selectBest()` evaluates:

- preferred provider
- MCP requirement
- streaming requirement
- resume requirement
- max cost tier
- configured provider priority
- field-pressure bonus from `getFieldStrength()`

The circuit breaker:

- opens after three failures
- suppresses a provider for 30 seconds
- moves to half-open after suppression expires
- closes on success

The result is a primary provider plus ordered fallbacks.

## Permission policy

`KilnPermissionPolicy` is the wrapper's canonical permission contract:

```ts
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

### Translation paths

- `translatePermission()` targets harness backends
- `translatePermissionForProvider()` targets direct API backends

Backend behavior differs:

| Backend family | Native enforcement |
|----------------|--------------------|
| Claude Code | partial native translation plus prompt constraints |
| Codex CLI | coarse native approval/sandbox flags, granular rules become constraints |
| OpenCode | runtime permission payloads, sandbox intent is advisory |
| Direct API providers | no native enforcement, prompt constraints only |

`normalizePermissionPolicy()` applies safe defaults and merges user rules before any translation happens.

## Session resume and persistence

The wrapper persists session metadata and transcripts through `SessionStore` and `TranscriptStore`.

Current direct-provider limitation:

- `ProviderSession` does not support session resume
- `providerSessionId` is unset
- direct API backends participate in transcript persistence, but not in provider-native reattachment

Harness backends remain the path for native resume behavior.

## System prompt construction

Kiln uses two prompt builders:

- `buildPreamble()` for harness sessions, which emits `<kiln-preamble>` XML
- `buildProviderSystemPrompt()` for direct API sessions, which appends plain-text policy constraints

That split exists because direct providers do not need harness-specific prompt wrapping and do not receive MCP/runtime metadata in the same way.

## Execution identity

Kiln now appends an explicit execution-identity block at the final invocation boundary instead of relying on the model to infer which backend is active.

Shared helper:

- `packages/core/src/agents/execution-identity.ts`

Behavior:

- harness sessions append the identity block before calling their external runtime
- direct-provider sessions append the same block before calling the provider adapter
- runtime `ModeBOrchestrator` can replace configured identity with routed identity when model routing actually changes the provider or model used for the turn

The block has this shape:

```text
[KILN EXECUTION IDENTITY]
provider: <provider>
model: <model>
source: configured | runtime-routed
If asked about provider/model, use this identity for this turn.
```

Important rule:

- `source: runtime-routed` is only used when the routed provider was actually applied
- if the router suggests a provider that cannot be resolved from the runtime pool, Kiln keeps the configured identity in the prompt

That keeps "which model/provider are you?" answers aligned with the backend that really executed the turn instead of the last optimistic UI selection or a failed routing attempt.

## CLI usage

Examples:

```bash
kiln run --provider openrouter --model meta-llama/llama-3.1-8b-instruct:free "Summarize this repo"
```

```bash
kiln run --provider anthropic --model claude-sonnet-4-6 "Review these changes"
```

```bash
kiln tui --provider ollama
```

`run.ts` treats direct API providers differently in one important way: when a provider is direct, `requiresMcp` is set to `false` so the registry does not exclude the provider for lacking MCP support.

## Agent Profiles

Kiln can load agent profiles from markdown files in `~/.kiln/agents/*.md` and `<project>/.kiln/agents/*.md`. Each file uses YAML frontmatter for `name`, `role`, `tools`, `model`, and `skills`, followed by a markdown body containing additional agent instructions.

Load order is global first, then project. If both scopes define the same `name`, the project definition overrides the global one. Missing agent directories are ignored.

Use `kiln run --agent <name>` to select a profile. Model resolution stays explicit: `--model` wins, otherwise Kiln uses `agent.model` when present. Agent instructions are appended to the existing system prompt generated by Kiln; they do not replace it.

Run `kiln sync --agents-md` (or `kiln sync` with no flags) to generate an `AGENTS.md` file at the project root. The file is valid GitHub-flavored markdown readable by Claude Code, Codex, OpenCode, and Cursor without any Kiln-specific configuration. It is auto-generated: edit agent `.md` files in `.kiln/agents/`, then re-run sync.

## TUI integration

`kiln tui` can select both harness and direct API providers. The provider picker is split into:

- Harness
- Direct API

That makes the backend tradeoff explicit instead of hiding direct providers behind CLI-specific naming.

Current transport behavior:

- gateway transport is the default for `kiln tui`
- direct transport is opt-in via `KILN_TUI_TRANSPORT=direct`

In gateway mode, the TUI receives both the selected provider and the final routed provider/model for each completed turn, so the chat header reflects actual execution rather than only the requested provider.

## Limitations

Current direct API backend limitations:

- no MCP support
- no native tool execution surface in V1
- no provider-native session resume
- computed cost mode reports `usd: 0` in V1
- `tool_result` events currently do not carry a provider-supplied tool name

These are implementation boundaries, not documentation gaps.

## Related

- [Tool Use](tool-use.md)
- [Hooks](hooks.md)
- [Skills](skills.md)
- [Observability](observability.md)
