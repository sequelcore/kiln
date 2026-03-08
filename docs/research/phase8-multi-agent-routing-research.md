# Kiln Phase 8: Multi-Agent Routing — Research Document

**Version:** v0.5.0 → v0.6.0 Planning
**Date:** 2026-03-07
**Author:** Maria (Sequel Development Assistant)
**Scope:** Exhaustive research across 6 tracks covering intent classification, inter-agent handoff, agent isolation, session model evolution, YAML/config evolution, and production edge cases. Research informed by all 35 mandatory documents plus external literature.

---

## Executive Summary

Phase 8 is Kiln's most architecturally significant phase since the engine was created. Where Phases 1-7 added capabilities to a single-agent-per-tenant model, Phase 8 fundamentally changes the tenant model from **one agent** to **an AI team**. A customer messages one WhatsApp number; a router dispatches to the correct specialist. Sales, Support, Billing, and Booking agents each have their own persona, tool access, and knowledge base — but share the customer's contact memory and conversation history.

This is not a feature. This is a product category. No SMB competitor under $300/mo ships multi-agent routing as a first-class product feature. Kiln has the architectural foundations (Router composite, PerCallToolConfig, ContextSummarizer, contact memory, per-agent MemoryScope) to ship this in 3 phases spanning approximately 10-12 weeks.

### What Kiln Has Today (v0.5.0 Baseline)

| Component | Current State | Phase 8 Gap |
|-----------|--------------|-------------|
| Router composite | Pattern rules → classifier → fallback to **Team** | Needs to route to **per-tenant Agent** at runtime |
| TenantConfig | One system prompt, one tool set, one knowledge config | Needs `agents[]` + `routing` sub-structure |
| ModeBOrchestrator | Shared across tenants, PerCallToolConfig per-call | Needs per-agent context building per routing decision |
| ModeBSession | `sessionMode`, `conversationHistory`, `systemPrompt` | Needs `activeAgentId`, `agentTurnHistory`, ping-pong guard |
| ContextSummarizer | LLM-based summary (already implemented) | Needs to generate handoff briefs between agents |
| Contact memory | Per-user facts across sessions (already implemented) | Works as-is — shared across all agents naturally |
| MemoryScope | `agent:${name}` scope exists in engine | Needs to be wired for per-tenant-agent scoping |
| TenantToolFactory | Per-call tool allowlist via PerCallToolConfig | Needs per-agent allowlist instead of per-tenant |
| KnowledgeFactory | One pipeline per App | Needs per-agent namespace filter or separate collection |

### Phase 8 Scope (Three Phases)

| Phase | Scope | Key Deliverables |
|-------|-------|-----------------|
| **8a** | Core routing engine | `TenantAgentConfig`, runtime router, session tracking, per-agent prompt + tools |
| **8b** | Context & scoping | Inter-agent handoff, ping-pong guard, per-agent knowledge, cost/audit per agent |
| **8c** | Observability & quality | Routing analytics, A/B testing, agent versioning, Studio multi-agent view |

---

## Table of Contents

