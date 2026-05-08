# Global Config

## Overview

`~/.kiln/config.yaml` is the global source of truth for engine defaults,
routing, permissions, MCP servers, hooks, managed agents, UI preferences, and
operator identity. It is not a monolithic personality file. Durable behavioral
doctrine belongs in instruction profiles, executable roles belong in agent
profiles, and reusable procedures belong in skills. Global instruction
profiles, agents, and skills live next to the config under
`~/.kiln/instructions/`, `~/.kiln/agents/`, and `~/.kiln/skills/`. Project
`kiln.yaml` and `.kiln/instructions|agents|skills` override them where needed.

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
| `modelTaskSuitability` | `KilnModelTaskSuitabilityOverride[]` | Operator or project overrides for provider/model task suitability evidence. |
| `identity` | `KilnGlobalIdentity` | Global identity values used for personalization and prompt context. |
| `identity.name` | `string` | Default operator name for generated prompt context and UI personalization. |
| `identity.timezone` | `string` | Default timezone identifier for prompt context and scheduling-aware flows. |
| `activeInstructionProfiles` | `string[]` | Ordered canonical instruction profile ids selected for global governed prompt context. Profiles are loaded from `~/.kiln/instructions/*.md` and may be overridden by project profiles with the same id. |
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
`modelTaskSuitability` entries override static suitability evidence for the
matching provider/model/task. Use them for operator or project knowledge such
as "this route is limited for frontend design" without changing global product
defaults.
The same runtime tool can request `agentProfile`, `skills`, and `contextMode`.
GUI, TUI, and CLI-launched managed invocations resolve those fields from
`.kiln/agents`, `~/.kiln/agents`, `.kiln/instructions`,
`~/.kiln/instructions`, `.kiln/skills`, and `~/.kiln/skills`. Missing profiles,
missing instruction profiles, missing skills, or `contextMode: "fork"` fail
closed instead of falling back to ambient parent context.

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
modelTaskSuitability:
  - provider: codex-oauth
    model: gpt-5.4-mini
    task: frontend-design
    level: limited
    reason: Prefer a visual-design-specialized route when available.
permissions:
  approval: on-request
  sandbox: read-only
identity:
  name: Ricardo
  timezone: America/Tijuana
activeInstructionProfiles:
  - sequel-engineering
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
modelTaskSuitability:
  - provider: codex-oauth
    model: gpt-5.4-mini
    task: frontend-design
    level: limited
    reason: Prefer a visual-design-specialized route when available.
permissions:
  approval: on-request
  sandbox: read-only
identity:
  name: Ricardo
  timezone: America/Tijuana
activeInstructionProfiles:
  - sequel-engineering
ui:
  theme: kiln-dark
components:
  include:
    - baseline:core
```

Durable instruction profiles live under `~/.kiln/instructions/` or
`.kiln/instructions/`. Example:

```markdown
---
name: sequel-engineering
displayName: Sequel Engineering
description: Engineering standards, workflow, and quality doctrine.
tags:
  - engineering
doctrine:
  principles:
    - No dead code.
    - No redundancy.
    - No legacy compatibility hacks without real consumers.
    - Respect DDD and Clean Architecture boundaries.
  workflow:
    - Scout before broad or architecture-sensitive changes.
    - Plan when work crosses contracts or bounded contexts.
    - Use TDD for behavior changes when practical.
  qualityGates:
    - Run focused checks before broad gates.
    - Verify before claiming complete.
  reviewPosture:
    - Findings before summaries.
    - Treat missing tests, hidden coupling, unclear authority, and boundary drift as real risks.
  delegation:
    - Use configured specialist profiles for architecture, TDD, implementation, and review.
---

Use DDD and Clean Architecture boundaries. Do not keep dead code, redundancy,
compatibility hacks, or boilerplate. Scout before broad changes, write tests
for behavior changes, verify before claiming complete, and keep commits atomic.
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
instructionProfiles:
  - sequel-engineering
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

