# Global Config

## Overview

`~/.kiln/config.yaml` is the global source of truth for provider defaults, permissions, MCP servers, hooks, and identity. Project `kiln.yaml` overrides it where needed, and `kiln sync` pushes the derived backend configs into native CLIs.

## File Location

- Default: `~/.kiln/config.yaml`
- Linux with `XDG_CONFIG_HOME` set: `$XDG_CONFIG_HOME/kiln/config.yaml`

## Schema

| Field | Type | Description |
|-------|------|-------------|
| `version` | `string` | Global config schema version. Current default is `"1"`. |
| `provider` | `string` | Default provider for Kiln CLI and TUI sessions. |
| `model` | `string` | Default model used when a project or command does not override it. |
| `permissions` | `KilnPermissionPolicy` | Default approval and sandbox policy applied when no project-level override exists. |
| `mcp` | `Record<string, unknown>` | Global MCP server definitions and related client config. |
| `hooks` | `Record<string, unknown>` | Global hook configuration shared across Kiln-managed workflows. |
| `identity` | `KilnGlobalIdentity` | Global identity values used for personalization and prompt context. |
| `identity.name` | `string` | Default operator name for generated prompt context and UI personalization. |
| `identity.timezone` | `string` | Default timezone identifier for prompt context and scheduling-aware flows. |
| `tui` | `KilnGlobalTuiConfig` | Global TUI preferences. |
| `tui.theme` | `string` | Default TUI theme name. |
| `gui` | `KilnGlobalGuiConfig` | Global GUI preferences. |
| `gui.theme` | `string` | Default GUI theme name (`kiln-dark`, `kiln-light`, `system-follow`). |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `KILN_PROVIDER` | Default provider — overrides `~/.kiln/config.yaml` provider, overridden by `--provider` flag |
| `KILN_MODEL` | Default model — overrides `~/.kiln/config.yaml` model, overridden by `--model` flag |

Priority order: CLI flag > environment variable > `~/.kiln/config.yaml` > built-in default.

## Example

```yaml
version: "1"
provider: claude
model: claude-sonnet-4-5
permissions:
  approval: on-request
  sandbox: read-only
identity:
  name: Ricardo
  timezone: America/Tijuana
tui:
  theme: nord
gui:
  theme: kiln-dark
```

## Relationship to kiln.yaml

Global config establishes user-level defaults that apply across every Kiln project. Project `kiln.yaml` overrides scalar values such as provider, model, or theme, while MCP server definitions are additive so both global and project servers remain active. The merge is performed by `loadKilnConfig(projectPath)` in `config/config-merger.ts` — use this instead of `readKilnYaml()` in command-level code. `kiln sync` materializes the merged result into native CLI configs; edit Kiln config files, not the generated native configs directly.

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
