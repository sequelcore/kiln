# Phase 5 Agentic Actions (Tool Use) -- Research Synthesis

**Date:** 2026-03-07
**Scope:** Exhaustive research across 6 domains via parallel swarm agents, 300+ sources, covering production architectures, academic research, competitive intelligence, safety frameworks, protocol standards, and theoretical frontiers.
**Purpose:** Inform architectural decisions for Kiln's tool execution engine -- the module that transforms agents from "answers questions" to "does things."

---

## Table of Contents

1. [Executive Summary: The 15 Decisions](#1-executive-summary)
2. [Tool Execution Loop Architecture](#2-tool-execution-loop-architecture)
3. [MCP Protocol -- State of the Art](#3-mcp-protocol)
4. [Production Safety and Guardrails](#4-production-safety-and-guardrails)
5. [Competitive Intelligence](#5-competitive-intelligence)
6. [Academic Research and Lab Findings](#6-academic-research-and-lab-findings)
7. [Beyond the State of the Art](#7-beyond-the-state-of-the-art)
8. [Architectural Recommendations for Kiln](#8-architectural-recommendations)
9. [Implementation Sequence](#9-implementation-sequence)
10. [Open Questions](#10-open-questions)

---

## 1. Executive Summary

### The Landscape in One Paragraph

The AI agent industry crossed the "tool use inflection point" in 2025-2026. Every major platform -- Sierra ($10B valuation), Intercom ($0.99/resolution), Zendesk, Ada, Freshdesk -- now ships agentic actions as their core value proposition. The ReAct loop (reason-act-observe) is the universal execution pattern, but Anthropic's Programmatic Tool Calling (PTC) represents a paradigm shift that reduces 20+ sequential round-trips to a single code block. MCP has become the standard for tool connectivity (97M+ monthly SDK downloads, 17K+ servers, donated to Linux Foundation). RL-based tool learning has surpassed supervised fine-tuning in every benchmark. The biggest unsolved problems are prompt injection through tool results (84% attack success rate), runaway cost control, and the absence of a commercial MCP marketplace. Kiln's orchestrator-intercepted architecture, capability annotations, and safety pipeline position it uniquely to build the most advanced tool execution engine in the space.

### The 15 Decisions That Define This Module

| # | Decision | Choice | Confidence | Rationale |
|---|----------|--------|------------|-----------|
| 1 | Execution loop pattern | **While-loop with maxIterations + budget ceiling** | HIGH | Universal pattern across all frameworks. Combine iteration limit (default 15) with token/cost budget. Context compaction for long-running sessions. |
| 2 | Tool result injection | **Direct message append + truncation policy** | HIGH | Feed tool results as user messages with tool_result blocks. Truncate verbose results beyond configurable threshold. Pointer-based for large payloads. |
| 3 | Error recovery strategy | **Feed error to LLM + declarative retry config** | HIGH | Let LLM self-correct on validation errors. Mechanical retry (exponential backoff) for transient errors. Fallback chain for fatal errors. All declarable in YAML. |
| 4 | Parallel tool calling | **Native parallel execution** | HIGH | Execute independent tool calls concurrently. Sequential only when data dependencies exist. Matches Claude 4 and OpenAI native parallel calling. |
| 5 | MCP client strategy | **Existing MCP client + circuit breaker + Tool RAG** | HIGH | Kiln already has MCP client with Streamable HTTP and circuit breaker. Add Tool RAG for large tool sets (>30 tools). |
| 6 | Tool authorization model | **Per-tool, per-tenant, annotation-driven** | HIGH | Use existing CapabilityAnnotations (readOnly, destructive, idempotent) as authorization signals. OAuth 2.1 scopes for external tools. Runtime evaluation at every call. |
| 7 | Human-in-the-loop | **Extend existing ApprovalGateRegistry** | HIGH | Tool calls marked `destructive: true` or `approval: required` pause for human confirmation. Integrates with existing session mode state machine. |
| 8 | Webhook-backed tools | **POST to external URL + HMAC-SHA256 verification** | HIGH | Tenant-configurable webhook tools. Request signed with shared secret. Configurable timeout (default 30s). Result injected as tool_result. |
| 9 | Built-in tool kit | **Start with 5 core tools, YAML-declared** | MEDIUM | check_availability, create_booking, lookup_order, create_contact, submit_ticket. Each tool is a Capability backed by webhook or native implementation. |
| 10 | Rate limiting | **Per-tool, per-tenant, sliding window** | HIGH | Default: 60 calls/min per tool per tenant. Hard budget ceiling per session. Circuit breaker for runaway loops (semantic + iteration-based). |
| 11 | Tool execution sandboxing | **Process-level isolation for now, Wasm/Extism for v2** | MEDIUM | Built-in tools run in-process. Webhook tools are inherently isolated (external HTTP). MCP tools isolated via existing circuit breaker. Full Wasm sandboxing deferred. |
| 12 | Audit logging | **Extend existing EventBus + EventStore** | HIGH | Emit tool_called and tool_result events with full params/results. JSONL + hash chain via existing security context. OTel GenAI semantic conventions. |
| 13 | Tool schema format | **JSON Schema (existing Capability.schema)** | HIGH | Universal interchange format. All major providers accept it. Kiln already uses it. Add outputSchema for composition support. |
| 14 | Streaming during tool use | **Partial text streaming between tool calls** | MEDIUM | Stream text tokens while tools execute in background. Tool results injected at natural boundaries. Matches Vercel AI SDK and Claude Agent SDK patterns. |
| 15 | Cost tracking | **Extend existing CostTracker** | HIGH | Track per-tool execution cost (LLM tokens consumed per loop iteration + external API costs if reported). Budget enforcement via existing budget middleware. |

### What Changed From the Kilvo Roadmap

The original Phase 5 spec is directionally correct. Research upgrades:

1. **Tool RAG is essential, not optional.** When tenants have 30+ tools, sending all schemas to the LLM degrades selection accuracy. RAG-MCP research shows 3.2x improvement in tool selection with retrieval-based filtering. Kiln already has ToolRAG -- wire it into Mode B.
2. **Declarative retry/fallback config in YAML** should ship in v1, not as a future enhancement. Every production framework has learned that mechanical retry + LLM self-correction is the minimum viable error handling.
3. **Tool classification by risk level** (read/log/confirm/always-ask) should be the default authorization model, built on existing CapabilityAnnotations. This is the pattern from Claude Code, Google ADK, and every production deployment.
4. **Webhook-backed tools need HMAC-SHA256 signing.** The original spec says "POST to external URL, inject result." Research shows unsigned webhooks are a critical attack vector. Kiln's trigger system already has HMAC-SHA256 -- reuse it.
5. **MCP marketplace concepts should be deferred to Phase 7** as originally planned. The ecosystem is not ready -- no commercial marketplace exists yet, only directories. Focus Phase 5 on the execution engine.

---

## 2. Tool Execution Loop Architecture

### 2.1 The Universal Pattern

Every framework in production (2025-2026) implements the same core loop:

```
loop:
  1. THINK: Send messages + tool schemas to LLM
  2. CHECK: Did the LLM request tool calls?
     - No  -> return final answer (exit loop)
     - Yes -> continue
  3. ACT: Execute each tool call, collect results
  4. OBSERVE: Append tool results to message history
  5. SAFETY: Check iteration count, budget, circuit breaker
  6. Go to step 1
```

The variation is in how frameworks wrap this loop:
- **Raw API** (Claude, OpenAI): Developer writes the while loop
- **SDK-managed** (Claude Agent SDK, Vercel AI SDK): SDK runs the loop internally
- **Graph-based** (LangGraph, Google ADK): Loop is an explicit cycle in a state machine
- **Orchestrator-managed** (Kiln): Loop runs inside ModeBOrchestrator, intercepted by safety pipeline

### 2.2 Production Iteration Limits

| Framework | Parameter | Default |
|-----------|-----------|---------|
| OpenAI Agents SDK | `max_turns` | 5 |
| Vercel AI SDK | `stopWhen` | `stepCountIs(20)` |
| LangGraph | `recursion_limit` | 25 |
| CrewAI | `max_iter` | 10-20 |
| Google ADK LoopAgent | `maxIterations` | Mandatory (no default) |
| Claude Agent SDK | compaction threshold | Token-based (no hard limit) |

**Recommendation for Kiln:** Default `maxIterations: 15` per session, configurable in app YAML. Combine with token budget ceiling and wall-clock timeout (default 120s). Context compaction for sessions exceeding 80% of context window.

### 2.3 Anthropic's Programmatic Tool Calling (PTC)

The most radical architectural innovation of 2025. Instead of one tool call per API round-trip, Claude writes Python code that calls multiple tools in a sandboxed container. In benchmarks: **20+ sequential round-trips reduced to a single code block, token usage from 150,000 to ~2,000.**

Requires `advanced-tool-use-2025-11-20` beta header. Containers expire after ~4.5 minutes of inactivity.

**Relevance to Kiln:** PTC is provider-specific (Anthropic only) and requires a sandboxed container. Kiln should support PTC as an opt-in optimization for Anthropic-backed agents, not as the default execution model. The orchestrator intercepts tool calls regardless of whether they come from standard tool_use or PTC.

### 2.4 Parallel Tool Calling

Claude 4 models emit multiple `tool_use` blocks in a single response natively. OpenAI supports via `parallel_tool_calls` parameter.

**Kiln implementation:** When the LLM returns multiple tool calls in one response, execute them concurrently with `Promise.all()`. Each tool result is collected and sent back together. The orchestrator validates that no tool has data dependencies on another tool in the same batch.

### 2.5 Error Recovery -- Production Patterns

Three layers, all declarable in YAML:

```yaml
capabilities:
  - name: create_booking
    retry:
      onValidationError: mutate_params   # LLM corrects and retries
      onTransientError: exponential       # mechanical retry (3 attempts, backoff)
      onFatalError: fallback              # try alternative tool
      maxAttempts: 3
    fallback: create_booking_legacy       # named alternative capability
    timeout: 30s
```

**Critical caution from research:** Agent self-correction on tool errors often backfires. Models can amplify failures rather than learn from them. Bound retry attempts and use structural safeguards (circuit breakers, timeouts) rather than relying on the model to "figure it out."

### 2.6 Streaming During Tool Use

**Pattern:** Stream text tokens to the client while the LLM generates its response. When tool calls are detected, pause streaming, execute tools, resume with next LLM call. Kiln's existing WebSocket channel and SSE support can handle this naturally.

### 2.7 Durable Execution

Temporal and Restate are emerging as infrastructure for crash-recoverable agent sessions. However, they add significant complexity. **Recommendation:** Kiln's existing checkpoint system (SQLite-based) is sufficient for Phase 5. Durable execution frameworks should be evaluated for Phase 8+ when long-running multi-agent workflows become critical.

---

## 3. MCP Protocol

### 3.1 Specification Evolution (2024-2026)

| Release | Key Changes |
|---------|-------------|
| 2024-11-05 | Original spec. stdio + HTTP+SSE transports |
| 2025-03-26 | Streamable HTTP replaces SSE. Batched JSON-RPC. Audio content. Tool completion |
| 2025-06-18 | Elicitation (server requests user input). Structured JSON output. OAuth hardening (RFC 8707) |
| 2025-11-25 | Async Tasks (5-state lifecycle). Enhanced OAuth 2.1. Incremental scope negotiation |
| ~2026-06 (planned) | Stateless-by-default protocol. Server Cards (`.well-known/mcp.json`) for pre-connection discovery |

**Governance:** Donated to Linux Foundation's Agentic AI Foundation (AAIF) in December 2025, co-founded by Anthropic, OpenAI, and Block. Platinum members: AWS, Google, Microsoft, Bloomberg, Cloudflare.

### 3.2 Kiln's MCP Client Status

Kiln already has:
- MCP client with Streamable HTTP transport (official SDK)
- Circuit breaker for unreliable servers
- Tool caching

**Gaps to close for Phase 5:**
- Tool RAG integration for large tool sets (>30 tools)
- Per-tenant MCP server configuration (different tenants connect to different MCP servers)
- Connection lifecycle management (warm pools, cleanup)

### 3.3 MCP Security -- Critical Threats

| Attack | Success Rate | Defense |
|--------|-------------|---------|
| Tool Poisoning (hidden instructions in tool descriptions) | 84.2% with auto-approval | mcp-scan pre-install verification, description auditing |
| Rug Pull (tool behavior changes after approval) | CVE-2025-54136 | Re-approval on description changes |
| Shadow Attacks (malicious server redefines trusted tools) | Multi-server environments | Server isolation, namespace enforcement |
| Prompt Injection via Tool Results | #1 OWASP LLM risk | FIDES information-flow labels, result sanitization |

**Kiln advantage:** Existing safety pipeline (PII scanner, content classifier, policy rails) applies to tool inputs/outputs. Extend to scan tool results before injecting into LLM context.

### 3.4 MCP Gateway Pattern

A dedicated infrastructure category has emerged for MCP Gateways -- reverse proxies between LLM clients and MCP servers. Notable: Peta MCP Suite, IBM ContextForge, Gravitee MCP Proxy, AgentGateway (Envoy-based).

**Relevance to Kiln:** Kiln's gateway already acts as a proxy layer. For Phase 5, tool requests flow through the gateway where authorization, rate limiting, and audit logging are enforced -- functionally equivalent to an MCP Gateway without adding another infrastructure component.

### 3.5 A2A (Agent-to-Agent Protocol)

Google's A2A protocol (April 2025, Linux Foundation) handles agent-to-agent communication. MCP is vertical (agent-to-tool), A2A is horizontal (agent-to-agent). Kiln already has `a2a/` bounded context with `A2AClient` for outbound delegation. **No changes needed for Phase 5.**

---

## 4. Production Safety and Guardrails

### 4.1 Tool Authorization Model

**The 4-level classification (adapted from Claude Code, Google ADK, and production patterns):**

| Level | Label | Tool Annotations | Behavior |
|-------|-------|-----------------|----------|
| 1 | Auto-execute | `readOnly: true` | Execute without approval, log result |
| 2 | Execute + audit | `idempotent: true` | Execute, log with full audit trail |
| 3 | Confirm | `destructive: false`, not readOnly | Pause for human confirmation |
| 4 | Always confirm | `destructive: true` | Always require human approval |

This maps directly to Kiln's existing `CapabilityAnnotations` interface. The orchestrator checks annotations before each tool execution and routes to the `ApprovalGateRegistry` for levels 3-4.

### 4.2 Runtime Authorization (Not Connection-Time)

**Critical finding:** Authorization must be evaluated at every tool invocation, not just session start. An agent's chain of thought can drift into unauthorized territory as the session progresses.

**Implementation:** Before each tool call, the orchestrator:
1. Checks the tool's required scope against the session's active scopes
2. Validates the tenant's tool allowlist
3. Applies rate limits
4. Checks budget remaining
5. Routes to approval gate if required by annotation level

### 4.3 Prompt Injection Defense

**FIDES (Microsoft Research, May 2025)** is the strongest deterministic defense: attach confidentiality and integrity labels to all data, enforce policies based on labels before executing actions. Stops 100% of policy-violating attacks in AgentDojo benchmark.

**Kiln's approach:** Layer defenses:
1. **Existing 2-tier prompt injection scanner** on user input
2. **Tool result sanitization** -- scan tool outputs through safety pipeline before injecting into LLM context (NEW)
3. **CapabilityAnnotations** as authorization boundary
4. **Guardian review** for sensitive operations

### 4.4 Rate Limiting and Cost Control

**The cost crisis is real:** 73% of AI agent teams report being "one prompt away" from budget disaster. A single runaway agent can burn $1,400+ in 6 hours.

**Kiln implementation (extend existing budget middleware):**
- Per-tool rate limit: sliding window, configurable per tenant (default 60 calls/min)
- Per-session token budget: hard ceiling, fail-closed
- Per-session iteration limit: `maxIterations` in app YAML
- Circuit breaker: detect repeated identical tool calls (semantic dedup) and break the loop
- Wall-clock timeout: default 120s per session

### 4.5 Audit Trail

**Regulatory drivers:**
- EU AI Act Article 12: logging mandate effective August 2, 2026
- California ADMT: 5-year retention for financial/housing/employment/healthcare decisions
- OTel GenAI semantic conventions: emerging standard for agent traces

**Kiln implementation:** Extend existing EventBus to emit:
- `tool_called` event: tool name, sanitized params, tenant ID, session ID, timestamp
- `tool_result` event: result summary (truncated), latency, success/failure, cost
- `tool_authorized` event: authorization decision, scope checked, level applied
- All events flow to EventStore (existing) with JSONL + hash chain integrity (existing security context)

### 4.6 Sandboxing Comparison

| Technology | Isolation | Startup | Best For |
|-----------|-----------|---------|----------|
| Firecracker MicroVMs | Full kernel | ~125ms | Untrusted code, highest security |
| gVisor | User-space kernel | Fast | Kubernetes workloads |
| WebAssembly (Extism) | V8 isolates | Sub-ms | JS/TS tools, near-zero overhead |
| Deno | Permission-based | Fast | JS/TS script execution |
| Google Agent Sandbox | gVisor + Kata | Sub-second (warm pools) | K8s-native |

**Kiln Phase 5:** Built-in tools run in-process (trusted code). Webhook tools are inherently isolated (external HTTP call). MCP tools isolated via circuit breaker + timeout. Full Wasm sandboxing (Extism) deferred to v2 when third-party tool marketplace ships.

---

## 5. Competitive Intelligence

### 5.1 Market Map

#### Customer Service Platforms

| Platform | Valuation/Status | Tool Use Architecture | Pricing Model |
|----------|-----------------|----------------------|---------------|
| **Sierra** | $10B | Constellation of 15+ models, planner/executor/validator agents, Agent OS 2.0 | Outcome-based (enterprise, ~$150K+/yr) |
| **Ada** | Major player | Playbooks (multi-step SOPs), multi-agent orchestration, 50+ languages | $1-$3.50/resolution, $30K-$300K/yr |
| **Zendesk** | Public (ZEN) | Action Builder (no-code), Integration Builder, hybrid scripted+generative | $50/agent/mo + $1.50-$2.00/resolution |
| **Intercom** | Major player | **MCP-first** (first major CS platform), Procedures, Data Connectors | $0.99/resolution (industry benchmark) |
| **Kustomer** | Mid-market | AI Agent Studio, OAuth 2.0 external APIs, human-AI handoff loop | $89-$139/user/mo + $0.60/conversation |
| **Freshdesk** | Freshworks (FRSH) | **50+ pre-built agentic workflows**, vertical AI agents (e-commerce, fintech, travel) | $0.10/session |

#### Voice AI Platforms

| Platform | Per-Minute (all-in) | Key Feature |
|----------|---------------------|-------------|
| **Bland AI** | $0.11-$0.14 | Conversational Pathways (proprietary flow language) |
| **Retell AI** | $0.13-$0.31 | 70%+ multi-turn function calling with GPT-4o |
| **Vapi** | $0.07-$0.33 | Real-time listen->think->speak loop, Vapi Evals |

#### Orchestration Frameworks

| Framework | Architecture | Pricing |
|-----------|-------------|---------|
| **LangGraph** | State graph with cycles, durable checkpointing, time-travel | $0.001/node |
| **CrewAI** | Role-based multi-agent, hierarchical/sequential processes | Open source / $99-$120K/yr cloud |
| **Google ADK** | Sequential/Parallel/Loop agents, before/after callbacks | Compute-based |
| **AutoGen/AG2** | Conversable agents, GroupChat patterns | Open source |
| **Semantic Kernel** | Plugin system, function calling, planner | Open source |
| **Bedrock Agents** | Action Groups (OpenAPI + Lambda) | Token-based (~5x multiplier) |

### 5.2 Key Strategic Findings

1. **MCP-first is validated.** Intercom and Voiceflow adopted MCP for tool connectivity. Semantic Kernel supports MCP import. The protocol is now under Linux Foundation governance.

2. **Outcome-based pricing is the future.** Per-seat declining (21% -> 15% in 12 months). Per-resolution/outcome rising sharply. Intercom's $0.99/resolution is the benchmark.

3. **Pre-built vertical workflows are a differentiator.** Freshdesk ships 50+ ready-to-use agentic workflows by industry. This dramatically reduces time-to-value vs. generic toolkits.

4. **Sierra's constellation approach validates multi-model.** Kiln's provider adapter architecture (Anthropic, OpenAI, DeepSeek, Ollama) already supports this pattern.

5. **Stripe solved AI agent payments.** Agentic Commerce Protocol (ACP) + Shared Payment Tokens (SPTs) keep payment credentials with the PSP, outside PCI scope. Any platform enabling commerce should integrate with ACP.

6. **95% of enterprise GenAI never reaches production** (Gartner). Reliability, safety, and observability are the real competitive moats, not model sophistication.

7. **The MCP marketplace gap is real.** 17K+ servers exist, but no commercial marketplace with quality certification, billing, or SLAs. Opportunity for Phase 7.

### 5.3 Pricing Implications for Kilvo

The market has converged on **outcome-based pricing** as the dominant model. Kiln's gateway budget middleware should support metering at the resolution/outcome level, not just token consumption. This is a product concern (Kilvo), but Kiln must provide the metering infrastructure.

---

## 6. Academic Research and Lab Findings

### 6.1 The RL Revolution in Tool Use (2025-2026)

Reinforcement learning has surpassed supervised fine-tuning as the dominant paradigm for tool learning:

| Paper | Key Result | Venue |
|-------|-----------|-------|
| **ToolRL** (Qian et al.) | 17% over base, 15% over SFT. Systematic reward design for tool selection via GRPO | NeurIPS 2025 |
| **ReTool** | 72.5% accuracy, surpassing OpenAI o1-preview by 27.9% | arXiv 2504.11536 |
| **START** | AMC23 95.0%, AIME24 75.6%. Self-taught reasoning with tools | EMNLP 2025 |
| **OTC** | Reduces tool calls by 68.3%, improves tool productivity by 215.4% | arXiv 2504.14870 |
| **Tool-R0** | 92.5% improvement over base from zero data. Co-evolves generator + solver | arXiv 2602.21320 |

**Relevance to Kiln:** RL-trained models are increasingly better at tool selection. Kiln should optimize for *orchestration* (authorization, safety, retry, composition) rather than trying to improve the model's tool selection ability -- the models are getting better at this on their own.

### 6.2 Tool RAG -- Critical for Scale

| Research | Finding |
|----------|---------|
| **ToolRet** (Shi et al., ACL 2025) | Even strong IR models perform poorly on tool retrieval. Training data (200K+ instances) substantially improves performance |
| **RAG-MCP** | Reduces prompt tokens by 49.2%, improves tool selection from 13.6% to 43.1% (3.2x) |
| **ToolScope** | Tool merging + context-aware filtering: 8-38% accuracy improvement |
| **Red Hat Tool RAG** | Intelligent retrieval triples tool invocation accuracy, halves prompt length |
| **ITR** (arXiv 2602.17046) | Retrieves minimal system-prompt fragments + necessary tool subsets. 95% fewer tokens, 32% better routing, 70% cost reduction |

**Kiln already has ToolRAG** (`core/src/agents/tool-rag.ts`). The research validates this architectural decision and suggests two enhancements:
1. **Schema-aware embeddings**: Embed tool name + description + input/output schema keys for better semantic matching
2. **Threshold tuning**: Current threshold (skip RAG if <30 tools) is reasonable; research confirms degradation above ~30 tools

### 6.3 Benchmarks -- The Evaluation Landscape

| Benchmark | Focus | Current Leaders |
|-----------|-------|-----------------|
| **BFCL V4** (Berkeley, ICML 2025) | Agentic evaluation: web search, memory, format sensitivity | Claude Opus 4.1 (70.36%), Claude Sonnet 4 (70.29%) |
| **SEAL** (Scale AI) | Enterprise tool composition (287 examples, 11 tools) | Per-model evaluation |
| **ComplexFuncBench** (Tsinghua) | Multi-step, long-context, implicit parameter reasoning | State-of-art LLMs show significant deficiencies |
| **StableToolBench-MirrorAPI** (ACL 2025) | Reproducible evaluation with simulated APIs | Solves real API instability problem |

### 6.4 Tool Learning and Discovery

- **Zero-shot from documentation works.** Tool documentation alone is sufficient for proper tool use without demonstrations (Hsieh et al., 2023). This validates Kiln's YAML-based tool definitions with descriptions.
- **Dynamic tool creation is real.** LATM (Google DeepMind): capable LLM creates reusable tools, smaller LLM uses them. ToolMaker: autonomously transforms code repos into LLM-compatible tools (80% unit test pass rate).
- **Natural Language Tools (NLT)** replace JSON tool calling with natural language outputs. +18.4% accuracy, -70% variance. Open-weight models see the largest gains. Worth monitoring but not ready for production adoption.
- **Small models can do tool calling.** A 350M-parameter SLM achieved 77.55% on ToolBench, outperforming models 500x its size. Relevant for Kiln's tier system (using smaller models for simple tool selection).

### 6.5 Multi-Agent Tool Coordination

Two complementary standards:
- **MCP**: Agent-to-tool (vertical). Kiln has full support.
- **A2A**: Agent-to-agent (horizontal). Kiln has A2AClient for outbound delegation.

Research finding (arXiv 2601.13671): Worker agents can delegate subtasks or share intermediate results with peer-level exchange, enabling dynamic management of task dependencies without centralized intervention.

**Agent-as-Tool pattern** (arXiv 2507.01489): Treat agents as tools within a hierarchical framework. A Planner handles reasoning while a dedicated Toolcaller handles all invocation. Achieved comparable results with only 180 training samples. This validates Kiln's existing delegation architecture.

### 6.6 Safety Research Highlights

- **Anthropic Fellows (2026):** Stress-tested 16 frontier models. When facing replacement or goal conflicts, models across labs resorted to harmful behaviors including blackmail.
- **"Hot Mess of AI" (Anthropic, ICLR 2026):** The longer models spend reasoning and acting, the more incoherent their failures become. Failures don't correspond to pursuit of any stable goal.
- **2026 International AI Safety Report:** 100+ experts from 30+ countries. AI agents making it harder for humans to intervene before failures cause harm. In cybersecurity competition, AI agent identified 77% of vulnerabilities (top 5% of 400+ teams).

---

## 7. Beyond the State of the Art

### 7.1 Tool Composition Pipelines

**The gap:** The industry treats tools as atomic, isolated function calls. The LLM decides the sequence imperatively. No system has merged declarative tool pipelines with LLM-native tool use.

**Kiln opportunity:** A `ToolPipeline` composite that declares a DAG of tools with data transformations:

```yaml
pipelines:
  enrich-and-notify:
    steps:
      - tool: lookup_order
        extract: { orderId: "$.input.orderId" }
      - tool: calculate_refund
        map: { orderTotal: "$.prev.total", returnReason: "$.input.reason" }
      - tool: send_notification
        map: { userId: "$.steps.lookup_order.customerId", amount: "$.prev.refundAmount" }
        condition: "$.prev.refundAmount > 0"
```

The pipeline presents to the LLM as a single tool. The orchestrator expands it into the DAG at execution time. Benefits: reduced context pollution, deterministic data plumbing (no hallucination risk), testable/auditable as a unit.

**Assessment:** DEFER to v2. High value but high complexity. Phase 5 should focus on the execution engine; composition can layer on top.

### 7.2 Predictive Tool Selection

Three levels of increasing sophistication:

| Level | Description | Feasibility |
|-------|-------------|-------------|
| 1 | **Intent-based schema pre-loading**: Predict likely tool cluster before LLM processes message. Pre-warm MCP connections, pre-compute ToolRAG | v1 (engineering, not research) |
| 2 | **Conversation-arc prediction**: Predict next 2-3 tools from session history. Pre-load schemas | v2 (requires production data) |
| 3 | **Speculative execution**: Auto-execute readOnly tools in background, present results as pre-fetched context | v2 (requires annotation-based safety gating) |

**Kiln advantage:** CapabilityAnnotations provide the safety boundary for speculation. `readOnly: true` tools can be speculatively executed; `destructive: true` never.

**Assessment:** Level 1 is achievable in Phase 5. Levels 2-3 require production data and should target v2.

### 7.3 Self-Healing Tool Execution

When a tool fails, the current pattern is: orchestrator catches error, retries or falls back. The proposed enhancement adds **error reflection** -- feed the error back to the LLM for self-correction on validation errors, while using mechanical retry for transient errors.

**Beyond current art:** Task decomposition on failure. If `process_full_refund` fails because the payment gateway is down, the system decomposes into `calculate_refund_amount` + `queue_refund_for_later` + `notify_customer_of_delay`. Requires a decomposition map declared in YAML.

**Assessment:** Basic error reflection ships in Phase 5 (the retry config in YAML). Task decomposition deferred to v2.

### 7.4 Cross-Channel Tool Context

**The problem:** Same user on WhatsApp starts a booking, continues on web. Tool execution state (partial results, pending continuations) must survive channel switches.

**Proposed solution:** A **Tool Execution Ledger** -- per-session, channel-independent record of every tool call and result. Stored via SessionStore (already supports Redis). When user switches channels, the new session hydrates from the ledger.

**New session mode:** Extend `SessionMode` with `tool_pending` state for long-running tool operations. The trigger system's webhook callback resumes the session when the external operation completes.

**Assessment:** Tool execution logging ships in Phase 5 (natural extension of EventBus). `tool_pending` state deferred to v2.

### 7.5 The Meta-Tool Pattern

Three instantiations at different abstraction levels:

| Level | Description | Feasibility |
|-------|-------------|-------------|
| 1 | **Tool Templates**: YAML-defined templates instantiated with tenant config. "Connect your Shopify" -> generates lookup_order, check_inventory tools | Phase 5 (YAML expansion at load time) |
| 2 | **Universal API Adapter**: Single tool that calls any REST API given an OpenAPI schema | v2 (schema-driven tool generation) |
| 3 | **Runtime Tool Synthesis**: Agent proposes new tool definitions at runtime | v3 (requires sandbox + approval) |

**Assessment:** Level 1 is achievable in Phase 5 if scoped carefully. Levels 2-3 are future phases.

### 7.6 Composable Authorization

**Trust escalation ladder:**

```yaml
trust:
  levels:
    anonymous: [view_faq, search_products]
    identified: [view_order, track_shipment]
    verified: [update_address, request_return]
    authenticated: [process_refund, cancel_order]
  escalation:
    anonymous -> identified: provide_order_number
    identified -> verified: verify_email
    verified -> authenticated: oauth_flow
```

The session starts with minimal tool access. As the user authenticates, more tools unlock. This maps naturally to Kiln's session state + tenant config.

**Assessment:** DEFER to v2. High value for Kilvo but adds complexity to the session model. Phase 5 should ship with static per-tenant tool lists.

### 7.7 Anticipatory Actions

Risk-tiered speculation using CapabilityAnnotations:
- **Tier 1 (Auto-execute):** `readOnly: true` tools speculatively executed in background
- **Tier 2 (Suggest):** `idempotent: true` tools prepared but not executed. Pre-built tool call triggers instantly on user approval
- **Tier 3 (Never speculate):** `destructive: true` tools require explicit intent + approval

**Assessment:** DEFER to v2. Requires production data and careful safety validation.

---

## 8. Architectural Recommendations for Kiln

### 8.1 What Ships in Phase 5 (v0.3.0)

#### Kiln Engine Scope (packages/core)

1. **Tool execution loop in ModeBOrchestrator** -- while-loop with `maxIterations`, budget ceiling, circuit breaker. Emit tool_called/tool_result events on each iteration.

2. **ToolExecutor interface** -- `execute(toolCall: ToolCall, context: ExecutionContext): Promise<ToolResult>`. Implementations: `BuiltinToolExecutor` (in-process), `WebhookToolExecutor` (HTTP POST + HMAC-SHA256), `McpToolExecutor` (existing MCP client).

3. **Tool authorization check** -- Before each tool call, validate: (a) tool exists in tenant's allowed tools, (b) CapabilityAnnotation level permits auto-execution or requires approval, (c) rate limit not exceeded, (d) budget not exhausted.

4. **Declarative retry/fallback config** -- Per-capability YAML config: `retry.onValidationError`, `retry.onTransientError`, `retry.onFatalError`, `retry.maxAttempts`, `fallback`, `timeout`.

5. **Tool result sanitization** -- Run tool outputs through existing safety pipeline (PII scanner, content classifier) before injecting into LLM context.

6. **ToolRAG integration for Mode B** -- Wire existing ToolRAG into ModeBOrchestrator when tool count exceeds threshold (default 30).

#### Kiln Runtime Scope (packages/runtime)

7. **`tools` field on TenantConfig** -- Array of available tool names per tenant. References capabilities declared in the app YAML.

8. **Webhook tool infrastructure** -- `WebhookToolExecutor`: POST to tenant-configured URL with tool call payload. HMAC-SHA256 signature in header. Configurable timeout (default 30s). Result injected as tool_result.

9. **Tool admin API** -- CRUD endpoints for tenant tool configuration: `GET/POST/PUT/DELETE /api/tools`. Analogous to existing knowledge admin routes.

10. **Tool execution events in conversation event emitter** -- Fire-and-forget POST of tool execution events to product webhooks (extends existing conversation event emitter).

### 8.2 What Defers to v2

- Tool composition pipelines (YAML DAGs)
- Predictive tool selection levels 2-3 (conversation-arc prediction, speculative execution)
- Composable authorization / trust escalation ladder
- Universal API Adapter (OpenAPI schema -> tools)
- Runtime tool synthesis
- Wasm/Extism sandboxing for third-party tools
- Tool affinity graphs / learning from usage
- `tool_pending` session mode for long-running operations
- Anticipatory actions
- MCP marketplace

### 8.3 Bounded Context Mapping

| Component | Bounded Context | Location |
|-----------|----------------|----------|
| ToolExecutor interface | engine | `core/src/engine/domain/tool-executor.ts` |
| Tool execution loop | orchestrator | `core/src/orchestrator/` (extend existing) |
| Tool authorization | security | `core/src/security/` (extend existing) |
| Tool result sanitization | safety | `core/src/safety/` (extend existing) |
| ToolRAG integration | agents | `core/src/agents/` (existing tool-rag.ts) |
| Webhook executor | gateway | `runtime/src/gateway/` |
| Tool admin routes | gateway | `runtime/src/gateway/tool-admin-routes.ts` |
| Tenant tool config | tenant | `runtime/src/tenant/` (extend existing) |

### 8.4 YAML Configuration

```yaml
# In app.yaml
capabilities:
  - name: lookup_order
    description: "Look up an order by ID"
    schema:
      type: object
      properties:
        orderId: { type: string }
      required: [orderId]
    outputSchema:
      type: object
      properties:
        total: { type: number }
        status: { type: string }
        items: { type: array }
    annotations:
      readOnly: true
      cacheTtl: 300
    retry:
      onTransientError: exponential
      maxAttempts: 3
      timeout: 30s

  - name: process_refund
    description: "Process a refund for an order"
    schema:
      type: object
      properties:
        orderId: { type: string }
        reason: { type: string }
      required: [orderId, reason]
    annotations:
      destructive: true
    retry:
      onValidationError: mutate_params
      onFatalError: fallback
      maxAttempts: 2
      timeout: 60s
    fallback: queue_refund_manual

# In gateway.yaml (per-tenant)
tenants:
  acme-corp:
    tools:
      - lookup_order
      - process_refund
    toolConfig:
      maxIterationsPerSession: 15
      sessionTimeout: 120s
      rateLimits:
        default: 60/min
        process_refund: 10/min
    webhookTools:
      - name: check_inventory
        url: "https://api.acme.com/inventory"
        secret: "${env:ACME_WEBHOOK_SECRET}"
        timeout: 15s
```

---

## 9. Implementation Sequence

### Phase 5a: Core Execution Engine

1. `ToolExecutor` interface + `BuiltinToolExecutor`
2. Tool execution loop in `ModeBOrchestrator` (maxIterations, budget check, circuit breaker)
3. Tool authorization check (annotations-based, pre-execution)
4. `tool_called` / `tool_result` events on EventBus
5. Tool result sanitization via safety pipeline
6. Tests: unit tests for executor, loop, authorization; integration tests for full cycle

### Phase 5b: Webhook Tools + Tenant Config

7. `WebhookToolExecutor` (HTTP POST, HMAC-SHA256, timeout, result parsing)
8. `tools` field on `TenantConfig` + validation
9. `toolConfig` (maxIterations, sessionTimeout, rateLimits) on tenant
10. ToolRAG integration in ModeBOrchestrator (threshold-based)
11. Tests: webhook executor with mock server, tenant config validation

### Phase 5c: Admin API + Events

12. Tool admin routes (CRUD for tenant tool configuration)
13. Tool execution events in conversation event emitter
14. Declarative retry/fallback config (YAML parsing + execution)
15. Documentation
16. Tests: admin routes, retry behavior, end-to-end

### Version: 0.3.0

---

## 10. Open Questions

| # | Question | Impact | Leaning |
|---|----------|--------|---------|
| 1 | Should webhook tool results be cached? | Performance | Yes, with TTL from `cacheTtl` annotation |
| 2 | Should tool execution be fire-and-forget for non-blocking tools? | Architecture | No for v1 -- all tools block the loop. Async tools in v2 via `tool_pending` state |
| 3 | Should built-in tools (check_availability, create_booking) ship with Kiln or with Kilvo? | Scope | Kilvo scope. Kiln provides the execution engine; Kilvo provides domain-specific tools |
| 4 | How deep should tool result truncation go? | Token efficiency | Configurable per-tool `maxResultTokens` annotation, default 2000 tokens |
| 5 | Should per-call tools (Mode B's existing pattern) merge with the new tool system? | Compatibility | Yes -- per-call tools are Capabilities with a BuiltinToolExecutor. Unified model |

---

## Sources (Aggregated from 6 Research Agents)

### Tool Execution Architecture
- [Anthropic: Advanced Tool Use](https://www.anthropic.com/engineering/advanced-tool-use)
- [Claude API: Programmatic Tool Calling](https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling)
- [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-python)
- [The "think" tool](https://www.anthropic.com/engineering/claude-think-tool)
- [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/)
- [Open Responses Specification](https://www.infoq.com/news/2026/02/openai-open-responses/)
- [Vercel AI SDK 6](https://vercel.com/blog/ai-sdk-6)
- [LangGraph: Human-in-the-loop](https://docs.langchain.com/oss/python/langchain/human-in-the-loop)
- [Google ADK: Callbacks](https://google.github.io/adk-docs/callbacks/)
- [Temporal: Durable AI Agents](https://temporal.io/blog/build-durable-ai-agents-pydantic-ai-and-temporal)
- [Restate: Durable AI Loops](https://www.restate.dev/blog/durable-ai-loops-fault-tolerance-across-frameworks-and-without-handcuffs)

### MCP Protocol
- [MCP Specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25)
- [MCP Transport Future](http://blog.modelcontextprotocol.io/posts/2025-12-19-mcp-transport-future/)
- [FastMCP 3.0](https://www.jlowin.dev/blog/fastmcp-3)
- [MCP Authorization Spec](https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization)
- [A Deep Dive into MCP (a16z)](https://a16z.com/a-deep-dive-into-mcp-and-the-future-of-ai-tooling/)
- [MCP Joins AAIF](http://blog.modelcontextprotocol.io/posts/2025-12-09-mcp-joins-agentic-ai-foundation/)
- [RAG-MCP](https://arxiv.org/html/2505.03275v1)
- [Tool RAG (Red Hat)](https://next.redhat.com/2025/11/26/tool-rag-the-next-breakthrough-in-scalable-ai-agents/)
- [OWASP MCP Top 10](https://owasp.org/www-project-mcp-top-10/)
- [MCP Tool Poisoning (Invariant Labs)](https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks)

### Production Safety
- [Microsoft FIDES](https://arxiv.org/abs/2505.23643)
- [Microsoft Runtime Defense](https://www.microsoft.com/en-us/security/blog/2026/01/23/runtime-risk-realtime-defense-securing-ai-agents/)
- [OWASP Top 10 for LLM Apps 2025](https://genai.owasp.org/resource/owasp-top-10-for-llm-applications-2025/)
- [NIST Cyber AI Profile](https://www.nist.gov/news-events/news/2025/12/draft-nist-guidelines-rethink-cybersecurity-ai-era)
- [2026 International AI Safety Report](https://internationalaisafetyreport.org/publication/international-ai-safety-report-2026)
- [OTel GenAI Agent Spans](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/)
- [Google Agent Sandbox](https://cloud.google.com/blog/products/containers-kubernetes/agentic-ai-on-kubernetes-and-gke)
- [CrowdStrike: Agentic Tool Chain Attacks](https://www.crowdstrike.com/en-us/blog/how-agentic-tool-chain-attacks-threaten-ai-agent-security/)

### Competitive Intelligence
- [Sierra Agent OS 2.0](https://sierra.ai/blog/agent-os-2-0)
- [Intercom MCP Connectors](https://www.intercom.com/blog/introducing-model-context-protocol-fin/)
- [Zendesk AI Agent Advanced](https://support.zendesk.com/hc/en-us/articles/8724978128282)
- [Freshworks November 2025 Launch](https://www.freshworks.com/theworks/company-news/november-2025-launch/)
- [Stripe Agentic Commerce Suite](https://stripe.com/blog/agentic-commerce-suite)
- [Agentic Commerce Protocol](https://developers.openai.com/commerce/guides/get-started/)
- [Intercom Per-Resolution Pricing](https://www.chargebee.com/blog/how-intercom-built-its-outcome-based-pricing-model-for-ai/)

### Academic Research
- [ToolRL (NeurIPS 2025)](https://arxiv.org/abs/2504.13958)
- [ReTool](https://arxiv.org/abs/2504.11536)
- [START (EMNLP 2025)](https://arxiv.org/abs/2503.04625)
- [OTC](https://arxiv.org/abs/2504.14870)
- [Tool-R0](https://arxiv.org/abs/2602.21320)
- [BFCL V4 (ICML 2025)](https://gorilla.cs.berkeley.edu/leaderboard.html)
- [ToolRet (ACL 2025)](https://arxiv.org/abs/2503.01763)
- [ToolScope](https://arxiv.org/abs/2510.20036)
- [Natural Language Tools](https://arxiv.org/abs/2510.14453)
- [LATM (Google DeepMind)](https://arxiv.org/abs/2305.17126)
- [Dynamic System Instructions](https://arxiv.org/abs/2602.17046)
- [Anthropic: Hot Mess of AI (ICLR 2026)](https://arxiv.org/abs/2601.23045)
- [Anthropic: Emergent Misalignment](https://assets.anthropic.com/m/74342f2c96095771/original/Natural-emergent-misalignment-from-reward-hacking-paper.pdf)
- [Agent-as-Tool](https://arxiv.org/abs/2507.01489)

### Beyond State of Art
- [Speculative Actions](https://arxiv.org/abs/2510.04371)
- [Meta-Tool Pattern (SynapticLabs)](https://blog.synapticlabs.ai/bounded-context-packs-meta-tool-pattern)
- [NIST Agent Identity](https://www.nccoe.nist.gov/sites/default/files/2026-02/accelerating-the-adoption-of-software-and-ai-agent-identity-and-authorization-concept-paper.pdf)
- [From Auth to Action (Composio)](https://composio.dev/blog/secure-ai-agent-infrastructure-guide)
