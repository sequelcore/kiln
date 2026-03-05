# Core Concepts

## YAML-First Philosophy

Kiln is configured in YAML, not code. Teams, agents, workflows, quality gates, routing rules, memory scopes, channels, and triggers are all declared in `app.yaml`. TypeScript exists as the runtime validation layer and infrastructure implementation -- it does not encode application behavior.

This approach means that changing your agent's goal, adding a new workflow phase, or switching LLM providers requires editing one YAML file and restarting (or hot-reloading) the server. No recompilation. No code review for configuration changes. The engine reads the YAML, validates it fully before starting, and rejects invalid configs with an aggregated list of every violation found.

## Architecture Overview

```
App (app.yaml)
+-- Router
|   +-- Pattern rules (regex -> team)
|   +-- Classifier (fast-tier LLM fallback)
|   +-- Fallback team (default)
+-- Teams[]
|   +-- Team
|       +-- Agents (name, role, goal, tier)
|       +-- Workflow (phases + quality gates)
|       +-- Capabilities (MCP tools)
|       +-- QualityGates (shell commands)
+-- Memory (scoped storage, SQLite or PostgreSQL)
+-- Channels (CLI, Web, WhatsApp, Slack, API)
+-- Triggers (webhook, event, schedule)
```

The Gateway is the deployment unit: a persistent Bun/Hono process that hosts one or more Apps in a single process, each isolated by memory namespace, session state, and channel bindings. See [Gateway Configuration](configuration/gateway-yaml.md) for deployment details.

---

## The 7 Primitives

### Agent

An Agent is a persona with expertise. The four identity fields -- `name`, `role`, `goal`, and `backstory` -- are assembled automatically into a system prompt before the agent receives any message. You declare what the agent is, not how to prompt it.

```yaml
planner:
  name: Aria
  role: Solutions Architect
  goal: Produce clear, validated plans before any implementation starts
  backstory: Methodical thinker who identifies edge cases early.
  tier: reasoning
  tools: []
  structured: true
```

System prompt assembly order: identity (`"You are {name}, {role}. Your goal: {goal}"`) -> backstory -> instructions -> team context -> available tools -> quality standards. This order is deterministic and cannot be changed via YAML.

Each agent declares a `tier` that maps to a concrete LLM at runtime:

| Tier | Default Model | Role | Tool Access | Output |
|------|--------------|------|-------------|--------|
| `reasoning` | Opus 4.6 | Planning, evaluation, review | None | Structured JSON only |
| `coding` | Sonnet 4.6 | Implementation, tool execution | Full | Free-form + tool calls |
| `fast` | Haiku 4.5 | Classification, summarization | Read-only | Free-form |

The `count` field declares a parallel worker pool. `sandbox: true` enables per-agent filesystem and network isolation. `modalities` declares which content types the agent can process (defaults to `["text"]`).

### Capability

A Capability is an MCP tool that agents can invoke. Every capability an agent references in its `tools` list must be declared in the team's `capabilities` array -- the loader enforces this at startup.

```yaml
capabilities:
  - name: memory_recall
    description: Recall memories by query from scoped storage
    tags: [memory]
    annotations:
      readOnly: true
      idempotent: true

  - name: deploy_service
    description: Deploy a container to the production environment
    tags: [deployment]
    annotations:
      destructive: true
```

Annotation semantics: `readOnly` tools run without locks and are available to all tiers; `destructive` tools require approval gates; `idempotent` tools are safe to cache and retry. Unannotated capabilities default to `destructive: true`.

A special `type: delegation` capability routes a task to another App in the same Gateway:

```yaml
- name: delegate_research
  description: Delegate a literature review to the research app
  type: delegation
  targetApp: research-ai
  task: Perform a literature review on the provided topic
  timeout: 120
  tags: [delegation]
```

### Workflow

A Workflow is an ordered sequence of named phases with quality gates enforced at transitions. Phase names are plain strings -- the engine imposes no constraint on names or count.

```yaml
workflow:
  phases: [analyze, plan, implement, verify]
  gates:
    plan:
      requires: [human_approval]
    verify:
      requires: [tests_pass, typecheck, lint]
  maxIterations: 3
```

A gate blocks entry into the named phase until all requirements are satisfied. `human_approval` pauses execution and emits an event; the session resumes when an explicit approval or rejection is received. Other gate names (like `tests_pass`) must match a `qualityGates` entry in the team. `maxIterations` limits how many times the verification loop retries before declaring a phase failed (default: 3).

### Memory

Memory provides scoped, persistent storage across five isolation boundaries. All scopes are queried with the current task context on each agent turn.

```yaml
memory:
  scopes:
    - user
    - "agent:planner"
    - "agent:worker"
    - "project:default"
  backend: sqlite+fts5
  sync: git
```