### Write-capable managed routes

Kiln never synthesizes write-capable child routes from `routing.routes` or
enabled engines. Implementation routes must be explicit because the route must
declare bounded write scope and approval policy before the runtime can admit a
child.

```yaml
managedAgents:
  enabled: true
  routes:
    - id: codex-approved-write
      kind: harness
      provider: codex
      model: gpt-5.3-codex-spark
      profiles:
        - foundation-apply-approved-writes
      workingDirectory: project
      timeoutMs: 120000
      tools:
        allowed:
          - read
          - grep
          - apply-patch
        network: false
        writes: true
      memory:
        access: write-proposals
      writeAuthority:
        workspace:
          mode: apply-approved
          allowedPaths:
            - packages/cli/src/config
          deniedPaths:
            - .git
            - node_modules
        memory:
          mode: propose
          operations:
            - create
            - update
        artifacts:
          mode: propose
          resourceUris:
            - kiln://artifacts/managed-agent-write/codex-approved-write
          retention: session
        tools:
          allowed:
            - read
            - grep
            - apply-patch
          denied:
            - git-commit
        approval:
          mode: required-before-apply
      credentials:
        mode: runtime-selected
```

Only live-proven CLI harness providers currently expose approved workspace-write
routes. Direct-provider write routes fail closed until direct write proof covers
approved apply, rollback evidence, cleanup evidence, and replay. Read-only
routes remain the default for analysis, planning, and review.

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
Optional fields include `displayName`, `nicknameCandidates`, `description`,
`backstory`, `model`, `tools`, `skills`, `mode`, `authorityProfile`, `routeId`,
`providerRoute`, and `taskAffinity`. `name` is the stable profile id used in
configuration and events. `displayName` and `nicknameCandidates` are
operator-facing identity hints that native harness projections may expose
without changing the canonical id. `taskAffinity` is an advisory selection list
using task ids such as `architecture-review`, `backend-coding`,
`frontend-design`, `mechanical-edit`, `research`, and `test-writing`; it helps
parent sessions select a configured child but does not grant authority.
Incomplete agent files are ignored instead of being projected as legacy partial
agents.

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

Native projection is independent from routing eligibility. Setting
`engines.<id>.enabled: false` removes that engine from Kiln's runtime routing,
but Kiln may still project canonical agents, skills, permissions, and shims into
the native harness so direct use of that harness sees the same doctrine.

Repo-level shims are separate from global native harness projection. Generated
`AGENTS.md` and generated `CLAUDE.md` belong to a resolved project root; they
should be regenerated from canonical Kiln config, not edited as durable source
files. `AGENTS.md` is the shared repo instruction file for Codex CLI and
OpenCode. `CLAUDE.md` is the repo instruction file for Claude Code. Run:

```bash
kiln sync --repo-shims
kiln sync --repo-shims --project C:\path\to\repo
```

Repo-shim sync resolves the target project explicitly or by walking to the
nearest Kiln project root, then the nearest git root. It writes signed generated
files with Kiln projection metadata. Existing unmanaged guidance files and
drifted managed shims block generation unless `--force` is explicit; forced
overwrites create backups under `.kiln/backups/repo-shims/`.

Adopt durable repository context before syncing shims when the repo needs
project-specific guidance beyond deterministic package/script/doc evidence:

```bash
kiln project scout
kiln project scout --json
kiln project adopt
kiln sync --repo-shims
```

`kiln project adopt` writes `.kiln/project-context.md` from deterministic repo
evidence and blocks if an existing context differs unless `--force` is
explicit. The file is canonical project context; generated `AGENTS.md` and
`CLAUDE.md` project it but do not own it. Use the `repo-context-review` skill
with a managed read-only child when an agent should review or propose factual
context changes before adoption.

Inspect canonical configuration and projection status through the shared
config-status contract:

```bash
kiln config read effective
kiln config read projections
kiln config read setup
kiln config read health
kiln config read agents
kiln config read skills
```

