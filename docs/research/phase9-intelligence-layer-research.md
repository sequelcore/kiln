# Phase 9: Intelligence Layer — Exhaustive Research Document

**Version:** 1.0.0
**Date:** 2026-03-07
**Scope:** Multi-Model Routing, Conversation Metadata Enrichment, Observability & Analytics, Intelligent Session Management, Conversation Lifecycle Events, Competitive Landscape
**Target Version:** Kiln v0.9.0 (Phase 9a) → v1.0.0 (Phase 9c)

---

## Overview

Phase 9 transforms Kiln from an orchestration engine into a **self-optimizing AI runtime**. The previous eight phases built the pipes; Phase 9 builds the intelligence that runs through them.

The intelligence layer has four interlocking concerns:

1. **Routing intelligence** — select the cheapest model that can handle the query, automatically
2. **Conversation intelligence** — understand what happened in each conversation after it ends
3. **Observability infrastructure** — expose what the engine is doing in standardized, queryable form
4. **Lifecycle events** — emit rich, typed events that let consumers build analytics dashboards without parsing raw session data

Phase 9 ships for Kilvo first, then generalizes. All architectural decisions are validated against Kilvo's production needs (WhatsApp-primary, LATAM Spanish, SMB tier).

---

## Architectural Context (Current State)

These findings are grounded in reading the actual codebase before designing Phase 9.

### Provider Adapters

Four providers implement `ProviderAdapter` (`createMessage`, `streamMessage`):

| Adapter | Default Model | Notable |
|---------|--------------|---------|
| `AnthropicAdapter` | `claude-sonnet-4-6` | Streaming, tool caching, prompt caching, thinking blocks |
| `OpenAIAdapter` | `gpt-4o` | Wraps `OpenAICompatAdapter` |
| `DeepSeekAdapter` | `deepseek-chat` | Wraps `OpenAICompatAdapter` |
| `OllamaAdapter` | `llama3.1` | No retry, no cache tokens |

**Critical gap:** Model is baked into the adapter at construction time. There is no per-request model override. Changing models requires constructing a new adapter.

### OrchestratorDeps and OrchestrateResult

```typescript
interface OrchestratorDeps {
  readonly provider: ProviderAdapter;   // single fixed provider — Phase 9 extension point
  readonly model?: string;
  readonly maxTokens?: number;
  readonly maxToolRounds?: number;
  // ... tools, mcpClients, eventBus, escalationDetector, etc.
}

interface OrchestrateResult {
  readonly parts: readonly ContentPart[];
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly queued: boolean;
  readonly escalation?: EscalationSignal;
  readonly contextSummary?: string;
  readonly toolExecutions?: readonly ToolExecutionSummary[];
}
```

### TenantConfig (relevant fields)

```typescript
interface TenantConfig {
  // ... existing fields
  readonly agents?: readonly TenantAgentConfig[];
  readonly routing?: TenantRoutingConfig;  // Phase 8 — agent routing, not model routing
  readonly billing?: TenantBilling;
  // Phase 9 adds:
  // readonly modelConfig?: TenantModelConfig;
}
```

### Agent Interface

```typescript
interface Agent {
  readonly tier: "reasoning" | "coding" | "fast";  // declared intent, never enforced
  // ...
}
```

`AgentTier` is declared but has zero mechanical effect — the orchestrator never reads it to select a provider. Phase 9 wires it.

### Event Systems

**Internal EventBus** (35 typed events): `phase_changed`, `task_started/completed`, `tool_called/authorized/result/cache_hit`, `cost_update`, `memory_saved/recalled`, `knowledge_gap`, `agent_routed`, `pii_detected`, `content_classified`, `policy_evaluated`, security events, trigger events, `domain_event`.

**ConversationEventEmitter** (14 `ConversationEventType` values): `MESSAGE_RECEIVED`, `MESSAGE_SENT`, `SESSION_STARTED` *(defined, never emitted)*, `SESSION_EXPIRED`, `DELIVERY_STATUS`, `ESCALATION_DETECTED`, `HANDOFF_INITIATED`, `HANDOFF_RELEASED`, `OPERATOR_MESSAGE_SENT`, `HANDOFF_MESSAGE_QUEUED`, `TOOL_CALLED` *(defined, never emitted as ConversationEvent)*, `TOOL_EXECUTED`, `AGENT_ROUTED`, `AGENT_HANDOFF`.

**Silent bugs found:**
- `SESSION_STARTED` is never emitted despite being in the type union
- `TOOL_CALLED` is defined but never emitted as `ConversationEvent` (only on internal EventBus)
- `emitBatch()` exists on `ConversationEventEmitter` but is never called anywhere

### CostTracker Gap

`CostTracker.record(role, model, usage)` accumulates by `AgentRole` only. If a role switches models mid-session, the last model wins for all accumulated tokens. This makes routing cost attribution wrong. Must change accumulator key from `AgentRole` to `${role}:${model}`.

### ModeBOrchestrator Provider Call Chain

```
processMessage()
  → AI guard (skip if !ai_active)
  → EscalationDetector.checkPreLLM(userText)          ← sentiment hook goes here
  → system prompt assembly
  → ToolRAG filtering
  → Tool loop (up to maxToolRounds=10):
      → provider.createMessage({system, messages, tools, maxTokens})  ← THE ONLY LLM CALL POINT
      → tool authorization → rate limiting → cache → execute → sanitize
  → EscalationDetector.checkPostLLM(session, response)
  → ContextSummarizer.summarize() if escalating
```

The `provider.createMessage()` call is the single extension point for model routing.

### EscalationDetector

```typescript
// EscalationSignal.reason union already includes reserved slots:
"keyword" | "loop" | "confidence" | "tool_failure" | "custom"
```

Only `"keyword"` and `"loop"` are implemented. `"confidence"` and `"tool_failure"` are reserved stubs waiting for Phase 9.

### Key Extension Points

1. **Model routing hook**: `OrchestratorDeps.provider` → introduce `RouterProviderAdapter` wrapper that selects from a pool
2. **Per-call model override**: extend `PerCallToolConfig` (5th param) with `modelOverride?: string`
3. **Cost tracking**: fix `CostTracker` to accumulate by `role:model` tuple
4. **New EventBus event**: `model_routed` follows `agent_routed` precedent exactly
5. **ConversationEventType**: add `MODEL_SWITCHED`, `CONVERSATION_ENRICHED`, `CONVERSATION_CLOSED`, `COST_REPORT`
6. **TenantConfig extension**: add `modelConfig?: TenantModelConfig` as optional field (same pattern as `agents[]`)
7. **Dependency rule**: model router interface in `core/engine/domain/`, implementation in `runtime/`

---

## Track 1: Multi-Model Routing & Cost Optimization

### 1. Current State Assessment

| Gap | Severity |
|-----|---------|
| No per-request model selection | Critical |
| `AgentTier` not wired to provider selection | Critical |
| No complexity scoring | Critical |
| No cascade / fallback policy | Critical |
| `CostTracker` accumulates by role, not role+model | High |
| No per-tenant model override | High |
| `CircuitBreaker` not queried before routing | Medium |
| `OllamaAdapter` has no retry | Medium |

### 2. Research Findings

**RouteLLM (UC Berkeley, 2024)**
*Citation: Ong et al., "RouteLLM: Learning to Route LLMs with Preference Data," arXiv:2406.18665*

Two strategies trained on human preference data from Chatbot Arena:
- **CAWR (Calibrated Win Rate Router)**: Small classifier trained on win-rate data. ~1ms overhead. Threshold tunable.
- **MF (Matrix Factorization Router)**: Embeds queries and models in a shared latent space. More accurate, requires embedding at inference time.

Results: 40% cost reduction at 95% GPT-4 quality on MMLU; 50% cost reduction at 96% quality on MT-Bench. Both strategies generalize across model pairs not seen during training.

Kiln relevance: CAWR is implementable using conversation outcome data from Kilvo (escalation events, re-asks, session ratings). The preference data Kiln already collects is precisely what RouteLLM was trained on.

**FrugalGPT (Stanford, 2023)**
*Citation: Chen et al., "FrugalGPT: How to Use LLMs While Reducing Cost and Improving Performance," arXiv:2305.05176*

Up to 98% cost reduction vs GPT-4-only baseline via LLM cascades. Key finding: optimal cascade chain varies per task domain. Domain-aware cascade configuration — exactly what Kiln's YAML-per-app architecture supports — captures the most savings.

**LLM Cascades (Dohan et al., 2022)**
*Citation: arXiv:2207.10342*

Sequential model invocation with confidence gating. Breakeven math: cascade is cheaper when escalation rate < `1 - (C_cheap / C_expensive)`. At Haiku/Sonnet pricing: `1 - (0.80/3.00) = 0.73`. Cascade is cost-positive when fewer than 73% of queries escalate.

**Martian Model Router (commercial)**: 2x cost reduction claimed. Key insight: pre-estimates output token count (the primary cost driver for output-heavy models). Complexity scoring should weight output length estimation heavily.

**Not Diamond (commercial)**: 97% routing accuracy on task-type classification. Approach: benchmark each model on task-type-specific eval suites, normalize into `[0,1]` capability vectors, route to minimum cost-to-capability ratio above quality threshold.

**Anthropic limitation**: Anthropic's API does not expose log-probabilities. Kiln must use behavioral confidence signals (output length, uncertainty markers, stop reason) rather than probabilistic confidence for cascade routing.

### 3. Architectural Recommendations

#### 3.1 ModelCapabilityProfile

```typescript
// packages/core/src/engine/domain/model-router.ts

export type RoutingTier = "rules" | "complexity" | "cascade" | "fallback";

export interface ModelCapabilityProfile {
  readonly provider: string;
  readonly model: string;
  readonly supportsTools: boolean;
  readonly supportsStreaming: boolean;
  readonly supportsStructuredOutput: boolean;
  readonly supportsVision: boolean;
  readonly supportsAudio: boolean;
  readonly maxContextTokens: number;
  readonly qualityTier: "high" | "medium" | "low";
  /** Per-task benchmark scores 0-1. Keys: "coding", "reasoning", "summarization", "qa", "creative" */
  readonly capabilityScores: Readonly<Record<string, number>>;
  readonly latencyP50Ms: number;
  readonly inputPer1M: number;
  readonly outputPer1M: number;
}

export interface RoutingRequest {
  readonly messages: readonly AgentMessage[];
  readonly tools?: readonly ToolDefinition[];
  readonly tenantId: string;
  readonly agentId?: string;
  readonly conversationId: string;
  readonly requiresStreaming: boolean;
  readonly requiresStructuredOutput: boolean;
  readonly maxLatencyMs?: number;
  readonly budgetCents?: number;
  readonly contextTokens: number;
}

export interface RoutingDecision {
  readonly provider: string;
  readonly model: string;
  readonly reasoning: string;
  readonly confidence: number;
  readonly alternatives: readonly { provider: string; model: string; estimatedCostUsd: number }[];
  readonly routingTier: RoutingTier;
  readonly estimatedCostUsd: number;
  readonly cascadeFallback?: { provider: string; model: string };
}

export interface ModelRouter {
  route(request: RoutingRequest): Promise<RoutingDecision>;
}
```

