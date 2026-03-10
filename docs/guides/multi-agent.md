# Multi-Agent Routing

Multi-agent routing enables a single tenant to define multiple specialized agents that share one customer-facing channel (WhatsApp number, widget, email address, etc.). A routing layer selects which agent handles each inbound message based on regex patterns, embedding similarity, or a static fallback.

All six channel adapters (Web, WhatsApp, Instagram, Messenger, Email, Mode B REST) use the same routing pipeline. Sessions track `activeAgentId` and `agentTurnHistory` for continuity across agent switches.

## Configuration

Agents and routing are declared in `TenantConfig`. Each agent has an identity (name, role, goal) and an optional tool scope. Routing specifies how inbound messages map to agents.

```yaml
# TenantConfig (via admin API or JSON persistence)
agents:
  - id: sales
    name: "Sales Agent"
    role: "Sales specialist"
    goal: "Convert inquiries into bookings"
    tools: [check_availability, create_booking]
  - id: support
    name: "Support Agent"
    role: "Customer support"
    goal: "Resolve customer issues quickly"
    tools: [lookup_order, refund]
    isDefault: true

routing:
  rules:
    - match: "price|cost|book|appointment|reserv"
      agent: sales
    - match: "refund|cancel|order|problem|issue"
      agent: support
  fallback: support
  maxHandoffs: 5
  rerouteAfterTurns: 2
  embeddingThreshold: 0.75
```

### Agent Fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique identifier (referenced by routing rules) |
| `name` | Yes | Display name, injected into the agent's system prompt |
| `role` | Yes | One-line role description |
| `goal` | Yes | Primary objective |
| `backstory` | No | Additional persona context |
| `instructions` | No | Operating instructions appended to the system prompt |
| `tools` | No | Tool allowlist for this agent (zero-trust: omitted/empty = no tools, `["*"]` = all, explicit list = only those) |
| `isDefault` | No | Fallback agent when routing result references an unknown ID |

### Routing Fields

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `rules` | No | `[]` | Ordered regex rules; first match wins |
| `fallback` | Yes | -- | Agent ID used when no rule or embedding matches |
| `embeddingThreshold` | No | `0.75` | Minimum cosine similarity for Tier 2 embedding routing |
| `maxHandoffs` | No | `3` | Maximum agent switches per session before locking |
| `rerouteAfterTurns` | No | `1` | Minimum conversation turns before re-routing is allowed |

Validation enforces that `routing` is required when `agents.length > 1`, that `fallback` references a declared agent ID, and that all routing rule `agent` values reference declared agents. Invalid regex patterns are rejected at validation time.

When `agents` is absent or has one entry, the single-agent pipeline is used with zero behavioral change.

## Routing Tiers

Routing uses a 3-tier cascade. Each tier is tried in order; the first to produce a result wins.

### Tier 1: Regex Rules

Pattern matching against the extracted text of the inbound message. Rules are evaluated in declaration order; the first match wins. Regex compilation is case-insensitive. Broken regex patterns are skipped at runtime (fail-open).

```yaml
routing:
  rules:
    - match: "price|cost|quote|buy"
      agent: sales
    - match: "track|shipping|delivery|order"
      agent: order-support
  fallback: sales
```

Tier 1 routing runs synchronously with zero external calls.

### Tier 2: Embedding Similarity

When no regex rule matches and an `AgentRAG` instance is configured, the router embeds the inbound message and compares it against pre-embedded agent descriptions (`"{name}: {role}. {goal}"`). The agent with the highest cosine similarity is selected if the score meets `embeddingThreshold`.

Tier 2 requires:
- An embedding adapter (e.g., OpenAI `text-embedding-3-small`)
- A vector store (in-memory or PgVector)
- Agent descriptions ingested via `AgentRAG.ingestAgents()`

Tier 2 is async-only, accessed through `resolveAgentContextAsync()`. Channel handlers that use synchronous resolution (`resolveAgentContext()`) skip Tier 2 and fall through directly to the fallback.

```yaml
routing:
  rules:
    - match: "emergency|urgent"
      agent: priority-support
  fallback: general
  embeddingThreshold: 0.8  # Higher threshold = more confident matches only
```

### Fallback

When neither regex nor embedding produces a match, the `fallback` agent handles the message. This is the only required field in `routing`.

## Agent Tool Scoping

Each agent can declare a `tools` array controlling which tools it can invoke. Agent tool access uses **zero-trust semantics**:

| `tools` value | Behavior |
|---------------|----------|
| Omitted or `[]` | Agent gets **no tools** |
| `["*"]` | Agent gets all available tenant tools |
| `["check_availability", ...]` | Agent gets only listed tools (intersected with tenant allowlist) |

When an explicit list is provided, the effective tool set is the **intersection** of the agent's `tools` list with the tenant-level tool allowlist (from `TenantConfig.tools`, `webhookTools`, and `integrations`).

```yaml
# Tenant-level tools
tools: [check_availability, create_booking, lookup_order, refund, notify_owner]

agents:
  - id: sales
    name: "Sales Agent"
    role: "Sales specialist"
    goal: "Close deals"
    tools: [check_availability, create_booking]
    # Effective tools: check_availability, create_booking

  - id: support
    name: "Support Agent"
    role: "Customer support"
    goal: "Resolve issues"
    tools: ["*"]
    # Effective tools: all tenant tools (check_availability, create_booking, lookup_order, refund, notify_owner)

  - id: readonly
    name: "Info Agent"
    role: "Information only"
    goal: "Answer questions without taking actions"
    # tools omitted → no tools available
```

Webhook tools, integration tools, rate limiters, and built-in tools (e.g., `notify_owner`) are inherited from the tenant context. The zero-trust model ensures agents with side-effect-capable tools (e.g., integration adapters for Google Calendar, Stripe) must explicitly opt in.

## Warm Handoff Briefs

When routing switches from one agent to another mid-conversation, the new agent risks losing context. Warm handoff briefs solve this by generating an LLM summary of the conversation so far and injecting it into the new agent's system prompt.

The `DefaultAgentHandoffSummarizer` takes the last 10 messages from the session, sends them to the provider with a system prompt requesting a 2-3 sentence summary, and returns the brief in the format:

```
[Handoff from Sales Agent]: Customer asked about pricing for the deluxe package.
They were quoted $199/month and asked about a discount for annual billing.
No commitment was made.
```

This brief is:
- Appended to the new agent's system prompt for the current turn
- Stored in `AgentTurnEntry.handoffBrief` for audit
- Capped at 150 tokens to keep context lean

Handoff briefs are generated only when `AsyncAgentResolverDeps.handoffSummarizer` is provided. Without it, agent switches still work but the new agent starts without prior context. The summarizer is fail-open: if the LLM call fails, routing proceeds without a brief.

## Ping-Pong Guard

The ping-pong guard prevents rapid agent-switching loops where routing bounces a conversation between two agents on every turn. Three independent checks run before any agent switch:

| Check | Default | Blocks When |
|-------|---------|-------------|
| `maxHandoffs` | 3 | Total agent switches in the session exceeds the limit |
| `rerouteAfterTurns` | 1 | Fewer than N conversation turns have elapsed since the last switch |
| Bidirectional pair | Always on | Agent A handed to B, and routing wants to send back to A immediately |

When any check blocks, the current agent stays active. The `ResolvedAgentContext` reports `pingPongBlocked: true` and a `pingPongReason` string (`"max_handoffs_exceeded"`, `"cooldown_active"`, or `"bidirectional_pair"`).

```yaml
routing:
  rules:
    - match: "billing|invoice|payment"
      agent: billing
  fallback: general
  maxHandoffs: 5       # Allow more switches for complex conversations
  rerouteAfterTurns: 2  # Require 2 turns before re-evaluating
```

The guard is stateless -- it reads from session state (`handoffCount`, `lastRouteChangeAt`, `agentTurnHistory`) but does not mutate it. Session state updates happen in the channel handlers after the guard runs.

## Routing Templates

Three built-in templates provide pre-configured agent and routing setups for common business types. Templates are accessible via `listRoutingTemplates()` in code or the `GET /routing/templates` admin endpoint.

### service-business

For salons, clinics, repair shops.

| Agent | Role | Routing Pattern |
|-------|------|-----------------|
| Booking Agent | Appointment scheduler | `appointment\|book\|schedule\|reserv\|reschedule` |
| Support Agent | Customer support | `problem\|issue\|complaint\|broken\|not working` |
| General Inquiry Agent | Information specialist | Fallback |

### ecommerce

For online stores.

