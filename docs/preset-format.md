# Preset Format Reference

A preset is a YAML-encoded App configuration that packages agents, workflows, capabilities, memory, and quality gates for a specific domain. Loading a preset file produces a fully typed `App` composite that the engine can execute without any additional TypeScript configuration.

Presets are loaded via `parseAppYaml()` followed by `loadPresetConfig()`. The loader validates the dependency graph (agent tool references, router team references, gate phase references) and throws `AppLoaderError` with an aggregated list of all violations if anything is invalid.

Source: `packages/core/src/engine/loader/app-loader.ts`, `packages/core/src/engine/loader/preset-loader.ts`

---

## Preset Format

A preset YAML file maps directly to the `App` interface. The top-level fields are:

```yaml
name: string                 # Unique identifier for this App
channels: [string, ...]      # Channel adapters: cli, web, api, whatsapp, slack, websocket

memory:
  scopes: [string, ...]      # Memory scopes (see Memory Configuration)
  backend: string            # Storage backend: sqlite+fts5 | postgresql
  sync: string               # Optional sync strategy: git

router:
  rules:                     # Pattern rules (may be empty)
    - match: string          # Regex pattern tested against incoming message
      team: string           # Team name to route to when match succeeds
  classifier:                # Optional fast-tier agent for ML-based routing
    tier: fast
    tools: []
  fallback: string           # Team to use when no rule matches

teams:
  <team-name>:
    agents:
      <agent-name>:
        tier: reasoning | coding | fast
        tools: [string, ...]     # Capability names this agent may invoke
        structured: boolean      # Require structured JSON output (reasoning agents)
        count: number            # Parallel instance count (coding agents)
        sandbox: boolean         # Enable filesystem/network isolation
        systemPrompt: string     # Optional instruction override
    workflow:
      phases: [string, ...]      # Ordered phase names (any strings)
      gates:
        <phase-name>:
          requires: [string, ...]  # Gate requirements (see Quality Gates)
      maxIterations: number        # Max verification loop attempts (default: 3)
    capabilities:
      - name: string
        description: string
        tags: [string, ...]
        annotations:
          readOnly: boolean
          destructive: boolean
          idempotent: boolean
        # Delegation capabilities only:
        type: delegation
        targetApp: string
        task: string
        timeout: number
    qualityGates:
      - name: string
        command: string
        description: string
        required: boolean
```

All fields shown are required unless marked optional. The loader accepts `quality` as an alias for `qualityGates`.

---

## Agents

Each team defines a named set of agents. Agent names are arbitrary strings and become the key in the `agents` record. The engine resolves each tier to a concrete provider and model at runtime via `ProviderRegistry`.

### Tiers

| Tier | Model Class | Role | Tool Access |
|------|-------------|------|-------------|
| `reasoning` | Opus | Plans, evaluates, reviews | None (structured JSON output only) |
| `coding` | Sonnet | Implements, executes tools | Full capability set |
| `fast` | Haiku | Classifies, compresses, summarizes | Read-only subset |

### Agent Fields

- `tier` (required): one of `reasoning`, `coding`, `fast`
- `tools` (required): array of capability names from the team's `capabilities` list. Validation fails if any tool name is not declared as a capability. Reasoning agents always use `[]`
- `structured` (optional): when `true`, the engine requires structured JSON output from this agent. Used for reasoning agents that produce plans or evaluations
- `count` (optional): number of parallel instances. Coding agents with `count: 2` run two workers concurrently with sibling awareness
- `sandbox` (optional): when `true`, the agent runs inside a per-agent filesystem and network sandbox. Recommended for all coding agents
- `systemPrompt` (optional): overrides or extends the default system prompt for this agent

### The Three Agent Archetypes

All built-in presets use the same three archetypes, with domain-specific names:

**Reasoning agent** — zero tools, structured output, plans and evaluates:

```yaml
architect:
  tier: reasoning
  tools: []
  structured: true
```

**Coding agent** — full tool access, sandboxed, parallel workers:

```yaml
worker:
  tier: coding
  tools:
    - my_tool_read
    - my_tool_write
  count: 2
  sandbox: true
```

**Fast agent** — limited tools, read-only, compresses and classifies:

```yaml
optimizer:
  tier: fast
  tools:
    - my_memory_search
    - my_cost_summary
```

---

## Workflows

A workflow defines the sequence of phases an agent team executes, the gates that must pass before each phase transition, and the iteration limit for verification loops.

### Phases

Phases are plain strings. The engine imposes no constraint on names or count. The order of the array is the execution order.

```yaml
workflow:
  phases: [analyze, research, architect, implement, verify, synthesize]
```

Phases can be domain-specific:

```yaml
workflow:
  phases: [classification, literature, formulation, testing, controls, synthesis]
```

### Gates

Gates are defined per phase. A gate blocks entry into that phase until all requirements are satisfied. Gate keys must match a name in the `phases` array; the loader enforces this.

```yaml
gates:
  architect:
    requires: [human_approval]    # Pauses for user review before proceeding
  verify:
    requires: [tests_pass, typecheck, lint]
```

#### Built-in Gate Requirements

| Requirement | Behavior |
|-------------|----------|
| `human_approval` | Pauses execution and emits an `approval_requested` event. Resumes on `approval_received` |
| `tests_pass` | Requires the verification loop's test command to pass |
| `typecheck` | Requires the type-check command to pass |
| `lint` | Requires the lint command to pass |

Custom requirement strings are domain-defined and enforced by the preset's quality gate commands.

### maxIterations

`maxIterations` limits how many times the verification loop retries before the phase is considered failed. Defaults to `3` if omitted (set by `loadPresetConfig()`).

```yaml
workflow:
  phases: [implement, verify]
  gates:
    verify:
      requires: [tests_pass]
  maxIterations: 5
```

---

## Capabilities

Capabilities are MCP tools that agents can invoke. Every capability used in an agent's `tools` list must be declared in the team's `capabilities` array. The validator enforces this constraint.

### Standard Capability

```yaml
capabilities:
  - name: my_search
    description: Full-text search across the knowledge base
    tags: [search, knowledge]
    annotations:
      readOnly: true
      idempotent: true
```

### Capability Fields

- `name` (required): unique within the team. Referenced by agent `tools` arrays
- `description` (required): human-readable description used in MCP tool registration
- `tags` (optional): arbitrary strings for grouping and filtering
- `annotations` (optional): safety policy hints
  - `readOnly: true` — tool reads state only, no side effects. Engine grants to all tiers
  - `destructive: true` — tool has irreversible side effects. Engine restricts or requires confirmation
  - `idempotent: true` — repeated calls produce the same result. Engine may cache or retry safely
  - Unannotated tools default to `destructive: true`
- `schema` (optional): JSON Schema object describing the tool's input parameters. Omitting `schema` results in an empty schema `{}`

### Delegation Capability

A delegation capability routes a task to another App running in the same Gateway. The `type: delegation` field is required, and `targetApp` and `task` become required fields.

```yaml
capabilities:
  - name: delegate_to_research
    description: Delegate a literature review task to the research App
    type: delegation
    targetApp: research-ai
    task: Perform a literature review on the provided topic
    timeout: 120
    tags: [delegation]
```

- `targetApp`: must match a name in the Gateway's `apps` list
- `task`: description of what the target App should do with the delegated message
- `timeout`: seconds to wait for the delegation response (default behavior if omitted is implementation-defined)

---

## Memory Configuration

The `memory` block defines which scopes are active and how data is persisted.

```yaml
memory:
  scopes:
    - user
    - "agent:architect"
    - "agent:worker"
    - "agent:optimizer"
    - "project:default"
  backend: sqlite+fts5
  sync: git
```

### Scopes

| Scope | Pattern | Purpose | Persistence |
|-------|---------|---------|-------------|
| `user` | literal `user` | User preferences, standards, commit style | Local SQLite |
| `agent:{role}` | `agent:` + agent name | Per-agent patterns with exponential decay | Local SQLite |
| `team:{name}` | `team:` + team name | Team-specific conventions | Local SQLite |
| `project:{path}` | `project:` + identifier | Project knowledge, shared across developers | Git-synced gzipped JSONL |
| `org` | literal `org` | Organization-wide standards | Git-synced gzipped JSONL |

A preset must declare at least one scope. Declare scopes for every agent that needs recall. Scopes not listed are inaccessible to the App.

