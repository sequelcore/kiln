# App YAML Reference

`app.yaml` is the complete specification for a Kiln application. It declares agents, workflows, memory, routing, channels, triggers, evaluation, safety, and knowledge in a single file. The Gateway loads this file at startup and validates all cross-references before serving any requests.

Sources: `packages/core/src/engine/loader/app-loader.ts`, `packages/core/src/engine/loader/preset-loader.ts`

---

## Full Example

```yaml
name: my-app
channels: [web, cli, api]

memory:
  scopes:
    - user
    - "agent:architect"
    - "agent:worker"
    - "project:default"
  backend: sqlite+fts5
  sync: git

router:
  rules:
    - match: "^(bug|fix|error)"
      team: hotfix
    - match: "^(deploy|release)"
      team: ops
  classifier:
    tier: fast
    tools: []
  fallback: development

teams:
  development:
    mode: supervisor
    manager: architect
    agents:
      architect:
        tier: reasoning
        tools: []
        structured: true
      worker:
        tier: coding
        count: 2
        sandbox: true
        tools: [read_file, write_file, run_tests]
      reviewer:
        tier: fast
        tools: [read_file]
    workflow:
      phases: [analyze, design, implement, verify, synthesize]
      gates:
        design:
          requires: [human_approval]
        verify:
          requires: [tests_pass, typecheck, lint]
      maxIterations: 5
    capabilities:
      - name: read_file
        description: Read a file from the workspace
        tags: [filesystem, read]
        annotations:
          readOnly: true
          idempotent: true
      - name: write_file
        description: Write content to a file
        tags: [filesystem, write]
        annotations:
          destructive: true
      - name: run_tests
        description: Execute the test suite
        tags: [verification]
        annotations:
          idempotent: true
      - name: delegate_research
        description: Delegate a research task to the research App
        type: delegation
        targetApp: research-ai
        task: "Research the following topic: {{payload.topic}}"
        timeout: 120
        tags: [delegation]
    qualityGates:
      - name: tests_pass
        command: "bun run test"
        description: Run the full test suite
        required: true
      - name: typecheck
        command: "tsc --noEmit"
        description: TypeScript type checking
        required: true
      - name: lint
        command: "biome check ."
        description: Lint and format check
        required: true

  hotfix:
    mode: sequential
    agents:
      fixer:
        tier: coding
        sandbox: true
        tools: [read_file, write_file, run_tests]
    workflow:
      phases: [diagnose, fix, verify]
      gates:
        verify:
          requires: [tests_pass]
      maxIterations: 3
    capabilities:
      - name: read_file
        description: Read a file
        tags: [filesystem]
        annotations:
          readOnly: true
      - name: write_file
        description: Write a file
        tags: [filesystem]
      - name: run_tests
        description: Run tests
        tags: [verification]
    qualityGates:
      - name: tests_pass
        command: "bun run test"
        description: Run tests
        required: true

triggers:
  - name: on-deploy
    type: webhook
    path: /hooks/deploy
    team: ops
    task: "Deployment triggered by {{payload.actor}} on branch {{payload.branch}}"
    secretEnv: DEPLOY_WEBHOOK_SECRET
  - name: on-pr-opened
    type: event
    event: phase_changed
    filter:
      phaseName: implement
    team: development
    task: "Review the implementation phase output"
  - name: nightly-check
    type: schedule
    cron: "0 2 * * *"
    timezone: America/Los_Angeles
    team: development
    task: "Run nightly security and dependency audit"

knowledge:
  embedding:
    provider: openai
    model: text-embedding-3-small
    apiKeyEnv: OPENAI_API_KEY
  store:
    type: memory
  chunking:
    strategy: recursive
    chunkSize: 500
    overlap: 50
  sources:
    - path: ./docs
      glob: "**/*.md"
    - path: ./src
      glob: "**/*.ts"

mcp:
  servers:
    - name: filesystem
      url: http://localhost:3100/mcp

toolSelection:
  strategy: rag
  maxTools: 10
  threshold: 0.7

safety:
  pii:
    detect: [email, phone, ssn, credit_card]
    action: redact
    allowlist: ["support@company.com"]
  content:
    enabled: true
    categories:
      hate: { threshold: 0.7, action: block }
      violence: { threshold: 0.8, action: block }
    deepScan: false
  rails:
    - type: topic
      block: [medical_advice, legal_advice]
      escalate: [billing_dispute]
    - type: competitor
      competitors: [CompetitorA, CompetitorB]
      response: "I can only help with our products."

eval:
  datasets:
    - name: qa-baseline
      path: ./evals/qa-baseline.jsonl
  scorers:
    - name: exact
      type: exact-match
    - name: relevant
      type: relevance
    - name: quality
      type: composite
      scorers:
        - name: coherent
          type: coherence
        - name: faithful
          type: faithfulness
  experiments:
    - name: baseline
      dataset: qa-baseline
      team: development
      scorers: [exact, relevant, quality]
    - name: optimized
      dataset: qa-baseline
      team: development
      scorers: [exact, relevant, quality]
      compare: baseline
```