| Agent | Role | Routing Pattern |
|-------|------|-----------------|
| Sales Agent | Sales specialist | `buy\|purchase\|price\|quote\|cost\|product` |
| Returns Agent | Returns/refunds specialist | `cancel\|refund\|return\|exchange` |
| Order Support Agent | Order specialist | `order\|tracking\|shipping\|delivery\|shipped` |

### customer-support

For multi-tier support teams.

| Agent | Role | Routing Pattern |
|-------|------|-----------------|
| Technical Support Agent | Technical specialist | `error\|bug\|crash\|broken\|not working\|technical` |
| Billing Agent | Billing specialist | `invoice\|charge\|payment\|billing\|subscription\|plan` |
| Triage Agent | First responder | Fallback |

Templates serve as starting points. Copy the agent and routing config into your tenant and customize the patterns, goals, and tool scopes for your domain.

## Events

Two conversation event types provide visibility into agent routing for product backends.

### AGENT_ROUTED

Emitted on every message after agent resolution completes.

| Field | Type | Description |
|-------|------|-------------|
| `activeAgentId` | `string` | ID of the agent handling this message |
| `activeAgentName` | `string` | Display name of the active agent |
| `routingTier` | `"rule" \| "embedding" \| "fallback"` | Which tier produced the routing decision |
| `routingConfidence` | `number \| undefined` | Cosine similarity score (Tier 2 only) |

### AGENT_HANDOFF

Emitted when the active agent changes between consecutive messages.

| Field | Type | Description |
|-------|------|-------------|
| `fromAgent` | `string` | Name of the previous agent |
| `toAgent` | `string` | Name of the new agent |
| `reason` | `string` | Why the handoff occurred (e.g., `"agent_routing"`) |
| `accepted` | `boolean` | Whether the handoff completed (false if ping-pong blocked) |

The EventBus also emits typed `handoff_requested` and `handoff_completed` events for internal consumption (e.g., cost attribution, observability spans).

## Admin API

### Routing Test (Dry Run)

Test how a message would be routed without creating a session.

```
POST /tenants/:tenantId/routing/test
Content-Type: application/json

{
  "message": "I need to reschedule my appointment"
}
```

Response:

```json
{
  "agentId": "booking",
  "agentName": "Booking Agent",
  "tier": "rule",
  "matchedPattern": "appointment|book|schedule|reserv|reschedule",
  "confidence": null,
  "allRules": [
    { "match": "appointment|book|schedule|reserv|reschedule", "agent": "booking", "matched": true },
    { "match": "problem|issue|complaint|broken|not working", "agent": "support", "matched": false }
  ]
}
```

### Routing Templates

List all built-in routing templates.

```
GET /routing/templates
```

Returns an array of `RoutingTemplate` objects with `id`, `name`, `description`, `category`, `agents`, and `routing` fields.

### Agent/Routing Updates

Agent and routing configuration is mutable via the tenant admin API. Update `agents` and `routing` fields through `PATCH /tenants/:tenantId`.

## Best Practices

**Start with regex, add embedding later.** Tier 1 regex rules handle the majority of routing at zero cost and zero latency. Define patterns for your most common intents first. Add Tier 2 embedding routing only when you have ambiguous queries that regex cannot capture.

**Keep agent goals distinct.** Overlapping goals (e.g., two agents both handling "customer issues") cause unstable routing. Each agent should own a clearly delineated domain.

**Set `rerouteAfterTurns` to 2 or higher.** The default of 1 allows re-routing on every turn, which can feel jarring. A value of 2-3 gives agents time to resolve the query before routing reconsiders.

**Use `maxHandoffs` to bound cost.** Each handoff generates an LLM call for the brief. For cost-sensitive deployments, keep `maxHandoffs` at 3-5.

**Test routing before deploying.** Use `POST /tenants/:tenantId/routing/test` to verify that representative messages route to the correct agent. The `allRules` array in the response shows exactly which rules matched and which did not.

**Scope tools per agent.** Giving every agent access to every tool increases the risk of misrouted tool calls. A sales agent should not have access to `refund`; a support agent should not have access to `create_booking`.

**Monitor handoff events.** The `AGENT_HANDOFF` conversation event provides a clear signal for quality analysis. High handoff rates between specific agent pairs indicate overlapping routing patterns that should be refined.

---

Related guides: [Concepts](../concepts.md) | [Multi-Tenant](./multi-tenant.md) | [Tool Use](./tool-use.md) | [Channels](./channels.md) | [Gateway Configuration](../configuration/gateway-yaml.md)
