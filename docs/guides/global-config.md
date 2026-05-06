# Global Config

## Overview

`~/.kiln/config.yaml` is the global source of truth for engine defaults,
routing, permissions, MCP servers, hooks, managed agents, UI preferences, and
identity. Project `kiln.yaml` overrides it where needed, and `kiln sync` pushes
the derived backend configs into native CLIs.

## File Location

- Default: `~/.kiln/config.yaml`
- Linux with `XDG_CONFIG_HOME` set: `$XDG_CONFIG_HOME/kiln/config.yaml`

## Schema

| Field | Type | Description |
|-------|------|-------------|
| `version` | `string` | Global config schema version. Current version is `"2"`. |
| `engines` | `Record<string, KilnGlobalEngineConfig>` | Engine availability and billing metadata. |
| `routing.defaultWorker` | `string` | Default engine/provider route for operator sessions. |
| `routing.fallback` | `string` | Optional fallback route for budget-aware routing. |
| `routing.budgetAware` | `boolean` | Enables budget-aware route selection when configured. |
| `routing.budget` | `Record<string, KilnGlobalRoutingBudgetConfig>` | Optional per-engine budget ceilings. |
| `models.default` | `string` | Default model used when a route-specific model does not override it. |
| `models.<engine>` | `string` | Engine-specific model override. |
| `permissions` | `KilnPermissionPolicy` | Default approval and sandbox policy applied when no project-level override exists. |
| `mcp` | `Record<string, unknown>` | Global MCP server definitions and related client config. |
| `hooks` | `Record<string, unknown>` | Global hook configuration shared across Kiln-managed workflows. |
| `managedAgents` | `KilnManagedAgentsConfig` | Governed child-agent route configuration shared by GUI, TUI, and CLI runtime surfaces. |
| `identity` | `KilnGlobalIdentity` | Global identity values used for personalization and prompt context. |
| `identity.name` | `string` | Default operator name for generated prompt context and UI personalization. |
| `identity.timezone` | `string` | Default timezone identifier for prompt context and scheduling-aware flows. |
| `ui.theme` | `string` | Default operator theme name from the shared GUI/TUI theme catalog. |
| `components.include` | `string[]` | Bundled component set identifiers enabled for the operator. |

MCP server entries may include `requestTimeoutMs` to override the default
Kiln-owned MCP client request timeout for that server. Use it for servers with
long-running tools when the tool's own input does not expose a millisecond
`timeout` field.

Supported operator themes are `kiln-dark`, `kiln-light`, `system-follow`,
`dracula`, `catppuccin-mocha`, `nord`, `tokyo-night`, `gruvbox-dark`,
`rose-pine`, `kanagawa-wave`, `everforest-dark`, `ayu-dark`, `one-dark`, and
`night-owl`. GUI and TUI validate theme names against the same contract.
When the CLI `operator_set_theme` tool is called with `scope: "persisted"`, it
writes `ui.theme` because there is no live CLI visual surface to update.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `KILN_PROVIDER` | Default provider — overrides `routing.defaultWorker`, overridden by `--provider` flag |
| `KILN_MODEL` | Default model — overrides `models.default` or the selected engine model, overridden by `--model` flag |

Priority order: CLI flag > environment variable > `~/.kiln/config.yaml` > built-in default.

## Example

```yaml
version: "2"
engines:
  claude:
    enabled: true
    billing: subscription
  codex:
    enabled: true
    billing: plus-quota
routing:
  defaultWorker: codex
  budgetAware: false
models:
  default: claude-sonnet-4-5
  codex: gpt-5.4
permissions:
  approval: on-request
  sandbox: read-only
identity:
  name: Ricardo
  timezone: America/Tijuana
ui:
  theme: kiln-dark
components:
  include:
    - baseline:core
```

### Supported providers

`routing.defaultWorker` and `KILN_PROVIDER` accept engine/provider identifiers
known to Kiln's registry. Harness routes such as `claude`, `codex`, and
`opencode` are valid where the corresponding engine is enabled. Direct-provider
identifiers remain available for direct runtime sessions.

| Provider ID | Description |
|-------------|-------------|
| `anthropic` | Anthropic API (Claude models). Requires `ANTHROPIC_API_KEY` or `~/.kiln/auth/anthropic/`. |
| `openai` | OpenAI API. Requires `OPENAI_API_KEY` or `~/.kiln/auth/openai/`. |
| `deepseek` | DeepSeek API. Requires `DEEPSEEK_API_KEY` or `~/.kiln/auth/deepseek/`. |
| `openrouter` | OpenRouter aggregation gateway. Requires `OPENROUTER_API_KEY` or `~/.kiln/auth/openrouter/`. |
| `ollama` | Ollama local inference. No key required; configure endpoint in `~/.kiln/auth/ollama/`. |
| `codex-oauth` | OpenAI Codex via ChatGPT Plus device-code OAuth. Manage with `kiln auth codex-oauth`. |
| `opencode-go` | OpenCode Go subscription — flat-rate access ($10/mo) to Go-tier model set. Manage with `kiln auth opencode --tier go`. |
| `opencode-zen` | OpenCode Zen gateway — pay-per-request credits, access to Zen-tier model set. Manage with `kiln auth opencode --tier zen`. |

## Relationship to kiln.yaml

Global config establishes user-level defaults that apply across every Kiln
project. Project `kiln.yaml` overrides scalar values such as provider, model,
permissions, web policy, or managed-agent routes, while MCP server definitions
are additive so both global and project servers remain active. The merge is
performed by `loadKilnConfig(projectPath)` in `config/config-merger.ts`; use
this instead of `readKilnYaml()` in command-level code. `kiln sync`
materializes the merged result into native CLI configs; edit Kiln config files,
not the generated native configs directly.

## Obsolete Configs

Global config v1 is historical only. Current Kiln code does not produce or
consume v1 global config. If an old `~/.kiln/config.yaml` exists, recreate it as
v2 or run `kiln import-native codex` / `kiln import-native opencode` to import
supported native engine settings into the v2 contract.

## Agent Sync

Run `kiln sync --agents` (or `kiln sync` with no flags) to push agent definitions from `~/.kiln/agents/` and `.kiln/agents/` to all three CLIs:

| Target | Location | Format |
|--------|----------|--------|
| Claude Code | `~/.claude/agents/<name>.md` | YAML frontmatter + markdown |
| Codex | `~/.codex/agents/<name>.toml` | TOML role file |
| OpenCode | `~/.config/opencode/agents/<name>.md` | YAML frontmatter + markdown |

Agent definitions are translated from Kiln's `.md` format automatically. Sync is one-way (Kiln -> CLIs).

## Skills Sync

Run `kiln sync --skills` (or `kiln sync` with no flags) to copy skill directories from `~/.kiln/skills/` and `.kiln/skills/` to all three CLIs.

| Target | Location |
|--------|----------|
| Claude Code | `~/.claude/skills/<name>/` |
| Codex | `~/.codex/skills/<name>/` |
| OpenCode | `~/.config/opencode/skills/<name>/` |

Project skills override global skills with the same name. Only top-level files within each skill directory are copied. Sync is one-way (Kiln -> CLIs).