#### 3.2 ComplexityScorer

Stateless, no model calls, runs in <1ms. Signals and weights:
- Token count: 0.30
- Has tools: 0.25
- Has code blocks: 0.20
- Reasoning markers ("step by step", "analyze", "architect", "debug", "refactor"): 0.15
- Turn depth / conversation length: 0.10

```typescript
export type ComplexityClass = "trivial" | "simple" | "moderate" | "complex" | "expert";

export interface ComplexityScore {
  readonly score: number;      // 0-1
  readonly class: ComplexityClass;
  readonly signals: {
    readonly tokenCount: number;
    readonly hasTools: boolean;
    readonly toolCount: number;
    readonly hasCodeBlocks: boolean;
    readonly hasReasoningMarkers: boolean;
    readonly hasMultipleQuestions: boolean;
    readonly turnDepth: number;
  };
}
```

Complexity class mapping:
- `trivial` (0.0–0.2): greetings, simple FAQ, single-sentence factual
- `simple` (0.2–0.4): multi-sentence explanation, slot filling
- `moderate` (0.4–0.6): multi-step reasoning, tool calls, summarization
- `complex` (0.6–0.8): code generation, multi-tool orchestration
- `expert` (0.8–1.0): architecture design, adversarial reasoning, long-form generation

#### 3.3 RulesRouter (Tier 1)

```typescript
export interface RoutingRule {
  readonly name: string;
  readonly priority: number;   // lower = higher priority
  readonly condition: RoutingCondition;
  readonly target: { provider: string; model: string };
}

export type RoutingCondition =
  | { type: "tenant_tier"; tier: "starter" | "pro" | "enterprise" }
  | { type: "has_tools" }
  | { type: "complexity_above"; threshold: number }
  | { type: "complexity_below"; threshold: number }
  | { type: "budget_below_cents"; cents: number }
  | { type: "agent_id"; agentId: string }
  | { type: "agent_tier"; tier: "fast" | "coding" | "reasoning" }
  | { type: "always" };
```

The `agent_tier` condition wires the existing (but never enforced) `AgentTier` field:
- `tier: "fast"` → Haiku
- `tier: "coding"` → Sonnet
- `tier: "reasoning"` → Sonnet or Opus

#### 3.4 CascadeRouter (Tier 2)

Non-streaming only (hard constraint). Behavioral confidence signals for Anthropic:

```typescript
function assessConfidence(response: AgentResponse): number {
  const text = extractText(response.parts);
  const uncertaintyPatterns = [
    /i('m| am) not (sure|certain|confident)/i,
    /i don't know/i,
    /i cannot (determine|answer|tell)/i,
    /unclear|ambiguous|uncertain/i,
    /as an ai/i,
  ];
  const uncertaintyHits = uncertaintyPatterns.filter(p => p.test(text)).length;

  let score = 0.8;
  score -= uncertaintyHits * 0.15;
  if (response.outputTokens < 50) score -= 0.2;  // very short = likely gave up
  if (response.toolCalls.length > 0) score += 0.1;  // tool invocation = engaged
  if (response.stopReason !== "end_turn") score -= 0.3;
  return Math.max(0, Math.min(1, score));
}
```

#### 3.5 YAML Configuration Schema

```yaml
# app.yaml — routing section (new in Phase 9)
routing:
  defaultProvider: anthropic
  defaultModel: claude-haiku-4-5-20251001

  rules:
    - name: tool-use-requires-sonnet
      priority: 10
      condition:
        type: has_tools
      target:
        provider: anthropic
        model: claude-sonnet-4-6

    - name: fast-agents-use-haiku
      priority: 20
      condition:
        type: agent_tier
        tier: fast
      target:
        provider: anthropic
        model: claude-haiku-4-5-20251001

    - name: complex-queries-sonnet
      priority: 30
      condition:
        type: complexity_above
        threshold: 0.7
      target:
        provider: anthropic
        model: claude-sonnet-4-6

    - name: budget-constrained
      priority: 5
      condition:
        type: budget_below_cents
        cents: 10
      target:
        provider: anthropic
        model: claude-haiku-4-5-20251001

  cascade:
    enabled: false              # opt-in per app; off by default for streaming channels
    cheapProvider: anthropic
    cheapModel: claude-haiku-4-5-20251001
    expensiveProvider: anthropic
    expensiveModel: claude-sonnet-4-6
    confidenceThreshold: 0.70
```

#### 3.6 Integration with ModeBOrchestrator

The `PerCallToolConfig` (5th param to `processMessage`) is the per-call override pattern. Extend it:

```typescript
export interface PerCallRoutingConfig {
  readonly modelOverride?: { provider: string; model: string };
  readonly routingDecision?: RoutingDecision;  // for audit/event emission
  readonly cascadePolicy?: CascadePolicy;
}
```

Model routing runs before the tool loop, selects the adapter, and attaches `routingDecision` to the cost tracking event and AGENT_ROUTED conversation event.

#### 3.7 ProviderHealthMonitor

Subscribes to EventBus `cost_update` events. Maintains EWMA latency per model:

```typescript
class ProviderHealthMonitor {
  recordCall(model: string, latencyMs: number, success: boolean): void {
    // EWMA alpha=0.1
    const current = this.ewma.get(model) ?? { p50: latencyMs, errorRate: 0 };
    this.ewma.set(model, {
      p50: 0.9 * current.p50 + 0.1 * latencyMs,
      errorRate: 0.9 * current.errorRate + 0.1 * (success ? 0 : 1),
    });
  }
}
```

If error rate > 0.10, mark provider as degraded → `ModelCapabilityRegistry.eligible()` excludes it → feeds existing `CircuitBreaker`.

### 4. Edge Cases & Failure Modes

**All cheap models down**: Circuit breaker already exists. Route decision must query CB before committing. `RoutingDecision.alternatives[]` always includes a fallback.

**Routing adds >50ms latency**: Rules-only routing (Tier 1) adds <1ms. For latency-sensitive channels (WhatsApp, Messenger), restrict to Tier 1 only. `RoutingRequest.maxLatencyMs < 100` → skip async tiers, use YAML default.

**Cascade cost math**: Cascade is cost-positive when escalation rate < 73% (Haiku/Sonnet ratio). When escalation rate is high, direct rule routing is cheaper. Cascade never makes sense when `cheapModel == expensiveModel`.

**Tool-using queries routing to no-tools model**: `ModelCapabilityRegistry.eligible()` hard-filters models where `supportsTools: false` when `request.tools.length > 0`. Rules router validates decision against `eligible()` before committing.

**Mid-stream model escalation**: Not supported in Phase 9. Cascade operates in `createMessage` mode only. For streaming requests, routing decision is pre-call and committed. Future v2.0: speculative streaming with splice.

**Double-billing on cascade escalation**: When cascade escalates, both cheap attempt and expensive call are billed. `CostSummary` includes `cascadeAttempts` and `cascadeEscalations` for operator visibility. Budget middleware deducts cheap attempt before checking if budget allows the expensive call.

**DeepSeek-reasoner**: `supportsTools: false` in built-in capability profiles. Router falls through to next eligible model automatically.

### 5. Beyond State-of-the-Art

**Predictive routing**: At end of each turn, asynchronously compute `nextTurnComplexityEstimate` from conversation trajectory. Stored on session. Next message uses pre-computed estimate as initial score, reducing per-request complexity calculation from O(all messages) to O(new message only).

**Learning router**: Collect `(complexityScore, model, outcomeSignal)` tuples. Periodically recalibrate complexity thresholds using isotonic regression. No ML infrastructure needed — uses `EvalFramework` already in Kiln.

**Real-time provider benchmarking**: `ProviderHealthMonitor` EWMA becomes the live input to `ModelCapabilityRegistry.eligible()`. If Sonnet's EWMA p50 spikes, eligible() deprioritizes it in alternatives before the circuit breaker trips.

### 6. Cost Analysis

**At 30K conversations/month (Kilvo current):**

| Strategy | Cost/Conv | Monthly | vs All-Haiku Baseline |
|----------|-----------|---------|----------------------|
| All-Haiku baseline | $0.0053 | $159 | — |
| Observed mix (70/25/5) | $0.0012 | $36 | -77% |
| Rules-only Phase 9a (estimated) | $0.0020 | $60 | -62% |
| Cascade Phase 9b | $0.0015 | $45 | -72% |

Pricing basis: Haiku 4.5 $0.80/$4.00 per 1M, Sonnet 4.6 $3.00/$15.00, Opus 4.6 $15.00/$75.00.

**ROI framing**: Phase 9a at 30K conv/mo saves ~$99/mo absolute. ROI is a platform feature, not a per-deployment calculation. At 300K conv/mo (1K tenants at Kilvo scale), savings are $990/mo = $11,880/year.

**Volume thresholds:**
- <5K conv/mo: Rules routing not economically justified (saves <$15/mo)
- 20K-100K conv/mo: Phase 9a clearly justified ($60-300/mo savings)
- 50K+: Phase 9b cascade adds meaningful savings
- 100K+: Full Phase 9c with health monitoring

### 7. Priority Matrix

**Phase 9a (Core Routing Infrastructure):**
- `ModelCapabilityProfile` + `ModelCapabilityRegistry` with built-in profiles for all 10 catalog models (S)
- `ComplexityScorer` with 5 signals (S)
- `RulesRouter` Tier 1 with YAML config (M)
- Per-request model selection in `ModeBOrchestrator` via adapter swap (M)
- `CostTracker` fix: accumulate by `role:model` tuple (S)
- Per-tenant routing rules in `TenantConfig` (S)
- `routingDecision` field on routing conversation events (S)

**Phase 9b (Cascade + Health):**
- `CascadeRouter` with behavioral confidence detection (M)
- `CascadePolicy` YAML config (S)
- `ProviderHealthMonitor` EWMA (M)
- CircuitBreaker integration with routing (S)
- Budget-aware cascade gating (S)

**Phase 9c (Observability + Admin):**
- Routing stats admin API (S)
- Per-agent model override in `agents[]` config (S)
- Routing metrics in Studio Timeline view (M)

**Deferred to v2.0:** ML-based complexity classifier (RouteLLM CAWR), streaming cascade/speculative execution, learning router, embedding-based model tier selection.

---

## Track 2: Conversation Metadata Enrichment

### 1. Current State Assessment

**ContentClassifier** is a safety moderation gate, not an analytics layer. It operates on individual messages with 6 category patterns (`hate`, `violence`, `sexual`, `self_harm`, `harassment`, `misinformation`). There is no sentiment, topic, intent, or resolution logic anywhere in the codebase.

**Eval scorers** (12 total: 6 rule-based + 6 LLM-as-judge) operate on single `EvalInput` pairs. They are offline evaluation tools, not real-time enrichers.

**Critically absent:**
- No `CONVERSATION_CLOSED` event exists in either event system
- No per-message sentiment, intent, or topic signals
- `contextSummary` on `OrchestrateResult` only populates on escalation path — not a general summary
- Resolution detection only via TTL expiry or operator `setSessionMode("resolved")`
- No CSAT inference, no effort score, no post-conversation summary

