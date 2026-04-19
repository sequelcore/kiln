# FAQ

**What is the difference between Mode A and Mode B?**

Mode A runs phase-gated agentic workflows via a Claude Code subprocess -- it has a phase machine, checkpointing, interrupt/resume, and supports one active session per task. Mode B calls provider adapters directly for conversational, multi-user apps -- it supports concurrent sessions, budget enforcement, and tier-based access control, but has no phase machine. Both modes can run in the same Gateway process on different Apps. See [Core Concepts](concepts.md) for a comparison table.

---

**How do I add a new LLM provider?**

Implement the `ProviderAdapter` interface in `packages/core/src/agents/infrastructure/` following the pattern of the existing adapters (Anthropic, OpenAI, DeepSeek, OpenRouter, Ollama). Register it in the `ProviderRegistry`. Five adapters ship by default; for Mode B apps, set `provider.name` in `app.yaml` to the registered name and set `provider.apiKeyEnv` to the env var holding the key.

---

**Can I use Kiln without YAML?**

No. The YAML configuration is the required entry point -- the engine is designed around YAML-first configuration. You can generate YAML programmatically and pass the string to `parseAppYaml()`, but there is no code-only API for constructing an App. If you need to write YAML from code, use string template literals and validate the result with `validateApp()`.

---

**How does multi-tenant isolation work?**

Each App loaded by the Gateway receives its own memory namespace (`~/.kiln/gateway/{appName}/`), a separate `SessionRegistry` keyed by `{appName}:{userId}`, its own `ProviderAdapter` and `RuntimeSessionOrchestrator` instances, and a separate `ChannelRegistry`. A message arriving on one App's channel cannot reach another App. Cross-App communication is explicit and typed via `type: delegation` capabilities. See [Multi-Tenant](guides/multi-tenant.md) for deployment details.

---

**What is the difference between capabilities and quality gates?**

Capabilities are MCP tools that agents invoke during a session to accomplish work (save memory, call an API, run a command). Quality gates are shell commands that the verification loop runs at phase transitions to validate the output of that work (tests, lint, typecheck). Capabilities are declared per team and referenced in agent `tools` arrays. Quality gates are declared per team and referenced in `workflow.gates[phase].requires`.

---

**How do I test my app configuration?**

Use `parseAppYaml()` and `validateApp()` from `@kilnai/core` in a Vitest test. Parse the YAML file, check that `validateAppGraph()` returns null, and assert that `validateApp()` does not throw. This catches all cross-reference errors (missing capabilities, bad gate phases, invalid router fallback) before you run the server. See [Getting Started](getting-started.md) for a complete test example.

---

**Why Bun instead of Node.js?**

Bun provides the runtime, package manager, test runner, and bundler in one binary with startup times roughly 4x faster than Node.js. The Gateway uses `Bun.serve()` for the HTTP server and `bun:sqlite` for the memory store. Node.js 20+ is still required if you use MCP tools that spawn Node.js subprocesses, but the Kiln process itself requires Bun 1.1+.

---

**What happens if the budget endpoint is down?**

Budget middleware is fail-open by design. Any network error or non-2xx response from the budget or usage endpoints is silently swallowed and the request proceeds normally. Users are never blocked by a billing service outage. See [Gateway Configuration](configuration/gateway-yaml.md) for the full billing block reference.

---

**Can I use Kiln with Python models?**

Yes, via the Ollama adapter. Configure Ollama to serve a Python-compatible model locally, set `provider.name: ollama` and `provider.model` to the Ollama model name in your `app.yaml`. No API key is required. For cloud-hosted Python models with an OpenAI-compatible API, use the `openai` adapter and point `provider.baseUrl` to the endpoint.

---

**How do I add a custom channel?**

Implement the `Channel` interface from `packages/core/src/engine/domain/channel.ts` in `packages/runtime/src/channels/`. Your implementation must provide `name`, `defaultFormat`, `supportedModalities`, `receive()`, `send()`, and `stream()`. Register it in `ChannelRegistry`. The `stream()` method should consume the `AsyncIterable<EngineEvent>` provided by `EventBridge`. See [Channels](guides/channels.md) for the existing adapter implementations as reference.

