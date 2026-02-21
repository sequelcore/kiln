# Kiln Evolution Plan

## 1. Vision

### What Kiln Is

A YAML-configured, production-grade AI orchestration engine for TypeScript teams building multi-tenant, multi-agent SaaS applications.

### Target Users

Engineering teams who need:
- Multi-tenant isolation (SaaS products with per-customer AI agents)
- Quality assurance enforcement (gates, verification loops, reproducibility)
- Budget control (per-role cost tracking, tier enforcement)
- Multi-channel deployment (CLI, Web, WhatsApp, Slack, API)
- Self-hosted / white-label capability
- Declarative configuration (YAML over code)

### What Kiln Is NOT

| Not This | That's For | Why Not |
|----------|-----------|---------|
| Personal AI assistant | OpenClaw | Consumer space, single-user, chat-first UX |
| Visual no-code builder | AutoGPT Platform | Non-engineer target, proprietary blocks |
| Python framework | LangGraph, CrewAI | Different ecosystem; Python is saturated with options |
| Research prototype | BabyAGI | Educational, not production-grade |

### Competitive Position

```
                    Code-First ──────────────────── YAML-Declarative
                        │                                │
  Production-Grade ─────┼── LangGraph                    │── Kiln ◄── ONLY ONE HERE
                        │                                │
  Framework ────────────┼── CrewAI, Mastra               │
                        │                                │
  Managed Runtime ──────┼── Bedrock AgentCore             │── (none yet)
                        │                                │
  No-Code ──────────────┼── AutoGPT Platform             │── (none)
```

### Validated Strengths

These are confirmed unique or best-in-class across 10+ competitors:

1. **YAML-first configuration** -- comprehensive YAML-defined agents/teams/workflows/gates
2. **Multi-tenant gateway** -- native multi-tenant isolation with per-app routes and budget enforcement
3. **5 scoped memory** -- richest scope model (user, agent, team, project, org) with decay and compaction
4. **MCP-native capabilities** -- aligned with Anthropic's Model Context Protocol standard
5. **Quality gates with verification loop** -- iterative test/lint/typecheck enforcement
6. **Agent Identity Standard** -- name/role/goal/backstory persona model with auto-assembled system prompts
7. **Budget enforcement** -- cache-aware cost tracking with per-role pricing
8. **Cross-app delegation** -- schema-contracted inter-app communication
9. **Security layers** -- prompt injection (2-tier), Guardian review, encrypted secrets, audit logging
10. **TypeScript/Bun** -- only production framework in the Bun ecosystem

### Kiln Differentiator Thesis

Every competitor forces a choice: code-first flexibility (LangGraph, Mastra) or managed simplicity (Bedrock AgentCore). Kiln is the only engine where the entire agent topology -- teams, workflows, memory scopes, quality gates, channels, triggers, security layers -- is declared in YAML, validated at startup, and runs on a single Bun process. Advanced features are opt-in YAML fields, not code changes. This means a DevOps engineer can reconfigure an AI deployment without touching TypeScript.

---

## 2. Current Status

| Metric | Value |
|--------|-------|
| Packages | 3 (core, runtime, cli) |
| Bounded contexts | 24 |
| Tests passing | 2,270+ (vitest) |
| Primitives | 7 (Agent, Capability, Workflow, Memory, Task, Channel, Trigger) |
| Composites | 3 (Team, Router, App) |
| Provider adapters | 4 (Anthropic w/ native output_config, OpenAI, DeepSeek, Ollama) |
| Embedding adapters | 2 (OpenAI, Ollama) |
| Channel adapters | 5 (CLI, Web, WhatsApp, Slack, API) |
| Trigger types | 3 (webhook, event, schedule) |
| Security layers | 6 (injection scan, Guardian, secrets, audit, tenant isolation, self-audit) |
| Observability | OTel span mapping (29 event types) + exporter |
| Knowledge (RAG) | Chunkers (2), EmbeddingAdapters (2), VectorStore (1), RetrievalPipeline, auto-injected capability |
| Eval | 12 scorer types (6 rule-based + 6 LLM-as-judge), dataset JSONL loader, experiment runner, experiment comparator |
| Error codes | 43 (across 12 bounded contexts) |

### Recently Completed (Phase 10 -- Evaluation Framework)

