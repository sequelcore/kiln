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
For the shortest setup path for personality, engineering standards, and
work-governance posture, use [Operator Doctrine](operator-doctrine.md).

## File Location

- Default: `~/.kiln/config.yaml`
- Linux with `XDG_CONFIG_HOME` set: `$XDG_CONFIG_HOME/kiln/config.yaml`

Common operator-doctrine fields can be edited without hand-editing YAML:

```bash
kiln config set --global identity.name Ricardo
kiln config set --global identity.timezone America/Tijuana
kiln config set --global activeInstructionProfiles sequel-engineering
kiln config set --global workGovernance.defaultPosture orchestrate
kiln config set --global skills.selection.mode auto
```

## Schema

| Field | Type | Description |
|-------|------|-------------|
| `version` | `string` | Canonical global config schema guard. Current version is `"1"`. |
| `engines` | `Record<string, KilnGlobalEngineConfig>` | Engine availability and billing metadata. |
| `routing.defaultWorker` | `string` | Default engine/provider route for operator sessions. |
| `routing.fallback` | `string` | Optional fallback route for budget-aware routing. |
| `routing.routes` | `{ provider: string, model?: string }[]` | Ordered provider/model execution candidates. When present, the first healthy route is the default fallback order. CLI run may reorder configured candidates by task suitability when no explicit provider is requested. |
| `routing.budgetAware` | `boolean` | Enables budget-aware route selection when configured. |
| `routing.budget` | `Record<string, KilnGlobalRoutingBudgetConfig>` | Optional per-engine budget ceilings. |
| `models.default` | `string` | Default model used when a route-specific model does not override it. |
| `models.<engine>` | `string` | Engine-specific model override. |
| `permissions` | `KilnPermissionPolicy` | Default approval and sandbox policy applied when no project-level override exists. |
| `mcp` | `Record<string, unknown>` | Global MCP server definitions and related client config. |
| `hooks` | `Record<string, unknown>` | Global hook configuration shared across Kiln-managed workflows. |
| `managedAgents` | `KilnManagedAgentsConfig` | Governed child-agent route configuration shared by GUI, TUI, and CLI runtime surfaces. |
| `modelTaskSuitability` | `KilnModelTaskSuitabilityOverride[]` | Operator or project overrides for provider/model task suitability evidence. |
| `reasoningPolicy` | `KilnReasoningPolicyConfig` | Optional task-aware reasoning effort policy. It is resolved after provider/model selection and only sent when the selected route advertises compatible effort support. |
| `identity` | `KilnGlobalIdentity` | Global identity values used for personalization and prompt context. |
| `identity.name` | `string` | Default operator name for generated prompt context and UI personalization. |
| `identity.timezone` | `string` | Default timezone identifier for prompt context and scheduling-aware flows. |
| `activeInstructionProfiles` | `string[]` | Ordered canonical instruction profile ids selected for global governed prompt context. Profiles are loaded from `~/.kiln/instructions/*.md` and may be overridden by project profiles with the same id. |
| `workGovernance` | `KilnWorkGovernanceConfig` | Default work posture, direct-execution envelope, delegation triggers, and evidence expectations projected across CLI, GUI, TUI, benchmark sessions, and repo shims. |
| `web.searchProvider` | `KilnYamlWebSearchProvider` | Global default web search provider reference. This supplies a reusable adapter and `apiKeyEnv`; it does not enable network access. |
| `web.extractProvider` | `KilnYamlWebExtractProvider` | Global default web extraction provider reference. This supplies a reusable adapter and `apiKeyEnv`; it does not enable network access. |
| `ui.theme` | `string` | Default operator theme name from the shared GUI/TUI theme catalog. |
| `skills.builtin` | `{ enabled?: boolean, include?: string[], exclude?: string[] }` | First-party built-in skill activation policy. Built-in skill content lives in Kiln core; config only admits or narrows it. |
| `skills.selection.mode` | `advisory \| auto` | Controls whether route/task and explicit work-classification recommendations are only shown to agents or automatically admitted after catalog checks. Defaults to `advisory`. |
| `components.include` | `string[]` | Bundled component set identifiers enabled for the operator. |

When `routing.budgetAware` is true, budget ceilings are projected into the
runtime/session budget admission service. CLI commands may provide the config
source, but they do not own budget decisions. If an enabled budget-aware route
requires live usage and no meter is available, managed orchestration admission
fails closed instead of estimating, falling back to a local token shim, or
reusing gateway billing state.

MCP server entries may include `requestTimeoutMs` to override the default
Kiln-owned MCP client request timeout for that server. Use it for servers with
long-running tools when the tool's own input does not expose a millisecond
`timeout` field.