---

**What is the difference between domains and skills?**

Domains describe a technology context -- detection patterns, quality gates, few-shot examples -- and are merged automatically when a project matches multiple domains. Skills are reusable YAML-configured behavior packages (tools, triggers, instructions) that can be installed from the registry and composed into any App. Domains answer "what is this project?"; skills answer "what can this app do?". See [Domains](guides/domains.md) for domain kits and detection. The `kiln skill list|install|publish` commands manage skills.

---

**How does human handoff work in Mode B?**

Mode B sessions have a `sessionMode` state machine with four states: `ai_active` (default), `queued`, `human_active`, and `resolved`. When escalation is detected (keywords like "talk to agent" or conversational loop detection), the session transitions to `queued` and an `ESCALATION_DETECTED` event is emitted. A human operator can then claim the session via `POST /handoff`, send messages via `POST /operator-message`, and release back to AI via `POST /release`. Resolved sessions auto-reopen to `ai_active` on the next user message. All handoff routes require Bearer authentication. See [Gateway YAML Reference](configuration/gateway-yaml.md#session--handoff) for the full API.

---

**What happens if two requests modify the same session simultaneously?**

`SessionRegistry.save()` uses optimistic concurrency control. Each session tracks a `version` counter that increments on every mutation. When saving, the stored version is compared to the session's `loadedVersion` (set when the session was loaded). If they differ, `CONCURRENT_SESSION_MODIFICATION` is thrown (retryable). This is critical for Redis-backed stores where each `get()` returns a new deserialized object. For the in-memory store, same-reference sessions bypass the version check since mutations are immediately visible.

---

**How does model routing work?**

Model routing selects which LLM handles each request based on message complexity and tenant-defined rules. The `ComplexityScorer` evaluates 5 signals (message length, tool count, conversation depth, structured output, modality) in under 1ms. The `RulesRouter` matches 7 condition types (keyword, regex, cost/latency thresholds, capability requirements, model preference, fallback) in priority order. When no rule matches, the tenant's `defaultModel` is used. The system is fail-open: if routing fails, the default model handles the request. See [Model Routing](guides/model-routing.md) for configuration.

---

**What is conversation enrichment?**

After a conversation ends (session resolved or expired), the enrichment pipeline extracts analytics. A rule-based `computeEffortScore()` (0-10 scale, zero LLM cost) evaluates turn count, escalations, handoffs, and repeat questions. An optional LLM call extracts sentiment, resolution status, predicted CSAT, and topic tags (PII is stripped first). Results are stored in SQLite and accessible via admin API at `/enrichment`. Conversations under 3 user turns skip LLM enrichment. See [Enrichment](guides/enrichment.md) for details.

---

**How do I expose Prometheus metrics?**

Add a `PrometheusCollector` to your gateway's `EventStore` sinks. The collector tracks counters (messages, tool calls, errors, routing decisions) and histograms (latency, token usage). Metrics are served at `GET /metrics` in Prometheus text exposition format. Tenant IDs are excluded from labels to prevent cardinality explosion. Requires `prom-client` as an optional peer dependency (dynamically imported). See [Observability](guides/observability.md) for setup.

---

**How does cost tracking work?**

The `CostTracker` records token usage keyed by `role:model` tuple (e.g., `assistant:claude-haiku-4-5`). It tracks input tokens, output tokens, and cache reads/writes per model. Embedding costs (`recordEmbedding()`) and STT costs (`recordStt()`) are tracked separately. A `COST_REPORT` event is emitted per session with the full `CostSummary` including `byRoleModel` breakdown.

---

**How does memory decay work?**

Agent-scoped memory stores (`agent:{role}`) apply a decay function that reduces the relevance score of entries over time, so older memories are ranked lower in recall results but not deleted. Three curve types are supported: `exponential` (fast drop-off, good for ephemeral patterns), `linear` (steady reduction), and `step` (full relevance until a hard cutoff). When a store exceeds a configured size threshold, `MemoryCompactor` summarizes older entries into compressed form and archives the originals. Configure decay and compaction thresholds in the memory backend options. See [Memory](guides/memory.md) for configuration details.
