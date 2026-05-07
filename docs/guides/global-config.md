# Global Config

## Overview

`~/.kiln/config.yaml` is the global source of truth for engine defaults,
routing, permissions, MCP servers, hooks, managed agents, UI preferences, and
operator identity. It is not a monolithic personality file. Durable behavioral
doctrine belongs in instruction profiles, executable roles belong in agent
profiles, and reusable procedures belong in skills. Global agents and skills
live next to the config under `~/.kiln/agents/` and `~/.kiln/skills/`. Project
`kiln.yaml` and `.kiln/agents|skills` override them where needed.

Harness integration is capability-driven: Kiln uses runtime config injection
for Kiln-launched processes only when a harness supports it, and `kiln sync`
pushes derived backend configs into native CLIs when native projection is
required.

The architecture contracts are `docs/architecture/config-projection.md` and
`docs/architecture/harness-integration-capabilities.md`. Agent-context doctrine
is `docs/architecture/agent-context.md`. This guide is the operator-facing
usage view.

## File Location

- Default: `~/.kiln/config.yaml`
- Linux with `XDG_CONFIG_HOME` set: `$XDG_CONFIG_HOME/kiln/config.yaml`

## Schema

| Field | Type | Description |
|-------|------|-------------|
| `version` | `string` | Canonical global config schema guard. Current version is `"1"`. |
| `engines` | `Record<string, KilnGlobalEngineConfig>` | Engine availability and billing metadata. |
| `routing.defaultWorker` | `string` | Default engine/provider route for operator sessions. |
| `routing.fallback` | `string` | Optional fallback route for budget-aware routing. |
| `routing.routes` | `{ provider: string, model?: string }[]` | Ordered provider/model execution candidates. When present, the first healthy route is the default and later entries are fallbacks. |
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

Managed child invocation is derived from the same canonical routing hierarchy
unless `managedAgents.routes` declares an explicit allowlist. When
`routing.routes` is present, GUI, TUI, CLI run, and operator gateway sessions
project eligible direct providers and harnesses with live-proven read-only
result handoff into synthesized read-only `foundation-readonly-plan` routes for
`managed_agent.invoke`.
Direct-provider projections require an explicit model and that model must be
known tool-call-capable for Kiln runtime tools. If no ordered route list exists,
Kiln falls back to the enabled supported child engines: `routing.defaultWorker`
is preferred when it names `codex` or `opencode`; otherwise Kiln chooses the
first enabled supported child engine. `managedAgents.routes` declares explicit
allowlisted routes, and `managedAgents.enabled: false` disables the runtime tool
even when a supported engine is enabled. A route whose provider has
`engines.<provider>.enabled: false` is unhealthy even if it is explicitly
declared. A route is also unhealthy when the session-start engine probe cannot
find or execute the target harness. Harness routes are also unhealthy when the
provider does not advertise the configured model or when that provider/model has
not live-proven substantive result handoff for the requested managed profile.
The current safe default for OpenCode read-only child invocations is
`opencode/minimax-m2.5-free`; OpenCode models that merely appear in a free tier
remain unavailable until they pass the same managed handoff proof. Synthesized
child routes use `models.<engine>` when present, then the adapter's safe default
for that engine. They do not inherit
`models.default`, because model IDs are provider-specific. Write-capable routes
are never synthesized.
At runtime, Kiln projects the resolved route registry into the
`managed_agent.invoke` tool definition so parent agents can see configured
route ids and unavailable-route diagnostics. If multiple managed routes share a
provider/profile, parent agents must select by `routeId` or by an exact
configured model; provider-only selection fails closed as ambiguous.
The same runtime tool can request `agentProfile`, `skills`, and `contextMode`.
GUI, TUI, and CLI-launched managed invocations resolve those fields from
`.kiln/agents`, `~/.kiln/agents`, `.kiln/skills`, and `~/.kiln/skills`. Missing
profiles, missing skills, or `contextMode: "fork"` fail closed instead of
falling back to ambient parent context.

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

## Ordered Routes

Use `routing.routes` when routing must express a durable hierarchy instead of
a single default plus one fallback. Each entry is a provider/model execution
candidate. Kiln evaluates them in order, skips direct provider/model routes
that are cooling down, and passes the remaining healthy candidates to the
runtime session loop.

```yaml
routing:
  routes:
    - provider: codex-oauth
      model: gpt-5.4-mini
    - provider: openrouter
      model: openrouter/free
    - provider: codex
      model: gpt-5.3-codex-spark
```

`routing.defaultWorker` remains the compact single-route form. Do not duplicate
the same intent in both fields; use `routing.routes` when route order matters.
For direct providers, prefer route-specific `model` values over `models.default`
because model identifiers are provider-specific.

## Example

```yaml
version: "1"
engines:
  claude:
    enabled: true
    billing: subscription
  codex:
    enabled: true
    billing: plus-quota
routing:
  routes:
    - provider: codex-oauth
      model: gpt-5.4-mini
    - provider: openrouter
      model: openrouter/free
    - provider: codex
      model: gpt-5.3-codex-spark
  budgetAware: false
models:
  codex: gpt-5.3-codex-spark
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

## Sanitized Personal Setup Example

This example reflects a local operator setup where direct Codex OAuth is the
primary route, OpenRouter is an inexpensive direct-provider fallback, native
Codex CLI is a harness fallback, OpenCode is available for mechanical child
work, and Claude is disabled until a valid subscription is available. It is a
shape example only; secrets stay in environment variables or credential pools.

```yaml
version: "1"
engines:
  claude:
    enabled: false
    billing: subscription
  codex-oauth:
    enabled: true
    billing: subscription
  openrouter:
    enabled: true
    billing: api-key
  codex:
    enabled: true
    billing: plus-quota
  opencode:
    enabled: true
    billing: free