Kiln's economic routing posture is subscription-first where the provider exposes
a compliant direct route. Direct subscription providers such as `codex-oauth`,
`opencode-go`, and `opencode-zen` should be preferred for normal operator work
because they preserve the user's paid access path without spawning a native CLI
harness. Native harness providers such as `codex` and `opencode` are fallback
routes for cases where a provider's terms, available API surface, or local
capability proof requires the native harness. Keep those harness engines
disabled or out of `routing.routes` unless the operator intentionally chooses
that fallback.

Managed child invocation is derived from the same canonical routing hierarchy.
When `routing.routes` is present, GUI, TUI, CLI run, and operator gateway
sessions project eligible direct providers and harnesses with live-proven
read-only result handoff into synthesized read-only
`foundation-readonly-plan` routes for `managed_agent.invoke`.
Direct-provider projections require an explicit model and that model must be
known tool-call-capable for Kiln runtime tools. If no ordered route list exists,
Kiln falls back to the enabled supported child engines: `routing.defaultWorker`
is preferred when it names `codex` or `opencode`; otherwise Kiln chooses the
first enabled supported child engine. `managedAgents.routes` declares explicit
managed exceptions and authority-bearing routes. It is merged on top of derived
read-only routes instead of replacing `routing.routes`; use it for write routes,
special read-only exceptions, or explicit overrides, not as a duplicated routing
graph. When `routing.routes` contains multiple models for the same provider,
derived managed route IDs include a model slug so each team member remains
addressable. `managedAgents.enabled: false` disables the runtime tool even when
a supported engine is enabled. A route whose provider has
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
are never synthesized. Synthesized managed-agent routes use a five-minute
timeout budget by default. Explicit `managedAgents.routes[].timeoutMs` remains
the route authority when a team deliberately wants a shorter probe or a longer
bounded child run.
At runtime, Kiln projects the resolved route registry into the
`managed_agent.invoke` tool definition so parent agents can see configured
route ids, timeout budgets, timeout source diagnostics, and unavailable-route
diagnostics. If multiple
managed routes share a provider/profile, parent agents must select by `routeId`
or by an exact configured model unless a configured `agentProfile` contributes
a route hint.
When an agent-profile route hint exists, `managed_agent.invoke` uses it to
disambiguate provider-only requests and rejects explicit route, provider, or
model selections that contradict the hint. Provider-only selection without a
hint fails closed as ambiguous.
`modelTaskSuitability` entries override static suitability evidence for the
matching provider/model/task. Use them for operator or project knowledge such
as "this route is limited for frontend design" without changing global product
defaults. The resolved route catalog also carries first-party evaluation
evidence, live route proof, and configured skill recommendations. Skill
recommendations are advisory; a parent may request a skill only when the skill
exists in the admitted skill catalog or on the selected agent profile.
CLI run uses the same resolved suitability records to rank configured
`routing.routes` when no explicit `--provider` is passed. Agent
`taskAffinity` wins over prompt keyword inference, operator overrides win
same-level ties over static profiles, and the original route order remains the
fallback order for unknown tasks or equal scores.
`reasoningPolicy` is intentionally separate from `modelTaskSuitability`.
Suitability decides which healthy route should be tried first; reasoning policy
decides the desired effort after that route has been selected. Automatic effort
is capability-gated: if the active provider/model does not advertise
`supportedReasoningEfforts`, Kiln omits the automatic effort instead of
inventing a provider-specific default. Set `unsupported: fail` only when an
operator wants unsupported or unadvertised automatic effort to fail closed.

```yaml
reasoningPolicy:
  default: medium
  unsupported: omit
  byTask:
    architecture-review: xhigh
    backend-coding: high
    frontend-design: high
    test-writing: high
    research: high
    mechanical-edit: low
```
The same runtime tool can request `agentProfile`, `skills`, and `contextMode`.
GUI, TUI, and CLI-launched managed invocations resolve those fields from
`.kiln/agents`, `~/.kiln/agents`, `.kiln/instructions`,
`~/.kiln/instructions`, `.kiln/skills`, and `~/.kiln/skills`. Missing profiles,
missing instruction profiles, missing skills, or `contextMode: "fork"` fail
closed instead of falling back to ambient parent context.

Built-in skill activation is configured under `skills.builtin`. Project and
user skill files override built-ins with the same id. This keeps Kiln useful by
default without turning generated harness files into a second source of truth.
Skill selection defaults to `advisory`: task/model recommendations are visible
to parent agents, but only explicit agent/profile skills are loaded. Set
`skills.selection.mode: auto` when the operator wants Kiln to admit available
recommended skills for the selected task, route, and explicit work
classification. Auto-selection never grants tools or authority, skips
unavailable recommended skills, and still fails closed for explicitly
requested missing skills. Work classification is invocation/session metadata,
not global policy: config selects the admission mode but does not define a
universal task label for every prompt.