### 2. Research Findings

**Sentiment Analysis Timing Decision:**
- **VADER (rule-based JS)**: <1ms, zero cost, English-only. Kiln's primary market (Mexico) is multilingual — VADER fails on Spanish sarcasm (>25% error rate on informal Mexican Spanish).
- **LLM-based per-message**: 200-800ms, ~150-300 tokens/call. Too expensive for real-time hot path.
- **LLM-based post-conversation**: Single call covers summary + topics + sentiment arc + resolution + CSAT. Cost: ~$0.001-0.002 per conversation at Haiku pricing.

**Recommendation**: Post-conversation batch LLM call is the correct default. Real-time per-message heuristic (opt-in) for English-only channels.

**Resolution Detection:**

Intercom Fin's approach: conversation ended without escalation AND no follow-up within TTL window. Produces systematic false positives — customers who gave up count as "resolved."

LLM-based resolution detection is superior. The enrichment prompt explicitly guards against "thanks, bye" false positives: *"Resolution requires the customer's original problem was addressed, not just a polite closing statement."*

Strong resolution signals to feed the LLM:
- `setSessionMode("resolved")` → strong prior for resolved
- `ESCALATION_DETECTED` → strong prior for unresolved
- Tool execution success (`TOOL_EXECUTED` with success result)
- Terminal positive multi-word affirmation (not single-word "gracias")

**CSAT Inference:**

Academic ceiling: 70-82% Pearson correlation with actual surveys (Qualtrics XM Institute 2022, Medallia 2023, Baethge et al. 2023). Zendesk's 85% claim is measured on best-performing cohort, not general population.

Signals that lift prediction accuracy:
1. Resolution status (resolved → higher CSAT, strongest predictor)
2. Sentiment trajectory (improving arc → higher CSAT than final-state sentiment alone)
3. Turn count (fewer turns for simple intents → higher CSAT)
4. Tool success rate (successful tool executions correlate with resolution)
5. Escalation occurrence (escalated → lower AI CSAT)
6. Response latency between turns (pauses signal frustration)

**Microsoft Research (2023, "Emotional Arcs in Customer Service")**: Arc pattern is more predictive of CSAT than final-state sentiment. An "improving" arc (started negative, recovered positive) predicts CSAT > 4.0 even when the conversation started frustrating.

**Customer Effort Score (CES):**

Fully rule-based from existing session data — no LLM required:

```typescript
function computeEffortScore(metrics: EffortMetrics): number {
  // 10 = zero effort, 0 = maximum effort
  const base = 10;
  return Math.max(0, base
    - Math.min(3, (metrics.userTurns - 2) * 0.3)
    - Math.min(2, metrics.clarificationRequests * 0.5)
    - Math.min(2, metrics.toolErrors * 0.4)
    - Math.min(1.5, metrics.agentHandoffs * 0.5)
    - (metrics.escalated ? 1.5 : 0)
  );
}
```

All signal sources exist today: `session.messageCount`, `session.handoffCount`, `OrchestrateResult.toolExecutions`.

### 3. Architectural Recommendations

#### 3.1 Core Interfaces

```typescript
// packages/core/src/enrichment/types.ts

export interface SentimentScore {
  readonly polarity: "positive" | "neutral" | "negative";
  readonly score: number;       // -1.0 to 1.0
  readonly confidence: number;
  readonly method: "heuristic" | "llm";
}

export type ResolutionStatus = "resolved" | "partial" | "unresolved" | "ambiguous";

export interface ResolutionResult {
  readonly status: ResolutionStatus;
  readonly confidence: number;
  readonly evidence: string;
}

export interface TopicTag {
  readonly label: string;        // e.g. "Order Status"
  readonly subtopic?: string;    // e.g. "Delayed Shipment"
  readonly confidence: number;
  readonly prominence: number;   // 0.0-1.0, fraction of conversation
}

export type SentimentArcPattern =
  | "consistently_positive" | "consistently_negative"
  | "improving" | "declining" | "volatile" | "neutral_throughout";

export interface ConversationEnrichment {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly enrichedAt: string;

  readonly summary: string;
  readonly topics: readonly TopicTag[];
  readonly topicDrift: boolean;

  readonly resolution: ResolutionResult;

  readonly effortScore: number;             // 0-10
  readonly effortComponents: EffortComponents;

  readonly csatPrediction: CsatPrediction;  // score 0-5, confidence 0-1

  readonly sentimentArc: readonly SentimentPoint[];
  readonly sentimentArcPattern: SentimentArcPattern;
  readonly overallSentiment: SentimentScore;

  readonly agentPerformance: readonly AgentPerformanceMetrics[];

  readonly language?: string;              // ISO 639-1
  readonly multilingual: boolean;
  readonly piiRedacted: boolean;           // PiiScanner ran on output

  readonly turnCount: number;
  readonly userTurnCount: number;
  readonly durationMs: number;
}

export interface ConversationEnricher {
  enrichPostConversation(session: CompletedSession): Promise<ConversationEnrichment | undefined>;
  enrichRealTime?(message: IncomingMessage, context: EnrichmentContext): Promise<RealTimeEnrichment | undefined>;
}
```

#### 3.2 Single-Call LLM Enrichment

One LLM call for all post-conversation signals. Splitting into separate calls multiplies cost 4-6x for negligible quality gain.

```typescript
const ENRICHMENT_SYSTEM_PROMPT = `You are a conversation analyst. Analyze a completed customer support conversation and extract structured metadata.

Return ONLY a JSON object:
{
  "summary": "<2-4 sentence summary>",
  "topics": [{"label": "...", "subtopic": "...", "confidence": 0.0-1.0, "prominence": 0.0-1.0}],
  "topicDrift": true|false,
  "resolution": {"status": "resolved|partial|unresolved|ambiguous", "confidence": 0.0-1.0, "evidence": "..."},
  "sentimentArc": [{"turnIndex": N, "polarity": "positive|neutral|negative", "score": -1.0-1.0}],
  "overallSentiment": {"polarity": "...", "score": -1.0-1.0, "confidence": 0.0-1.0},
  "csatPrediction": {"score": 0.0-5.0, "confidence": 0.0-1.0, "basis": ["..."]},
  "agentContributions": [{"agentId": "...", "resolutionContribution": "primary|partial|none", "sentimentDelta": -1.0-1.0}],
  "language": "<ISO 639-1>",
  "multilingual": true|false,
  "clarificationRequests": N
}

RULES:
- sentimentArc: USER turns only
- resolution: "resolved" requires problem was addressed, NOT just a polite closing
- topics: ordered by prominence descending, max 5
- Do NOT include customer names, order numbers, email addresses, or phone numbers`;
```

#### 3.3 Lifecycle Integration

`CONVERSATION_CLOSED` is the trigger. It does not exist today — must be added to both `ConversationEventType` and `EventType`.

Trigger points:
- `SessionRegistry.expire()` → `closeReason: "expired"`
- `handoff-routes.ts /resolve` → `closeReason: "operator_closed"`
- `ModeBOrchestrator` session mode → `"resolved"` transition → `closeReason: "resolved"`
- `handoff-routes.ts /handoff` escalation accepted → `closeReason: "escalated"`

The `EnrichmentRunner` subscribes to `conversation_closed` on EventBus and runs the LLM call fire-and-forget. The product webhook receives two separate events: `CONVERSATION_CLOSED` (immediate) and `CONVERSATION_ENRICHED` (1-5 seconds later).

#### 3.4 Multi-Agent Attribution

`session.agentTurnHistory` (Phase 8) already tracks which agent handled which turn. Per-agent metrics are computed from the turn ranges between handoff entries.

#### 3.5 Enrichment Admin API

```
GET  /tenants/:id/enrichment/:sessionId
GET  /tenants/:id/enrichment?limit=50&cursor=X
GET  /tenants/:id/enrichment/aggregates?days=30
DELETE /tenants/:id/enrichment/:sessionId    (GDPR)
```

SQLite-backed for dev mode (follow `SqliteEmailThreadStore` pattern). PostgreSQL for production.

### 4. Edge Cases & Failure Modes

**Multilingual (Spanish + English mix)**: Detect language per turn. Pass `multilingual: true` to LLM prompt. Skip heuristic sentiment for Spanish — use LLM-only. Claude and GPT-4o handle LATAM Spanish natively.

**"Gracias" false positive**: Enrichment prompt explicitly states: *"A polite farewell without issue resolution evidence should yield status: 'ambiguous' with low confidence."* Cross-reference `ContactMemoryService` extracted issues.

**Topic drift**: LLM naturally produces multiple topics ordered by prominence. Set `topicDrift: true` when primary topic in first half differs from final half. Rule-based derivation from topic prominence array — no extra LLM call.

**Very short conversations (<2 user turns)**: Skip LLM call entirely. `buildMinimalEnrichment()` computes effort score (rule-based) and close reason only. Cost: $0.

**Very long conversations (50+ turns)**: Sampling strategy — first 20 turns, last 20 turns, every 5th turn between. Note truncation in prompt. Alternatively: call `ContextSummarizer` (already exists) on turns 1..N-20, then enrich from summary + last 20 turns.

**PII in enrichment output**: Run `PiiScanner` on the enrichment JSON before storage. Prompt instructs model to return categorical topics, not verbatim quotes. Set `piiRedacted: true` on the event when scanner ran.

**Enrichment latency**: Strictly fire-and-forget. `EnrichmentRunner.runPostConversation()` called with `.catch(() => {})`. User has already received final response. 10s timeout with `enrichmentStatus: "failed"` fallback.

### 5. Beyond State-of-the-Art

**Predictive resolution**: At configurable turn N (default 3), call LLM with conversation so far: *"Estimate probability this conversation will resolve without human escalation."* Emit `LOW_RESOLUTION_PROBABILITY` event when probability < 0.4. Proactively queues human agent.

**Emotional trajectory arc patterns**: Rule-based derivation from `sentimentArc` array. Six patterns including `improving` (negative→positive, high CSAT predictor) and `declining` (positive→negative, churn risk signal).

**Knowledge gap detection from failed resolution**: When `resolution.status === "unresolved"`, cross-reference the session's `knowledge_gap` EventBus events. Surface as `KnowledgeGapInsight` suggesting FAQ entries to create.

**Comparative enrichment (percentile scoring)**: Once 100+ conversations accumulated, embed summaries in vector store. `findSimilar(sessionId, k=5)` enables percentile ranking: *"Your resolution rate is in the 73rd percentile for businesses in your category."*

### 6. Priority Matrix

**Phase 9a:**
- `CONVERSATION_CLOSED` event (prerequisite for everything else)
- Customer Effort Score (rule-based, zero LLM cost)
- `EnrichmentStore` interface + SQLite implementation
- Post-conversation LLM enricher (single-call)
- PII guard on enrichment output
- Enrichment admin API