| Scope | Storage | Purpose |
|-------|---------|---------|
| `user` | SQLite + FTS5 (`~/.kiln/memory.db`) | User preferences, personal standards |
| `agent:{role}` | SQLite + FTS5 per role | Per-agent patterns with exponential decay |
| `team:{name}` | SQLite + FTS5 per team | Team-specific conventions |
| `project:{path}` | Gzipped JSONL in project dir | Project knowledge, git-synced across developers |
| `org` | Gzipped JSONL in project dir | Organization-wide standards, git-synced |

`sync: git` enables automatic push/pull of `project:` and `org` scopes. Content tagged `<private>` is stripped before any git-synced write. Memory stores support configurable decay curves (exponential, linear, step) and auto-compact when they exceed a configured size threshold.

See [Memory](guides/memory.md) for full configuration details.

### Task

A Task is a unit of work in a tree structure. Agents can explore problems by creating subtasks (`deepen`), alternative approaches (`branch`), or abandoning dead ends (`prune`). A configurable `maxDepth` prevents unbounded recursion. Tasks are scored by a formula (`priority * depthDiscount^depth * (1 + evidenceBonus)`) to guide selection.

Tasks are managed internally by the orchestrator via the `TaskTree`. The `BatchExecutor` selects tasks for concurrent execution across parallel worker instances.

### Channel

A Channel is an input/output adapter that connects the engine to an external platform. Agents produce content without knowledge of the destination; the channel adapter formats output for its target.

```yaml
channels: [cli, web, api]
```

| Adapter | Format | Transport | Supported Modalities |
|---------|--------|-----------|---------------------|
| `cli` | full | stdin/stdout | text |
| `web` | full | WebSocket | text, image, audio, file |
| `whatsapp` | short | WhatsApp Business API | text, image, audio, file |
| `slack` | full | Slack Bot Events + Web API | text, image, file |
| `api` | structured | HTTP REST + SSE | text, image, audio, file |