---

## Top-Level Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Unique identifier for this App. Used for memory namespacing in the Gateway. |
| `channels` | `string[]` | Yes | Channel adapter names to activate. Valid values: `cli`, `web`, `api`, `whatsapp`, `slack`, `voice`. At least one required. |

---

## voice

Required when `channels` includes `voice`. Configures speech-to-text and text-to-speech adapters for the voice channel.

```yaml
voice:
  stt:
    provider: openai
    apiKeyEnv: OPENAI_API_KEY
    model: whisper-1
    language: en
  tts:
    provider: openai
    apiKeyEnv: OPENAI_API_KEY
    voice: alloy
```

### voice.stt

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `provider` | `string` | Yes | STT provider. Valid values: `openai`, `deepgram`. |
| `apiKeyEnv` | `string` | No | Environment variable containing the API key. |
| `model` | `string` | No | Model name (e.g., `whisper-1`). Provider-specific default used if omitted. |
| `language` | `string` | No | Language hint for transcription. |

### voice.tts

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `provider` | `string` | Yes | TTS provider. Valid values: `openai`, `elevenlabs`. |
| `apiKeyEnv` | `string` | No | Environment variable containing the API key. |
| `model` | `string` | No | Model name. Provider-specific default used if omitted. |
| `voice` | `string` | No | Voice name (e.g., `alloy`, `nova`). Provider-specific default used if omitted. |

---

## teams

A map of named teams. Each team is a self-contained execution unit with its own agents, workflow, capabilities, and quality gates. Teams do not share agents or capabilities with each other.

### teams.\<name\>.mode

| Value | Behavior |
|-------|----------|
| `sequential` (default) | Agents execute in workflow phase order. |
| `supervisor` | Manager agent delegates tasks to workers; requires `manager` field. |
| `swarm` | Agents hand control to each other via `handoff` capability; requires 2+ agents and a handoff capability. |

### teams.\<name\>.agents

A map of named agents. Agent names are arbitrary.

```yaml
agents:
  architect:
    tier: reasoning
    tools: []
    structured: true
  worker:
    tier: coding
    count: 2
    sandbox: true
    tools: [read_file, write_file]
    modalities: [text, image]
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tier` | `reasoning \| coding \| fast` | Yes | Model class. See tier table below. |
| `tools` | `string[]` | Yes | Capability names this agent may invoke. Must all be declared in the team's `capabilities` list. Reasoning agents always use `[]`. |
| `structured` | `boolean` | No | Require structured JSON output. Use for reasoning agents that produce plans. |
| `count` | `number` | No | Number of parallel worker instances. Applies to coding agents. Workers in the same batch share sibling context to avoid duplicate work. |
| `sandbox` | `boolean` | No | Enable per-agent filesystem and network isolation. Recommended for all coding agents. |
| `modalities` | `string[]` | No | Content types this agent can process. Valid values: `text`, `image`, `audio`, `file`. Defaults to `["text"]`. |

**Tier reference:**

| Tier | Default Model | Role | Tools | Output |
|------|--------------|------|-------|--------|
| `reasoning` | Opus 4.6 | Plans, evaluates, reviews | None | Structured JSON only |
| `coding` | Sonnet 4.6 | Implements, executes tools | Full capability set | Free-form + tool calls |
| `fast` | Haiku 4.5 | Classifies, compresses, summarizes | Read-only | Free-form |

### teams.\<name\>.workflow