General writing quality belongs in the `clear-writing` built-in skill, not in
global config. Global config may choose whether built-ins are enabled and may
record stable operator preferences such as locale, identity, or active
instruction profiles. A brand voice, organization tone, or project-specific
terminology belongs in an instruction profile or scoped project skill. This
keeps "write clearly" available to every kind of Kiln user without making
Sequel's voice, GOV.UK conventions, or any other local style a universal
default.

```yaml
skills:
  selection:
    mode: auto
  builtin:
    enabled: true
    include:
      - repo-context-review
      - codebase-scouting
      - implementation-planning
      - tdd-workflow
      - code-review-findings
      - clean-architecture-boundary-review
      - ddd-boundary-review
      - refactoring-safety
      - security-scope-review
      - managed-agent-risk-review
      - benchmark-readiness-review
      - config-projection-review
```

Project `.kiln/kiln.yaml` may disable or narrow the same catalog:

```yaml
skills:
  selection:
    mode: advisory
  builtin:
    exclude:
      - benchmark-readiness-review
```

## Repository Hygiene

Global config and global instruction profiles are the right place for personal
operator preferences and durable self-improvement notes that apply across
projects. Keep repo-root agent memory such as `memory/lessons.md` out of shared
repositories; it is operator state, not project doctrine.

Project `.kiln/kiln.yaml`, `.kiln/project-context.md`,
`.kiln/instructions/**`, `.kiln/agents/**`, and `.kiln/skills/**` are
versionable only when they define durable project behavior. Runtime state under
`.kiln/`, local databases, sessions, logs, backups, and repo-root `memory/**`
should be ignored. See [Repository Hygiene](repo-hygiene.md).

Supported operator themes are `kiln-dark`, `kiln-graphite`, `kiln-light`, and
`system-follow`. `kiln-dark` is the Obsidian default, `kiln-graphite` is a
slightly lifted dark surface, and `kiln-light` is the Paper light variant. GUI
and TUI validate theme names against the same contract.
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
      model: gpt-5.6-terra
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
      model: gpt-5.6-terra
    - provider: openrouter
      model: openrouter/free
    - provider: codex
      model: gpt-5.3-codex-spark
  budgetAware: false
models:
  codex: gpt-5.3-codex-spark
reasoningPolicy:
  default: medium
  unsupported: omit
  byTask:
    architecture-review: xhigh
    mechanical-edit: low
modelTaskSuitability:
  - provider: codex-oauth
    model: gpt-5.6-terra
    task: frontend-design
    level: limited
    reason: Prefer a visual-design-specialized route when available.
permissions:
  approval: on-request
  sandbox: read-only
identity:
  name: Alex
  timezone: America/Tijuana
activeInstructionProfiles:
  - sequel-engineering
workGovernance:
  defaultPosture: orchestrate
  directExecution:
    maxFiles: 1
    maxRisk: low
  requireDelegationFor:
    - architecture
    - security
    - ui
    - runtime
    - provider-routing
    - managed-agents
    - config
    - multi-file
    - cross-surface
    - long-running
    - verification-heavy
    - formal-proof-candidate
  requiredEvidence:
    - surface-map
    - risk-hypothesis
    - plan
    - tests
    - typecheck
    - residual-risk
ui:
  theme: kiln-dark
components:
  include:
    - baseline:core
```

## Sanitized Personal Setup Example

This example reflects a local operator setup where direct Codex OAuth is the
primary deep-reasoning route, OpenCode Go contributes task-specialized direct
models, OpenCode Zen free routes remain non-sensitive fallbacks, native CLI
harnesses are disabled by default, and Claude is disabled until a valid
subscription is available. It is a shape example only; secrets stay in
environment variables or credential pools. Enable a native harness only as an
explicit fallback when direct provider use is unavailable or not compliant with
the provider terms for the desired workflow.
For a complete sanitized file that includes task-aware skill selection and
managed read-only routes, see
`docs/examples/configs/task-aware-model-team.yaml`.

```yaml
version: "1"
engines:
  claude:
    enabled: false
    billing: subscription
  codex-oauth:
    enabled: true
    billing: subscription
  opencode-go:
    enabled: true
    billing: subscription
  opencode-zen:
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
      model: gpt-5.6-terra
    - provider: codex-oauth
      model: gpt-5.6
    - provider: codex-oauth
      model: gpt-5.6-luna
    - provider: opencode-go
      model: kimi-k2.6
    - provider: opencode-go
      model: glm-5.1
    - provider: opencode-go
      model: deepseek-v4-pro
    - provider: opencode-go
      model: qwen3.6-plus
    - provider: opencode-go
      model: minimax-m2.7
    - provider: opencode-go
      model: deepseek-v4-flash
    - provider: opencode-zen
      model: deepseek-v4-flash-free
    - provider: opencode-zen
      model: minimax-m2.5-free
    - provider: codex
      model: gpt-5.3-codex-spark
    - provider: opencode
      model: opencode/minimax-m2.5-free
  budgetAware: false