**Phase 9b:**
- `EnrichmentAggregates` API (resolution rate, avg CSAT, top topics, per-agent metrics)
- Real-time per-message heuristic sentiment (opt-in, English-only)
- Short-conversation guard (`minUserTurnsForLLM` threshold)
- Long-conversation sampling strategy
- Multilingual detection + language-aware enrichment

**Phase 9c:**
- Predictive resolution (emit `LOW_RESOLUTION_PROBABILITY` at turn N)
- Emotional trajectory arc pattern derivation
- Studio Timeline integration with enrichment overlay

**Deferred v2.0:** Comparative enrichment/percentile scoring, knowledge gap LLM suggestions (beyond event surfacing), BERT-based multilingual sentiment sidecar, scheduled retroactive backfill.

---

## Track 3: Observability & Analytics Infrastructure

### 1. Current State Assessment

**SpanMapper**: Exhaustive switch over 35 `KilnEvent` types → 4 `SpanOperation` variants. TypeScript never-guard enforces exhaustiveness. Zero Prometheus metric emission. Custom attribute names (`inputTokens`, `totalCostUsd`) that violate OTel GenAI semantic conventions.

**OtelExporter**: `EventStore` sink. `activeSpans` map per session. `SimpleSpanProcessor` — blocks on collector failure. Write-only (no `getBySession()`, no `getAfter()`).

**OTel bootstrap** in `gateway-server.ts`: Dynamic import for `@opentelemetry/sdk-trace-base` and exporter. Supports `console`, `otlp`, `none`. No `/metrics` endpoint. No Prometheus registry.

**CostTracker**: Per-role in-memory accumulator. Session-scoped, ephemeral. No persistence, no per-tenant aggregation, no time-series.

**Critical gaps:**
- No Prometheus `/metrics` endpoint
- No per-tenant metric aggregation
- `SimpleSpanProcessor` blocks on collector failure → should be `BatchSpanProcessor`
- OTel span attributes don't conform to `gen_ai.*` namespace (2025 GenAI WG spec)
- No `knowledge_retrieved` event (counterpart to `knowledge_gap`)
- ConversationEventEmitter has no retry and silently drops events

### 2. Research Findings

**OpenTelemetry GenAI Semantic Conventions (OTEL GenAI WG, 2025)**

Required span attributes for `gen_ai.client` span:
- `gen_ai.system`: `"anthropic"` | `"openai"` | `"deepseek"` | `"ollama"`
- `gen_ai.request.model`: model as sent in request
- `gen_ai.response.model`: model as returned in response
- `gen_ai.operation.name`: `"chat"` | `"embeddings"`
- `gen_ai.usage.input_tokens`: number
- `gen_ai.usage.output_tokens`: number
- `gen_ai.usage.cache_read_input_tokens`: number (Anthropic-specific, proposed)
- `gen_ai.usage.cache_creation_input_tokens`: number (Anthropic-specific, proposed)
- `gen_ai.response.finish_reasons`: string[]

Kiln extensions (separate namespace to avoid collision):
- `kiln.tenant_id`, `kiln.agent_id`, `kiln.agent_name`, `kiln.channel`, `kiln.session_id`, `kiln.routing_tier`, `kiln.cost_usd`

**Langfuse (open-source LLM observability)**

Hierarchy: `Trace` (session) → `Observation` (LLM call/tool/retrieval) → `Score` (human or automated). `generation` observation maps to Kiln's `cost_update` event. Score maps to enrichment quality score. Langfuse export adapter is a v2.0 item — native OTLP covers 95% of use cases.

**Datadog LLM Observability (2024)**

Span kinds: `llm`, `agent`, `tool`, `retrieval`, `workflow`, `task`, `embedding`. Retrieval span includes: `documents[].text`, `documents[].score`, `documents[].name`. Kiln's SpanMapper should add `kind: "llm"` for LLM call spans and `kind: "retrieval"` for knowledge retrieval.

**Arize Phoenix**

RAG evaluation via retrieval spans with document scores. Embedding drift detection via UMAP + cosine clustering. Key missing Kiln event: `knowledge_retrieved` with document scores (only `knowledge_gap` exists today).

**Cardinality problem**: 10K tenants × 10 models × 8 channels = 800K label combinations in Prometheus. Solution: **never put `tenant_id` in Prometheus**. Move per-tenant breakdowns to TimescaleDB on existing PostgreSQL. Prometheus gets aggregate SLOs only.

**Analytics data volume at 10K tenants**: ~33-48M events/month (46 events/second sustained). In-memory Prometheus operations (~1µs each): negligible CPU. For analytics DB: 15M rows/month × ~200 bytes = 3GB/month uncompressed, ~600MB compressed in TimescaleDB.

### 3. Architectural Recommendations

#### 3.1 Emit Strategy: CompositeEventStore

Add a `PrometheusCollector` as a second `EventStore` subscriber alongside `OtelExporter`:

```typescript
const compositeStore = new CompositeEventStore([otelExporter, prometheusCollector]);
const eventBus = new EventBus(100, compositeStore);
```

`PrometheusCollector` handles metric emission. `SpanMapper`/`OtelExporter` handles traces. Single responsibility maintained.

#### 3.2 Switch to BatchSpanProcessor

Replace `SimpleSpanProcessor` in `gateway-server.ts`:

```typescript
new BatchSpanProcessor(exporter, {
  maxQueueSize: 2048,
  scheduledDelayMillis: 5000,
  exportTimeoutMillis: 30000,
  maxExportBatchSize: 512,
})
```

With batch processor, collector downtime queues spans instead of blocking. System continues running; queue drains when collector recovers.

#### 3.3 OTel GenAI Span Attributes

`mapCostUpdate()` in SpanMapper should emit `gen_ai.usage.*` alongside existing custom names (backward-compatible addition).

```typescript
span.setAttributes({
  'gen_ai.system': event.provider,
  'gen_ai.request.model': event.model,
  'gen_ai.usage.input_tokens': event.inputTokens,
  'gen_ai.usage.output_tokens': event.outputTokens,
  'gen_ai.usage.cache_read_input_tokens': event.cacheReadTokens,
  'gen_ai.usage.cache_creation_input_tokens': event.cacheWriteTokens,
  'kiln.tenant_id': event.tenantId ?? '',
  'kiln.agent_id': event.agentId ?? '',
  'kiln.cost_usd': event.costUsd,
  // Keep existing names for backward compat
  'inputTokens': event.inputTokens,
  'totalCostUsd': event.costUsd,
});
```

#### 3.4 Prometheus Metrics Catalog

`prom-client` as optional peer dep (same dynamic import pattern as `@opentelemetry/api`).

**Latency histograms** (buckets: 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0 seconds):
```
kiln_llm_request_duration_seconds{provider, model, channel, operation}
kiln_tool_execution_duration_ms{tool_name, success}
kiln_conversation_turn_duration_ms{channel}
kiln_knowledge_retrieval_duration_ms{store_type}
```

**Counters:**
```
kiln_llm_requests_total{provider, model, channel, status}
kiln_llm_tokens_total{direction, provider, model}    # direction: input|output|cache_read|cache_write
kiln_cost_usd_total{provider, model}
kiln_tool_calls_total{tool_name, authorized, success}
kiln_tool_cache_hits_total{tool_name}
kiln_pii_detected_total{pii_type, direction, action}
kiln_content_blocked_total{direction, tier}
kiln_policy_violations_total{rail_type, direction}
kiln_injection_threats_total{tier}
kiln_security_alerts_total{severity, category}
kiln_agent_routings_total{agent_name, routing_tier}
kiln_agent_handoffs_total{from_agent, to_agent}
kiln_human_handoffs_total{channel}
kiln_knowledge_gaps_total{}
kiln_errors_total{code, channel}
kiln_budget_exhausted_total{}
kiln_streams_aborted_total{provider, model}
```

**Gauges:**
```
kiln_active_sessions{channel, session_mode}
kiln_budget_remaining_usd{}
kiln_otel_spans_active{}
```

**Histograms:**
```
kiln_agent_routing_confidence{routing_tier}     # buckets: 0.1, 0.2, ..., 1.0
kiln_knowledge_gap_score{}                       # buckets: 0.0, 0.1, ..., 0.5
kiln_session_duration_seconds{channel, resolution_reason}
```

**Note on labels**: `tenant_id` is deliberately excluded from all Prometheus labels to prevent cardinality explosion. Per-tenant data lives in `AnalyticsSink` → TimescaleDB.

#### 3.5 `/metrics` Endpoint

```typescript
// Mounted at GET /metrics, unauthenticated on internal network
app.get('/metrics', async (c) => {
  const metrics = await registry.metrics();
  return c.text(metrics, 200, { 'Content-Type': registry.contentType });
});
```

Must be excluded from tenant auth middleware. IP-restricted in production.

#### 3.6 AnalyticsSink for Per-Tenant Data

Ring buffer queue (10K events max), 1-second batched flush to TimescaleDB:

```typescript
class AnalyticsSink implements EventStore {
  private readonly queue: ConversationMetricEvent[] = [];

  async save(event: KilnEvent): Promise<void> {
    const metric = this.mapToMetric(event);
    if (!metric) return;
    if (this.queue.length >= 10_000) this.queue.shift();  // drop oldest, never block
    this.queue.push(metric);
    this.scheduleFlush();
  }
}
```

Schema (TimescaleDB hypertable partitioned by `ts` and sharded by `tenant_id`):
```
ts, tenant_id, session_id, channel, agent_id, provider, model,
input_tokens, output_tokens, cost_usd, turn_latency_ms, tool_calls,
knowledge_gap, pii_detected, error_occurred
```

### 4. Edge Cases & Failure Modes

**OTel collector down**: `BatchSpanProcessor` queues up to 2048 spans. System continues. Queue drains on collector recovery. For Prometheus: in-memory registry never fails.

**Streaming token counting with connection drops**: Anthropic sends `usage` in final `message_stop` event; OpenAI in final chunk with `stream_options.include_usage: true`. Buffer the final event. If stream closes before it arrives, record `kiln_streams_aborted_total`. Add `partial_usage` best-effort estimate.

**Metric cardinality**: Never use `session_id`, `user_id`, `conversation_id`, `tool_input_hash` as Prometheus labels. Those belong in OTel span attributes only.

**Per-tenant isolation enforcement**: `PrometheusCollector` resolves `tenant_id` from `event.sessionId → session → tenantId` at emission time, never from shared mutable state. Unit test: emit cost_update for tenant A, assert tenant B counter unchanged.

### 5. Beyond State-of-the-Art

**Real-time anomaly detection**: `ProviderAnomalyDetector` tracks rolling window of last 100 latency samples per model. If p95 of last 10 samples > 3× median of prior samples, emit anomaly signal → `RoutingFeedbackRegistry` marks provider degraded.

**Predictive cost budgeting**: Linear regression on first-week daily costs → forecast month-end spend with confidence interval. Feed `kiln_budget_forecast_usd` gauge. Alert when `forecast > budgetLimit × 0.8`.

**Observability → routing feedback loop**:
1. `agent_routed` event records `routingTier` + `confidence`
2. Online eval scorer attaches `quality_score` to production conversations
3. `RoutingFeedbackRegistry` computes rolling avg quality per agent per tenant
4. Quality below threshold → `routing_quality_alert` event → admin auto-update routing rules