- Engine primitive: `EvalConfig` types (`EvalScorerType`, `EvalScorerConfig`, `EvalDatasetConfig`, `EvalExperimentConfig`) + `validateEvalConfig()` with circular compare detection
- 6 rule-based scorers: `ExactMatchScorer`, `ContainsScorer`, `JsonValidityScorer`, `LengthScorer`, `LatencyScorer`, `CostScorer`
- `CompositeScorer` (averages sub-scorers, guards empty array)
- 6 LLM-as-judge scorers: `FaithfulnessScorer`, `RelevanceScorer`, `CoherenceScorer`, `HallucinationScorer`, `ToxicityScorer`, `CustomPromptScorer`
- `ScorerLLM` interface for LLM-based evaluation
- `parseLLMResponse()` internal utility (SCORE + REASONING extraction, clamping, anchored regex)
- `parseDatasetJsonl()` JSONL loader with strict validation (duplicate IDs, non-string context rejection)
- `ExperimentRunner` with per-scorer error isolation (try/catch per scorer, degraded score on failure)
- `compareExperiments()` side-by-side experiment comparison
- `createScorer()` factory: `EvalScorerConfig` -> `Scorer` instance
- `eval` block parsing in `app-loader.ts` (optional top-level field in app.yaml)
- `validateApp()` extended: eval config validation + experiment team reference checking
- 5 error codes: `EVAL_YAML_INVALID`, `EVAL_DATASET_NOT_FOUND`, `EVAL_DATASET_INVALID`, `EVAL_SCORER_FAILED`, `EVAL_EXPERIMENT_FAILED`
- Conservative safety scoring: Hallucination/Toxicity return 0.0 (unsafe) on LLM parse failure

### Previously Completed

**Phase 8 -- Knowledge RAG Primitives:**
- Engine primitives: `EmbeddingAdapter`, `VectorStore`, `Chunker`, `Document`, `Chunk` interfaces
- `RecursiveTextChunker` (paragraph -> sentence -> character, configurable overlap, SHA-256 chunk IDs)
- `MarkdownChunker` (heading hierarchy, code block preservation, fallback chunking)
- Infrastructure: `OpenAIEmbeddingAdapter` (fetch-based, retry), `OllamaEmbeddingAdapter` (fetch-based)
- `InMemoryVectorStore` with cosine similarity (for tests/prototyping)
- `RetrievalPipeline` (ingest: chunk -> embed -> store; retrieve: embed -> search -> rerank)
- `Reranker` interface for optional result re-ranking
- `KnowledgeConfig` YAML types + `validateKnowledgeConfig()` with full validation
- `knowledge` block parsing in `app-loader.ts` (optional top-level field in app.yaml)
- `knowledge_search` capability auto-injection (`readOnly`, `idempotent`, `cacheTtl: 60`)
- `isAgentAllowed()` for restricting knowledge access to specific agents

### Previously Completed

**Phase 7 -- Observability (OTel Integration):**
- `SpanMapper`: maps all 29 `KilnEvent` types to OTel span operations
- `OTelExporter`: implements `EventStore` interface, accepts standard `TracerProvider`
- Zero OTel deps in engine primitives; `@opentelemetry/api` as peer dependency

**Phase 6 -- Ehrlich Gaps:**
- Anthropic native `output_config` with `additionalProperties` validation
- ToolCache with SHA-256 keys, per-entry TTL, capability annotations
- `compressContext()` utility for large tool output compression
- `AgentRole` widened from union to `string` (arbitrary custom roles)
- `EventStore` interface + fire-and-forget sink on EventBus

---

## 3. Roadmap

### Phase 7: Observability (OTel Integration) -- COMPLETED

**Why:** Every enterprise prospect asks "can we plug this into Datadog?" Without OTel, the answer is no. Every major competitor (CrewAI, LangGraph, AG2, Mastra) emits OTel spans natively. This is the smallest effort gap with the biggest enterprise unlock.

**Kiln advantage:** We already emit 29 typed events through EventBus. The OTel layer is a thin adapter that maps existing events to standard spans -- not a rewrite. Competitors bolt OTel on as an afterthought; Kiln's typed EventBus makes it clean.

**Where:** `packages/core/src/observability/` (new bounded context)

#### 7.1 OTel Span Mapping

- Define `SpanMapper` that maps `KilnEvent` types to OTel span operations:
  - `phase_changed` -> span start/end for phase lifecycle
  - `tool_called` / `tool_result` -> child span with tool name, duration, success
  - `thinking` -> span event (annotation on parent)
  - `cost_update` -> span attributes (tokens, cost)
  - `worker_assigned` -> child span for worker execution
  - `error` -> span status ERROR + exception event
  - Security events -> span events with `security.*` attribute namespace
  - Trigger events -> span events with `trigger.*` attribute namespace
- All 29 event types get explicit mapping -- no silent drops

#### 7.2 OTel Exporter

- `OTelExporter` class implementing `EventStore` interface (reuse the sink hook from Phase 6)
- Accepts standard `TracerProvider` from `@opentelemetry/api` -- user brings their own backend
- Zero OTel deps in engine primitives: `@opentelemetry/api` is a peer dependency in runtime only
- Automatic context propagation: `traceId` = session ID, `spanId` = generated per event

#### 7.3 YAML Configuration

```yaml
observability:
  enabled: true
  exporter: otlp          # otlp | console | none
  endpoint: http://localhost:4318
  serviceName: my-kiln-app
  attributes:             # custom resource attributes
    environment: production
    team: platform
```