```yaml
workflow:
  phases: [analyze, design, implement, verify, synthesize]
  gates:
    design:
      requires: [human_approval]
    verify:
      requires: [tests_pass, typecheck, lint]
  maxIterations: 5
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phases` | `string[]` | Yes | Ordered phase names. Any strings; the engine has no reserved phase names. Execution proceeds in array order. |
| `gates` | `Record<string, Gate>` | No | Phase gates. Keys must match entries in `phases`. Blocks entry into that phase until requirements pass. |
| `gates.<phase>.requires` | `string[]` | Yes (per gate) | Gate requirements. See built-in requirements below. |
| `maxIterations` | `number` | No | Maximum verification loop retries before a phase is marked failed. Defaults to `3`. |

**Built-in gate requirements:**

| Requirement | Behavior |
|-------------|----------|
| `human_approval` | Pauses execution and emits `approval_requested`. Resumes on `approve()` or `reject()`. |
| `tests_pass` | Requires the `tests_pass` quality gate command to pass. |
| `typecheck` | Requires the `typecheck` quality gate command to pass. |
| `lint` | Requires the `lint` quality gate command to pass. |

Custom requirement strings map to quality gate `name` fields.

### teams.\<name\>.capabilities

Every capability name listed in any agent's `tools` array must be declared here. The loader validates all references.

```yaml
capabilities:
  - name: read_file
    description: Read a file from the workspace
    tags: [filesystem, read]
    annotations:
      readOnly: true
      idempotent: true
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Unique within the team. Referenced by agent `tools` arrays. |
| `description` | `string` | Yes | Used in MCP tool registration. |
| `tags` | `string[]` | No | Arbitrary strings for grouping and filtering. |
| `annotations.readOnly` | `boolean` | No | Tool reads state only. Engine grants to all tiers. |
| `annotations.destructive` | `boolean` | No | Tool has irreversible side effects. Unannotated tools default to `destructive: true`. |
| `annotations.idempotent` | `boolean` | No | Repeated calls produce the same result. Engine may cache or retry safely. |
| `schema` | `object` | No | JSON Schema describing the tool's input parameters. Omitting results in an empty schema `{}`. |

**Delegation capability:**

Use `type: delegation` to route a task to another App in the same Gateway.

```yaml
capabilities:
  - name: delegate_research
    description: Delegate research to the research App
    type: delegation
    targetApp: research-ai
    task: "Research this topic: {{payload.topic}}"
    timeout: 120
    tags: [delegation]
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"delegation"` | Yes | Marks this as a delegation capability. |
| `targetApp` | `string` | Yes | Must match an App `name` in `gateway.yaml`. |
| `task` | `string` | Yes | Instruction sent to the target App. |
| `timeout` | `number` | No | Seconds to wait for the delegation response. |

### teams.\<name\>.qualityGates

Verification commands executed by the verification loop. Referenced by `workflow.gates.<phase>.requires`.

```yaml
qualityGates:
  - name: tests_pass
    command: "bun run test"
    description: Run the full test suite
    required: true
  - name: typecheck
    command: "tsc --noEmit"
    description: TypeScript type checking
    required: true
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Identifier. Referenced in `workflow.gates[phase].requires`. |
| `command` | `string` | Yes | Shell command executed by the verification loop. |
| `description` | `string` | Yes | Human-readable label shown in console output. |
| `required` | `boolean` | Yes | When `true`, failure blocks phase transition. When `false`, failure is logged but does not block. |

The loader accepts `quality` as an alias for `qualityGates`.

---

## memory