Messages use `ContentPart[]` -- a discriminated union of `TextPart`, `ImagePart`, `AudioPart`, and `FilePart`. This is the internal message format across all channels and agent interactions. See [Content Model](#content-model) below.

See [Channels](guides/channels.md) for per-adapter configuration options.

### Trigger

A Trigger is an event-driven workflow activator. Three types are supported:

```yaml
triggers:
  # Webhook: activated by HTTP POST with HMAC-SHA256 signature verification
  - name: on-deploy
    type: webhook
    path: /hooks/deploy
    team: main
    task: "Deploy triggered by {{payload.user}}"
    secretEnv: DEPLOY_WEBHOOK_SECRET

  # Event: activated when an internal engine event matches
  - name: on-error
    type: event
    event: agent_error
    filter:
      severity: critical
    team: main
    task: "Investigate critical agent error"

  # Schedule: activated on a cron expression
  - name: nightly-audit
    type: schedule
    cron: "0 2 * * *"
    timezone: "America/New_York"
    team: main
    task: "Run nightly security audit"
```

The `task` field supports `{{payload.field}}` template interpolation across all trigger types. Webhook signatures use HMAC-SHA256 timing-safe comparison. The cron parser is zero-dependency, supporting 5-field expressions with ranges, lists, and step values.

See [Triggers](guides/triggers.md) for full configuration.

---

## The 3 Composites

### Team

A Team is a self-contained execution unit combining agents, a workflow, capabilities, and quality gates. Teams in the same App do not share agents, memory scopes, or state.

```yaml
teams:
  main:
    mode: supervisor
    manager: planner
    agents:
      planner:
        tier: reasoning
        tools: []
        structured: true
      worker:
        tier: coding
        tools: [memory_save, memory_recall]
        count: 2
        sandbox: true
    workflow:
      phases: [plan, implement, verify]
      gates:
        verify:
          requires: [tests_pass]
    capabilities:
      - name: memory_save
        description: Save a memory entry
        tags: [memory]
      - name: memory_recall
        description: Recall memories by query
        tags: [memory]
        annotations:
          readOnly: true
    qualityGates:
      - name: tests_pass
        command: "bun run test"
        description: Run test suite
        required: true
```

### Team Modes

| Mode | Behavior | Requirements |
|------|----------|-------------|
| `sequential` (default) | Agents execute in workflow phase order | At least 1 agent |
| `supervisor` | Manager agent delegates tasks to workers by name, validates results | `manager` field pointing to a declared agent |
| `swarm` | Agents hand control to each other via `handoff` capability, no central coordinator | 2+ agents + a capability with `type: "handoff"` |

### Router

A Router dispatches incoming messages to teams using a three-layer priority chain:

```yaml
router:
  rules:
    - match: "^(analyze|investigate)"
      team: research
    - match: "^(execute|deploy|run)"
      team: execution
  classifier:
    tier: fast
    tools: []
  fallback: research
```

1. **Pattern rules** -- regex-tested against the incoming message in order; first match wins. Handles ~80% of inputs at zero cost.
2. **Classifier** -- a `fast`-tier LLM call for inputs matching no rule. Handles ~15% of inputs.
3. **Fallback** -- the statically configured team for all remaining inputs. Required.

The classifier agent must have `tier: fast`. The fallback must name a team declared in the `teams` map.

### App

An App is the top-level deployment unit. It composes all other primitives and composites into a single deployable configuration. `validateApp()` performs full referential integrity checks before the process starts: router fallback must name a real team, agent tools must name declared capabilities, gate phases must exist in the workflow, trigger names must be unique.

A single `app.yaml` file defines one App. The Gateway loads one or more Apps into a single process. See [App Configuration](configuration/app-yaml.md) for the complete field reference.

---

## Runtime Modes

The Gateway supports two runtime modes. Both can coexist in the same process on different Apps.

| Aspect | Mode A (Claude Code) | Mode B (Provider-Adapter) |
|--------|---------------------|--------------------------|
| Use case | Phase-gated agentic workflows | Conversational, multi-user |
| Session model | One active session per task | Concurrent sessions via SessionRegistry |
| Phase machine | Yes -- configurable phase sequence | No |
| Checkpointing | Yes -- resume after crash, fork for A/B | No |
| Concurrency | Single session | Unlimited concurrent sessions |
| LLM calls | Via Claude Code subprocess | Direct `createMessage()` call |
| YAML declaration | Omit `runtime` field (or `runtime: claude-code`) | `runtime: provider-adapter` + `provider` block |

Mode B apps declare a `provider` block and optionally a `billing` block:

```yaml
runtime: provider-adapter

provider:
  name: anthropic
  model: claude-haiku-4-5
  apiKeyEnv: ANTHROPIC_API_KEY

billing:
  budgetEndpoint: https://api.example.com/billing/budget/{userId}
  usageEndpoint: https://api.example.com/billing/usage/{userId}
  overBudgetMessage: "You have reached your monthly limit."
  tiers:
    free:
      agents: [fast]
    pro:
      agents: [fast, coding]
```

Budget middleware is fail-open: a billing service outage never blocks users.

### Handoff & Escalation

Mode B apps support human handoff -- transitioning a conversation from AI to a human operator and back. The session mode state machine governs lifecycle:

```
ai_active ──→ queued ──→ human_active ──→ ai_active
    │             │            │
    │             └────────────┴──→ resolved
    └──→ resolved ──→ ai_active (auto-reopen on new message)
```

| Mode | Description |
|------|-------------|
| `ai_active` | AI processes messages normally (default) |
| `queued` | Messages are queued for human review; AI does not respond |
| `human_active` | A human operator is handling the conversation |
| `resolved` | Conversation is closed; auto-reopens to `ai_active` on new user message |

**Escalation detection** runs after every AI response. The `EscalationDetector` checks for keywords (e.g., "hablar con humano", "talk to agent") and conversational loops (repeated similar responses). When triggered, an `ESCALATION_DETECTED` conversation event is emitted and the session transitions to `queued`.

**Operator messaging** allows human operators to send messages to end users via the handoff API. Messages are injected into the session history as assistant messages and delivered through the active channel (WebSocket or WhatsApp).

**Optimistic concurrency** prevents race conditions on session mutations. Each session tracks a `version` counter that increments on every mutation. `SessionRegistry.save()` checks that the stored version matches the version at load time, throwing `CONCURRENT_SESSION_MODIFICATION` on conflict.

See [Gateway YAML Reference](configuration/gateway-yaml.md#session--handoff) for handoff API routes and configuration.

---

## Content Model

All messages in Kiln use `ContentPart[]` -- a discriminated union supporting four types:

| Type | Fields | Use |
|------|--------|-----|
| `text` | `text: string` | All channels; default type |
| `image` | `url: string`, `mimeType: string` | Web, WhatsApp, Slack, API |
| `audio` | `data: string` (base64), `mimeType: string` | WhatsApp, Web, API |
| `file` | `url: string`, `name: string`, `mimeType: string` | Web, WhatsApp, Slack, API |

Text-only messages are represented as `[{ type: "text", text: "..." }]`. Helper functions `textParts()` and `extractText()` simplify working with text-only payloads. Each channel declares `supportedModalities` and silently drops content parts it cannot render.

---

## Event System

The engine emits 32 typed events across all operations. Events are available via SSE at `GET /dev/events` in dev mode and via the `useKilnEvents()` React hook.

| Level | Events | Use |
|-------|--------|-----|
| State | `session_start`, `session_end`, `app_loaded` | Session and app lifecycle |
| Phase | `phase_start`, `phase_end`, `gate_passed`, `approval_requested` | Workflow progress |
| Tool | `tool_call`, `tool_result`, `capability_invoked` | Agent tool execution |
| Token | `token_stream`, `message_complete` | LLM streaming output |

Additional event categories: security (5 events), trigger (4 events), safety (3 events), memory, cost, eval, A2A.

The `EventBus` uses a ring buffer for in-process delivery. An optional `EventStore` sink enables persistence (the OTel exporter implements this interface to map events to OpenTelemetry spans).