reasoningPolicy:
  default: medium
  unsupported: omit
  byTask:
    architecture-review: xhigh
    backend-coding: high
    frontend-design: high
    test-writing: high
    research: high
    mechanical-edit: low
modelTaskSuitability:
  - provider: opencode-go
    model: kimi-k2.6
    task: frontend-design
    level: preferred
    reason: Operator benchmark preference for frontend and visual implementation tasks.
  - provider: opencode-go
    model: deepseek-v4-pro
    task: backend-coding
    level: preferred
    reason: Operator benchmark preference for backend/debugging and provider-runtime tasks.
  - provider: opencode-go
    model: qwen3.6-plus
    task: research
    level: preferred
    reason: Operator benchmark preference for synthesis, comparison, and evidence-heavy research.
  - provider: opencode-go
    model: deepseek-v4-flash
    task: mechanical-edit
    level: preferred
    reason: Operator preference for fast low-friction mechanical work.
skills:
  selection:
    mode: auto
  builtin:
    enabled: true
permissions:
  approval: on-request
  sandbox: read-only
identity:
  name: Alex
  timezone: America/Tijuana
activeInstructionProfiles:
  - sequel-engineering
workGovernance:
  defaultPosture: orchestrate
  directExecution:
    maxFiles: 1
    maxRisk: low
  requireDelegationFor:
    - architecture
    - security
    - ui
    - runtime
    - provider-routing
    - managed-agents
    - config
    - multi-file
    - cross-surface
    - long-running
    - verification-heavy
    - formal-proof-candidate
  requiredEvidence:
    - surface-map
    - risk-hypothesis
    - plan
    - tests
    - typecheck
    - residual-risk
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

`workGovernance` is the cross-surface policy that tells parent agents when
they may execute directly and when they should orchestrate. It is intentionally
separate from instruction-profile prose so GUI, TUI, CLI, benchmark sessions,
managed invocations, and generated repo shims can all project the same
resolved policy. Use instruction profiles for team doctrine; use
`workGovernance` for the executable posture and evidence expectations.
CLI-owned runtime surfaces also expose `work_governance.assess`, a read-only
tool that returns the resolved direct-versus-orchestrate recommendation for a
specific task. The same surfaces expose `work_profile.list`,
`work_item.update`, `work_item.list`, and `work_item.complete` so parent agents
can create bounded work items and fail closed when required evidence or
residual-risk reporting is missing. Work item updates are projected into
canonical `work_item_updated` session events and a model-readable
`kiln://session/work-items` resource. Durable project doctrine still belongs in
canonical config and docs; work items are session evidence, not reusable team
policy.
Use `work_item.execution.start` to enter active execution; `work_item.update`
does not accept `status=in_progress`. A scout or local read-only diagnosis does
not complete routed work. When a pending work item has an assigned write route,
the parent should create or use a goal and call `work_item.execution.start`
instead of reporting a generic read-only sandbox block.
Goal-bound work closes through the explicit execution lifecycle. A verified
managed invocation may be attached only through `work_item.execution.start`;
after `work_item.execution.finish` closes every item, the parent records each
declared goal requirement with `goal.evidence.record` and calls
`goal.complete`. These control-plane tools are part of the canonical execute
projection on CLI, GUI, and TUI surfaces.

UI work that depends on aesthetics or product polish requires
`visual-reference-research` before planning. Text-only web search is
insufficient for this evidence; agents should use browser, computer-use,
image-capable, or screenshot-capable tools when available and record source
URLs plus extracted design principles. Repository pages and code listings are
source-discovery evidence only; the visual gate requires product UI, demo,
video, running-app, README image, or docs image evidence.

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
  - clean-architecture-boundary-review
  - ddd-boundary-review
instructionProfiles:
  - sequel-engineering
providerRoute:
  providerId: codex-oauth
  model: gpt-5.6-terra
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
skills ["ddd-boundary-review"], and contextMode isolated.
Task: inspect docs/architecture/managed-agents.md and report architectural
risks. Do not modify files.
```

`contextMode: isolated` is the current default. `contextMode: resources` may be
used when the parent supplies explicit governed resource URIs. `contextMode:
fork` is reserved for a future policy slice and currently fails closed in
CLI-owned GUI, TUI, and CLI sessions.

### Timeout proof routes

Use explicit route configuration to prove timeout behavior. Do not add a
request-local timeout override or adapter shim for live testing. A temporary
read-only route can use a short `timeoutMs` value while keeping normal
authority and route diagnostics intact:

```yaml
managedAgents:
  enabled: true
  routes:
    - id: codex-oauth-readonly-timeout-proof
      kind: direct
      provider: codex-oauth
      model: gpt-5.6-luna
      profiles:
        - foundation-readonly-plan
      workingDirectory: read-only
      timeoutMs: 1000
      tools:
        allowed:
          - read
          - rg
        network: false
        writes: false
      memory:
        access: read-only
      credentials:
        mode: runtime-selected