`kiln config read` is read-only. It resolves the same project root as repo-shim
sync, merges global and project config through the canonical loaders, reports
adopted project-context status, classifies generated repo shims, summarizes
native projection install-state, and exposes harness capability diagnostics.
The `setup` view is the operator-facing setup read model: project-context
status, repo-shim status, native projection status, and recommended actions such
as `adopt-project-context`, `sync-repo-shims`, `sync-native-projections`, or
`adopt-or-back-up-native-guidance`.
The model-callable `kiln_config.read` tool exposes the same views to admitted
runtime tool surfaces. Setup surfaces should consume the same contract rather
than parsing YAML or native files directly.

Operator surfaces expose the same setup read model:

- CLI: `kiln config read setup` for JSON and `kiln status` for the summarized
  setup actions.
- GUI: the Setup sidebar mode reads the gateway endpoint
  `/gui/api/config/setup`.
- TUI: `/setup` renders the same project-context, repo-shim, native projection,
  and action summary in the terminal session.

These views are diagnostic. Adoption, sync, and mutation still go through the
explicit project, sync, and config proposal commands.

Agents may propose bounded setup changes through `kiln_config.propose_change`.
The tool validates `skill.upsert`, `agent.upsert`, and `agent.attach_skills`
payloads and returns a structured proposal with diagnostics and preview diff;
it does not write files. Applying a proposal is a separate approval-gated flow.

The apply flow is intentionally split:

```text
1. Agent calls kiln_config.propose_change(...)
2. Operator reviews the returned proposalId, paths, authority impact, and diff
3. Operator runs: kiln config approve <proposalId>
4. Agent calls kiln_config.apply_change({ proposalId, approvalId })
```

`kiln config approve` prints the approval record as JSON. The `approvalId` is
bound to the stored proposal hash; if the proposal changes, the approval no
longer matches. `kiln_config.apply_change` writes only canonical project
config under `.kiln/agents/` or `.kiln/skills/`, rejects stale proposals when a
target file changed after proposal creation, consumes the approval after a
successful canonical write, and runs the existing native projection pipeline.
Native Claude Code, Codex, and OpenCode files remain generated projections.

When managed invocation is enabled, Kiln exposes a compact admitted agent
catalog to the `managed_agent.invoke` tool description. Parent assistants should
select a configured `agentProfile` when the child task clearly matches a
profile, such as scout/context discovery, TDD, implementation, research, review,
or DDD validation. If no configured profile matches a one-off read-only task,
the parent may omit `agentProfile` and invoke a generic governed child. Parents
must not invent profile names; unknown profiles fail closed during context
resolution.

The model-facing tool also projects configured route ids, provider/model task
suitability, agent-profile task affinity, the configured skill catalog, and
unavailable-route diagnostics. This is why an operator can say "use the right
child agent for this review" instead of spelling out every route field; the
parent still chooses only from bounded Kiln ids.

Canonical instruction profiles are the home for durable workflow standards
such as "no dead code", "no redundancy", "DDD", "Clean Architecture", "TDD
first", "review before commit", and "verify before done". Generated
`AGENTS.md` and native harness projections may point to these profiles or carry
profile ids as harness-readable metadata, but the source of truth remains the
Kiln instruction profile file.

Use the `doctrine` frontmatter for standards that surfaces or child agents must
inspect structurally. Keep explanatory nuance in the markdown body. This avoids
duplicating long prompts in `AGENTS.md`, `CLAUDE.md`, Codex agent TOML files,
OpenCode agent files, GUI prompts, and SDK consumers.

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

Native projection is independent from runtime routing eligibility. When
`engines.<id>.enabled: false` is set for `claude`, `codex`, or `opencode`, that
engine is unavailable for Kiln runtime routing, but `kiln sync` may still write
canonical permissions, hooks, agents, skills, and shims for direct standalone
harness usage. To remove projected native artifacts, use explicit uninstall
commands rather than overloading route availability.