- `observability` is a top-level optional field in `gateway.yaml`
- When omitted, zero overhead -- no OTel code loaded
- `console` exporter for local dev (pretty-prints spans to stdout)

#### 7.4 Dev Inspector Integration

- Extend the existing HTML dev inspector to show a waterfall/timeline view of spans
- Each phase is a row; tool calls are nested children with duration bars
- Reuse SSE connection already in place; add span data to the event stream

---

### Phase 8: Knowledge (RAG Primitives) -- COMPLETED

**Why:** Table-stakes gap. Every orchestration framework except bare-bones SDKs has RAG primitives. Without them, every Kiln user who needs knowledge retrieval builds it outside the framework. Mastra has the most complete TypeScript RAG system; we study it but build cleaner.

**Kiln advantage:** YAML-configured knowledge sources. Competitors require code to set up RAG pipelines. Kiln lets you declare knowledge sources in `app.yaml` and the engine wires chunking, embedding, and retrieval automatically. One YAML block replaces 50+ lines of Mastra/LangChain code.

**Where:** `packages/core/src/knowledge/` (new bounded context)

#### 8.1 Engine Primitives

- `EmbeddingAdapter` interface in `engine/domain/embedding.ts`:
  - `embed(texts: string[]): Promise<number[][]>`
  - `dimensions: number`
  - Provider-agnostic, same pattern as `ProviderAdapter`
- `VectorStore` interface in `engine/domain/vector-store.ts`:
  - `upsert(entries: VectorEntry[]): Promise<void>`
  - `query(embedding: number[], options: QueryOptions): Promise<VectorResult[]>`
  - `delete(ids: string[]): Promise<void>`
  - `QueryOptions`: `topK`, `minScore`, `filter` (metadata key-value)
- `Chunk` type: `{ id, content, metadata, embedding? }`
- `Chunker` interface: `chunk(document: Document): Chunk[]`
  - Document = `{ content: string; metadata: Record<string, unknown> }`

#### 8.2 Infrastructure Implementations

- **Embedding adapters:**
  - `OpenAIEmbeddingAdapter` (text-embedding-3-small/large)
  - `OllamaEmbeddingAdapter` (nomic-embed-text, local)
  - Adapters live in `knowledge/infrastructure/`, same isolation as provider adapters
- **Vector stores:**
  - `PgVectorStore` (pgvector extension -- aligns with PostgreSQL in the stack)
  - `SqliteVecStore` (sqlite-vec -- zero-dep local option, matches existing SQLite memory)
  - `InMemoryVectorStore` (for tests and prototyping)
- **Chunkers:**
  - `RecursiveTextChunker` (split by paragraph -> sentence -> character, configurable overlap)
  - `MarkdownChunker` (split by heading hierarchy, preserve structure)
  - Configurable `chunkSize` and `chunkOverlap`

#### 8.3 Retrieval Pipeline

- `RetrievalPipeline` class: `ingest(documents) -> chunk -> embed -> store` and `retrieve(query) -> embed -> search -> rerank -> return`
- Optional `Reranker` interface: `rerank(query: string, results: VectorResult[]): VectorResult[]`
  - LLM-based reranker implementation using existing `ProviderAdapter`
  - Cross-encoder reranker (Cohere) as optional adapter
- Hybrid search: combine FTS5 keyword results (existing memory) + vector similarity, merge by reciprocal rank fusion (RRF)

#### 8.4 YAML Configuration

```yaml
knowledge:
  embedding:
    provider: openai
    model: text-embedding-3-small
  store:
    backend: pgvector       # pgvector | sqlite-vec | memory
    connectionString: ${VECTOR_DB_URL}
  chunking:
    strategy: recursive      # recursive | markdown
    chunkSize: 512
    chunkOverlap: 50
  sources:
    - name: docs
      path: ./knowledge/docs/
      watch: true            # hot-reload on file changes (dev mode)
    - name: api-specs
      path: ./knowledge/openapi/
      chunking:
        strategy: markdown
```

- `knowledge` is a top-level optional field in `app.yaml`
- Sources are auto-ingested on startup, re-ingested on changes in dev mode
- Agents access knowledge via a built-in `knowledge_search` capability injected automatically when `knowledge` is configured
- The capability has a `cacheTtl` annotation (reuse Phase 6 ToolCache)

#### 8.5 Knowledge Capability Auto-Injection

- When `knowledge` is configured in YAML, the engine auto-registers a `knowledge_search` capability:
  - Input schema: `{ query: string, source?: string, topK?: number }`
  - Output: `{ results: { content: string, score: number, metadata: object }[] }`
- Agents don't need to reference it in `tools:` -- it's available to all agents in the app by default
- Can be restricted to specific agents via `knowledge.allowedAgents: [agentName]`

---

### Phase 9: Multimodal Support

**Why:** Voice agents and vision are no longer niche. Google ADK and OpenAI Agents SDK have real-time audio. Vercel AI SDK has unified speech. Not having multimodal types means Kiln can't orchestrate any non-text workflow.