```

The managed-agent route catalog must show `timeoutMs=1000
source=explicit-route` for that route. A child that exceeds the budget should
finish as `timed_out`, abort the child provider call when the adapter supports
abort, and link transcript plus timeout diagnostic resources. Remove the route
after proof if it is not part of normal team policy.

### Write-capable managed routes

Kiln never synthesizes write-capable child routes from `routing.routes` or
enabled engines. Implementation routes must be explicit because the route must
declare bounded write scope and approval policy before the runtime can admit a
child.

```yaml
managedAgents:
  enabled: true
  worktreeLease:
    mode: git
    rootPath: .kiln/managed-worktrees
  routes:
    - id: codex-oauth-critical-approved-write
      kind: direct
      provider: codex-oauth
      model: gpt-5.6
      profiles:
        - foundation-apply-approved-writes
      workingDirectory: isolated-worktree
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
            - kiln://artifacts/managed-agent-write/codex-oauth-critical-approved-write
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

Live-proven direct-provider adapters expose approved workspace-write routes for
subscription-first setups when the route is explicit and includes
`writeAuthority`. Read-only routes remain the default for analysis, planning,
and review.
Use `managedAgents.worktreeLease` with `workingDirectory: isolated-worktree`
for write-capable parallel children. The runtime creates an invocation-scoped
git worktree under `rootPath` before adapter execution and releases it through
managed-agent lifecycle cleanup evidence.
Network/browser research and approved workspace writes are separate authority
profiles. Use a read-only route with `tools.network: true` and browser/web
tools for visual-reference research. When the research must inspect sibling
local frontend repositories, add explicit read-only reference roots under
`readAuthority.workspace.allowedPaths`; do not add those paths to
`writeAuthority.workspace.allowedPaths` unless the child is intentionally
allowed to edit them. Example:

```yaml
managedAgents:
  routes:
    - id: opencode-go-qwen3-6-plus-readonly
      kind: direct
      provider: opencode-go
      model: qwen3.6-plus
      profiles:
        - foundation-readonly-plan
      workingDirectory: project
      tools:
        allowed:
          - read
          - grep
          - glob
          - web_search
        network: true
        writes: false
      readAuthority:
        workspace:
          allowedPaths:
            - /workspace/references/t1code
            - /workspace/references/vllm-studio
      memory:
        access: read-only
      credentials:
        mode: runtime-selected
```

Read and write authority projection automatically denies standard repository
state and generated dependency descendants (`.git`, `node_modules`, and
`.kiln`) under the project root and configured authority roots. Configure
`deniedPaths` only for additional project-specific sensitive paths.

Approved-write routes must keep `tools.network: false`; config projection marks
write routes with network authority unavailable instead of silently admitting a
combined write+internet child. When creating a routed UI work item that uses an
approved-write route, also set `phaseRoutes.visual-reference-research` to the
read-only browser-capable route, for example
`opencode-go-qwen3-6-plus-readonly`. When that visual research must inspect
local sibling or cloned reference repositories, set `referenceRoots` on the
work item to the concrete roots the read-only route must be able to read. The
managed invocation request projects those roots as `requiredReadPaths` and
fails closed before child execution if the selected route authority does not
cover them. If the
tool rejects the work item with `visual_reference_phase_route_required`, retry
`work_item.update` with the structured `retryInputPatch` shape and that
configured route id; writing the JSON in normal assistant text is not a valid
state transition.

For GUI/TUI operator turns, the composer authority selector is only the requested
turn limit. Actual child edit capability comes from `managedAgents.routes[]`.
If every managed route is `foundation-readonly-plan`, delegated implementation
will correctly report that it cannot edit even when the parent turn is in
`auto` authority. For subscription-first setups, do not add a native harness
write route merely to make edits work; that changes the economic and auth
surface. Use explicit direct managed routes for `codex-oauth`, `opencode-go`,
and `opencode-zen` with `foundation-apply-approved-writes`, `tools.writes: true`,
and `writeAuthority.approval.mode: required-before-apply`.

For a task-aware team, keep read-only managed routes derived from
`routing.routes` and add explicit write routes only for models that should
implement under supervision. Prefer descriptive route IDs that encode the job:

- `codex-oauth-critical-approved-write` for critical architecture-sensitive
  edits, difficult backend changes, and test-heavy work.
