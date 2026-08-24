# Hook System

## Overview

Kiln provides a hook system for executing custom logic at key lifecycle points during CLI wrapper session execution. Hooks are configured in canonical global `~/.kiln/config.yaml` or the bound private project `config.yaml` and executed by the wrapper layer.

## Hook Events

The HookRegistry supports lifecycle events that fire during session execution. The following events are defined in `packages/cli/src/kiln-yaml-types.ts`:

| Event | When It Fires |
|-------|--------------|
| `PreToolUse` | Before a tool is invoked |
| `PostToolUse` | After a tool completes |
| `UserPromptSubmit` | When user submits a prompt |
| `SessionStart` | When session initializes |
| `SessionEnd` | When session completes |
| `SubagentStart` | When a subagent spawns |
| `SubagentStop` | When a subagent completes |

## Hook Configuration

### HookEvent Type

```typescript
export type HookEvent =
  | "PreToolUse"
  | "PostToolUse"
  | "UserPromptSubmit"
  | "SessionStart"
  | "SessionEnd"
  | "SubagentStart"
  | "SubagentStop";
```

### HookHandler

Each hook handler runs a shell command:

```typescript
export type HookHandlerMode = "command";

export interface HookHandler {
  readonly type: HookHandlerMode;
  readonly command: string;
  readonly timeoutSec?: number;
  readonly async?: boolean;
}
```

### HookRule

Hooks can be scoped to specific tools via a matcher:

```typescript
export interface HookRule {
  readonly matcher?: string;
  readonly hooks: readonly HookHandler[];
}
```

### KilnHooksConfig

The complete configuration structure:

```typescript
export interface KilnHooksConfig {
  readonly PreToolUse?: readonly HookRule[];
  readonly PostToolUse?: readonly HookRule[];
  readonly UserPromptSubmit?: readonly HookRule[];
  readonly SessionStart?: readonly HookRule[];
  readonly SessionEnd?: readonly HookRule[];
  readonly SubagentStart?: readonly HookRule[];
  readonly SubagentStop?: readonly HookRule[];
}
```

## Hook Modes

Each hook executes in command mode:

### Command Mode

Runs a shell command. The command receives event context as environment variables:

| Environment Variable | Description |
|---------------------|-------------|
| `KILN_HOOK_EVENT` | The hook event name (e.g., "SessionStart") |
| `KILN_HOOK_TOOL` | The tool name (for PreToolUse/PostToolUse) |
| `KILN_SESSION_ID` | The current session ID |

Commands can be synchronous (blocking) or asynchronous (fire-and-forget). Use `async: true` for background tasks.

Example hook configuration in canonical `config.yaml`:

```yaml
hooks:
  SessionStart:
    - hooks:
        - type: command
          command: echo "Session started: $KILN_SESSION_ID"
          timeoutSec: 30
  PreToolUse:
    - matcher: "bash*"
      hooks:
        - type: command
          command: ./scripts/pre-tool-guard.sh
          timeoutSec: 10
  PostToolUse:
    - hooks:
        - type: command
          command: ./scripts/log-tool-use.sh
          async: true
```

## Hook Executor

The HookExecutor (`packages/cli/src/wrapper/hook-executor.ts`) runs handlers synchronously by default, or asynchronously when `async: true` is set.

For synchronous execution, the command runs with a configurable timeout (default: no timeout). Results are logged but do not block execution unless the exit code is non-zero.

For async execution, the process is spawned detached and unref'd, allowing it to run in the background.

## Session Hooks Integration

The SessionHooks class (`packages/cli/src/application/session-hooks.ts`) provides a high-level API for firing hooks at appropriate points:

```typescript
export class SessionHooks {
  constructor(config: KilnHooksConfig | undefined, options: SessionHooksOptions);

  sessionStart(): void;
  sessionEnd(): void;
  userPromptSubmit(): void;
  preToolUse(toolName: string): void;
  postToolUse(toolName: string): void;
}
```

## Glob Matching

The hook system supports glob patterns for targeting specific tools. For example:
- `matcher: "bash*"` matches any tool starting with "bash"
- `matcher: "*"` matches all tools
- No matcher applies to all tools for that event

## MCP Tool Split

To reduce context window pressure, MCP tools are split into two tiers at the gateway level:

| Tier | Tools | Loading Strategy |
|------|-------|------------------|
| Eager (8) | memory_*, cost_*, budget_*, swarm join/leave/status/broadcast | Loaded at session start |
| Deferred | safety_*, integration_*, eval_*, and other management tools | Loaded on demand when needed |

This split is configured at the gateway level and surfaced through the MCP server's tool discovery.

## Related

- [CLI Wrapper](../gui/cli-wrapper.md) -- session lifecycle and backend management
- [App YAML Configuration](../../configuration/app-yaml.md) -- full app configuration reference