### Backends

| Backend | Use Case |
|---------|---------|
| `sqlite+fts5` | Default. Local deployments, single-node, FTS5 full-text search |
| `postgresql` | Multi-node deployments, shared memory across gateway instances |

### Sync

`sync: git` enables automatic push/pull of `project:` and `org` scopes to the project's git repository. Omit for local-only Apps. Content tagged `<private>` is stripped before any git-synced write.

---

## Router Configuration

The router dispatches incoming messages to teams using a three-layer strategy: pattern rules, optional classifier agent, and a required fallback.

```yaml
router:
  rules:
    - match: "^(analyze|research|investigate)"
      team: investigation
    - match: "^(execute|run|deploy)"
      team: execution
  classifier:
    tier: fast
    tools: []
  fallback: investigation
```

### Pattern Rules

Each rule's `match` field is a regex string. Rules are evaluated in order; the first match wins. Approximately 80% of messages are handled at this layer. If `rules` is empty, all messages fall through to the classifier or fallback.

### Classifier

The optional `classifier` agent must have `tier: fast`. The engine invokes it only when no pattern rule matches. The classifier returns a team name. Approximately 15% of messages are handled here.

### Fallback

`fallback` is required and must match a key in the `teams` map. It handles all messages not resolved by rules or classifier (approximately 5%), and serves as the default team when the App has only one team.

---

## Quality Gates

Quality gates are verification commands that must pass before a phase transition occurs. They are defined at the team level and referenced by the workflow's `gates` map using requirement names.

```yaml
qualityGates:
  - name: typecheck
    command: "tsc --noEmit"
    description: Type-check TypeScript source
    required: true
  - name: test
    command: "vitest run"
    description: Run test suite
    required: true
  - name: lint
    command: "biome check"
    description: Lint and format code
    required: true
```

### Gate Fields

- `name` (required): identifier. Referenced in `workflow.gates[phase].requires`
- `command` (required): shell command the verification loop executes
- `description` (required): human-readable label shown in the console
- `required` (required): when `true`, a failing gate blocks phase transition. When `false`, the failure is logged but does not block

Gates are executed by the verification loop (Ralph pattern): run tests, run lint, run typecheck, optionally capture screenshots. The loop retries up to `maxIterations` times before marking the phase as failed.

Source: `packages/core/src/verification/verification-loop.ts`

---

## Loading a Preset

### Basic loading

```typescript
import { parseAppYaml, validateAppGraph } from "@kilnai/core";
import { readFileSync } from "node:fs";

const content = readFileSync("my-preset.yaml", "utf-8");
const app = parseAppYaml(content);       // throws AppLoaderError on schema errors

const graphError = validateAppGraph(app); // throws AppLoaderError on dependency errors
if (graphError) throw graphError;
```

`parseAppYaml()` validates field types and required fields. `validateAppGraph()` validates cross-references: router fallback must name an existing team, agent tools must name existing capabilities, gate phases must exist in the workflow.

### Deriving an OrchestratorConfig (Mode A only)

For Mode A sessions (Claude Code subprocess), bridge the App to an `OrchestratorConfig`:

```typescript
import { loadPresetConfig } from "@kilnai/core";

const config = loadPresetConfig(app); // uses router.fallback team by default
// config.phases, config.requireApproval, config.parallelWorkers, etc.
```

For Mode B sessions (Provider-Adapter), the App is consumed directly by the Gateway runtime without this bridge.

---

## Common Mistakes

- **Agent tool not declared as a capability.** Every string in an agent's `tools` array must appear as a `name` in the team's `capabilities` list. The loader reports each violation individually.
- **Gate phase not in workflow.** A key under `workflow.gates` must match a phase in `workflow.phases`. Typos are caught at load time.
- **Router fallback does not name a team.** The `router.fallback` value must match a key in the top-level `teams` map.
- **Classifier agent with wrong tier.** The `router.classifier` agent must have `tier: fast`. Other tiers are rejected by the validator.
- **Delegation capability missing targetApp or task.** When `type: delegation` is set, both `targetApp` and `task` are required fields.
- **Empty channels array.** At least one channel must be listed.
- **Empty memory scopes.** At least one scope must be listed.