- `opencode-go-frontend-approved-write` for React, TypeScript, layout, and UI
  implementation.
- `opencode-go-backend-approved-write` for runtime, provider-routing, and
  backend debugging.
- `opencode-go-service-approved-write` for service, adapter, and data-flow
  implementation.
- `opencode-go-qwen3-6-plus-readonly` or another explicit read-only
  browser-capable route for visual/reference research before planning.
- `opencode-go-mechanical-approved-write` and
  `opencode-zen-mechanical-approved-write` for repetitive low-risk edits.
- `opencode-zen-free-approved-write` as the cost-conscious direct-provider
  fallback when the free route is sufficient.

### Remote harness managed routes

Remote managed routes use the managed invocation lifecycle with endpoint-backed
harness execution. They are configured as harness routes with a `remoteHarness`
endpoint block. The runtime projects these routes as `surface: remote-harness`
and `executionMode: remote-harness`; those are runtime projection fields, not
configuration fields. Invoke and cancel URLs must be HTTPS. Auth token
environment names must be portable identifiers; token values are read at call
time and are never persisted in records, transcripts, diagnostics, or handoff
resources.

```yaml
managedAgents:
  enabled: true
  routes:
    - id: codex-cloud-readonly
      kind: harness
      provider: codex-cloud
      model: gpt-5.6
      profiles:
        - foundation-readonly-plan
      remoteHarness:
        invokeUrl: https://remote.example.test/managed-agent/invoke
        cancelUrl: https://remote.example.test/managed-agent/cancel
        authTokenEnv: KILN_CODEX_CLOUD_TOKEN
      tools:
        allowed:
          - read
          - grep
        network: false
        writes: false
```

Remote harness routes are currently read-only. They must expose provider
limitations as capability evidence and use configured route proof instead of
claiming live provider/tool proof from endpoint configuration alone. The runtime
validates returned records against the admitted identity and capability
snapshot; mismatched route, model, adapter, execution mode, authority, or
capability evidence fails closed.

### Supported providers

`routing.defaultWorker` and `KILN_PROVIDER` accept engine/provider identifiers
known to Kiln's registry. Direct subscription providers should appear before
harness providers in normal user configs. Harness routes such as `claude`,
`codex`, and `opencode` are valid where the corresponding engine is enabled, but
they are fallback execution surfaces rather than the preferred economic route.

| Provider ID | Description |
|-------------|-------------|
| `anthropic` | Anthropic API (Claude models). Requires `ANTHROPIC_API_KEY` or `~/.kiln/auth/anthropic/`. |
| `openai` | OpenAI API. Requires `OPENAI_API_KEY` or `~/.kiln/auth/openai/`. |
| `deepseek` | DeepSeek API. Requires `DEEPSEEK_API_KEY` or `~/.kiln/auth/deepseek/`. |
| `openrouter` | OpenRouter aggregation gateway. Requires `OPENROUTER_API_KEY` or `~/.kiln/auth/openrouter/`. |
| `ollama` | Ollama local inference. No key required; configure endpoint in `~/.kiln/auth/ollama/`. |
| `codex-oauth` | OpenAI Codex via ChatGPT Plus device-code OAuth. Manage with `kiln auth codex login`, `kiln auth codex status`, and `kiln auth codex logout`. |
| `opencode-go` | OpenCode Go subscription — flat-rate access to Go-tier models. Manage with `kiln auth opencode link --tier go`, `kiln auth opencode status --tier go`, and `kiln auth opencode logout --tier go`. |
| `opencode-zen` | OpenCode Zen gateway — credit-backed access to Zen-tier models. Manage with `kiln auth opencode link --tier zen`, `kiln auth opencode status --tier zen`, and `kiln auth opencode logout --tier zen`. |

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
are additive so both global and project servers remain active.

Web config has a stricter authority split. Global config may define
`web.searchProvider` and `web.extractProvider` so credentials and provider
selection are reusable across projects. It may not define `web.enabled`,
`web.netPolicy`, or `web.allowedDomains`; those authority fields belong in the
project `.kiln/kiln.yaml`. This keeps provider capability global while every
repo still grants its own network access explicitly.

```yaml
# ~/.kiln/config.yaml
version: "1"
web:
  searchProvider:
    type: tavily
    apiKeyEnv: TAVILY_API_KEY
  extractProvider:
    type: firecrawl
    apiKeyEnv: FIRECRAWL_API_KEY
```

```yaml
# .kiln/kiln.yaml
version: "1"
web:
  enabled: true
  netPolicy: documentation
  allowedDomains:
    - docs.example.com
```

The merge is performed by `loadKilnConfig(projectPath)` in
`config/config-merger.ts`; use this instead of `readKilnYaml()` in
command-level code. `kiln sync` materializes the merged result into native CLI
configs; edit Kiln config files, not the generated native configs directly.

