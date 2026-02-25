# FAQ

**What is the difference between Mode A and Mode B?**

Mode A runs phase-gated agentic workflows via a Claude Code subprocess -- it has a phase machine, checkpointing, interrupt/resume, and supports one active session per task. Mode B calls provider adapters directly for conversational, multi-user apps -- it supports concurrent sessions, budget enforcement, and tier-based access control, but has no phase machine. Both modes can run in the same Gateway process on different Apps. See [Core Concepts](concepts.md) for a comparison table.

---

**How do I add a new LLM provider?**

Implement the `ProviderAdapter` interface in `packages/core/src/agents/infrastructure/` following the pattern of the existing adapters (Anthropic, OpenAI, DeepSeek, Ollama). Register it in the `ProviderRegistry`. Four adapters ship by default; for Mode B apps, set `provider.name` in `app.yaml` to the registered name and set `provider.apiKeyEnv` to the env var holding the key.

---

**Can I use Kiln without YAML?**

No. The YAML configuration is the required entry point -- the engine is designed around YAML-first configuration. You can generate YAML programmatically and pass the string to `parseAppYaml()`, but there is no code-only API for constructing an App. If you need to write YAML from code, use string template literals and validate the result with `validateApp()`.

---

**How does multi-tenant isolation work?**

Each App loaded by the Gateway receives its own memory namespace (`~/.kiln/gateway/{appName}/`), a separate `SessionRegistry` keyed by `{appName}:{userId}`, its own `ProviderAdapter` and `ModeBOrchestrator` instances, and a separate `ChannelRegistry`. A message arriving on one App's channel cannot reach another App. Cross-App communication is explicit and typed via `type: delegation` capabilities. See [Multi-Tenant](guides/multi-tenant.md) for deployment details.

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

**How does memory decay work?**

Agent-scoped memory stores (`agent:{role}`) apply a decay function that reduces the relevance score of entries over time, so older memories are ranked lower in recall results but not deleted. Three curve types are supported: `exponential` (fast drop-off, good for ephemeral patterns), `linear` (steady reduction), and `step` (full relevance until a hard cutoff). When a store exceeds a configured size threshold, `MemoryCompactor` summarizes older entries into compressed form and archives the originals. Configure decay and compaction thresholds in the memory backend options. See [Memory](guides/memory.md) for configuration details.