**Kiln advantage:** Multimodal declared in YAML channel config, not code. An agent configured with `modalities: [text, image, audio]` automatically gets the right message types routed to it. Competitors require code to wire multimodal inputs.

**Where:** `packages/core/src/engine/domain/` (extend existing primitives), `packages/runtime/src/channels/` (new adapters)

#### 9.1 Message Content Parts

- Replace `content: string` in `AgentMessage` with `content: string | ContentPart[]`
- `ContentPart` union type:
  - `TextPart: { type: "text", text: string }`
  - `ImagePart: { type: "image", source: ImageSource }` where `ImageSource` = `{ type: "url", url: string } | { type: "base64", mediaType: string, data: string }`
  - `AudioPart: { type: "audio", source: AudioSource }` where `AudioSource` = `{ type: "url", url: string } | { type: "base64", mediaType: string, data: string }`
  - `FilePart: { type: "file", name: string, mimeType: string, data: string | Buffer }`
- Provider adapters map `ContentPart[]` to their native format:
  - Anthropic: `content: [{ type: "image", source: { type: "base64", ... } }]`
  - OpenAI: `content: [{ type: "image_url", image_url: { url: "data:..." } }]`
  - Ollama: `images: [base64String]`

#### 9.2 Channel Multimodal Support

- `Channel` interface gains `supportedModalities: readonly Modality[]` (text, image, audio, file)
- Channel router validates modality compatibility before routing messages
- WhatsApp channel: image/audio/document support via Business API media endpoints
- Slack channel: file upload via `files.upload` API
- Web channel: binary WebSocket frames for audio/image
- API channel: multipart/form-data support for file uploads

#### 9.3 Agent Modality Declaration

```yaml
teams:
  analysis:
    agents:
      vision-analyst:
        name: Iris
        role: Visual Analysis Specialist
        goal: Analyze images and documents
        tier: reasoning
        modalities: [text, image]    # new field
        tools: [extract_text, describe_image]
```

- `modalities` is optional, defaults to `[text]`
- Router validates that incoming message modalities match agent capabilities
- Mismatched modalities get a clear error event, not a silent failure

#### 9.4 Voice Channel (Stretch)

- `VoiceChannel` adapter for WebRTC/WebSocket real-time audio
- Speech-to-text on input (Whisper/Deepgram adapter)
- Text-to-speech on output (ElevenLabs/OpenAI TTS adapter)
- `SpeechAdapter` interface: `transcribe(audio) -> text`, `synthesize(text) -> audio`
- YAML config:

```yaml
channels:
  - type: voice
    stt:
      provider: deepgram
      model: nova-2
    tts:
      provider: elevenlabs
      voice: rachel
```

---

### Phase 10: Evaluation Framework -- COMPLETED

**Why:** Without evals, users can't answer "is my agent getting better or worse?" This separates prototype tools from production platforms. Mastra has the most complete TypeScript eval system (scorers, datasets, experiments). LangSmith has the best workflow (trace -> dataset -> eval -> compare). We take the best of both.

**Kiln advantage:** YAML-declared evaluation pipelines. Competitors require code to define scorers and wire datasets. Kiln lets you declare eval suites in YAML alongside your app config, run them with `kiln eval`, and compare results in the dev inspector.

**Where:** `packages/core/src/eval/` (new bounded context), `packages/cli/src/commands/eval.ts` (CLI command)

#### 10.1 Core Interfaces

- `Scorer` interface:
  - `name: string`
  - `score(input: EvalInput): Promise<EvalScore>`
  - `EvalInput`: `{ input: string, output: string, expected?: string, context?: string[] }`
  - `EvalScore`: `{ name: string, score: number, reasoning?: string }`
- `Dataset` interface:
  - `name: string`
  - `items: DatasetItem[]`
  - `DatasetItem`: `{ id: string, input: string, expected?: string, context?: string[], metadata?: Record<string, unknown> }`
  - Stored as JSONL files in `.kiln/eval/datasets/`
- `Experiment` interface:
  - `name: string`
  - `datasetName: string`
  - `scorers: string[]`
  - `config: Record<string, unknown>` (agent config overrides for this experiment)
  - `results: ExperimentResult[]`
  - `ExperimentResult`: `{ itemId: string, output: string, scores: EvalScore[], durationMs: number, tokenUsage: TokenUsage }`

#### 10.2 Built-in Scorers

- **Rule-based (zero LLM cost):**
  - `ExactMatchScorer` -- binary match against expected
  - `ContainsScorer` -- checks if output contains required substrings
  - `JsonValidityScorer` -- validates output is parseable JSON + optional schema check
  - `LengthScorer` -- penalizes too-short or too-long responses
  - `LatencyScorer` -- scores based on response time thresholds
  - `CostScorer` -- scores based on token cost thresholds