```yaml
memory:
  scopes:
    - user
    - "agent:architect"
    - "agent:worker"
    - "project:default"
    - org
  backend: sqlite+fts5
  sync: git
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `scopes` | `string[]` | Yes | Active memory scopes. At least one required. Scopes not listed are inaccessible. |
| `backend` | `string` | Yes | Storage backend. `sqlite+fts5` for local; `postgresql` for multi-node. |
| `sync` | `string` | No | `git` enables automatic push/pull of `project:` and `org` scopes. Omit for local-only. |

**Scope reference:**

| Scope | Pattern | Backend | Purpose |
|-------|---------|---------|---------|
| `user` | literal `user` | SQLite at `~/.kiln/memory.db` | User preferences, personal standards |
| `agent:{name}` | `agent:` + agent name | SQLite at `~/.kiln/agents/{name}.db` | Per-agent patterns with exponential decay |
| `team:{name}` | `team:` + team name | SQLite at `~/.kiln/teams/{name}.db` | Team-specific conventions |
| `project:{id}` | `project:` + identifier | Gzipped JSONL in `{projectDir}/` | Project knowledge, shared across developers |
| `org` | literal `org` | Gzipped JSONL in `{projectDir}/org/` | Organization-wide standards |

See [Memory guide](../guides/memory.md) for decay curves, auto-compaction, and git sync details.

---

## router

```yaml
router:
  rules:
    - match: "^(bug|fix|error)"
      team: hotfix
    - match: "^(deploy|release)"
      team: ops
  classifier:
    tier: fast
    tools: []
  fallback: development
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `rules` | `PatternRule[]` | No | Regex rules evaluated in order. First match wins. |
| `rules[].match` | `string` | Yes | Regex pattern tested against the incoming message text. |
| `rules[].team` | `string` | Yes | Team name to route to when the pattern matches. Must exist in `teams`. |
| `classifier` | `Agent` | No | Fast-tier agent for ML-based routing when no rule matches. Must have `tier: fast`. |
| `fallback` | `string` | Yes | Team used when no rule and no classifier match. Must exist in `teams`. |

Routing priority: pattern rules (80% of inputs) -> classifier (15%) -> fallback (5%).

---

## triggers

```yaml
triggers:
  - name: on-deploy
    type: webhook
    path: /hooks/deploy
    team: ops
    task: "Deploy {{payload.branch}} by {{payload.actor}}"
    secretEnv: DEPLOY_WEBHOOK_SECRET

  - name: on-error
    type: event
    event: error
    filter:
      severity: high
    team: hotfix
    task: "Investigate error: {{payload.message}}"

  - name: nightly
    type: schedule
    cron: "0 2 * * *"
    timezone: America/Los_Angeles
    team: development
    task: "Run nightly audit"
```

All trigger types share these common fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Unique trigger identifier within the App. |
| `type` | `webhook \| event \| schedule` | Yes | Trigger type. |
| `team` | `string` | Yes | Team to dispatch the task to. Must exist in `teams`. |
| `task` | `string` | No | Task description sent to the team. Supports `{{payload.field}}` interpolation. |
| `enabled` | `boolean` | No | Defaults to `true`. Set `false` to disable without removing. |

**Webhook trigger fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | `string` | Yes | HTTP path for the webhook endpoint (e.g., `/hooks/deploy`). Must be unique across all Apps. |
| `method` | `"POST" \| "PUT"` | No | Accepted HTTP method. Defaults to `POST`. |
| `secretEnv` | `string` | No | Name of the environment variable holding the HMAC-SHA256 secret for request validation. |

**Event trigger fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `event` | `string` | Yes | EventBus event type to listen for (e.g., `phase_changed`, `error`, `tool_called`). |
| `filter` | `Record<string, unknown>` | No | Shallow equality filter on event payload fields. All keys must match for the trigger to fire. |

**Schedule trigger fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `cron` | `string` | Yes | Standard 5-field cron expression (`minute hour day month weekday`). |
| `timezone` | `string` | No | IANA timezone string (e.g., `America/Los_Angeles`). Defaults to `UTC`. |

See [Triggers guide](../guides/triggers.md) for full details on HMAC validation, template interpolation, and lifecycle.

---

## eval

The optional `eval` block defines evaluation pipelines. All cross-references are validated at load time.

```yaml
eval:
  datasets:
    - name: qa-baseline
      path: ./evals/qa-baseline.jsonl

  scorers:
    - name: exact
      type: exact-match
    - name: contains-keywords
      type: contains
      substrings: [Kiln, orchestration, agent]
    - name: valid-json
      type: json-validity
    - name: short-response
      type: length
      minLength: 10
      maxLength: 500
    - name: fast-response
      type: latency
      maxLatencyMs: 3000
    - name: cheap
      type: cost
      maxCostUsd: 0.01
    - name: faithful
      type: faithfulness
    - name: relevant
      type: relevance
    - name: coherent
      type: coherence
    - name: no-hallucination
      type: hallucination
    - name: safe
      type: toxicity
    - name: custom-quality
      type: custom-prompt
      prompt: "Rate the response quality from 0 to 1. Output only a number."
    - name: overall
      type: composite
      scorers:
        - name: sub-relevant
          type: relevance
        - name: sub-coherent
          type: coherence

  experiments:
    - name: baseline
      dataset: qa-baseline
      team: development
      scorers: [exact, relevant, coherent]
    - name: optimized
      dataset: qa-baseline
      team: development
      scorers: [exact, relevant, coherent]
      overrides:
        architect:
          tier: reasoning
      compare: baseline
```