### 6. Priority Matrix

**Phase 9a:**
- `PrometheusCollector` + `CompositeEventStore` wiring
- Core counters: `llm_requests_total`, `llm_request_duration_seconds`, `llm_tokens_total`, `cost_usd_total`, `errors_total`
- `GET /metrics` endpoint
- `prom-client` optional peer dep (dynamic import)
- OTel GenAI attribute alignment in SpanMapper (`gen_ai.*` namespace)
- `BatchSpanProcessor` replacing `SimpleSpanProcessor`

**Phase 9b:**
- Safety metrics: `pii_detected_total`, `content_blocked_total`, `policy_violations_total`
- Routing metrics: `agent_routings_total`, `handoffs_total`, routing confidence histogram
- Session metrics: `active_sessions`, `session_duration_seconds`
- Knowledge metrics: `knowledge_gaps_total`, retrieval document count histogram
- `AnalyticsSink` → TimescaleDB for per-tenant dashboards
- `budget_remaining_usd` gauge + exhaustion alert

**Phase 9c:**
- `ProviderAnomalyDetector`
- `RoutingFeedbackRegistry`
- Online eval scorer on production conversations
- Prometheus alerting rules YAML
- Grafana dashboard JSON definitions
- `knowledge_retrieved` event (counterpart to `knowledge_gap`)

**Deferred v2.0:** Cross-tenant anonymous benchmarking, embedding drift detection, Langfuse export adapter, full OTel metrics SDK, trace-to-eval correlation.

---

## Track 4: Intelligent Session Management

### 1. Current State Assessment

`EscalationDetector` has two detection modes:
1. **Pre-LLM keyword matching** — static keyword list, confidence 0.9 (phrases) / 0.8 (words), `reason: "keyword"`
2. **Post-LLM loop detection** — Jaccard word-overlap on last 3 responses, threshold 0.85, `reason: "loop"`

`EscalationSignal.reason` union already has reserved slots: `"confidence"` and `"tool_failure"` — neither is implemented.

`session._systemPrompt` was made mutable in Phase 8a (`setSystemPrompt()`) — adaptive prompts have zero new infrastructure cost.

`ToolExecutionSummary` is returned per turn but **not persisted** on the session — tool failure accumulation across turns requires explicit tracking.

### 2. Research Findings

**Sentiment-triggered escalation**

Intercom and Freshdesk use threshold-based approaches: VADER-style lexicon or BERT classifier, escalate when rolling N-turn average drops below threshold. Zendesk Intelligent Triage uses fine-tuned DistilBERT but requires labeled training data per domain.

For Kiln (no training data at onboarding): inject `sentimentScore` as a structured field in the LLM response schema. ~100 extra tokens per turn. Then check rolling 3-turn average in `EscalationDetector`.

False positive mitigation: require 3+ consecutive declining turns (not a single spike). Threshold: `score < -0.6` and `turnsAnalyzed >= 3`.

**Resolution prediction mid-conversation** (Madotto et al., "End-to-End Trainable Non-Collaborative Dialog System"):

Two proxy signals without ML training:
1. Tool success rate: if tools are failing repeatedly, resolution probability drops
2. Topic drift: if user question at turn N is semantically far from agent's last response (cosine > 0.4 using existing embedding infrastructure), agent has not addressed the query

Simple formula: `P(resolved) = 0.7 × toolSuccessRate + 0.3 × (1 - topicDrift)`. When < 0.3 after turn 3, trigger model upgrade or escalation review.

**Model upgrade mid-conversation**

Two industry patterns:
1. **Cascade (LLM Router by Lytix, OpenRouter)**: classify complexity before each call, select cheapest eligible model. Per-call, not per-session.
2. **Session-level upgrade**: track complexity over session, switch when threshold crossed.

Cascade is architecturally cleaner for Kiln. The orchestrator receives a `ModelRouter` interface instead of a fixed `ProviderAdapter`. Mid-turn switching impossible — occurs at natural boundaries between tool rounds.

**Adaptive system prompts**

`session.setSystemPrompt()` already exists (Phase 8a). An `AdaptivePromptManager` injects overlays between turns:

- Sentiment declining → *"The customer appears frustrated. Be extra empathetic and concise."*
- Tool failures accumulating → *"Multiple tool calls have failed. Consider explaining limitations rather than retrying."*
- Long session → *"This is a complex issue. Offer to escalate to a specialist if you cannot resolve within 2 more turns."*

Change persists for all subsequent turns — no new session infrastructure.

### 3. Architectural Recommendations

#### 3.1 Extended EscalationDetector

```typescript
interface EscalationDetector {
  checkPreLLM(userText: string, sentiment?: SentimentScore): EscalationSignal | null;
  checkPostLLM(session: ModeBSession, responseParts: readonly ContentPart[]): EscalationSignal | null;
  checkToolFailures(session: ModeBSession, toolFailureCount: number): EscalationSignal | null;  // NEW
}
```

`checkToolFailures` implements the reserved `"tool_failure"` reason: if `failedToolCalls / totalToolCalls > 0.5` over last 5 turns, signal escalation.

#### 3.2 SessionTrajectory

```typescript
interface SessionTrajectory {
  readonly turnCount: number;
  readonly toolSuccessRate: number;
  readonly topicDriftScore: number;
  readonly sentimentTrend: "improving" | "stable" | "declining";
  readonly estimatedResolutionProbability: number;
  readonly isRepeatCustomer: boolean;
  readonly priorUnresolvedSessions: number;
}
```

Computed by `SessionTrajectoryComputer` in `processInboundMessage()`. Passed to:
1. `ModelRouter.select()` for model upgrade decisions
2. `EscalationDetector.checkPreLLM()` for sentiment escalation
3. `AdaptivePromptManager.adapt()` for system prompt overlays

#### 3.3 EscalationRouter

```typescript
interface EscalationRouter {
  route(signal: EscalationSignal, session: ModeBSession, tenant: TenantConfig): EscalationAction;
}

type EscalationAction =
  | { type: "agent_handoff"; targetAgentId: string }
  | { type: "human_handoff"; reason: string }
  | { type: "model_upgrade"; targetModel: string }
  | { type: "none" };
```

Decision tree: keyword/sentiment/loop → check if specialist agent available → agent handoff; else human handoff. Tool failure → single failure: model upgrade + retry; multiple: human handoff. Confidence below threshold → model upgrade first, then human if still failing.

#### 3.4 Circular Escalation Guard

Extend the Phase 8b `PingPongGuard` pattern to the escalation layer. If session has been escalated to human and returned to AI more than `maxEscalations` times (default 2) within `cooldownMs` (default 30 minutes), lock session in `human_active` and emit alert event.

### 4. Edge Cases & Failure Modes

**Sentiment false positive**: User complaining about weather triggers negative sentiment. Require intent classification alongside sentiment: only escalate if `intent === 'complaint_about_service'`. Wrong escalation cost is real — operators paged for non-issues.

**Model upgrade mid-streaming**: Not supported. Switch occurs at turn boundaries only (between `createMessage()` calls in the tool loop).

**Session state during upgrade**: `conversationHistory` is model-agnostic. Each adapter normalizes to `AgentMessage` format. Switch is transparent at session layer.

**Circular escalation**: AI → human → AI → human loop. Check `escalation history` counter. Lock in `human_active` after N cycles.

### 5. Beyond State-of-the-Art

**Pre-emptive resolution detection**: Embed user query, cosine-search against "known unresolvable" patterns (account deletion, billing disputes requiring authority). Score > 0.9: skip LLM, route directly to human. Saves 100% of token cost for queries that always escalate.

**Conversation shape recognition**: Embed first 1-2 turns, search against library of known shapes (password reset, billing inquiry, product return). Match → pre-load relevant FAQ snippets. Turn-level retrieval becomes conversation-level retrieval.

**Customer lifetime value routing**: Extend `TenantAgentConfig` with `tier` field. Premium customers → Opus-class models. `CustomerTierResolver` webhook resolves CLV at session open.

### 6. Priority Matrix

**Phase 9a:**
- Sentiment-triggered escalation (heuristic tier, 3-turn minimum)
- Tool failure accumulation → escalation (implements reserved `"tool_failure"` reason)
- `ModelRouter` in `OrchestratorDeps` (cascade, rules-based)
- `EscalationRouter` (agent vs human decision tree)
- Circular escalation guard

**Phase 9b:**
- `SessionTrajectory` computation
- Adaptive system prompts via `AdaptivePromptManager`
- `RESOLUTION_PREDICTED` event emission at configurable turn threshold

**Deferred v2.0:**
- Customer return detection via session fingerprints (PgVector embedding of conversation summaries)
- Pre-emptive resolution detection
- CLV routing
- Conversation shape recognition

---

## Track 5: Conversation Lifecycle Events

### 1. Current State Assessment

`ConversationEvent` is a flat wide interface with every field optional. No static type safety per event type. 14 `ConversationEventType` values, two of which are never emitted.

Silent bugs:
- `SESSION_STARTED`: defined, never emitted (SessionRegistry.getOrCreate() creates sessions but never fires this event)
- `TOOL_CALLED`: defined in ConversationEventType, never emitted as ConversationEvent (only on internal EventBus)
- `emitBatch()`: exists on ConversationEventEmitter, never called

Delivery: fire-and-forget `fetch()` with no retry, no queue, no dedup, no idempotency keys. Silently drops events on non-200 response (console.warn only).

### 2. Research Findings

**CloudEvents 1.0 (CNCF graduated specification)**

Envelope attributes:
```
specversion: "1.0"
id: "<uuid>"            # idempotency key
source: "kiln://{tenantId}/gateway"
type: "ai.kilnai.conversation.message_received"
time: "<ISO-8601>"
subject: "{sessionId}"  # groups events into a conversation trace
datacontenttype: "application/json"
traceparent: "{W3C Trace Context}"  # links to OTel spans
causationid: "{parentEventId}"      # DAG edge for debugging
data: { ... }
```

CloudEvents adoption: EventBridge (AWS), Event Grid (Azure), Knative, GCP Pub/Sub all natively consume CloudEvents format.

**At-least-once with idempotency**: Stripe/Segment webhook model — 3 retry attempts with exponential backoff (1s/2s/4s), consumer deduplicates using `id` UUID with 24h Redis SET.

**Per-turn batching**: Buffer within a turn (MESSAGE_RECEIVED + AGENT_ROUTED + TOOL_EXECUTED* + MESSAGE_SENT), emit as one batch after turn completes. Reduces HTTP POST count ~5x.

**Analytics DB recommendation**: TimescaleDB on existing PostgreSQL (same stack, lower operational complexity than ClickHouse). Migrate to ClickHouse when event volume exceeds ~10M events/day.

### 3. Architectural Recommendations

#### 3.1 Full Event Schema (Phase 9)

Replace flat `ConversationEvent` with discriminated union:

```typescript
// packages/core/src/engine/gateway/conversation-event.ts

export type ConversationEventType =
  // Existing (fixed)
  | "MESSAGE_RECEIVED"
  | "MESSAGE_SENT"
  | "SESSION_STARTED"            // now actually wired
  | "SESSION_EXPIRED"
  | "DELIVERY_STATUS"
  | "ESCALATION_DETECTED"
  | "HANDOFF_INITIATED"
  | "HANDOFF_RELEASED"
  | "OPERATOR_MESSAGE_SENT"
  | "HANDOFF_MESSAGE_QUEUED"
  | "TOOL_EXECUTED"
  | "AGENT_ROUTED"
  | "AGENT_HANDOFF"
  // New (Phase 9)
  | "MESSAGE_ENRICHED"           // per-message sentiment + intent (opt-in)
  | "MODEL_ROUTED"               // model routing decision
  | "CONVERSATION_CLOSED"        // session end with full aggregate
  | "CONVERSATION_ABANDONED"     // TTL expiry without resolution
  | "COST_REPORT"                // per-turn or session cost breakdown
  | "KNOWLEDGE_GAP_DETECTED"     // retrieval failed, flagged for content review
  | "RESOLUTION_PREDICTED"       // mid-conversation probability update
  | "ESCALATION_ROUTED"          // escalation → agent/human/model_upgrade decision
  ;

interface ConversationEventBase {
  readonly eventType: ConversationEventType;
  readonly tenantId: string;
  readonly channel: string;
  readonly externalUserId: string;
  readonly sessionId: string;     // required on ALL events
  readonly traceId: string;       // required on ALL events
  readonly timestamp: string;
  readonly schemaVersion: "1";
}
```

#### 3.2 Key New Event Payloads

```typescript
interface ConversationClosedEvent extends ConversationEventBase {
  readonly eventType: "CONVERSATION_CLOSED";
  readonly closedBy: "user" | "operator" | "session_timeout" | "resolved";
  readonly startedAt: string;
  readonly closedAt: string;
  readonly durationSeconds: number;
  readonly turnCount: number;
  // Enrichment (populated by EnrichmentPipeline, may be absent if pipeline failed)
  readonly summary?: string;
  readonly topics?: ReadonlyArray<{ tag: string; confidence: number }>;
  readonly resolution?: { status: string; confidence: number };
  readonly sentiment?: { trajectory: string; initialScore: number; finalScore: number };
  readonly effort?: { customerTurns: number; toolCallsFailed: number; agentHandoffs: number; modelUpgrades: number };
  readonly csatPrediction?: number;
  // Routing
  readonly modelsUsed?: ReadonlyArray<{ provider: string; model: string; turns: number; costUsd: number }>;
  readonly agentsUsed?: ReadonlyArray<{ agentId: string; agentName: string; turns: number }>;
  // Cost
  readonly totalCostUsd?: number;
}

interface ModelRoutedEvent extends ConversationEventBase {
  readonly eventType: "MODEL_ROUTED";
  readonly turnNumber: number;
  readonly selectedProvider: string;
  readonly selectedModel: string;
  readonly previousModel?: string;
  readonly reason: "initial" | "complexity_upgrade" | "cost_downgrade" | "fallback";
  readonly complexityScore?: number;
  readonly routingTier: RoutingTier;
  readonly estimatedCostUsd?: number;
}

interface MessageEnrichedEvent extends ConversationEventBase {
  readonly eventType: "MESSAGE_ENRICHED";
  readonly turnNumber: number;
  readonly direction: "inbound" | "outbound";
  readonly sentiment: { score: number; label: string; trend: string };
  readonly intent?: { primary: string; confidence: number };
}

interface CostReportEvent extends ConversationEventBase {
  readonly eventType: "COST_REPORT";
  readonly reportType: "per_turn" | "session_total";
  readonly turnNumber?: number;
  readonly totalCostUsd: number;
  readonly breakdown: {
    byModel: ReadonlyArray<{ provider: string; model: string; turns: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; costUsd: number }>;
    byAgent?: ReadonlyArray<{ agentId: string; agentName: string; turns: number; costUsd: number }>;
  };
}

interface KnowledgeGapDetectedEvent extends ConversationEventBase {
  readonly eventType: "KNOWLEDGE_GAP_DETECTED";
  readonly turnNumber: number;
  readonly topScore: number;
  readonly threshold: number;
  readonly suggestedAction: "create_faq" | "add_source" | "escalate";
}
```

#### 3.3 CloudEvents Envelope

```typescript
interface CloudEventEnvelope {
  readonly specversion: "1.0";
  readonly id: string;                   // UUID, idempotency key
  readonly source: string;               // "kiln://{tenantId}/gateway"
  readonly type: string;                 // "ai.kilnai.conversation.{eventType.toLowerCase()}"
  readonly time: string;
  readonly subject: string;              // sessionId
  readonly datacontenttype: "application/json";
  readonly dataschema?: string;
  readonly traceparent?: string;
  readonly causationid?: string;
  readonly data: ConversationEvent;
}
```

Opt-in via `EventsConfig.format: "raw" | "cloudevents"`.

#### 3.4 Retry with Exponential Backoff

Replace fire-and-forget with 3-attempt retry for critical events:

```typescript
async function postWithRetry(url: string, headers: Record<string, string>, body: string,
  maxAttempts = 3, backoffMs = 1000): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url, { method: "POST", headers, body });
    if (res.ok) return;
    if (res.status < 500) return;  // 4xx: don't retry, consumer error
    if (attempt < maxAttempts) await sleep(backoffMs * 2 ** (attempt - 1));
  }
  console.warn(`[events] Failed after ${maxAttempts} attempts`);
}
```

`CONVERSATION_CLOSED` should be awaited (not fire-and-forget) given its criticality for analytics.

#### 3.5 EventsConfig Extension

```typescript
interface EventsConfig {
  readonly webhook: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly format?: "raw" | "cloudevents";
  readonly batchStrategy?: "per_event" | "per_turn" | "per_session";
  readonly retryAttempts?: number;         // default 0 for backward compat; recommend 3
  readonly retryBackoffMs?: number;        // default 1000
}
```

#### 3.6 Schema Versioning

Every event carries `schemaVersion: "1"`. Breaking changes → bump to `"2"`. Schema URI versioned: `.../v1/conversation_closed.json` → `.../v2/`. Non-breaking changes (new optional fields) don't require a version bump.

#### 3.7 Retention Recommendations

| Event class | Retention |
|-------------|-----------|
| `CONVERSATION_CLOSED`, `CONVERSATION_ABANDONED` | 2 years |
| `MESSAGE_RECEIVED`, `MESSAGE_SENT` | 90 days |
| `TOOL_EXECUTED`, `AGENT_ROUTED` | 90 days |
| `COST_REPORT` (session_total) | 2 years |
| `ESCALATION_DETECTED`, `HANDOFF_*` | 1 year |
| `DELIVERY_STATUS` | 30 days |
| `MESSAGE_ENRICHED`, `RESOLUTION_PREDICTED` | 30 days |

### 4. Edge Cases & Failure Modes

**Abandoned sessions**: `SESSION_EXPIRED` ≠ `CONVERSATION_ABANDONED`. The latter needs conversation-level aggregate (turn count, resolution = "abandoned"). Emitted from `SessionRegistry.cleanup()` alongside session deletion. `CONVERSATION_CLOSED` must NOT also fire for abandoned sessions.

**Event ordering**: Consumer uses `turnNumber` for ordering. CloudEvents `causationid` enables DAG reconstruction from out-of-order delivery. Buffer 1-2 seconds before materializing for analytics.

**Duplicate events**: Emitter retries can produce duplicates. Consumer maintains dedup window using CloudEvents `id` UUID in Redis SET with 24h TTL.

**Webhook consumer down**: 3-attempt retry with exponential backoff handles transient outages. Events are logged with UUID for correlation. After max attempts, events are silently dropped and a `kiln_webhook_events_emitted_total{status="failed"}` counter increments.

**Large payloads**: `CONVERSATION_CLOSED` with 50-turn summary + breakdowns reaches 5-10KB. Well within standard 1MB webhook limits. Cap `summary` field at 500 characters. `MESSAGE_SENT` events use `messagePreview` (first 200 chars) not full content.

### 5. Beyond State-of-the-Art

**Reactive events**: YAML-configured automation triggers:
```yaml
events:
  reactions:
    - on: CONVERSATION_CLOSED
      condition: "resolution.status == 'unresolved'"
      post: "https://kilvo.app/api/tickets/create"
    - on: KNOWLEDGE_GAP_DETECTED
      throttle: "3 per 24h same query"
      post: "https://kilvo.app/api/content-gaps"
```

**Event streaming (SSE/WebSocket)**: Promote dev-mode SSE event stream (`/dev/events`) to production endpoint for real-time operator dashboards. Sub-50ms latency vs 100-500ms HTTP webhook.

**Event DAG with causationid**: `MESSAGE_RECEIVED` (id: e2, causationid: e1) → `AGENT_ROUTED` (id: e3, causationid: e2) → `TOOL_EXECUTED` (id: e4, causationid: e2) → `MESSAGE_SENT` (id: e5, causationid: e2). Enables full conversation replay and debugging without external graph infrastructure.

### 6. Priority Matrix

**Phase 9a:**
- Discriminated union for event types (type safety)
- Wire `SESSION_STARTED` (currently missing)
- `CONVERSATION_CLOSED` + `CONVERSATION_ABANDONED` events
- Retry with exponential backoff (3 attempts)
- `turnNumber` on MESSAGE_RECEIVED / MESSAGE_SENT
- `schemaVersion` on all events

**Phase 9b:**
- `MESSAGE_ENRICHED` (depends on enrichment pipeline from Track 2)
- `MODEL_ROUTED` (depends on model routing from Track 1)
- `COST_REPORT` per session
- `KNOWLEDGE_GAP_DETECTED` conversation event (surfaces existing EventBus event)
- `RESOLUTION_PREDICTED`
- `ESCALATION_ROUTED`
- CloudEvents envelope (opt-in)

**Phase 9c:**
- Per-turn event batching (5x HTTP reduction)
- `AnalyticsSink` integration with TimescaleDB

**Deferred v2.0:** SSE/WebSocket production streaming endpoint, reactive event router (YAML automation triggers), event DAG with `causationid`, Langfuse export adapter.

---

## Track 6: Competitive Landscape, Edge Cases & Scope

### 1. Kilvo Production Context

**What Kilvo can observe today:** Hourly conversation volume, handoff/escalation rates, per-conversation token usage, agent routing tier + confidence (Phase 8c).

**What Phase 9 unlocks:** Sentiment trends, resolution rate, CSAT inference, topic clustering, per-agent quality score, model cost breakdown, knowledge gap suggestions, contact lifetime sentiment.

**Intelligence Dashboard Requirements (from Kilvo roadmap):**
- Sentiment trend (7d/30d rolling)
- Resolution rate by agent
- CSAT inference score
- Topic heatmap with FAQ gap suggestions
- Cost per conversation by model
- Per-agent quality score composite
- Contact lifetime sentiment aggregation