routing:
  routes:
    - provider: codex-oauth
      model: gpt-5.4-mini
    - provider: openrouter
      model: openrouter/free
    - provider: codex
      model: gpt-5.3-codex-spark
    - provider: opencode
      model: opencode/minimax-m2.5-free
  budgetAware: false
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

Matching global agent profiles live under `~/.kiln/agents/`. They must use the
canonical profile contract; partial native-agent files are not accepted as
Kiln source. Example:

```markdown
---
name: architecture-reviewer
role: Architecture reviewer
description: Reviews architecture decisions, boundaries, and long-term risks.
goal: Find structural risks and propose clean, durable corrections.
tier: reasoning
mode: managed-child
skills:
  - architecture-review
  - ddd-review
providerRoute:
  providerId: codex-oauth
  model: gpt-5.4-mini
---

Evaluate the assigned scope against Kiln architecture doctrine. Report risks,
missing tests, and concrete corrections. Do not modify files unless explicitly
granted write authority by the parent invocation.
```

Reusable procedures live under `~/.kiln/skills/<skill-name>/SKILL.md`. A child
invocation may request a profile, skills, and context mode:

```text
Use managed_agent.invoke with profile foundation-readonly-plan,
providerRoute.providerId codex-oauth, agentProfile architecture-reviewer,
skills ["ddd-review"], and contextMode isolated.
Task: inspect docs/architecture/managed-agents.md and report architectural
risks. Do not modify files.
```

`contextMode: isolated` is the current default. `contextMode: resources` may be
used when the parent supplies explicit governed resource URIs. `contextMode:
fork` is reserved for a future policy slice and currently fails closed in
CLI-owned GUI, TUI, and CLI sessions.

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

Provider credentials are not global-config fields. Keep API keys in the
operator environment or in credential-pool files under `~/.kiln/auth/`; keep
only availability, routing, models, permissions, and managed-agent policy in
`~/.kiln/config.yaml`. For OpenRouter on a single local machine, prefer
`OPENROUTER_API_KEY`; use `~/.kiln/auth/openrouter/` only through an explicit
credential adoption flow when Kiln needs pool rotation or multiple accounts.

## Relationship to kiln.yaml

Global config establishes user-level defaults that apply across every Kiln
project. Project `kiln.yaml` overrides scalar values such as provider, model,
permissions, web policy, or managed-agent routes, while MCP server definitions
are additive so both global and project servers remain active. The merge is
performed by `loadKilnConfig(projectPath)` in `config/config-merger.ts`; use
this instead of `readKilnYaml()` in command-level code. `kiln sync`
materializes the merged result into native CLI configs; edit Kiln config files,
not the generated native configs directly.

## Invalid Configs

Kiln has one canonical global config schema. Partial or obsolete files are not
loaded as compatibility inputs. Commands that intentionally replace invalid
global config must write a backup first, then write canonical config.

## Agent Sync

Kiln agent profiles are canonical executable roles. A valid `.kiln/agents/*.md`
or `~/.kiln/agents/*.md` file must declare `name`, `role`, `goal`, and `tier`.
Optional fields include `description`, `backstory`, `model`, `tools`, `skills`,
`mode`, `authorityProfile`, `routeId`, and `providerRoute`. Incomplete agent
files are ignored instead of being projected as legacy partial agents.

Run `kiln sync --agents` (or `kiln sync` with no flags) to push agent
definitions from `~/.kiln/agents/` and `.kiln/agents/` to enabled native CLIs:

| Target | Location | Format |
|--------|----------|--------|
| Claude Code | `~/.claude/agents/<name>.md` | YAML frontmatter + markdown |
| Codex | `~/.codex/agents/<name>.toml` | TOML role file |
| OpenCode | `~/.config/opencode/agents/<name>.md` | YAML frontmatter + markdown |

Agent definitions are translated from Kiln's `.md` format automatically. Sync
is one-way (Kiln -> CLIs). Drift in a projected agent file aborts that target
unless `--force` is confirmed.

## Skills Sync

Run `kiln sync --skills` (or `kiln sync` with no flags) to copy skill
directories from `~/.kiln/skills/` and `.kiln/skills/` to enabled native CLIs.

| Target | Location |
|--------|----------|
| Claude Code | `~/.claude/skills/<name>/` |
| Codex | `~/.codex/skills/<name>/` |
| OpenCode | `~/.config/opencode/skills/<name>/` |

Project skills override global skills with the same name. Only top-level files
within each skill directory are copied. Sync is one-way (Kiln -> CLIs). Drift in
a projected skill file aborts that target unless `--force` is confirmed.

## Drift, Backups, And Disabled Engines

`kiln sync` records managed native targets in `.kiln/install-state.json`.
Document targets track managed fields; file targets track the whole file. If a
managed field or managed file changes outside Kiln, the next sync aborts that
target unless `--force` is confirmed.

Before overwriting an existing projected native file, Kiln writes a backup under
`.kiln/backups/<target-id>/`. Backups are append-only.

When `engines.<id>.enabled: false` is set for `claude`, `codex`, or `opencode`,
`kiln sync` removes recorded managed projections for that harness and does not
write new permission, hook, agent, or skill projections for it.