## Invalid Configs

Kiln has one canonical global config schema. Partial or obsolete files are not
loaded as compatibility inputs. Commands that intentionally replace invalid
global config must write a backup first, then write canonical config.

## Agent Sync

Kiln agent profiles are canonical executable roles. A valid `.kiln/agents/*.md`
or `~/.kiln/agents/*.md` file must declare `name`, `role`, `goal`, and `tier`.
Optional fields include `displayName`, `nicknameCandidates`, `description`,
`backstory`, `tools`, `skills`, `mode`, `authorityProfile`, `routeId`,
`providerRoute`, and `taskAffinity`. `name` is the stable profile id used in
configuration and events. `displayName` and `nicknameCandidates` are
operator-facing identity hints that native harness projections may expose
without changing the canonical id. `taskAffinity` is an advisory selection list
using task ids such as `architecture-review`, `backend-coding`,
`frontend-design`, `mechanical-edit`, `research`, and `test-writing`; it helps
parent sessions select a configured child but does not grant authority.
Incomplete agent files are ignored instead of being projected as legacy partial
agents.

Agent profiles do not have a top-level `model` field. Use `providerRoute` only
when the role requires a strict execution route. Profiles without
`providerRoute` are portable and project to native harnesses without a fixed
model so the harness can use its own current default. Profiles with
`providerRoute` project a native model only when the target harness capability
explicitly supports that provider/model encoding. Unsupported strict routes are
omitted for that harness, and previously managed now-incompatible native agent
files are backed up and removed unless drift blocks the cleanup. Kiln does not
guess support from provider id prefixes; cross-harness provider adapters must
be represented as explicit capabilities before projection may use them.

Kiln also provides first-party built-in agent profiles for common roles:
`scout`, `planner`, `architect`, `tdd`, `coder`, `fast-coder`, `reviewer`,
`ddd-validator`, `researcher`, and `refactoring-specialist`. These defaults
are available to managed invocation and native projection so a fresh Kiln setup
has a usable specialist roster. A global profile with the same `name` replaces
the built-in profile; a project profile with the same `name` replaces both.
Use this override path for personal display names, provider preferences, extra
instruction profiles, and team-specific role doctrine.

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
but Kiln may still project compatible canonical agents, skills, permissions, and
shims into the native harness so direct use of that harness sees the same
doctrine.

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

The same sync also writes a workflow snapshot projection for harnesses and
external tools that can read repo files but cannot query Kiln runtime state:

- `.kiln/projections/workflow-snapshot.md` is the readable generated snapshot.
- `.kiln/projections/workflow-snapshot-manifest.json` records the generator,
  source ids, generated file list, timestamp, and canonical snapshot hash.

The snapshot projects specification, work-governance posture, work-item
profiles, instruction profile references, authority posture, and model policy
guidance. It is generated from canonical Kiln evidence and must not be edited as
source. Re-running `kiln sync --repo-shims` leaves the repo shims, manifest, and
snapshot markdown unchanged when canonical workflow evidence has not changed.
`kiln config read projections` reports `workflow-snapshot:manifest` as missing,
current, stale, or drifted without repairing it implicitly.

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
adopted project-context status, classifies generated repo shims, reports
workflow snapshot manifest health, summarizes native projection install-state,
reports skill catalog origin/projection/admission diagnostics, and exposes
harness capability diagnostics.
The `setup` view is the operator-facing setup read model: project-context
status, repo-shim status, native projection status, skill projection/admission
status, and recommended actions such as `adopt-project-context`,
`sync-repo-shims`, `sync-native-projections`,
`sync-global-instruction-shims`, `adopt-or-back-up-global-instructions`, or
`review-global-instruction-drift`.
The model-callable `kiln_config.read` tool exposes the same views to admitted
runtime tool surfaces. Setup surfaces should consume the same contract rather
than parsing YAML or native files directly.

Operator surfaces expose the same setup read model:

- CLI: `kiln config read setup` for JSON and `kiln status` for the summarized
  setup actions.
- GUI: the Setup sidebar mode reads the gateway endpoint
  `/gui/api/config/setup` and can execute safe setup actions through
  `POST /gui/api/config/setup/actions`.
- TUI: `/setup` renders the same project-context, repo-shim, global instruction
  shim, native projection, and action summary in the terminal session.

The GUI action endpoint is intentionally narrower than the CLI. It delegates to
CLI-owned setup services and permits non-force project-context adoption,
repo-shim sync, native projection sync, and safe global-instruction-shim sync.
The gateway, not the button state, enforces that executable set. Valid but
disallowed requests return a blocked setup result and never reach the CLI
mutation service.
Global shim sync writes only missing or stale Kiln-managed targets; unmanaged
files and drifted managed files are blocked by the CLI-owned projection service.
Adoption or backup of native or global guidance, force sync, and drift review
remain review-only in the GUI so the operator can use the explicit CLI review,
force-sync, import, or config proposal flow. Model-callable mutation still goes
through the config proposal lifecycle below.