**Key constraint**: All enrichment metadata must travel on the `conversation_closed` event payload — not a separate API call. Kilvo's Java/Spring backend is the source of truth.

### 2. Competitive Intelligence

**Intercom Fin (2024)**
- Resolution: silence-as-proxy within 10-minute window. Systematic false positives (customers who gave up = "resolved").
- CSAT: post-conversation thumbs up/down. Only on Pro plan ($99+/seat). Not inferred — explicit.
- Topic analytics: AI auto-tagging on Advanced/Expert plans only ($139+/seat). Manual labels at SMB tier.
- Intelligence is a paid add-on, not a base feature.
- **Gap**: Real-time sentiment (batch only, hours of lag). Model cost breakdown (fully opaque).

**Zendesk**
- CSAT prediction: claims 85% accuracy (trained on 18B tickets). Independent research ceiling: 70-78% on real-world support data.
- Intelligent triage: fine-tuned BERT-class model for intent + sentiment. $115/seat/mo (Suite Professional). Silent automation — scores not surfaced to customers.
- QA scoring (from Klaus acquisition): 5 dimensions scored 1-5, LLM-judged, $35/agent/mo add-on. Not SMB-accessible.
- **Gap**: Affordable QA scoring (Klaus is $35/agent/mo on top of Zendesk). SMB teams with 1-3 AI agents have zero QA tooling options.

**Ada**
- Containment rate definition: no human escalation. Does NOT equal resolution. Inflated numbers — abandoned sessions count as "contained."
- Resolution: post-conversation microsurvey or LLM-based scoring (beta, Enterprise only).
- **Spanish gap**: LATAM Spanish performance degraded vs Castilian. Mexican slang, WhatsApp register notably weaker.
- **Gap**: Affordable multi-language resolution scoring for LATAM market.

**Forethought**
- Quality scoring: rule-based heuristics (knowledge accuracy, intent confidence, turn count). Misses nuance — 10-turn resolved conversation scores lower than 2-turn abandoned one.
- **Gap**: Nuanced conversation quality (not proxy metrics).

**Kustomer**
- **Only competitor with per-message real-time sentiment** — lexicon-based (~5ms), displayed live in agent workspace. Enterprise only ($89/user/mo).
- Sentiment trajectory visualization (arc over conversation) — the feature most relevant to Kiln Phase 9 Studio UI.

**Freshdesk Freddy**
- Batch sentiment (15-minute lag). Spanish: 40-50 intents vs 150+ English. LATAM Spanish structurally weaker.
- Auto-resolution: silence-as-proxy (2-hour window). Same false positive problem as Intercom.

**Sierra (enterprise)**
- Post-conversation LLM evaluator (separate dedicated evaluator model, not the agent model). Scores 5 dimensions (goal achievement, policy compliance, empathy, accuracy, resolution completeness). 0-100 composite quality score. This is the architecture Kiln Phase 9 enrichment should mirror.
- Cross-session resolution: if customer returns to same issue within 72 hours, original session reclassified as unresolved. Most accurate resolution measurement in the market.
- **Priced for enterprise** ($50K+/year). Zero SMB equivalent.

### 3. What Nobody Does at SMB Tier ($29-299/mo)

| Capability | Gap |
|------------|-----|
| Real-time per-message sentiment | Only Kustomer (enterprise only, $89/user/mo) |
| AI-powered "this topic needs an FAQ" suggestions | Only Forethought (enterprise only) |
| Model cost breakdown per agent | Zero competitors expose this to customers |
| Conversation quality scoring without surveys | Only Sierra (enterprise only) |
| Cross-channel analytics (WhatsApp + web + email) | Only Intercom/Kustomer (Advanced/Enterprise tiers) |
| Per-agent routing quality metrics | Zero competitors at SMB tier |

**Kiln's structural advantage:** Pipeline depth. 20 steps per message means enrichment signals are available at every layer — tool execution results, routing decisions with confidence, PII detection flags, safety pipeline outputs. Competitor architectures don't instrument at this depth.

### 4. Deferred Items Evaluation

| Item | Verdict | Phase | Effort | Rationale |
|------|---------|-------|--------|-----------|
| OpenAPI-to-tools adapter | Defer | Phase 10 | M | Phase 5 concern; no Phase 9 dependency |
| Predictive tool selection L1 | Conditional | 9b if intent embedding exists | S | Free if piggybacking on Phase 9 intent embedding |
| Semantic query caching | **Include** | 9b | M | -30-50% retrieval cost; feeds cost dashboard |
| OTel metrics + traces export | **Include** | 9c | M | Explicit in Kilvo roadmap spec |
| Multi-tenant audit isolation | **Include** | 9a | S | LFPDPPP legal requirement; only ~200 LOC |
| Knowledge gap clustering Phase 2 | **Include** | 9b | M | Phase 1 events exist; Phase 2 is the visible output |
| STT + embedding cost tracking | **Include** | 9a | S | Required for accurate cost dashboard |
| hybridQuery in RetrievalPipeline | Defer | Phase 10 | S | DX improvement only; no Phase 9 dependency |

### 5. "Intelligence as a Service" Assessment

**Should enrichment be a standalone HTTP API?**

At Phase 9: **No**. Correct architecture is push-not-pull: `session_closed` event triggers enrichment pipeline → `conversation_enriched` event fires to product webhook. Consumers subscribe to events, don't call an endpoint.

**Comparison vs cloud NLP services:**
- AWS Comprehend: no conversation-level scoring, LATAM Spanish weaker, no resolution detection
- Azure Language: conversation summarization in preview, superior topic extraction, same LATAM gap
- Google NL API: good multilingual but no conversation-aware scoring

**Kiln's differentiators**: conversation-aware (full arc, not individual messages), domain-configurable per tenant, resolution-aware (none of the cloud services have this), superior informal LATAM Spanish comprehension.

**Pricing model when productized**: Included in Pro/Business tiers. For hypothetical third-party API: $0.003-0.005 per conversation enriched.

### 6. Production Edge Cases Catalog

**1. Model routing cost spike (all cheap models down)**
Detection: rolling average cost per conversation exceeds 3× 24-hour baseline → emit `COST_SPIKE_DETECTED`. Mitigation: per-tenant daily budget ceiling; CircuitBreaker on each model; graceful degradation to `overBudgetMessage` rather than routing 100% to Sonnet.

**2. Multilingual sentiment — Spanish false positives**
Patterns: "Gracias por nada" (thanks for nothing) appears positive in keyword analysis. "Muy amables" after a complaint sequence is sarcastic. Mexican diminutives ("buenito") are dismissive, not appreciative. Solution: LLM-based sentiment for Spanish (contextual, not lexicon); confidence scoring; test corpus of ~50 sarcasm patterns in eval framework.

**3. Resolution false positives — "gracias" without resolution**
In Mexican WhatsApp, "gracias" ends both resolved AND unresolved conversations at roughly equal frequency. Solution: LLM-inferred resolution from full transcript; tool execution success as strong signal; 4-point scale (resolved/partial/unresolved/ambiguous) not binary.

**4. CSAT prediction accuracy ceiling**
Academic ceiling: 70-78% Pearson correlation. Zendesk's 85% is cohort-specific. Mitigation: present as "Estimated Satisfaction" not "CSAT Score"; use 3-point scale (satisfied/neutral/dissatisfied) for higher reliability; surface confidence intervals; enable optional explicit survey as calibration mechanism.

**5. Topic drift**
Conversation starts "order status", becomes "delivery complaint". Mitigation: extract topic at turn 3 AND at conversation end. Store both as `primaryTopic` + `finalTopic`. Tag `topicDrift: true`. FAQ gap system uses `finalTopic`. Routing uses current-turn topic (EmbeddingTenantRouter already operates per-message, correct behavior).

**6. Cost tracking during stream drops**
Anthropic sends usage in final `message_stop` event. If stream drops before it arrives, cost is invisible. Mitigation: buffer final metadata event; record `kiln_streams_aborted_total` counter; add `partial_usage` best-effort estimate for budget enforcement.

**7. Analytics data volume at scale**
10K tenants × 300 convs/mo × 8 turns × 8 events/turn = ~33-48M events/month (46 events/second). Prometheus operations: negligible CPU. TimescaleDB: 15M rows/month × ~200 bytes = 3GB/month uncompressed. Enrichment LLM calls: 3M/month × $0.001 = $3,000/month. Semantic caching reduces this 30-50%.

**8. Enrichment latency**
Post-conversation LLM call takes 1-5 seconds. Solution: strictly fire-and-forget from main pipeline. Product webhook receives `CONVERSATION_CLOSED` immediately. `CONVERSATION_ENRICHED` fires 1-5 seconds later as separate event. 10-second timeout with `enrichmentStatus: "failed"` fallback.

**9. PII in enrichment payloads**
Topics and summaries may capture customer names, order IDs, addresses. Mexico LFPDPPP (March 2025 reform) applies. Mitigation: run `PiiScanner` on enrichment JSON before emission; prompt instructs model to return categorical topics not verbatim quotes; `piiRedacted: boolean` flag on `CONVERSATION_ENRICHED` event.

**10. Sentiment in edge cases**
Short (<2 turns): insufficient signal. Return `sentimentConfidence: "insufficient"`, display as "-" in dashboards. Long (50+ turns): compute in 3 segments. Weight final segment (last 5 turns) more heavily. Detect V-curve patterns (positive→negative→positive) as `sentiment_recovery` event type. Exclude 50+ turn outliers from average calculations.

### 7. Phase 9 Scope Definition

#### Phase 9a: Foundation (~1,500 LOC)

Goal: Instrument the engine. Zero product-visible features externally, but makes everything else possible.

| Item | Effort |
|------|--------|
| Multi-tenant audit isolation (LFPDPPP legal req.) | S |
| STT + embedding cost tracking | S |
| `CONVERSATION_CLOSED` + `CONVERSATION_ABANDONED` events | S |
| Wire `SESSION_STARTED` emission | S |
| `EnrichmentPipeline` skeleton (async, fire-and-forget, structured prompt) | M |
| `CONVERSATION_ENRICHED` event type with payload | S |
| `EnrichmentStore` interface + SQLite implementation | S |
| Enrichment admin API (`GET /tenants/:id/enrichment/*`) | M |
| PiiScanner on enrichment output | S |
| Customer Effort Score (rule-based, zero LLM) | S |
| `CostTracker` fix: accumulate by `role:model` | S |
| Retry with exponential backoff on ConversationEventEmitter | S |
| `schemaVersion` + `sessionId` + `traceId` on all events | S |
| `PrometheusCollector` + `CompositeEventStore` | M |
| Core Prometheus metrics (requests, duration, tokens, cost, errors) | S |
| `GET /metrics` endpoint | S |
| OTel GenAI attribute alignment in SpanMapper | S |
| `BatchSpanProcessor` replacing `SimpleSpanProcessor` | S |
| `RulesRouter` (Tier 1 model routing) | M |
| `ModelCapabilityRegistry` with built-in profiles | S |
| `ComplexityScorer` (5 signals, <1ms) | S |
| Per-request model selection in `ModeBOrchestrator` | M |
| Per-tenant routing rules in `TenantConfig.modelConfig` | S |