### datasets

Each dataset is a JSONL file where each line is a JSON object:

```jsonl
{"id": "1", "input": "What is Kiln?", "expected": "An AI orchestration engine", "context": ["docs"]}
{"id": "2", "input": "How many primitives are there?"}
```

| Field | Type | Required |
|-------|------|----------|
| `id` | `string` | Yes, unique |
| `input` | `string` | Yes |
| `expected` | `string` | No |
| `context` | `string[]` | No |
| `metadata` | `object` | No |

### scorers

| Type | Category | Notes |
|------|----------|-------|
| `exact-match` | Rule-based | `1` if `output === expected`, else `0` |
| `contains` | Rule-based | Requires `substrings: string[]`. Score = found / total (case-insensitive) |
| `json-validity` | Rule-based | Parse check + optional key-presence. Requires `schema: object` if checking structure |
| `length` | Rule-based | Uses `minLength` and/or `maxLength`. Proportional penalty when outside range |
| `latency` | Rule-based | Requires `maxLatencyMs`. Score `1.0` if under; `maxLatencyMs / durationMs` if over |
| `cost` | Rule-based | Requires `maxCostUsd`. Score `1.0` if under; `maxCostUsd / costUsd` if over |
| `faithfulness` | LLM-as-judge | LLM rates 0–1 |
| `relevance` | LLM-as-judge | LLM rates 0–1 |
| `coherence` | LLM-as-judge | LLM rates 0–1 |
| `hallucination` | LLM-as-judge | Inverted: `1 - llmScore`. Returns `0` on parse failure (conservative) |
| `toxicity` | LLM-as-judge | Inverted: `1 - llmScore`. Returns `0` on parse failure (conservative) |
| `custom-prompt` | LLM-as-judge | Requires `prompt: string`. LLM evaluates and returns a score |
| `composite` | Meta | Requires `scorers: []`. Average of sub-scorer scores |

### experiments

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Unique experiment identifier. |
| `dataset` | `string` | Yes | Must reference a declared dataset name. |
| `team` | `string` | Yes | Must reference a team in the App's `teams` map. |
| `scorers` | `string[]` | Yes | Must reference declared scorer names. |
| `overrides` | `object` | No | Agent config overrides for this experiment. |
| `compare` | `string` | No | Another experiment name to compare against. No cycles allowed. |

---

## safety

See [Safety Pipeline guide](../guides/safety.md) for full documentation.

```yaml
safety:
  pii:
    detect: [email, phone, ssn, credit_card, ip_address, date_of_birth]
    action: redact
    allowlist: ["support@company.com"]
    deepScan: false
  content:
    enabled: true
    categories:
      hate: { threshold: 0.7, action: block }
      violence: { threshold: 0.8, action: block }
      sexual: { threshold: 0.9, action: block }
      self_harm: { threshold: 0.7, action: block }
    deepScan: false
  rails:
    - type: topic
      block: [medical_advice, legal_advice]
      escalate: [billing_dispute]
    - type: competitor
      competitors: [CompetitorA, CompetitorB]
      response: "I can only help with our products."
    - type: escalation
      triggers: [urgent, emergency, critical]
      escalateTo: human-support
    - type: compliance
      required: [GDPR, HIPAA]
```

---

## knowledge

Configures the RAG pipeline. When present, a `knowledge_search` capability is automatically injected into agents that are allowed to use it.