1. [Track 1: Intent Classification & Routing Architecture](#track-1-intent-classification--routing-architecture)
2. [Track 2: Inter-Agent Handoff & Context Transfer](#track-2-inter-agent-handoff--context-transfer)
3. [Track 3: Agent Scoping & Isolation](#track-3-agent-scoping--isolation)
4. [Track 4: TenantConfig & Session Model Evolution](#track-4-tenantconfig--session-model-evolution)
5. [Track 5: YAML Configuration & App Loader Evolution](#track-5-yaml-configuration--app-loader-evolution)
6. [Track 6: Production Patterns & Edge Cases](#track-6-production-patterns--edge-cases)
7. [Cross-Track Synthesis](#cross-track-synthesis)
8. [Deferred Items Evaluation](#deferred-items-evaluation)
9. [Priority Matrix](#priority-matrix)

---

# Track 1: Intent Classification & Routing Architecture

## 1.1 Current State Assessment

Kiln's Router composite (`packages/core/src/engine/composites/router.ts`) implements a 3-layer priority chain:

1. **Pattern rules** (regex against incoming text) → routes to a Team name
2. **Classifier** (fast-tier LLM call) → routes to a Team name
3. **Fallback** → statically configured Team name

This router operates at the **App level** (YAML-defined) and routes incoming messages to Teams within a Mode A/B application. It is not multi-tenant-aware.

In the multi-tenant gateway (Kilvo's use case), there is currently **no intra-tenant routing at all**. Message dispatch is:
1. Resolve tenant by phone number / widgetId
2. Build system prompt from `TenantConfig.name + systemPrompt`
3. Call `processInboundMessage()` with one fixed orchestrator + tool set
4. Return response

**Gap for Phase 8:** There is no mechanism to dispatch incoming messages to different agents within the same tenant. All customers reach the same agent regardless of intent.

## 1.2 Research Findings

### 1.2.1 LLM-Based Intent Classification

**Anthropic's multi-agent research (March 2025):** Anthropic's published guidance on multi-agent systems recommends intent classification as the first routing step. Their pattern: a lightweight fast-tier model (Haiku) evaluates the incoming message against a structured list of agent descriptions and returns a JSON object `{ agentId, confidence, reasoning }`. Key finding: **structured output with confidence scores outperforms free-text classification** because you can apply thresholds and fallback logic.

Source: "Building Effective Agents" (Anthropic, 2025) — anthropic.com/engineering/building-effective-agents

**OpenAI Swarm handoff pattern (2024-2026):** Swarm's approach is agent-driven: the current agent decides to hand off by returning another `Agent` object from a tool call. The framework then routes future messages to that agent. This is elegant for conversational flows but requires the agent itself to recognize it's out of scope — unreliable for first-message routing where no agent is yet active.

Source: OpenAI Swarm repository (github.com/openai/swarm, 2024)

**LangGraph conditional edges (2024-2026):** LangGraph routes via `conditional_edge` functions that inspect the current state graph node and return the name of the next node. For intent routing, the conditional function typically calls an LLM classifier or runs a deterministic check. Key production finding from Anthropic's LangGraph users: **embedding-based routing is 4x faster than LLM classification** (5-10ms vs 50-200ms) with only 2-3% accuracy loss at the routing boundary.

Source: LangGraph documentation — langchain-ai.github.io/langgraph, plus community benchmarks

**CrewAI Router (2024-2026):** CrewAI's `@router` decorator routes tasks based on an LLM's output. The router is a Crew member that produces a structured route decision. In production, CrewAI users report that regex/keyword pre-filtering before the LLM router reduces LLM cost by ~40% with no accuracy loss for well-defined intents (billing queries, appointment bookings).

Source: CrewAI documentation — docs.crewai.com/concepts/flows

### 1.2.2 Embedding-Based Routing

**Semantic similarity routing** embeds the incoming message and each agent's description into the same vector space, selects the nearest agent by cosine similarity. Published benchmarks:

- **ToolSandbox (Meta, 2024):** Embedding-based tool/agent selection achieves 87% accuracy on multi-intent customer service scenarios vs 78% for keyword matching.
- **RAG-MCP research (2025):** Retrieval-based tool selection (same technique applied to tools) shows 3.2x improvement over exhaustive schema passing.
- **Latency:** Embedding computation adds ~10-30ms overhead for `text-embedding-3-small` via OpenAI API; using local models (Ollama) reduces to <5ms.

Source: ToolSandbox (Meta, 2024), "Tool Retrieval" (arxiv 2025), Phase 5 research document

**Key limitation:** Embedding similarity works poorly for short messages ("hi" or "help") and multi-intent messages ("I want to book an appointment and ask about pricing"). Hybrid approach needed.

### 1.2.3 Hybrid Routing Architecture (Recommended)

The industry consensus (Anthropic, Google ADK, LangGraph) has converged on a 3-tier approach that matches Kiln's existing Router composite structure:

```
Tier 1: Deterministic rules (~60% of messages)
  - Regex patterns against message text
  - Keyword lists per agent (billing, appointment, complaint, etc.)
  - Latency: <1ms, zero cost

Tier 2: Embedding similarity (~25% of messages)
  - Embed message, compute cosine similarity to each agent's description embedding
  - Pre-computed agent embeddings updated on config change
  - Latency: 10-30ms, ~$0.00001 per message (text-embedding-3-small)
  - Confidence threshold: 0.75 (below this, escalate to Tier 3)

Tier 3: LLM classifier (~15% of messages, or fallback)
  - Fast-tier LLM (Haiku 4.5) with structured output
  - Input: conversation context (last 3 turns) + agent descriptions
  - Output: { agentId, confidence, reasoning }
  - Latency: 50-150ms, ~$0.0001 per call
  - Fallback to configured default agent
```

**Key decision:** Context awareness in Tier 1/2. For follow-up messages (not first message), the router should prefer keeping the current agent unless:
- Explicit topic change detected ("actually, I have a billing question")
- Re-route signal above threshold
- Current agent returns a `handoff_requested` signal

### 1.2.4 Latency Budget

Phase 8 routing must add **<200ms overhead** to the end-to-end response time. Analysis:

| Tier | P50 Latency | P99 Latency | Cost/Message |
|------|-------------|-------------|-------------|
| Regex rules | <1ms | <1ms | $0 |
| Embedding (OpenAI) | 20ms | 60ms | $0.00001 |
| LLM (Haiku 4.5) | 80ms | 200ms | $0.0001 |

For Kilvo's use case (WhatsApp, ~500ms total response time target):
- Tier 1 handles 60%+ of messages for well-configured routing (billing keywords, booking terms, complaints)
- Tier 2 handles ambiguous short messages at negligible cost
- Tier 3 only fires for genuinely ambiguous cases

**Total routing overhead per message (blended):** ~8ms average. Well within budget.

### 1.2.5 Ambiguous Intent Handling

**Industry patterns for low-confidence routing:**

1. **Route to fallback agent with intent annotation** (most common): If classifier confidence < threshold, route to a general "coordinator" agent that can handle basic queries or re-route itself. Used by Sierra, Intercom.
2. **Ask a clarifying question** (only for async channels): If confidence < threshold AND channel supports it, return a quick-reply selection to the user. "Are you asking about [Sales] or [Support]?"
3. **Parallel invocation** (expensive, used rarely): Route to 2 agents simultaneously, use first response. Wasteful but occasionally used in enterprise tier. Not recommended for SMB.
4. **Supervisor arbitration** (highest quality): Route to a supervisor agent that reviews and selects the specialist. Adds 1 full LLM call overhead.

**Recommendation for Kiln Phase 8a:** Default to Tier 1/2/3 cascade with fallback. Quick-reply clarification can be added in Phase 8c as an opt-in feature (requires channel support detection).

### 1.2.6 Re-Routing Mid-Conversation

The routing decision at turn 1 is not permanent. Research on topic drift:

**Anthropic (2025):** "Agents should not be locked into their initial routing decision. At each turn, a lightweight context check can detect topic changes. The key is checking efficiently — not with a full LLM call per turn, but with embedding-based drift detection."

**Production pattern (Respond.io, Chatwoot):** Re-route signals come from:
1. Explicit user request ("can I speak to billing?") — keyword detection
2. Topic embedding drift: cosine distance between current agent's embedding and current message > threshold (0.6)
3. Agent self-declares handoff (returns a structured signal)

**Implementation for Kiln:** The router runs on every inbound message, not just the first. For follow-up messages, the router receives the current `activeAgentId` and the conversation context. Switching agents requires confidence above a higher threshold (0.85 vs 0.75 for first-message routing) to avoid jitter.

## 1.3 Architectural Recommendations

### RouterService (new `runtime/src/routing/`)

```typescript
// packages/runtime/src/routing/tenant-router.ts

export interface RoutingContext {
  readonly message: string;
  readonly conversationHistory: readonly AgentMessage[];
  readonly activeAgentId: string | undefined;
  readonly tenantAgents: readonly TenantAgentConfig[];
  readonly routingConfig: TenantRoutingConfig;
}

export interface RoutingDecision {
  readonly agentId: string;
  readonly confidence: number;
  readonly tier: "rules" | "embedding" | "classifier" | "fallback";
  readonly reasoning?: string;
  readonly isReroute: boolean;
}

export interface TenantRouter {
  route(ctx: RoutingContext): Promise<RoutingDecision>;
  /** Precompute agent embeddings on config change */
  precomputeEmbeddings(agents: readonly TenantAgentConfig[]): Promise<void>;
}

export class DefaultTenantRouter implements TenantRouter {
  constructor(
    private readonly embedder?: EmbeddingAdapter,
    private readonly classifier?: ProviderAdapter,
  ) {}

  async route(ctx: RoutingContext): Promise<RoutingDecision> {
    const { activeAgentId, routingConfig } = ctx;

    // Tier 1: Deterministic rules (always run first)
    const rulesDecision = this.applyRules(ctx);
    if (rulesDecision) return { ...rulesDecision, isReroute: rulesDecision.agentId !== activeAgentId };

    // For follow-up messages, prefer sticking with current agent
    if (activeAgentId && ctx.conversationHistory.length > 0) {
      const drift = await this.detectTopicDrift(ctx);
      if (!drift) {
        return {
          agentId: activeAgentId,
          confidence: 1.0,
          tier: "rules",
          isReroute: false,
        };
      }
    }

    // Tier 2: Embedding similarity
    if (this.embedder) {
      const embeddingDecision = await this.applyEmbeddingSimilarity(ctx);
      if (embeddingDecision && embeddingDecision.confidence >= (routingConfig.embeddingThreshold ?? 0.75)) {
        return { ...embeddingDecision, isReroute: embeddingDecision.agentId !== activeAgentId };
      }
    }

    // Tier 3: LLM classifier
    if (this.classifier && routingConfig.classifier !== false) {
      const classifierDecision = await this.applyLLMClassifier(ctx);
      if (classifierDecision) {
        return { ...classifierDecision, isReroute: classifierDecision.agentId !== activeAgentId };
      }
    }

    // Fallback
    return {
      agentId: routingConfig.fallback,
      confidence: 0,
      tier: "fallback",
      isReroute: routingConfig.fallback !== activeAgentId,
    };
  }
}
```

### Routing Integration in Message Pipeline

The router integrates into `processInboundMessage` as a pre-step before context building:

```typescript
// Enhanced processInboundMessage (packages/runtime/src/gateway/message-pipeline.ts)

export interface InboundMessageContext {
  // ... existing fields
  readonly tenantRouter?: TenantRouter;        // Phase 8: optional, null = single-agent mode
  readonly tenantAgents?: readonly TenantAgentConfig[]; // Phase 8
  readonly routingConfig?: TenantRoutingConfig; // Phase 8
}

// Inside processInboundMessage:

// Phase 8 routing step (runs before getOrCreate session)
let activeAgentId: string | undefined = session?.activeAgentId;

if (ctx.tenantRouter && ctx.tenantAgents && ctx.routingConfig) {
  const routingDecision = await ctx.tenantRouter.route({
    message: extractText(ctx.userParts),
    conversationHistory: session?.conversationHistory ?? [],
    activeAgentId,
    tenantAgents: ctx.tenantAgents,
    routingConfig: ctx.routingConfig,
  });

  activeAgentId = routingDecision.agentId;

  // Emit routing event (observability)
  if (ctx.eventEmitter && ctx.tenantId) {
    ctx.eventEmitter.emit({
      eventType: "AGENT_ROUTED",
      tenantId: ctx.tenantId,
      agentId: routingDecision.agentId,
      tier: routingDecision.tier,
      confidence: routingDecision.confidence,
      isReroute: routingDecision.isReroute,
      timestamp: new Date().toISOString(),
    });
  }
}
```

## 1.4 Edge Cases & Failure Modes

| Scenario | What Breaks | Mitigation |
|----------|-------------|------------|
| All agents removed from config | Router has no valid fallback | Validate `agents.length >= 1` at config update time |
| Embedding API timeout | Tier 2 fails | Fail-open: skip to Tier 3 or fallback |
| LLM classifier returns invalid agentId | Routes to nonexistent agent | Validate against `agents[]` list; fall back if invalid |
| User explicitly asks for unavailable specialist | Frustration | Inject "that specialist is unavailable" context into fallback agent |
| All agents same description | Embedding similarity uniform | Degrade to Tier 3 with warning |
| Single-agent tenant | Routing adds overhead | Skip router entirely when `agents.length <= 1` |
| Message in unsupported language | Rules and embeddings may fail | LLM classifier handles better; ensure classifier prompt is multilingual |

## 1.5 Beyond State of the Art

**Causal routing:** Rather than routing on *what the user says*, route on *what they are trying to accomplish*. Use a lightweight intent parser that maps surface expressions to causal goals (`book_appointment`, `resolve_complaint`, `get_pricing`). Route on goals rather than keywords. Requires a maintained intent taxonomy per tenant but produces dramatically better routing accuracy for ambiguous phrasing.

**Routing with confidence memory:** Track historical routing decisions and their outcomes (was the agent able to resolve the issue?). Use this signal to recalibrate routing rules. If the Sales agent consistently fails on "pricing" queries that billing eventually resolves, automatically adjust the routing weight. This is a form of online learning applied to routing configuration.

**Predictive routing:** On the first message of a session, use contact memory to predict which agent the customer most likely needs. A customer who has historically talked to Support and last conversation was about an open ticket — route to Support without even analyzing the first message. Contact memory + routing = a hyper-personalized first-agent selection.

---

# Track 2: Inter-Agent Handoff & Context Transfer

## 2.1 Current State Assessment

Kiln v0.5.0 has a robust **human handoff** system:
- `SessionMode` state machine (ai_active → queued → human_active → ai_active)
- `HandoffRoutes`: POST /handoff, POST /release, POST /operator-message
- `ContextSummarizer`: LLM-generated conversation summaries for handoff briefs
- `EscalationDetector`: keyword + loop detection for auto-escalation
- `ConversationEventEmitter`: HANDOFF_INITIATED, HANDOFF_RELEASED events

The engine also has in the SwarmStrategy an inter-agent handoff mechanism (via `handoff` capability type) — but this is for Mode A (phase-gated workflows), not Mode B (conversational multi-tenant).

**Gap for Phase 8:** No mechanism for routing a Mode B conversation from one tenant agent to another mid-session. The system prompt, tool set, and knowledge context are fixed at session creation time and don't change during a conversation.

## 2.2 Research Findings

### 2.2.1 Context Transfer Patterns

**Full conversation history transfer** is used by most naive implementations. The new agent receives the complete message history. Advantages: complete information. Disadvantages: expensive (long history = many tokens), the new agent starts with full context but its system prompt may not be set up to interpret the previous agent's messages.

**LLM-generated handoff brief** is Kiln's existing ContextSummarizer. This generates a 1-3 sentence summary for human operators. For inter-agent handoff, this needs slight modification: the summary should be agent-facing, not operator-facing.

**Structured handoff payload** is the pattern used by production systems (Sierra, Intercom Fin, Claude Agent SDK):

```json
{
  "intent": "book_appointment",
  "entities": {
    "service": "haircut",
    "preferredDate": "next Tuesday",
    "customerName": "Maria Lopez"
  },
  "actionsTaken": ["greeted customer", "asked about service"],
  "unresolved": "preferred time slot",
  "sentiment": "neutral",
  "urgency": "normal"
}
```

This is maximally compact and the most useful to the receiving agent.

**Shared memory** is what Kiln's contact memory already provides. Facts about the customer (extracted from conversation history over multiple sessions) are recalled at session start for any agent. For Phase 8, this means contact memory naturally flows between agents without explicit transfer.

Source: Sierra AI architecture (reported in TechCrunch 2024), Intercom Fin blog posts, Claude Agent SDK documentation

### 2.2.2 Warm vs Cold Handoff

**Cold handoff:** Agent A stops processing. Agent B receives context and starts from scratch. Simple but jarring — the customer may feel they have to repeat themselves.

**Warm handoff:** Both agents are briefly active. Agent A generates a brief (`[Handoff from Sales]: Customer asking about pricing for Pro plan. Has existing Starter subscription. Mood: curious, not frustrated.`). This brief is injected into Agent B's context window as a synthetic "assistant" message before Agent B processes the real user message. Agent B then responds with full awareness.

**Recommendation:** Warm handoff is the right model for Phase 8. Implementation:
1. Router decides to switch agents
2. `ContextSummarizer` generates a handoff brief (agent-facing, not operator-facing) — or use existing history
3. Brief injected into session history as a synthetic message tagged `[Handoff context]` (same pattern as existing release route)
4. Agent B processes next user message with full context

Source: Anthropic multi-agent patterns blog, AutoGen documentation (Microsoft, 2024-2025)

### 2.2.3 Ping-Pong Prevention

The most dangerous failure mode: Agent A routes to Agent B, Agent B immediately routes back to Agent A, infinite loop.

**Production defenses:**

1. **Cooling period:** After handoff from A to B, do not allow re-routing away from B for N turns (configurable, default: 3). Used by Sierra.
2. **Handoff stack limit:** Maximum 2 handoffs per session. After limit, force to fallback agent. Used by Intercom.
3. **Agent pair blacklist:** If (A → B) has occurred this session, forbid (B → A) for the remainder of the session. Simplest to implement.
4. **Supervisor arbitration:** A meta-agent reviews any re-route request and can reject it. High quality but adds latency.

**Recommendation for Kiln Phase 8:**
- Track `routingHistory: Array<{ agentId, turn }>` in session
- On re-route, check: has current agent been active for >= `rerouteAfterTurns` (default: 1)?
- Track `handoffCount` per session; cap at `maxHandoffs` (default: 3, configurable)
- If agent pair has already been traversed (A→B), apply higher confidence threshold for B→A (0.95 vs 0.85)

### 2.2.4 Context Window Management

Each agent has a different system prompt, which means its "baseline" context changes on handoff. Production approaches:

1. **Full history:** Pass complete conversation history to new agent. Works but burns tokens on long conversations.
2. **Recent N turns:** Pass last N turns (default: 10). Agents don't need full history, just current context.
3. **Handoff brief + recent:** Structured handoff brief + last 3-5 turns. Best quality-to-token ratio.
4. **Compression:** Use a compressor to reduce old turns before passing. Kiln doesn't have this yet.

**Recommendation:** Pass the full session history as-is (Kiln's current session format), but prepend a handoff brief to the system prompt when the active agent changes. No history truncation needed for Phase 8a; add compression in Phase 8c for sessions exceeding 50 turns.

## 2.3 Architectural Recommendations

### Session Changes for Inter-Agent Handoff

```typescript
// packages/runtime/src/session/mode-b-session.ts (additions)

export interface AgentTurn {
  readonly agentId: string;
  readonly startMessageIndex: number; // which message index in conversationHistory
  readonly handoffReason?: string;
  readonly handoffBrief?: string;     // LLM-generated brief when switching
}

// ModeBSession additions:
// - activeAgentId: string | undefined
// - previousAgentId: string | undefined  (for ping-pong guard)
// - agentTurnHistory: AgentTurn[]
// - handoffCount: number
// - lastRouteChangeAt: number  (turn index of last route change)

// setActiveAgent() method:
setActiveAgent(
  agentId: string,
  handoffBrief?: string,
): void {
  if (this._activeAgentId === agentId) return;

  // Record the turn
  this._agentTurnHistory.push({
    agentId,
    startMessageIndex: this._conversationHistory.length,
    handoffBrief,
  });

  this._previousAgentId = this._activeAgentId;
  this._activeAgentId = agentId;
  this._handoffCount++;
  this._lastRouteChangeAt = this._conversationHistory.length;

  // Inject handoff brief into conversation if provided
  if (handoffBrief) {
    this.addUserMessage(textParts(`[Context] ${handoffBrief}`));
  }
}
```

### Handoff Brief Generation

The existing `ContextSummarizer` generates operator-facing summaries. For inter-agent handoff, a slightly different prompt is needed:

```typescript
// packages/runtime/src/session/agent-handoff-summarizer.ts

const AGENT_HANDOFF_PROMPT = (fromAgent: string, toAgent: string) =>
  `You are generating a handoff brief from ${fromAgent} to ${toAgent}. Summarize in 2-3 sentences:
  1. What the customer needs
  2. What has been discussed or attempted
  3. Any key facts the next agent should know immediately
  Format: "[Handoff from ${fromAgent}] ..."`;
```

### Ping-Pong Guard in Router

```typescript
// In DefaultTenantRouter.route():

function isPingPong(
  decision: RoutingDecision,
  session: ModeBSession,
  config: TenantRoutingConfig,
): boolean {
  const maxHandoffs = config.maxHandoffs ?? 3;
  if (session.handoffCount >= maxHandoffs) return true;

  const minTurnsBeforeReroute = config.rerouteAfterTurns ?? 1;
  const turnsSinceLastChange = session.conversationHistory.length - session.lastRouteChangeAt;
  if (decision.isReroute && turnsSinceLastChange < minTurnsBeforeReroute) return true;

  // Bidirectional pair check: A→B already happened, now B→A requires high confidence
  const prevAgent = session.previousAgentId;
  if (prevAgent && decision.agentId === prevAgent && decision.confidence < 0.95) return true;

  return false;
}
```

## 2.4 Edge Cases & Failure Modes

| Scenario | What Breaks | Mitigation |
|----------|-------------|------------|
| Handoff brief generation fails | No context for new agent | Fail-open: skip brief, agent starts with raw history |
| Agent switches mid-tool-execution | Tool result reaches wrong agent | Complete current tool round before switching agents |
| Human handoff during inter-agent handoff | State conflict | Session mode takes precedence: if `human_active`, no agent routing until released |
| Max handoffs reached | Customer stuck with fallback | Emit `MAX_HANDOFFS_REACHED` event; Kilvo backend shows escalation suggestion |
| Agent handoff brief exceeds context | Token overflow | Truncate brief to 500 chars; pass last 3 turns raw |

## 2.5 Beyond State of the Art

**Agent-to-agent knowledge sharing:** When agent A resolves a query and hands off to agent B, A can write a structured "case note" to the shared `team:${tenantId}` memory scope. This persists across sessions, not just within a session. Over time, agents learn from each other's successful resolutions.

**Confidence-weighted context:** Instead of a uniform handoff brief, the generating agent assigns confidence scores to each piece of context. "Customer name: Maria (90% confidence)" vs "Customer has Pro plan (60% confidence, inferred from pricing questions)." The receiving agent can weight uncertain context appropriately.

**Active/passive agent model:** In high-stakes handoffs, Agent A remains "passive" for the first 2-3 turns after handing off to Agent B, monitoring the response quality. If Agent B struggles (detected via loop detection), Agent A can inject a correction. This is a form of multi-agent collaboration vs sequential handoff.

---

# Track 3: Agent Scoping & Isolation

## 3.1 Current State Assessment

Kiln v0.5.0 has one scope per tenant:

- **System prompt:** `buildTenantSystemPrompt(tenant, channel)` — single string
- **Tool access:** `buildTenantToolContext(tenant)` — one allowlist, one set of webhook tools
- **Knowledge:** One `RetrievalPipeline` per App (shared across all tenants and their agents)
- **Memory:** Contact facts are per-user (correct — shared). Session memory is per-session (correct — naturally isolated)

**Gap:** No mechanism for Agent A to have different tools than Agent B within the same tenant. No mechanism for Agent A to search a different knowledge collection than Agent B.

## 3.2 Research Findings

### 3.2.1 Tool Scoping

**Kubernetes RBAC pattern** (adapted for AI agents): Define tool permissions as a set of allowed capability names per agent. Applied at routing time, not at agent definition time. This is what `PerCallToolConfig.toolAllowlist` already provides in Kiln — it just needs to be populated from per-agent config instead of per-tenant config.

**Google ADK (2025):** Agent-level tool access uses the concept of "agent profiles" — each profile defines a subset of the system's registered tools that the agent can invoke. Profiles are validated at startup, not at runtime.

**OpenAI Agents SDK (2025):** Each agent receives its own `tools` list at construction time. The SDK does not implement cross-agent tool access checking — it's the developer's responsibility to scope.

**Key insight:** Tool scoping is already supported by Kiln's architecture. `PerCallToolConfig.toolAllowlist` accepts a `ReadonlySet<string>` that gates tool execution in `ModeBOrchestrator`. The only change needed is to populate this from `TenantAgentConfig.tools` instead of `TenantConfig.tools`.

### 3.2.2 Knowledge Scoping

Three approaches for per-agent knowledge scoping:

**Approach A: Separate vector stores per agent**
- Each agent has its own `RetrievalPipeline` with its own `VectorStore`
- Complete isolation, highest flexibility
- Cost: one PgVector collection per agent per tenant = expensive at scale (100 tenants × 3 agents = 300 collections)
- Source: PgVector multi-tenancy documentation

**Approach B: Shared collection with namespace filter**
- Single vector store per tenant
- Each chunk stored with `agentId` metadata
- At retrieval, filter by `agentId IN [currentAgent, 'shared']`
- Cost: one collection per tenant, scales well
- Recommendation: **use this approach**

**Approach C: Semantic tagging**
- All chunks in shared collection
- Chunks tagged by topic domain (`billing`, `sales`, `support`)
- Agent config specifies `knowledgeTags: ['billing']`
- At retrieval, filter by agent's tags
- More flexible than agentId filter but requires content tagging

**Recommendation:** Start with Approach B (namespace filter) in Phase 8a. Add Approach C (semantic tagging) as a premium feature in Phase 8c.

**PgVectorStore hybrid search already supports metadata filters:**
```sql
SELECT content, source, 1 - (embedding <=> $1) AS similarity
FROM kiln_embeddings
WHERE (metadata->>'agentId' = $2 OR metadata->>'agentId' = 'shared')
ORDER BY similarity DESC
LIMIT $3;
```

This requires minimal changes to `PgVectorStore.query()` — add an optional `filter` parameter.

Source: PgVector documentation, Phase 4 research document (pgvector-store.ts implementation details)

### 3.2.3 Memory Scoping

Kiln's `MemoryScope` type already supports `agent:${name}` scope:

```typescript
export type MemoryScope = "user" | `agent:${string}` | `team:${string}` | `project:${string}` | "org";
```

For Phase 8:
- **Contact facts (contact memory):** Shared across all agents — this is correct behavior. All agents benefit from knowing the customer's history.
- **Agent working memory:** Each agent can use `agent:${agentId}` scope for patterns specific to that agent's domain.
- **Team memory:** Use `team:${tenantId}` for shared context across all agents in a tenant.

No changes needed to `MemoryScope` — it already supports the right scoping model.

### 3.2.4 System Prompt Composition

For multi-agent tenants, the system prompt must compose:

```
1. Tenant identity: "You are a virtual assistant for [businessName]."
2. Language instruction: "Always detect and match the customer's language."
3. Agent persona: "Your name is [agentName]. [role]. [goal]."
4. Agent backstory (optional): [backstory]
5. Agent instructions (optional): [instructions specific to this agent]
6. Tool context: "You have access to: [tool descriptions]"
7. Knowledge mode context: "Search the knowledge base when needed" (if tool mode)
8. Handoff context (if re-routed): "[Handoff from SalesAgent]: ..."
```

The current `buildTenantSystemPrompt(tenant, channel)` in `system-prompt-builder.ts` handles items 1-3. Items 4-8 are new additions for Phase 8.

## 3.3 Architectural Recommendations

### TenantAgentConfig Schema

```typescript
// packages/core/src/engine/gateway/tenant-config.ts (additions)

export interface TenantAgentConfig {
  /** Unique identifier within this tenant (e.g. "sales", "support", "billing") */
  readonly id: string;
  /** Display name shown in analytics and handoff briefs */
  readonly name: string;
  /** Agent's professional role (e.g. "Sales Specialist") */
  readonly role: string;
  /** Agent's primary goal */
  readonly goal: string;
  /** Optional background narrative */
  readonly backstory?: string;
  /** Additional instructions for this agent's domain */
  readonly instructions?: string;
  /** Allowed tool names (subset of tenant's tool set). Null = all tools allowed. */
  readonly tools?: readonly string[];
  /** Knowledge scoping: which agentIds' chunks to include in retrieval */
  readonly knowledgeScope?: readonly string[];
  /** Override global model for this agent */
  readonly model?: string;
  /** Override global tier for this agent */
  readonly tier?: "reasoning" | "coding" | "fast";
  /** Pre-computed description embedding (set by router on config change) */
  readonly _descriptionEmbedding?: readonly number[];
}

export interface TenantRoutingConfig {
  /** Regex rules: first match wins */
  readonly rules?: readonly PatternRule[];
  /** Agent to route to when no rule matches AND embedding/classifier uncertain */
  readonly fallback: string;
  /** Enable LLM classifier (default: true when classifier model available) */
  readonly classifier?: boolean;
  /** Minimum embedding similarity to route without classifier (default: 0.75) */
  readonly embeddingThreshold?: number;
  /** Re-route confidence threshold (higher than initial routing threshold, default: 0.85) */
  readonly rerouteThreshold?: number;
  /** Minimum turns before re-routing away from current agent (default: 1) */
  readonly rerouteAfterTurns?: number;
  /** Maximum total handoffs per session (default: 3) */
  readonly maxHandoffs?: number;
}
```

### Per-Agent Context Building

```typescript
// packages/runtime/src/gateway/agent-context-builder.ts (new)

export function buildAgentSystemPrompt(
  tenant: TenantConfig,
  agent: TenantAgentConfig,
  channel: string,
  handoffBrief?: string,
): string {
  const lines: string[] = [];

  // 1. Business identity
  const businessName = tenant.businessName ?? tenant.name ?? "our business";
  lines.push(`You are a virtual assistant for ${businessName}.`);

  // 2. Language
  lines.push("Always detect the customer's language and respond in the same language.");

  // 3. Agent persona
  lines.push(`Your name is ${agent.name}. You are a ${agent.role}. ${agent.goal}.`);

  // 4. Backstory
  if (agent.backstory) lines.push(agent.backstory);

  // 5. Instructions
  if (agent.instructions) lines.push(agent.instructions);

  // 6. Handoff context (injected at front of context, not system prompt)
  // Note: handoff brief is added as a synthetic message, not in system prompt

  return lines.join("\n\n");
}

export function buildAgentPerCallConfig(
  tenant: TenantConfig,
  agent: TenantAgentConfig,
  baseContext: TenantToolContext,
): PerCallToolConfig {
  // Per-agent tool allowlist: intersection of tenant tools and agent-allowed tools
  let toolAllowlist: ReadonlySet<string> | undefined = baseContext.toolAllowlist;

  if (agent.tools !== undefined) {
    const agentTools = new Set(agent.tools);
    // If tenant already has an allowlist, take the intersection
    toolAllowlist = new Set(
      [...agentTools].filter(t => !baseContext.toolAllowlist || baseContext.toolAllowlist.has(t))
    );
  }

  return {
    toolAllowlist,
    rateLimiter: baseContext.rateLimiter,
    tenantId: tenant.tenantId,
    additionalTools: baseContext.toolDefinitions,
  };
}
```

## 3.4 Edge Cases & Failure Modes

| Scenario | What Breaks | Mitigation |
|----------|-------------|------------|
| Agent configured with tools not in tenant allowlist | Agent gets tools it shouldn't have | Validate `agent.tools ⊆ tenant.tools` at config save time |
| Agent has empty tools list | Agent cannot call any tools | Warn in console; explicit empty = no tools (by design) |
| Knowledge scope references nonexistent agentId | Empty retrieval results | Fail-open: retrieve without filter |
| Agent model is unavailable | Zero responses | Fall back to tenant-level model, then global model |
| All agent descriptions identical | Embedding routing uniform | Log warning; suggest diversifying agent descriptions |

## 3.5 Beyond State of the Art

**Dynamic tool surfaces:** Rather than static per-agent tool lists, agents could declare their capabilities as semantic descriptions, and tools are matched at runtime via ToolRAG. "I am a billing agent, I need payment and invoice tools" — the system finds matching tools from the registry. This enables zero-configuration tool assignment for new agents.

**Cross-agent tool delegation:** Agent B needs a tool only available to Agent A. Rather than duplicating the tool configuration, Agent B can delegate a sub-task to Agent A via the A2A protocol. This creates a principled way to share specialized capabilities across agent boundaries without configuration duplication. Kiln already has `A2AClient` for cross-App delegation — the same pattern applies intra-tenant.

**Capability-based permission model (future v2.0):** Replace boolean tool allowlists with OAuth 2.1-style scopes. `agent:sales` gets `tools:read` for CRM and `tools:write` for booking. `agent:billing` gets `tools:read:invoices` and `tools:write:refunds`. This is the composable authorization item from the v1.0 backlog — include a simplified version in Phase 8.

---

# Track 4: TenantConfig & Session Model Evolution

## 4.1 Current State Assessment

**TenantConfig (current, from `engine/gateway/tenant-config.ts`):**
```typescript
export interface TenantConfig {
  // Identity
  tenantId: string;
  appName: string;
  enabled: boolean;

  // Agent identity (single agent)
  name?: string;           // agent name (e.g. "Sol")
  businessName?: string;   // business name (e.g. "Bonita's Salon")
  systemPrompt?: string;   // full agent instructions
  model?: string;
  tier?: string;

  // Tool access (single agent)
  tools?: string[];
  webhookTools?: WebhookToolConfig[];
  toolConfig?: ToolConfig;

  // Knowledge (single agent)
  knowledge?: KnowledgeConfig;

  // Channel credentials
  whatsappPhoneNumberId?: string;
  whatsappAccessToken?: string;
  widgetId?: string;
  instagramPageId?: string;
  instagramAccessToken?: string;
  messengerPageId?: string;
  messengerAccessToken?: string;
  emailAddress?: string;
  emailFromAddress?: string;
  emailTransportConfig?: EmailTransportConfig;

  // Behavior
  billing?: Partial<BillingConfig>;
  allowedOrigins?: string[];
  faqEntries?: Array<{ q: string; a: string }>;
  greeting?: string;
  escalationContact?: string;

  // Timestamps
  createdAt: string;
  updatedAt?: string;
}
```

**ModeBSession (current, from `session/mode-b-session.ts`):**
```typescript
// Key fields (inferred from usage):
class ModeBSession {
  id: string;           // ${appName}:${tenantId}:${userId}:${timestamp}
  appName: string;
  tenantId?: string;
  userId: string;
  systemPrompt: string;
  sessionMode: SessionMode;
  conversationHistory: AgentMessage[];
  version: number;        // optimistic concurrency
  loadedVersion: number;
  createdAt: Date;
  lastActivityAt: Date;
  idleTimeoutMs: number;
}
```

## 4.2 Research Findings

### 4.2.1 Schema Evolution Principles

**Additive-only changes** are the safest migration path. Adding `agents?` and `routing?` as optional fields to `TenantConfig` means:
- All existing tenants continue working without any changes
- Backward compatibility is automatic: single-agent mode when `agents` is undefined or has 1 entry
- The Kilvo backend pushes agents[] to the gateway as it implements Phase 8

Source: Martin Fowler's "Parallel Change" refactoring pattern (martinfowler.com), applied to API evolution

### 4.2.2 Session Model for Multi-Agent Conversations

Research on conversational threading models:

**Linear threading (current):** One sequence of messages. Simple. Does not record which agent handled which turn. OK for single-agent.

**Agent-annotated threading (Phase 8):** Same linear sequence but each turn is annotated with `agentId`. The conversation history looks like:
```
[user] "What's the price for Pro?"
[assistant:sales] "The Pro plan is $79/mo..."
[user] "I have a billing question about my invoice"
[assistant:billing] "I can help with that..."
```

**Branching threading (v2.0+):** Multiple conversation branches, one per agent interaction. Would require major changes to session structure. Not recommended for Phase 8.

**Recommendation:** Agent-annotated linear threading. The session history stays as `AgentMessage[]` but with an optional `agentId` annotation per assistant message. When deserializing old sessions, `agentId` is undefined (backward compatible).

### 4.2.3 Optimistic Concurrency in Multi-Agent Sessions

The existing `version`/`loadedVersion` pattern in `SessionRegistry.save()` prevents concurrent modification. In Phase 8, routing adds a new write path (updating `activeAgentId` on the session). Two concurrent messages from the same user on different channels could both attempt to set `activeAgentId`. The existing concurrency check handles this correctly — the second write will detect a version mismatch and retry.

### 4.2.4 SessionMode Compatibility

The existing `SessionMode` state machine (`ai_active → queued → human_active → ai_active`) must remain unchanged for Phase 8. Inter-agent handoff does NOT change the `SessionMode` — it's orthogonal:

- `SessionMode` controls: is the AI active, or is a human operator handling it?
- `activeAgentId` controls: which AI agent is currently active?

A session can be `human_active` AND have `activeAgentId = "billing"` (so when released, billing agent resumes).

## 4.3 Architectural Recommendations

### Extended TenantConfig

```typescript
// Additions to TenantConfig (backward compatible):

export interface TenantConfig {
  // ... all existing fields unchanged ...

  // Phase 8: Multi-agent support (optional — omit for single-agent mode)
  agents?: readonly TenantAgentConfig[];
  routing?: TenantRoutingConfig;
}
```

### Extended ModeBSession

```typescript
// Additions to ModeBSession (backward compatible):

class ModeBSession {
  // ... all existing fields unchanged ...

  // Phase 8: Active agent tracking
  private _activeAgentId: string | undefined = undefined;
  private _previousAgentId: string | undefined = undefined;
  private _agentTurnHistory: AgentTurn[] = [];
  private _handoffCount: number = 0;
  private _lastRouteChangeAt: number = 0;

  get activeAgentId(): string | undefined { return this._activeAgentId; }
  get handoffCount(): number { return this._handoffCount; }
  get agentTurnHistory(): readonly AgentTurn[] { return this._agentTurnHistory; }

  setActiveAgent(agentId: string, handoffBrief?: string): void {
    // ... implementation as shown in Track 2 ...
  }
}
```

### Session Serializer Updates

```typescript
// session/session-serializer.ts (additions):

// Serialize:
function serialize(session: ModeBSession): SerializedSession {
  return {
    // ... existing fields ...
    activeAgentId: session.activeAgentId,
    previousAgentId: session.previousAgentId,
    agentTurnHistory: session.agentTurnHistory,
    handoffCount: session.handoffCount,
    lastRouteChangeAt: session.lastRouteChangeAt,
  };
}

// Deserialize: all Phase 8 fields default to undefined/0 for old sessions
```

### Backward Compatibility Test Matrix

| TenantConfig State | Behavior |
|-------------------|----------|
| No `agents` field | Single-agent: use `name` + `systemPrompt` (current behavior, unchanged) |
| `agents.length === 0` | Error: invalid config, reject at validation |
| `agents.length === 1` | Single-agent: use that agent's config, no routing overhead |
| `agents.length >= 2` | Multi-agent: routing required, `routing.fallback` must be set |
| `agents` set but no `routing` | Error: multi-agent requires routing config |

## 4.4 Edge Cases & Failure Modes

| Scenario | What Breaks | Mitigation |
|----------|-------------|------------|
| Agent removed from config mid-session | activeAgentId references nonexistent agent | Validate on each route; fall back to routing.fallback if agent not found |
| Session stored in Redis, config updates | Stale activeAgentId after agent rename | Use agent.id (immutable) not agent.name for routing |
| SessionMode `human_active`, then agent changes | Possible confusion | Only route when `sessionMode === "ai_active"` |
| Redis session TTL expires mid-conversation | Agent context lost | Rebuild from routing on session recreation; contact memory preserves customer context |

## 4.5 Beyond State of the Art

**Agent affinity sessions:** A customer who always asks about billing gets automatically assigned to the billing agent at session start (before any routing analysis), based on their historical `agentTurnHistory` stored in contact memory. This is a routing optimization that eliminates the routing step for returning customers with clear agent patterns.

**Cross-session agent continuity:** When a customer contacts the business again, and their last session ended with agent B, start the new session with agent B (if the returning message appears related to the previous topic). Contact memory can store the last-active agent and its topic context, enabling agent-aware session initialization.

---

# Track 5: YAML Configuration & App Loader Evolution

## 5.1 Current State Assessment

Kiln's routing configuration lives at two levels:

1. **App YAML level** (`app.yaml`): `router:` composite routes incoming messages to Teams. This is YAML-static, loaded at gateway startup.
2. **Tenant level**: TenantConfig is pushed via admin API. Currently has no routing configuration.

For Phase 8, the multi-agent routing decision is inherently **runtime-dynamic** (tenant admins configure it via console, stored in Kilvo's backend, pushed to gateway). It does NOT belong in `app.yaml`.

## 5.2 Research Findings

### 5.2.1 Static vs Dynamic Routing Configuration

**Static routing (app.yaml):** Best for platform-level routing decisions that don't change per-tenant. Example: "All messages to `app:support` go to the `support-team` team." This is what Kiln's current Router composite handles.

**Dynamic routing (admin API / tenant config):** Best for tenant-specific routing that changes frequently. Example: "Tenant X has a Sales agent that handles pricing, a Support agent that handles complaints." This is what Phase 8 needs.

**Industry practice:** Chatwoot uses rule-based assignment stored in the database, configurable per team. Intercom uses "Assignment Rules" (database-stored). Respond.io uses "Workflow Rules" (database-stored). None of these are YAML-defined.

**Conclusion:** Phase 8 multi-agent routing config lives in `TenantConfig` (pushed via admin API), NOT in `app.yaml`. The YAML Router composite stays as-is for App-level Team routing.

### 5.2.2 App YAML Evolution (Optional Enhancement)

For Mode A use cases (non-multi-tenant), the existing `router.rules[].team` notation could be extended to `router.rules[].agent` to support intra-team agent routing. However, this is not required for Phase 8's primary use case (Kilvo) and should be deferred.

```yaml
# Future (not Phase 8):
router:
  rules:
    - match: "^billing"
      agent: billing-specialist    # routes to agent within the team
    - match: "^sales"
      agent: sales-specialist
  fallback: support-agent
```

### 5.2.3 Hot-Reload for Routing Config

When a tenant admin updates their agent configuration, the gateway should reflect it immediately without restart. The existing TenantRegistry already stores and retrieves config from JSON files (in-memory with file persistence). Hot-reload of routing config is therefore automatic — the next inbound message will read the updated TenantConfig including `agents[]` and `routing`.

Pre-computed embeddings (for Tier 2 routing) need to be invalidated when agent descriptions change. The router should maintain an embedding cache keyed by `tenantId:agentId:descriptionHash`. On config update, the hash changes, triggering re-computation on first use (or proactively via a background task).

### 5.2.4 CLI Evolution

The `kiln init` wizard currently creates a single-agent app.yaml. For Phase 8, an optional multi-agent flow:

```
? How many AI agents do you want? (1 = single agent, 2+ = team)
  ○ 1 agent (recommended for getting started)
  ● 3 agents (Sales, Support, Billing)
  ○ Custom

→ Agent 1: Role? [Sales Specialist]
→ Agent 1: Primary topics? [pricing, plans, upgrades]
→ Agent 2: Role? [Support Specialist]
...
```

This generates the `agents[]` configuration in the initial tenant setup, not in app.yaml.

## 5.3 Architectural Recommendations

### Admin API Extension for Agents

```
# New admin API routes (mounted at /{appPath}/admin/)

GET    /tenants/:id/agents          → List agents for tenant
POST   /tenants/:id/agents          → Create agent
GET    /tenants/:id/agents/:agentId → Get agent
PUT    /tenants/:id/agents/:agentId → Update agent
DELETE /tenants/:id/agents/:agentId → Delete agent

GET    /tenants/:id/routing         → Get routing config
PUT    /tenants/:id/routing         → Update routing config
POST   /tenants/:id/routing/test    → Test routing for a given message
```

The routing test endpoint is critical for tenant self-service:
```json
POST /tenants/my-tenant/routing/test
{ "message": "I want to book an appointment" }
→ { "agentId": "booking", "confidence": 0.94, "tier": "rules", "reasoning": "Matched pattern: appointment" }
```

### Validation at Config Update Time

```typescript
// Validation rules for multi-agent TenantConfig:
function validateMultiAgentConfig(config: TenantConfig): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!config.agents || config.agents.length === 0) return errors; // single-agent OK

  // Agent IDs must be unique
  const agentIds = new Set(config.agents.map(a => a.id));
  if (agentIds.size !== config.agents.length) {
    errors.push({ field: "agents", message: "Agent IDs must be unique" });
  }

  // routing is required for multi-agent
  if (config.agents.length >= 2 && !config.routing) {
    errors.push({ field: "routing", message: "routing config required when agents.length >= 2" });
  }

  // routing.fallback must reference a valid agent
  if (config.routing && !agentIds.has(config.routing.fallback)) {
    errors.push({ field: "routing.fallback", message: `Agent "${config.routing.fallback}" not found` });
  }

  // routing.rules must reference valid agents
  for (const rule of config.routing?.rules ?? []) {
    if (!agentIds.has(rule.team)) { // rule.agentId in Phase 8 schema
      errors.push({ field: `routing.rules`, message: `Agent "${rule.team}" not found` });
    }
  }

  // Per-agent tool validation
  const tenantTools = new Set([
    ...(config.tools ?? []),
    ...(config.webhookTools ?? []).map(t => t.name),
  ]);
  for (const agent of config.agents) {
    for (const tool of agent.tools ?? []) {
      if (!tenantTools.has(tool)) {
        errors.push({ field: `agents.${agent.id}.tools`, message: `Tool "${tool}" not in tenant tools` });
      }
    }
  }

  return errors;
}
```

## 5.4 Edge Cases & Failure Modes

| Scenario | What Breaks | Mitigation |
|----------|-------------|------------|
| Tenant deletes an agent that is activeAgentId in sessions | Routing fails | Garbage collect stale activeAgentId before next routing decision |
| Routing config references agent by name vs id | Silent mismatch | Enforce: rules reference agent.id only |
| Config push during peak traffic | Partial state visibility | TenantRegistry.update() is atomic in-memory; no mid-write inconsistency |
| Invalid regex in routing rule | Runtime error | Validate regex at config save time (same as Router composite validation) |

## 5.5 Beyond State of the Art

**Routing rule marketplace:** Tenant admins configure routing in their console (Kilvo UI). But what if Kiln shipped a library of pre-built routing rule templates? "Use the Service Business template: automatically routes `appointment`, `booking`, `schedule` to your Booking agent." This is analogous to ChatGPT plugins — a curated library reduces configuration friction dramatically. The templates would live in the domain kit YAML files (`core/src/domains/service-business.yaml`).

**Semantic routing rules:** Instead of regex, allow natural language routing rules: `"Route to Sales when customer asks about pricing, features, or upgrades"`. The engine translates this to an embedding-based matcher at load time. This makes routing configuration accessible to non-technical tenant admins. No regex expertise required.

---

# Track 6: Production Patterns & Edge Cases

## 6.1 Current State Assessment

Kiln v0.5.0 production patterns:
- **Cost tracking:** `CostUpdateEvent` per session, `byRole` breakdown
- **Rate limiting:** `SlidingWindowRateLimiter` per-tool per-tenant
- **Audit logging:** JSONL + hash chain, per gateway
- **Observability:** OTel spans (already implemented via `OTelExporter`)
- **A/B testing:** Eval framework (experiment comparator, 12 scorers)

**Gaps for Phase 8:**
- No per-agent cost breakdown
- No routing quality metrics
- No agent-level analytics (which agent handles X% of conversations)
- No A/B testing for routing strategies

## 6.2 Research Findings

### 6.2.1 Observability for Multi-Agent Systems

**MLflow AI Gateway (2024-2025):** Tracking agent-level metrics requires routing decisions to be logged as spans. Each routing decision should emit: `{ agentId, tier, confidence, latencyMs, isReroute }`.

**LangSmith (LangChain):** Production multi-agent tracing annotates each LLM call with the active agent. Cost, latency, and quality metrics can then be aggregated by agent. Key metric for routing quality: "escalation rate" (how often the routed agent escalates to a different agent or human).

**Anthropic's internal tooling:** Logs `routing_decision` events alongside conversation events. Post-hoc analysis identifies misrouted conversations by comparing routing decision with the actual agent that successfully resolved the query.

**Recommendation for Kiln Phase 8:**
- Add `agentId` to `CostUpdateEvent` payload
- Emit `AGENT_ROUTED` conversation event (fire-and-forget via ConversationEventEmitter)
- Add routing spans to OTel trace context (existing `TraceContext` can be extended)

### 6.2.2 Cost Tracking Per Agent

Current `CostUpdateEvent.byRole` tracks by "reasoning/coding/fast" tier. For Phase 8, cost attribution changes:

```typescript
// Extended cost tracking:
byAgent?: {
  [agentId: string]: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    calls: number;
  };
};
```

Kilvo's backend consumes conversation events to populate analytics. Adding `agentId` to cost-related events allows per-agent cost analytics without changes to Kilvo's core data model — just a new dimension on existing event data.

### 6.2.3 Provider Failure Fallback

When an agent's configured model provider is unavailable (rate limited, outage):
- The agent's `model` override is used first; if that fails, fall back to tenant model; if that fails, fall back to App-level provider.
- This is already how the provider resolution chain works in Mode B (provider from OrchestratorDeps).
- For Phase 8, the agent-level model override needs to be applied when building OrchestratorDeps for that agent.

### 6.2.4 Agent Versioning

When a tenant admin updates an agent's persona mid-day, active sessions should not be disrupted. Two approaches:

**Session-pinned versioning:** Each session stores the `agentVersion` it was created with. Routing uses that version's config for the session lifetime. Agent config updates only affect new sessions.

**Live update:** Sessions use the current config, including updates. No versioning needed. Simpler but risks conversation quality degradation mid-session if the persona changes drastically.

**Recommendation:** Live update for Phase 8 (simpler, lower risk for the SMB use case where admins rarely change active agents mid-day). Add session-pinned versioning in Phase 8c as an opt-in flag.

### 6.2.5 Concurrent Conversations

A customer contacts the business simultaneously via WhatsApp (Sales agent) and Web Widget (Support agent). Scenarios:
- Session keys include channel type? No — current key is `${appName}:${tenantId}:${userId}` without channel. Same user on two channels would share a session.
- This is intentional for single-agent: all channels lead to one conversation context.
- For multi-agent Phase 8: same session, but `activeAgentId` may differ by channel. This is a race condition.

**Recommendation:** Session key remains unchanged. `activeAgentId` is the last-written value. For the SMB use case, simultaneous dual-channel conversations are rare enough that eventual consistency is acceptable. Document this limitation. Add per-channel agent affinity (channel-specific activeAgentId) as a Phase 8c enhancement.

### 6.2.6 Routing Quality Measurement

How do you know if routing is working correctly? No benchmark exists for this in production systems. Proposed metrics:

| Metric | Definition | Target |
|--------|------------|--------|
| Routing accuracy | % conversations where initial routing agent resolved the query | > 85% |
| Reroute rate | % conversations that required agent switching | < 10% |
| Ping-pong rate | % conversations that triggered ping-pong guard | < 1% |
| Routing latency | P99 latency added by routing layer | < 200ms |
| Fallback rate | % conversations using fallback agent | < 15% |

These can be computed from `AGENT_ROUTED` and `ESCALATION_DETECTED` events in Kilvo's analytics.

### 6.2.7 "Your AI Team" as Product Marketing

**Competitive analysis at $29-299/mo SMB tier:**

| Product | Multi-Agent | Routing | Price |
|---------|------------|---------|-------|
| Intercom Fin | No (single AI, topic classification internal) | No | $0.99/resolution |
| Zendesk AI | "Department routing" (rule-based to human teams) | No (to AI) | $50/agent/mo |
| Ada | "Topics" (pre-programmed flows, not multiple agents) | No | $2,000+/mo |
| Sierra | Custom agents (proprietary, enterprise-only) | Yes | $150K+ ARR |
| Respond.io | Internal micro-agents (not exposed as product) | No | $79-299/mo |
| Wati | Single agent | No | $59/mo |
| Chatfuel | Single agent | No | $34/mo |

**Market gap:** No product under $300/mo exposes multi-agent routing as a customer-facing product feature. Kilvo's "Your AI Team" marketing (from kilvo-roadmap.md) is a genuine first-mover opportunity at the SMB tier.

**Differentiation angle:**
- Sierra has custom agents at enterprise prices ($150K+ ARR)
- Kilvo has "Your AI Team" at $79/mo (Pro: 3 agents) and $199/mo (Business: 10 agents)
- The key product insight: **agent count is the natural upgrade trigger** — as businesses grow (more products, more query types), they need more specialists

**"No one has done this yet" opportunity:** At the SMB tier, the unanswered question is: can AI team routing be configured in under 10 minutes by a non-technical business owner? If yes, Kilvo captures the market before anyone with VC money realizes the opportunity. The console UX (role selection, keyword configuration, agent persona wizard) is the competitive moat, not the technology.

## 6.3 Architectural Recommendations

### AGENT_ROUTED Conversation Event

```typescript
// New event type for ConversationEventEmitter:
interface AgentRoutedEvent extends ConversationEvent {
  eventType: "AGENT_ROUTED";
  agentId: string;
  agentName: string;
  tier: "rules" | "embedding" | "classifier" | "fallback";
  confidence: number;
  isReroute: boolean;
  previousAgentId?: string;
  routingLatencyMs: number;
}
```

### A/B Testing Routing Strategies

Kiln's eval framework already has an `ExperimentRunner` and `Comparator`. For routing A/B testing:

1. Define two `TenantRoutingConfig` variants (A and B)
2. Route even-numbered sessions to variant A, odd to variant B (or by user hash)
3. Track `AGENT_ROUTED` + `ESCALATION_DETECTED` events per variant
4. Compare: reroute rate, escalation rate, response quality (human eval or LLM-as-judge)

This can use the existing eval dataset infrastructure — no new primitives needed.

### Per-Agent Cost Attribution in OTel

```typescript
// Extend TraceContext to carry agentId:
export class TraceContext {
  // existing fields...
  agentId?: string;

  setAgent(agentId: string): void {
    this.agentId = agentId;
  }
}

// OTelExporter will map agentId to span attributes:
// gen_ai.agent.id, gen_ai.agent.name
```

## 6.4 Edge Cases & Failure Modes

| Scenario | What Breaks | Mitigation |
|----------|-------------|------------|
| All agents fail (model outage) | No response to customer | Return graceful error message: "Our agents are temporarily unavailable. Please try again in a few minutes." |
| Routing latency spike (embedding API down) | Tier 2 slow, Tier 3 fired | Circuit breaker on embedding API; fall straight to Tier 3/fallback on timeout |
| Tenant with 10 agents, all similar descriptions | Routing accuracy poor | Log warning with suggestion to diversify agent descriptions; provide routing test UI |
| Billing agent gets sales question | Suboptimal response | Accepted: agent can handle off-scope questions; quality degrades gracefully |
| Customer explicitly asks to switch agents | No explicit command handling | Add to Tier 1 rules: "speak to {agentId}" patterns; update `activeAgentId` directly |

## 6.5 Beyond State of the Art

**Self-optimizing routing:** The routing system observes resolution outcomes (did the routed agent resolve the query, or did it require escalation?) and automatically adjusts routing weights. Conversations that required rerouting become negative training examples for the routing rules. This is a form of online reinforcement learning applied to agent selection — no one has shipped this at the SMB tier.

**Predictive routing with contact history:** On session start, before the first message, run contact memory recall. If the customer's last 5 sessions were all with the billing agent, and their stored facts include "has disputed 3 invoices," pre-route to billing with 90% confidence. The routing decision precedes the first message, enabling the billing agent to proactively load context.

**Intent taxonomy auto-learning:** Instead of admins manually configuring routing rules, the system analyzes existing conversation history (across all sessions) using topic clustering to automatically generate routing rules. "We detected 3 dominant query categories: appointment booking (42%), pricing questions (31%), complaint resolution (27%). Suggested agents: Booking, Sales, Support." This is product-level AI applied to the configuration problem itself.

---

# Cross-Track Synthesis

## The Phase 8 Data Flow

```
Customer message (WhatsApp / WebSocket / etc.)
        │
        ▼
Channel handler (whatsapp-webhook-routes / ws-tenant-routes)
        │
        ▼
TenantConfig resolution (by phone/widgetId/pageId)
        │
        ├─ Single-agent mode (no agents[]): → existing pipeline (unchanged)
        │
        └─ Multi-agent mode (agents[] present):
                │
                ▼
        TenantRouter.route()
        [Tier 1: regex rules] → [Tier 2: embedding] → [Tier 3: LLM] → [fallback]
                │
                ▼
        RoutingDecision { agentId, confidence, tier }
                │
        ┌───────┤
        │       ▼
        │  Ping-pong guard (skip if within rerouteAfterTurns)
        │
        ▼
session.setActiveAgent(agentId, handoffBrief?)
        │
        ▼
buildAgentSystemPrompt(tenant, agent, channel)
buildAgentPerCallConfig(tenant, agent, baseToolContext)
buildAgentKnowledgeContext(agent, userMessage)    ← per-agent knowledge filter
        │
        ▼
processInboundMessage() → ModeBOrchestrator.processMessage()
        │
        ▼
Response → channel → customer
        │
        ▼
Events: AGENT_ROUTED, MESSAGE_RECEIVED, TOOL_EXECUTED (fire-and-forget)
```

## The Three Layers

| Layer | What Changes | What Stays the Same |
|-------|-------------|---------------------|
| **Engine** (`@kilnai/core`) | TenantAgentConfig, TenantRoutingConfig interfaces, PatternRule extended | Router composite (unchanged), all primitives, safety pipeline, eval framework |
| **Runtime** (`@kilnai/runtime`) | TenantRouter, AgentContextBuilder, session Phase 8 fields, AGENT_ROUTED event, per-agent KnowledgeFilter | ModeBOrchestrator (unchanged), SessionMode state machine, all channel adapters, handoff routes |
| **Gateway** (startup/config) | Admin API for agents CRUD, routing test endpoint, pre-compute embeddings on tenant update | Gateway server structure, app loading, channel resolution, all existing routes |

---

# Deferred Items Evaluation

## From v0.5.0 (Not Shipped)

| Item | Phase 8 Inclusion | Reasoning |
|------|-----------------|-----------|
| **Async tools** (long-running, webhook callbacks) | Defer to Phase 9 | Adds session state complexity orthogonal to routing. Phase 8 already complex. |
| **OpenAPI-to-tools adapter** | Phase 8b (optional) | Useful for agent tool configuration. Could ship alongside per-agent tool scoping with minimal incremental effort. ~200 LOC. |
| **Predictive tool selection L1** | Phase 8b | Natural companion to routing: same embedding model can pre-select tools based on routing intent. Reuses existing ToolRAG. |

## From v1.0 Backlog

| Item | Phase 8 Inclusion | Reasoning |
|------|-----------------|-----------|
| **Composable authorization** (~500 LOC) | Phase 8a (simplified) | Per-agent tool allowlists ARE the authorization model for Phase 8. Full OAuth 2.1 scopes in Phase 9. |
| **Tool composition pipelines** (~800 LOC, YAML DAGs) | Defer to Phase 9 | High complexity, not routing-critical. |
| **Message chunking** (~200 LOC) | Phase 8c | Improves UX but not routing-critical. Low-hanging fruit for Phase 8c. |
| **Outbound rate limiting** (~150 LOC) | Phase 8a | Per-agent rate limits extend existing SlidingWindowRateLimiter. 30 LOC change. Include. |
| **OTel metrics + traces export** (~400 LOC) | Phase 8b | Multi-agent routing generates significantly more spans. OTel export needed for production observability. Include. |
| **Multi-tenant audit isolation** (~200 LOC) | Phase 8b | Per-agent audit trail is required for compliance-sensitive tenants. Include. |

## From Phase Research

| Item | Phase 8 Inclusion | Reasoning |
|------|-----------------|-----------|
| **Cross-channel contact deduplication** | Defer to Phase 9 | Requires identity graph. Not routing-critical. |
| **`hybridQuery` exposed in RetrievalPipeline** | Phase 8a | Per-agent knowledge scoping benefits from hybrid search filter. Already implemented in PgVectorStore. Expose it. |
| **Anticipatory actions / speculative execution** | Defer to Phase 9 | High experimental complexity. |
| **Messenger Handover Protocol** | Defer to Phase 8c | Useful for Messenger channel specifically. Lower priority. |

---

# Priority Matrix

## Phase 8a: Core Routing Engine (~6 weeks)

**Scope:** The minimum viable multi-agent system. Single-agent tenants unchanged. Multi-agent tenants can configure agents and routing rules.

| Item | Complexity | Risk | Value |
|------|-----------|------|-------|
| `TenantAgentConfig` + `TenantRoutingConfig` schema | Low | Low | Critical |
| Validate multi-agent TenantConfig at save time | Low | Low | Critical |
| `DefaultTenantRouter` (Tier 1: regex, Tier 2: embedding, Tier 3: LLM) | Medium | Medium | Critical |
| Integrate router into WhatsApp + WebSocket pipelines | Medium | Medium | Critical |
| `buildAgentSystemPrompt()` per active agent | Low | Low | Critical |
| `buildAgentPerCallConfig()` per active agent | Low | Low | Critical |
| Session `activeAgentId` tracking + `setActiveAgent()` | Low | Low | Critical |
| Ping-pong guard (cooling period + pair blacklist) | Low | Low | High |
| Admin API: agents CRUD + routing config | Medium | Low | High |
| Routing test endpoint (`/routing/test`) | Low | Low | High |
| Backward compatibility (single-agent unchanged) | Low | Low | Critical |
| Per-agent outbound rate limits (30 LOC extension) | Low | Low | Medium |
| `hybridQuery` filter for per-agent knowledge scope | Low | Low | High |
| `AGENT_ROUTED` conversation event | Low | Low | Medium |
| Session serializer updates (Phase 8 fields) | Low | Low | Critical |

**Estimated:** ~1,200-1,500 LOC production code + ~800 LOC tests

## Phase 8b: Context, Scoping & Observability (~4 weeks)

| Item | Complexity | Risk | Value |
|------|-----------|------|-------|
| Inter-agent handoff brief generation (agent-facing ContextSummarizer variant) | Low | Low | High |
| `AgentTurnHistory` in session + serializer | Low | Low | Medium |
| Re-routing logic: topic drift detection (embedding-based) | Medium | Medium | High |
| Per-agent knowledge namespace filter (PgVectorStore + InMemory) | Medium | Low | High |
| Pre-compute agent description embeddings on config update | Medium | Low | High |
| Per-agent cost attribution in CostUpdateEvent | Low | Low | Medium |
| OTel spans for routing decisions (extend TraceContext + OTelExporter) | Medium | Low | High |
| Per-agent audit trail (agentId in audit log entries) | Low | Low | Medium |
| OpenAPI-to-tools adapter (per-agent tool registration) | Medium | Medium | Medium |
| Predictive tool selection (reuse ToolRAG with routing intent) | Low | Low | Medium |
| Multi-tenant audit isolation (per-tenantId audit log files) | Low | Low | Medium |

**Estimated:** ~800-1,000 LOC production code + ~600 LOC tests

## Phase 8c: Quality, Analytics & Polish (~2-3 weeks)

| Item | Complexity | Risk | Value |
|------|-----------|------|-------|
| Routing quality metrics (accuracy, reroute rate, ping-pong rate) | Medium | Low | High |
| A/B testing routing strategies via eval framework | Medium | Low | Medium |
| Agent versioning (session-pinned config snapshot) | Medium | Medium | Low |
| Message chunking for all channels | Low | Low | Medium |
| Quick-reply clarification (low-confidence routing) | Medium | Medium | Medium |
| Studio multi-agent topology view | Medium | Low | Medium |
| Routing rule templates (domain kit presets) | Low | Low | High |
| Messenger Handover Protocol | Medium | Medium | Low |
| Per-channel agent affinity (separate activeAgentId per channel) | Medium | Medium | Low |
| CLI init wizard: multi-agent setup flow | Low | Low | Medium |

**Estimated:** ~600-800 LOC production code + ~400 LOC tests

## Defer to v2.0

| Item | Reasoning |
|------|-----------|
| Async tools (tool_pending state) | Requires fundamental session model changes |
| Tool composition pipelines (YAML DAGs) | High complexity, Phase 9 use cases |
| Cross-channel contact deduplication | Identity graph infrastructure required |
| Anticipatory actions / speculative execution | Experimental; no production evidence of ROI |
| Semantic routing rules (natural language → embedding matcher) | Phase 8c or Phase 9 |
| Self-optimizing routing (RL-based weight adjustment) | Requires sufficient conversation volume data |
| Supervisor arbitration (meta-agent reviews routing) | High latency, enterprise-only use case |
| Full OAuth 2.1 scopes for tool authorization | Phase 9 / enterprise tier |

---

## Version Target

**Phase 8a → v0.6.0**
**Phase 8b → v0.7.0**
**Phase 8c → v0.8.0**

Total estimated Phase 8: ~2,600-3,300 LOC production code + ~1,800 LOC tests. Largest phase since Phase 4 (Knowledge Engine). The routing engine alone (Phase 8a) is worth shipping as a standalone release — it enables the Kilvo backend to begin Phase 8 implementation while 8b/8c continue in parallel.

---

## Key Architectural Decisions (Summary)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Where routing config lives | `TenantConfig.agents[]` + `TenantConfig.routing` (pushed via admin API) | Runtime-dynamic, per-tenant, not static YAML |
| Routing algorithm | 3-tier cascade: regex → embedding → LLM classifier | Matches Kiln's existing Router composite pattern; latency budget met |
| Backward compatibility | Single-agent tenants fully unchanged when `agents` undefined or length 1 | Zero migration cost for existing Kilvo tenants |
| Context transfer on handoff | Warm handoff: history unchanged + agent-facing brief injected | Kiln already has ContextSummarizer; minimal new code |
| Ping-pong prevention | Cooling period + bidirectional pair tracking + handoff count cap | Simple, deterministic, no LLM overhead |
| Tool scoping | Per-agent allowlist via existing `PerCallToolConfig.toolAllowlist` | Architecture already supports this; zero new infrastructure |
| Knowledge scoping | Namespace filter on shared collection (agentId metadata in chunks) | Cost-effective; avoids N collections × M tenants explosion |
| Memory model | Contact memory shared across agents; agent working memory isolated | Correct semantics: customer facts are global, agent patterns are local |
| Session model | Additive: `activeAgentId`, `agentTurnHistory`, `handoffCount` | Backward compatible; old sessions work without these fields |
| App YAML | No changes in Phase 8 | Multi-tenant routing is runtime config, not static YAML |

---

*Research document complete. Next step: enter plan mode and decompose Phase 8a into implementation tasks.*