#### Phase 9b: Enrichment & Intelligence (~1,200 LOC)

Goal: AI-powered conversation understanding. First product-visible intelligence features.

| Item | Effort |
|------|--------|
| Post-conversation LLM enrichment prompt (single structured call) | M |
| Sentiment arc computation (3-segment for 20+ turn convs) | S |
| CSAT inference (multi-signal: LLM + turn count + resolution + tools) | M |
| Knowledge gap clustering Phase 2 (embedding clusters, admin API) | M |
| Semantic query caching (-30-50% retrieval cost) | M |
| Enrichment aggregates API | M |
| Safety metrics in Prometheus | S |
| Routing metrics + confidence histogram | S |
| Session metrics + knowledge metrics | S |
| `AnalyticsSink` → TimescaleDB per-tenant analytics | M |
| `CascadeRouter` with behavioral confidence | M |
| `ProviderHealthMonitor` EWMA | M |
| CircuitBreaker integration with routing | S |
| `MESSAGE_ENRICHED`, `MODEL_ROUTED`, `COST_REPORT`, `KNOWLEDGE_GAP_DETECTED` events | M |
| CloudEvents envelope opt-in | S |
| Sentiment-triggered escalation (3-turn minimum, EscalationDetector extension) | S |
| Tool failure accumulation escalation | S |
| `EscalationRouter` (agent vs human decision tree) | M |
| `SessionTrajectory` computation | M |
| Adaptive system prompts | S |

#### Phase 9c: Observability & Routing Intelligence (~800 LOC)

Goal: External observability and closing the routing feedback loop.

| Item | Effort |
|------|--------|
| OTel metrics + traces OTLP HTTP export | M |
| Langfuse / Honeycomb / Grafana Cloud config | S |
| `ProviderAnomalyDetector` + `RoutingFeedbackRegistry` | M |
| Online eval scorer on production conversations | M |
| Predictive resolution event at configurable turn threshold | M |
| Prometheus alerting rules YAML | S |
| Grafana dashboard JSON definitions | M |
| `knowledge_retrieved` EventBus event (counterpart to `knowledge_gap`) | S |
| Enrichment Timeline overlay in Studio | M |
| Per-turn event batching (5x HTTP reduction) | M |
| Routing stats admin API | S |

#### v2.0 Deferred

| Item | Reason |
|------|--------|
| ML-based complexity classifier (RouteLLM CAWR) | Requires training data collection (Phase 9 starts collecting) |
| Streaming cascade / speculative execution | Architectural complexity; stream splicing |
| Customer return detection via session fingerprints | Requires sufficient conversation history to be meaningful |
| Pre-emptive resolution detection | Requires "known unresolvable" labeled patterns per tenant |
| CLV routing | Requires CLV data integration |
| Intelligence as a standalone HTTP API | Product positioning decision; push model is sufficient |
| Cross-tenant anonymous benchmarking | Requires k-anonymity infrastructure + critical mass |
| Intelligence market / industry benchmarks | Post-Series A, post-10K tenants |
| Autonomous quality gates (auto-action) | Requires trust building; Phase 9c ships alert-only |
| hybridQuery in RetrievalPipeline | DX improvement, no Phase 9 dependency |
| OpenAPI-to-tools adapter | Phase 5 concern |
| Event DAG with causationid (production) | Nice-to-have; event batching is higher priority |
| SSE/WebSocket production streaming | High engineering investment; webhook retry covers most cases |

### 8. Beyond State-of-the-Art

**Conversation DNA**: Unique fingerprint of conversation shape (not content). Structural features: turn count, sentiment arc slope, topic drift velocity, tool execution sequence, time-between-turns distribution. Represented as a fixed-length embedding vector. Applications: anomaly detection at turn 4 for escalation-risk Pattern C; cross-agent performance comparison on identical conversation shapes; session fingerprints for pattern-based routing improvements. ~400 LOC. No competitor has shipped conversation structural fingerprinting.

**Collective intelligence (anonymized cross-tenant learning)**: With opt-in consent, aggregate categorical enrichment signals across similar businesses. *"Your resolution rate is in the 73rd percentile for salons in Mexico."* Privacy architecture: k-anonymity (minimum 5 tenants per cohort), categorical data only (no conversation text), HMAC-SHA256 anonymization of tenant IDs. Viable at 100+ tenants in the same vertical. Architecture now; product feature at scale.

**Intelligence market (sell enrichment as industry benchmarks)**: "The Kilvo SMB Conversational Commerce Index" — monthly report. Published at $500-2,000/year for agencies and enterprise AI vendors. Post-Series A, post-10K tenants.

**Autonomous quality gates**: Phase 9c: threshold detection → alert-only mode (emit `quality_gate_triggered` event, Kilvo sends email to account owner). v2.0: auto-action mode (opt-in per rule). Building the monitoring infrastructure now; automating the response later when operator trust is established.

---

## Implementation Notes

### New Files to Create

| File | Context | Purpose |
|------|---------|---------|
| `core/engine/domain/model-router.ts` | engine | `ModelRouter`, `ModelCapabilityProfile`, `RoutingRequest`, `RoutingDecision` interfaces |
| `core/agents/complexity-scorer.ts` | agents | `DefaultComplexityScorer` implementation |
| `core/agents/model-capability-registry.ts` | agents | `ModelCapabilityRegistry` with built-in profiles |
| `core/agents/rules-router.ts` | agents | `RulesRouter` Tier 1 implementation |
| `core/agents/cascade-router.ts` | agents | `CascadeRouter` Tier 2 implementation |
| `core/agents/provider-health-monitor.ts` | agents | EWMA latency + error rate tracking |
| `core/enrichment/types.ts` | enrichment (new context) | All enrichment interfaces |
| `core/enrichment/enrichment-pipeline.ts` | enrichment | `ConversationEnricher` LLM implementation |
| `runtime/enrichment/enrichment-store.ts` | enrichment | `InMemoryEnrichmentStore` + SQLite implementation |
| `runtime/enrichment/enrichment-runner.ts` | enrichment | Fire-and-forget post-session runner |
| `runtime/gateway/enrichment-admin-routes.ts` | gateway | Enrichment CRUD routes |
| `runtime/session/escalation-router.ts` | session | `EscalationRouter` implementation |
| `runtime/session/session-trajectory.ts` | session | `SessionTrajectoryComputer` |
| `runtime/session/adaptive-prompt-manager.ts` | session | `AdaptivePromptManager` |
| `runtime/observability/prometheus-collector.ts` | observability | `PrometheusCollector` EventStore |
| `runtime/observability/composite-event-store.ts` | observability | Fan-out to multiple EventStore sinks |
| `runtime/observability/analytics-sink.ts` | observability | Ring buffer → TimescaleDB flush |
| `runtime/observability/provider-anomaly-detector.ts` | observability | Sliding window anomaly detection |

### Files to Modify

| File | Changes |
|------|---------|
| `core/cost/cost-tracker.ts` | Accumulate by `${role}:${model}` not `AgentRole` |
| `core/events/index.ts` | Add `model_routed`, `conversation_closed`, `conversation_enriched` event types |
| `core/engine/gateway/conversation-event.ts` | Discriminated union; new event types; CloudEvents envelope |
| `core/engine/gateway/tenant-config.ts` | Add `modelConfig?: TenantModelConfig` |
| `core/orchestrator/orchestrator.ts` | `ModelRouter` in `ProviderRegistry` options |
| `core/observability/span-mapper.ts` | Add `gen_ai.*` attribute names; add `model_routed`, `conversation_closed` cases |
| `runtime/session/mode-b-orchestrator.ts` | `ModelRouter` injection; model selection per tool round |
| `runtime/session/escalation-detector.ts` | Sentiment + tool failure branches |
| `runtime/session/session-registry.ts` | Emit `SESSION_STARTED` and `CONVERSATION_CLOSED` |
| `runtime/gateway/gateway-server.ts` | `BatchSpanProcessor`; `CompositeEventStore`; `PrometheusCollector` wiring |
| `runtime/gateway/gateway-routes.ts` | `GET /metrics` endpoint; enrichment admin routes |
| `runtime/gateway/conversation-event-emitter.ts` | Retry with backoff; `emitBatch()` wiring |
| `runtime/gateway/message-pipeline.ts` | `MODEL_ROUTED`, `COST_REPORT`, `KNOWLEDGE_GAP_DETECTED` event emission |
| `runtime/gateway/handoff-routes.ts` | `ESCALATION_ROUTED` event; `CONVERSATION_CLOSED` on resolve |

### Dependency Rules (Respected)

- Model router interface (`ModelRouter`, `ModelCapabilityProfile`) → `core/engine/domain/` (zero external deps)
- `ComplexityScorer`, `ModelCapabilityRegistry`, `RulesRouter`, `CascadeRouter` → `core/agents/` (same context as provider adapters)
- `EnrichmentPipeline` → `core/enrichment/` (new bounded context in core)
- `EnrichmentStore`, `EnrichmentRunner`, `EnrichmentAdminRoutes` → `runtime/` (infrastructure layer)
- `PrometheusCollector` → `runtime/observability/` (optional peer dep, dynamic import)
- `prom-client` → optional peer dep on `@kilnai/runtime` (never on `@kilnai/core`)

---

## Research Citations

1. Ong, I. et al. (2024). "RouteLLM: Learning to Route LLMs with Preference Data." arXiv:2406.18665.
2. Chen, L., Zaharia, M., & Zou, J. (2023). "FrugalGPT: How to Use Large Language Models While Reducing Cost and Improving Performance." arXiv:2305.05176. Stanford University.
3. Dohan, D. et al. (2022). "Language Model Cascades." arXiv:2207.10342. DeepMind.
4. Madotto, A. et al. (2020). "End-to-End Trainable Non-Collaborative Dialog System." AAAI 2020.
5. Baethge, A. et al. (2023). "Predicting Customer Satisfaction from Conversational Text Data." Journal of Business Research.
6. Qualtrics XM Institute. (2022). "CSAT Prediction Accuracy Report."
7. Medallia Research. (2023). "AI-Powered CSAT Inference: State of the Art."
8. Microsoft Research. (2023). "Emotional Arcs in Customer Service Conversations."
9. OpenTelemetry GenAI Working Group. (2025). "Semantic Conventions for Generative AI Systems." opentelemetry.io/docs/specs/semconv/gen-ai/.
10. Langfuse. (2024). "Trace/Observation/Score Schema." langfuse.com/docs/api.
11. Datadog. (2024). "LLM Observability: Span Kinds and Attributes." docs.datadoghq.com.
12. Arize. (2024). "Phoenix: LLM Observability and RAG Evaluation." arize.com/phoenix.
13. CNCF CloudEvents Working Group. (2024). "CloudEvents Specification v1.0.2." cloudevents.io.
14. Intercom. (2024). "Fin AI Quality Score and Resolution Rate Methodology."
15. Zendesk. (2024). "CX Trends Report: AI Forecasting and CSAT Prediction."
16. Sierra. (2025). "Conversation Quality Scoring Architecture."