Global instruction shim status includes canonical shared `harness` identity
(`codex`, `claude-code`, or `opencode`), which GUI and TUI display directly.

## Governed Config Mutation

Agents may propose bounded setup changes through `kiln_config.propose_change`.
The tool validates `skill.upsert`, `agent.upsert`, and `agent.attach_skills`
payloads and returns a structured proposal with diagnostics and preview diff;
it does not write files. `agent.upsert` accepts the canonical profile fields
described above, including `nicknameCandidates`, but duplicate aliases or
aliases that duplicate the profile id/display name are rejected. Agent `tools`
must be supported Kiln profile tools (`read`, `grep`, `glob`, `web`, `write`,
or `bash`); unsupported names fail closed instead of being projected into
native harness files. Applying a proposal is a separate approval-gated flow.

The current supported operations are:

| Operation | Writes | Projection effects |
|-----------|--------|--------------------|
| `skill.upsert` | `.kiln/skills/<name>/SKILL.md` | native skills, repo shims |
| `agent.upsert` | `.kiln/agents/<name>.md` | native agents, repo shims |
| `agent.attach_skills` | `.kiln/agents/<name>.md` | native agents, repo shims |

Routing defaults, route enablement, projection sync, third-party packs, and
team/cloud distribution are not supported mutation operations yet. Use the
explicit CLI commands for project adoption and sync; do not ask an agent to
edit YAML or native harness files to imitate a missing config operation.

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
catalog to both `managed_agent.invoke` and `managed_agent.orchestrate`. Parent assistants should
select a configured `agentProfile` when the child task clearly matches a
profile, such as scout/context discovery, TDD, implementation, research, review,
or DDD validation. If no configured profile matches a one-off read-only task,
the parent may omit `agentProfile` and invoke a generic governed child. Parents
must not invent profile names; unknown profiles fail closed during context
resolution.

For orchestration, profile and route selection belong to each work item rather
than one global worker route. `managed_agent.orchestrate` validates that an
explicit `routeId` agrees with the selected profile's route hint and that the
profile's authority profile matches the request. Dependencies are executable
contracts: Runtime starts a dependent only after its producers succeed, then
passes their bounded summaries and resource URIs into the dependent request.
Failed producers block downstream work. Independent review requires at least
two distinct provider/model identities; two aliases for the same model do not
count as independent evidence.

The model-facing tool also projects configured route ids, provider/model task
suitability, agent-profile task affinity, the configured skill catalog, and
unavailable-route diagnostics. This is why an operator can say "use the right
child agent for this review" instead of spelling out every route field; the
parent still chooses only from bounded Kiln ids.
Resolved agent entries may include `routeId` and `providerRoute` hints. Hints
come from explicit agent config first and from route suitability plus agent tier
second. Fast profiles such as `scout` should resolve to bounded read-only Mini,
Spark, or free routes when those routes are configured; heavyweight synthesis
routes remain available for roles that need them but are not the default scout
path.
Visual-reference research should use its own read-only, network-capable route
and matching profile rather than borrowing the approved-write frontend route.
For example, configure `visual-researcher` with
`routeId: opencode-go-qwen3-6-plus-readonly` and expose `web_search`,
`web_fetch`, and `web_extract` on that route. Browser tools can still be added
when a running product or demo needs to be captured, but the baseline
frontend-reference phase must also support code-backed frontend implementation
evidence when the reference repository has no screenshots. This keeps reference
research separate from code-writing authority while giving `managed_agent.invoke`
a profile whose route hint matches the research route.

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

Native skill directories owned directly by a harness are not canonical Kiln
config. If `kiln config read skills` reports a skill as `origin:
native-harness`, `configured: false`, and projection status `unmanaged-native`,
that skill exists for standalone harness use but is not admitted into Kiln
managed invocation yet. Use the setup action
`adopt-or-back-up-native-guidance` to adopt parseable, non-conflicting native
skills into `~/.kiln/skills` and project the governed copy back to Claude Code,
Codex, and OpenCode. If the same skill name differs across harnesses, Kiln
blocks adoption and reports the conflict instead of picking a source
implicitly. Project-specific skills can still be installed or proposed into
`.kiln/skills` when the behavior should stay local to one repository.

Agent profiles may declare a default `workClassification` when the role is
intentionally cross-domain, such as report writing, support, education, or
business document review. Managed invocation uses that profile classification
only when the request and durable work item do not already provide one. The
classification can recommend skills such as `clear-writing`, but admission
still follows the governed skill registry and `skills.selection.mode`.

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