```yaml
knowledge:
  embedding:
    provider: openai
    model: text-embedding-3-small
    apiKeyEnv: OPENAI_API_KEY
  store:
    type: memory
  chunking:
    strategy: recursive
    chunkSize: 500
    overlap: 50
  sources:
    - path: ./docs
      glob: "**/*.md"
    - path: ./src
      glob: "**/*.ts"
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `embedding.provider` | `"openai" \| "ollama"` | Yes | Embedding model provider. |
| `embedding.model` | `string` | Yes | Model name (e.g., `text-embedding-3-small`). |
| `embedding.apiKeyEnv` | `string` | No | Environment variable name for API key. Not required for Ollama. |
| `store.type` | `"memory"` | Yes | Vector store type. `memory` uses `InMemoryVectorStore`. |
| `chunking.strategy` | `"recursive" \| "markdown"` | Yes | Chunking strategy. `markdown` preserves heading hierarchy. |
| `chunking.chunkSize` | `number` | No | Maximum chunk size in tokens. |
| `chunking.overlap` | `number` | No | Token overlap between adjacent chunks. |
| `sources` | `SourceConfig[]` | Yes | File sources to ingest. |
| `sources[].path` | `string` | Yes | Directory path relative to the App YAML file. |
| `sources[].glob` | `string` | Yes | Glob pattern for files to include. |

---

## mcp

Declares external MCP server connections. Tools discovered from connected servers are available to agents alongside declared capabilities.

```yaml
mcp:
  servers:
    - name: filesystem
      url: http://localhost:3100/mcp
    - name: search
      url: http://localhost:3101/mcp
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `servers[].name` | `string` | Yes | Unique identifier for the MCP server. |
| `servers[].url` | `string` | Yes | Streamable HTTP endpoint URL for the MCP server. |

MCP connections use the official `@modelcontextprotocol/sdk` client with Streamable HTTP transport. A circuit breaker protects against unreachable servers with exponential backoff retries.

---

## toolSelection

Controls how tools are selected when the total tool count exceeds the provider's limit.

```yaml
toolSelection:
  strategy: rag
  maxTools: 10
  threshold: 0.7
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `strategy` | `"all" \| "rag"` | Yes | `all` passes all tools; `rag` uses embedding similarity to select the most relevant. |
| `maxTools` | `number` | No | Maximum tools to pass to the provider. Only used with `strategy: rag`. |
| `threshold` | `number` | No | Minimum cosine similarity score (0–1) for a tool to be included. |

---

## Loading an App in TypeScript

```typescript
import { parseAppYaml, validateAppGraph } from "@kilnai/core";
import { readFileSync } from "node:fs";

const content = readFileSync("app.yaml", "utf-8");
const app = parseAppYaml(content);       // throws AppLoaderError on schema errors

const graphError = validateAppGraph(app); // throws AppLoaderError on dependency errors
if (graphError) throw graphError;
```

`parseAppYaml()` validates field types and required fields. `validateAppGraph()` validates all cross-references: router fallback must name an existing team, agent tools must name existing capabilities, gate phases must exist in the workflow.

**For Mode A sessions** (phase-gated workflows), bridge to an `OrchestratorConfig`:

```typescript
import { loadPresetConfig } from "@kilnai/core";

const config = loadPresetConfig(app); // uses router.fallback team by default
// config.phases, config.requireApproval, config.parallelWorkers, etc.
```

For Mode B sessions, the App is consumed directly by the Gateway runtime without this bridge.

---

## Common Mistakes

- **Agent tool not declared as a capability.** Every string in an agent's `tools` array must appear as a `name` in the team's `capabilities` list. The loader reports each violation individually.

- **Gate phase not in workflow.** Keys under `workflow.gates` must match entries in `workflow.phases`. Typos are caught at load time.

- **Router fallback does not name a team.** The `router.fallback` value must match a key in the top-level `teams` map.

- **Classifier agent with wrong tier.** The `router.classifier` agent must have `tier: fast`. Other tiers are rejected.

- **Delegation capability missing targetApp or task.** When `type: delegation` is set, both `targetApp` and `task` are required.

- **Empty channels array.** At least one channel must be listed.

- **Empty memory scopes.** At least one scope must be listed.

- **Eval experiment references non-existent team.** The `team` field in each experiment must match a key in `teams`.

- **Eval circular compare reference.** If experiment A compares against B, B cannot compare against A.

- **Eval scorer type typo.** Invalid scorer types are rejected at load time. Use one of the 12 valid type strings (or `composite` for meta-scoring).

- **Supervisor mode missing manager.** When `mode: supervisor`, the `manager` field must name an agent defined in the team's `agents` map.