- **LLM-as-judge (uses fast-tier provider):**
  - `FaithfulnessScorer` -- does the output stay faithful to provided context?
  - `RelevanceScorer` -- is the output relevant to the input?
  - `CoherenceScorer` -- is the output internally consistent and well-structured?
  - `HallucinationScorer` -- does the output contain claims not in the context?
  - `ToxicityScorer` -- does the output contain harmful content?
  - `CustomPromptScorer` -- user-defined evaluation prompt in YAML

#### 10.3 YAML Configuration

```yaml
# eval.yaml (separate file, referenced from app.yaml)
datasets:
  - name: customer-support-v1
    path: ./eval/datasets/support.jsonl

scorers:
  - name: quality-check
    type: composite
    scorers:
      - type: relevance
      - type: faithfulness
      - type: json-validity
        schema: { $ref: "./schemas/response.json" }
      - type: custom-prompt
        prompt: |
          Rate 0-1 whether this response follows our brand voice guidelines.
          Response: {{output}}

experiments:
  - name: baseline-v1
    dataset: customer-support-v1
    team: support              # which team to run
    scorers: [quality-check]
  - name: improved-prompt-v2
    dataset: customer-support-v1
    team: support
    overrides:                 # override agent config for this experiment
      agents:
        support-agent:
          instructions: "Updated instructions here..."
    scorers: [quality-check]
    compare: baseline-v1       # auto-compare against this experiment
```

#### 10.4 CLI Command

- `kiln eval run <experiment>` -- run an experiment, output results to `.kiln/eval/results/`
- `kiln eval compare <exp1> <exp2>` -- side-by-side score comparison with statistical significance
- `kiln eval list` -- list datasets, scorers, experiments
- `kiln eval dataset add <file>` -- add items to a dataset from a JSONL file
- Results stored as JSONL in `.kiln/eval/results/<experiment>/<timestamp>.jsonl`

#### 10.5 Dev Inspector Integration

- New `/dev/eval` route showing experiment results
- Score distribution charts per scorer
- Side-by-side comparison view for two experiments
- Drill-down into individual dataset items with input/output/scores

---

### Phase 11: Interoperability (A2A + Dynamic MCP)

**Why:** A2A (Agent-to-Agent protocol, Linux Foundation, 50+ partners) is becoming the standard for inter-agent communication. Without it, Kiln agents are invisible to the ecosystem. Dynamic MCP connection is table-stakes -- OpenAI and Vercel already auto-discover tools from live MCP servers.

**Kiln advantage:** A2A is just YAML. Competitors require code to publish Agent Cards and wire A2A endpoints. Kiln auto-generates the Agent Card from `app.yaml` and exposes A2A-compliant endpoints on the gateway with zero code. Cross-app delegation (already built) becomes A2A-native with a protocol swap.

**Where:** `packages/runtime/src/a2a/` (new bounded context), `packages/core/src/agents/mcp-client.ts` (new)

#### 11.1 A2A Agent Card Generation

- Auto-generate `/.well-known/agent.json` from `app.yaml`:
  - `name` from app name
  - `description` from app description (new optional YAML field)
  - `capabilities` from team capabilities (schema, tags, annotations)
  - `inputModes` / `outputModes` from channel modalities
  - `authentication` from gateway security config
- Agent Card served as a static JSON endpoint on the gateway
- Refreshed on YAML hot-reload in dev mode

#### 11.2 A2A Server Endpoints

- JSON-RPC 2.0 over HTTP + SSE (A2A spec compliant):
  - `tasks/send` -- receive a task from an external agent
  - `tasks/sendSubscribe` -- receive + stream progress via SSE
  - `tasks/get` -- query task status
  - `tasks/cancel` -- cancel a running task
- Map A2A tasks to Kiln's existing Router -> Team -> Orchestrator flow
- A2A task status maps to Kiln phase events
- A2A artifacts map to Kiln task evidence

#### 11.3 A2A Client (Outbound Delegation)

- Refactor `delegation-handler.ts` to support both Kiln-native and A2A protocols
- `A2AClient`: discover remote agent via Agent Card URL, send tasks, stream results
- Delegation capability `type: "a2a"` in YAML:

```yaml
capabilities:
  - name: external-research
    type: a2a
    agentUrl: https://research-agent.example.com
    task: "Research the following topic"
    timeout: 300
```

- Falls back to Kiln-native delegation for internal cross-app calls (no overhead)

#### 11.4 Dynamic MCP Server Connection

- `McpClient` class: connect to any MCP server via SSE or stdio at runtime
- Auto-discover tools from the server's `tools/list` response
- Register discovered tools as Kiln `Capability` objects with proper annotations
- YAML config:

```yaml
mcp:
  servers:
    - name: github
      transport: sse
      url: http://localhost:3100/sse
    - name: filesystem
      transport: stdio
      command: npx
      args: ["@anthropic/mcp-server-filesystem", "./workspace"]
```

- Tools from MCP servers merge with YAML-defined capabilities
- MCP annotation mapping: `readOnlyHint` -> `readOnly`, `destructiveHint` -> `destructive`, `idempotentHint` -> `idempotent` (already aligned)
- Auto-reconnect with circuit breaker on SSE transport failures

#### 11.5 Tool RAG (Large Tool Set Optimization)

- When total tools exceed a configurable threshold (default: 30), enable Tool RAG:
  - Embed tool descriptions using the configured embedding adapter (from Phase 8)
  - On each LLM call, retrieve top-K relevant tools based on the current message
  - Inject only relevant tools into the provider call, not all
- YAML config:

```yaml
toolSelection:
  strategy: rag             # all | rag
  maxTools: 15              # max tools per LLM call
  threshold: 30             # enable RAG when total tools exceed this
```

---

### Phase 12: Enterprise Safety (PII + Content Policy)

**Why:** Prompt injection detection is necessary but not sufficient. Enterprise and regulated industries require PII detection, data loss prevention, and content policy enforcement. Without PII handling, Kiln is blocked from healthcare, finance, and government deployments.

**Kiln advantage:** YAML-declared safety policies. Competitors require code to wire PII detectors and content filters. Kiln lets you declare a `safety` block and the engine applies it as middleware on all channel I/O.

**Where:** `packages/core/src/security/` (extend existing bounded context)

#### 12.1 PII Detection

- `PiiScanner` class in `security/pii-scanner.ts`:
  - Regex-based detection for: emails, phone numbers, SSNs, credit cards, IP addresses, dates of birth
  - Named entity detection for: person names, addresses, organization names (optional LLM-based tier)
  - Configurable actions per PII type: `detect` (log only), `redact` (mask with `[REDACTED]`), `block` (reject message)
- Applied as middleware on both input (from channel) and output (to channel)
- Event: `pii_detected` with type, action taken, and position

#### 12.2 Content Classification

- `ContentClassifier` class in `security/content-classifier.ts`:
  - Categories: hate, violence, sexual, self-harm, harassment, misinformation
  - Two-tier: regex heuristics (fast, zero cost) + LLM-based deep scan (configurable)
  - Returns confidence scores per category
  - Configurable thresholds and actions per category
- Reuses the existing 2-tier pattern from `PromptScanner`

#### 12.3 Content Policy Rails

- `PolicyRail` interface: `evaluate(message, context) -> PolicyResult`
- `PolicyResult`: `{ allowed: boolean, reason?: string, suggestion?: string }`
- Built-in rails:
  - `TopicRail` -- block/allow specific topics (keyword + semantic matching)
  - `CompetitorRail` -- prevent discussing competitor products
  - `EscalationRail` -- auto-escalate sensitive topics to human agents
  - `ComplianceRail` -- enforce regulatory language requirements
- Custom rails via YAML:

```yaml
safety:
  pii:
    detect: [email, phone, ssn, credit_card]
    action: redact                 # detect | redact | block
    allowlist: ["support@company.com"]
  content:
    enabled: true
    categories:
      hate: { threshold: 0.7, action: block }
      violence: { threshold: 0.8, action: block }
    deepScan: false                # LLM-based scan (costs tokens)
  rails:
    - type: topic
      block: [medical_advice, legal_advice]
      escalate: [billing_dispute, account_deletion]
    - type: competitor
      competitors: [CompetitorA, CompetitorB]
      response: "I can only discuss our products."
```

#### 12.4 Audit Integration

- All PII detections, content classifications, and policy rail evaluations logged to existing audit log
- New event types: `pii_detected`, `content_classified`, `policy_evaluated`
- Dashboard in dev inspector showing safety metrics

---

### Phase 13: Developer Experience (Studio + Frontend SDK)

**Why:** A CLI-only interface limits adoption. LangGraph Studio and Mastra Studio prove that a visual dev tool dramatically accelerates agent development. A frontend SDK is required for any team building a web app on top of Kiln.

**Kiln advantage:** Studio generates valid YAML -- not a separate proprietary format. What you build visually is the same `app.yaml` you'd write by hand. No lock-in, no abstraction gap. The frontend SDK provides typed React hooks that consume Kiln's SSE streams with zero configuration.

**Where:** `packages/studio/` (new package), `packages/sdk/` (new package)

#### 13.1 Kiln Studio (Web UI)

- Self-contained SPA served from the gateway at `/studio` in dev mode
- **Workflow graph view:** visual rendering of teams -> agents -> capabilities -> phases
  - Read from `app.yaml`, render as interactive graph
  - Click a node to inspect/edit its YAML fields
  - Changes write back to `app.yaml` (round-trip fidelity)
- **Agent playground:** browser-based chat UI for testing agents
  - Select an app, team, and agent
  - Send messages, see streaming responses
  - View thinking, tool calls, and cost in real-time
  - Switch between agents mid-conversation
- **Timeline view:** waterfall visualization of phase execution
  - OTel spans rendered as horizontal bars (reuse Phase 7)
  - Drill into individual tool calls with input/output/duration
  - Time-travel: click a past event to inspect state at that point
- **Memory inspector:** browse all 5 memory scopes
  - Search, filter by tags, view decay scores
  - Manual add/edit/delete for debugging
- **Eval dashboard:** experiment results from Phase 10
  - Score distribution charts
  - A/B comparison between experiments
  - Drill into individual items

#### 13.2 Frontend SDK (`@kilnai/react`)

- `useKilnChat(options)` hook:
  - Connects to Kiln API channel via SSE
  - Returns `{ messages, sendMessage, isLoading, error, cost, phase }`
  - Auto-reconnects with exponential backoff
  - Typed message history with `ContentPart[]` support (multimodal)
- `useKilnEvents(options)` hook:
  - Subscribe to specific event types from the EventBus SSE stream
  - Typed event payloads matching `EventMap`
- `KilnProvider` context provider:
  - Configures base URL, auth token, app name
  - Wraps children with connection state
- **Zero dependencies** beyond React 19+ peer dep
- Published as `@kilnai/react` (or `@alloyai/react` post-rebrand)

#### 13.3 Agent Playground CLI Upgrade

- `kiln dev` already starts gateway + dev inspector
- Add `--playground` flag: opens browser to `/studio` automatically
- Hot-reload: YAML changes reflect in Studio graph view instantly (reuse existing `YamlWatcher`)

---

### Phase 14: Deployment & Scaling

**Why:** Kiln requires operators to provision everything themselves. Competitors offer managed runtimes (Bedrock AgentCore), serverless deployment (Vercel), and horizontal scaling out of the box. For production multi-tenant workloads, this is a significant ops gap.

**Kiln advantage:** Deployment is YAML-configured. A single `deploy.yaml` declares the target (Docker, K8s, serverless), scaling policy, and health checks. `kiln deploy` generates the deployment artifacts. No vendor lock-in -- it generates standard Dockerfiles, Helm charts, and Terraform modules that work anywhere.

**Where:** `packages/cli/src/commands/deploy.ts` (new), `packages/runtime/src/gateway/` (scaling extensions)

#### 14.1 Containerization

- `Dockerfile` generator: `kiln deploy docker`
  - Multi-stage build: Bun install + typecheck + prune dev deps
  - Health check endpoint already exists (`/health`)
  - Configurable base image, exposed port, environment variables
  - `.dockerignore` auto-generated
- `docker-compose.yaml` generator for local multi-service testing:
  - Kiln gateway + PostgreSQL (for EventStore / VectorStore) + Redis (for sessions)

#### 14.2 Kubernetes / Helm

- Helm chart generator: `kiln deploy helm`
  - Deployment, Service, Ingress, ConfigMap (from gateway.yaml), Secret refs
  - HPA (Horizontal Pod Autoscaler) with custom metrics:
    - Active sessions count
    - Request latency p99
    - Token throughput
  - Readiness/liveness probes using existing `/health` endpoint
  - PodDisruptionBudget for zero-downtime deployments

#### 14.3 Stateless Gateway Mode

- Session state externalized to Redis (or PostgreSQL):
  - `SessionRegistry` backed by Redis instead of in-memory Map
  - Checkpoint store backed by PostgreSQL
  - EventStore (from Phase 6) backed by PostgreSQL
- Multiple gateway instances behind a load balancer, any instance handles any session
- YAML config:

```yaml
# gateway.yaml
scaling:
  mode: stateless            # standalone | stateless
  sessions:
    backend: redis
    url: ${REDIS_URL}
  checkpoints:
    backend: postgres
    url: ${CHECKPOINT_DB_URL}
  events:
    backend: postgres
    url: ${EVENT_DB_URL}
```

#### 14.4 Back-Pressure and Concurrency

- Configurable max concurrent sessions per gateway instance
- Request queue with priority (tenant tier-based)
- Graceful degradation: when at capacity, return `503 Service Unavailable` with `Retry-After` header
- Circuit breaker on provider calls already exists; extend to session-level

#### 14.5 Serverless Adapter (Stretch)

- `KilnHandler` export for serverless runtimes:
  - AWS Lambda (via Bun layer)
  - Cloudflare Workers (via Bun compatibility)
  - Vercel Edge Functions
- Stateless by design (requires external session/checkpoint store from 14.3)
- Each invocation handles one message, not a long-running gateway

---

### Phase 15: Durable Execution

**Why:** Kiln's checkpoint/resume works but lacks saga patterns, cross-process durability, and deterministic replay. For workflows that execute side effects (send email, create ticket, charge payment), there's no compensation mechanism when later phases fail.

**Kiln advantage:** Durable execution declared in YAML workflow config. Competitors require code to define compensating transactions. Kiln lets you declare `compensate` handlers per phase in YAML, and the engine automatically rolls back on failure.

**Where:** `packages/core/src/orchestrator/` (extend existing)

#### 15.1 Compensation Handlers

- Each phase in a workflow can declare a `compensate` action:

```yaml
teams:
  booking:
    workflow:
      phases:
        - name: reserve
          compensate:
            capability: cancel_reservation
            args: { reservationId: "{{phase.reserve.output.id}}" }
        - name: charge
          compensate:
            capability: refund_payment
            args: { paymentId: "{{phase.charge.output.id}}" }
        - name: confirm
```

- If `charge` fails, the engine automatically invokes `cancel_reservation` with the output from the `reserve` phase
- Compensation runs in reverse order (last successful phase first)
- Compensation failures are logged and alerted but don't block other compensations

#### 15.2 Cross-Process Durability

- Checkpoint store backed by PostgreSQL (from Phase 14.3)
- Write-ahead: checkpoint is flushed before each phase transition, not after
- If the process crashes mid-phase, the next instance picks up from the last committed checkpoint
- Idempotency keys on side-effect capabilities prevent double execution on resume

#### 15.3 Deterministic Replay

- All non-deterministic inputs (timestamps, random IDs, external API responses) are logged in the checkpoint
- Replay mode uses logged values instead of live calls
- Enables debugging: replay a production failure locally with the exact same inputs
- `kiln replay <checkpointId>` CLI command with `--deterministic` flag

#### 15.4 Long-Running Workflow Support

- Workflows can span hours/days (not limited to HTTP request lifecycle)
- Heartbeat mechanism: gateway pings checkpoint store periodically to signal liveness
- Dead session detection: if heartbeat stops, another instance can claim and resume the session
- Maximum workflow duration configurable per app in YAML

---

## 4. Design Principles

### Simplicity vs. Robustness: Both, Layered

Kiln is simple by default (YAML config, sensible defaults, minimal setup) but robust when configured (checkpointing, security layers, audit logging). Every advanced feature is opt-in via YAML flags. A minimal app.yaml with one agent and one team works out of the box. Production deployments enable Guardian review, prompt injection scanning, encrypted secrets, and audit logging by adding a few YAML fields.

### Multi-Agent Model: Supervisor + Swarm, YAML-Configured

Both supervisor and swarm patterns are supported and configured via a single `mode` field on the Team composite. Supervisor mode requires a `manager` agent that receives all tasks, delegates to workers by name, and validates results. Swarm mode lets agents hand control to each other via a `handoff` capability without a central coordinator. Sequential mode (the default) chains agents in workflow order.

### Memory: Scoped Stores + Decay + Compaction

Five memory scopes (user, agent, team, project, org) are backed by SQLite + FTS5 with configurable exponential decay curves. When a store exceeds a configurable threshold, auto-compaction summarizes older entries into compressed form and archives originals. Git-synced project and org scopes use gzipped JSONL for cross-developer sharing.

### Security: Defense-in-Depth, All Opt-In

Six security layers are available: 2-tier prompt injection detection (regex heuristics + deep LLM scan), Guardian review for destructive capabilities, AES-256-GCM encrypted secrets with PBKDF2 key derivation, append-only JSONL audit logging with SHA-256 hash chaining, tenant isolation enforcement (memory namespace + FS jail), and periodic self-audit health checks. Every layer is opt-in to maintain simplicity for local development.

### YAML Is The Source of Truth

Every feature in every phase follows the same rule: **if it can be configured, it's configured in YAML**. Code implements engine behavior; YAML declares user intent. The YAML schema is the public API. This is Kiln's core differentiator and it must never be compromised. A DevOps engineer who cannot write TypeScript can still configure, deploy, and operate a Kiln-powered AI application by editing YAML files.

---

## 5. Phase Dependencies

```
Phase 7 (OTel)              -- COMPLETED
Phase 8 (Knowledge/RAG)     -- COMPLETED
Phase 9 (Multimodal)        -- standalone, no deps
Phase 10 (Eval)             -- COMPLETED
Phase 11 (A2A + MCP)        -- benefits from Phase 8 (Tool RAG needs embeddings)
Phase 12 (Safety)           -- standalone, extends existing security context
Phase 13 (Studio + SDK)     -- benefits from Phase 7 (timeline), Phase 10 (eval dashboard)
Phase 14 (Deploy + Scale)   -- standalone, but Phase 15 depends on it
Phase 15 (Durable)          -- requires Phase 14.3 (stateless gateway / external stores)
```

### Recommended Execution Order

1. ~~**Phase 7** (OTel) -- COMPLETED~~
2. ~~**Phase 8** (Knowledge/RAG) -- COMPLETED~~
3. ~~**Phase 10** (Eval) -- COMPLETED~~
4. **Phase 11** (A2A + Dynamic MCP) -- ecosystem interop before it's too late
5. **Phase 9** (Multimodal) -- growing demand, unlocks voice/vision agents
6. **Phase 12** (Safety) -- enterprise blocker for regulated industries
7. **Phase 14** (Deploy) -- ops maturity for production users
8. **Phase 13** (Studio + SDK) -- DX acceleration, adoption driver
9. **Phase 15** (Durable) -- advanced production resilience
