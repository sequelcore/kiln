# Model Routing Operations

Use this guide for tenant routing rules, complexity scoring, and emitted
routing events. For doctrine and placement in the control loop, start with:

- [Control Model](../architecture/control-model.md)
- [Coordination](../architecture/coordination.md)

Kiln selects the model for each request based on complexity, agent tier, budget
constraints, and tenant-level routing rules. If routing fails, the tenant's
default provider and model are used.

## Overview

Model routing runs inside `RuntimeSessionOrchestrator.processMessage()` before the LLM
call. Each routing decision is emitted as both an internal EventBus event
(`model_routed`) and an external conversation event (`MODEL_ROUTED`).

## Model Capability Registry

The `ModelCapabilityRegistry` maintains static capability profiles for built-in
models across known providers. These profiles are capability and cost metadata,
not the execution source of truth. Operator surfaces and direct CLI execution
must use runtime provider discovery for available model IDs before admitting
work.

Provider/model route health is evaluated after discovery and before execution.
If a route recently failed with a retryable provider outcome, Kiln treats that
specific provider/model as cooling down until its health record expires. For
OpenRouter free testing, prefer `openrouter/free` over a specific `:free` model
unless a route policy intentionally pins a model; the free router lets
OpenRouter choose currently available free capacity.

Operator routing uses ordered provider/model candidates when
`routing.routes` is configured. Direct provider candidates must pass model
discovery and provider/model route health before they enter the execution loop.
Harness candidates are evaluated by provider availability and registry health.
Explicit CLI `--provider` requests remain a single authoritative route; omit
the flag to use the configured route hierarchy.

For CLI run, the configured route hierarchy is task-aware. Kiln infers one
coarse task from the selected agent's `taskAffinity` before prompt keywords,
then ranks the configured candidates with `ModelCapabilityRegistry` task
suitability plus `modelTaskSuitability` overrides. This does not create a
second router: discovery, route health, credential health, and execution
admission still decide whether a candidate may run. Suitability only orders the
already configured candidates.

Reasoning effort is a separate policy layer. `reasoningPolicy` maps inferred
tasks to Kiln's normalized effort enum (`minimal`, `low`, `medium`, `high`,
`xhigh`). CLI run resolves that policy per admitted provider/model candidate,
after discovery and health checks. Automatic effort is sent only when discovery
advertises the selected model's compatible `supportedReasoningEfforts`; routes
without effort evidence run without an invented default unless the policy sets
`unsupported: fail`.

| Model | Provider | Quality | Tools | Streaming | Vision | Context |
|-------|----------|---------|-------|-----------|--------|---------|
| `claude-opus-4-6` | Anthropic | high | yes | yes | yes | 200K |
| `claude-sonnet-4-6` | Anthropic | high | yes | yes | yes | 200K |
| `claude-haiku-4-5-20251001` | Anthropic | medium | yes | yes | yes | 200K |
| `gpt-4o` | OpenAI | high | yes | yes | yes | 128K |
| `gpt-4o-mini` | OpenAI | medium | yes | yes | yes | 128K |
| `o3` | OpenAI | high | yes | no | yes | 200K |
| `o3-mini` | OpenAI | medium | yes | no | yes | 200K |
| `deepseek-chat` | DeepSeek | medium | yes | yes | no | 64K |
| `deepseek-reasoner` | DeepSeek | medium | no | yes | no | 64K |
| `nvidia/nemotron-3-nano-30b-a3b:free` | OpenRouter | medium | yes | yes | no | 256K |
| `stepfun/step-3.5-flash:free` | OpenRouter | medium | yes | yes | no | 256K |
| `arcee-ai/trinity-large-preview:free` | OpenRouter | medium | yes | yes | no | 131K |
| `meta-llama/llama-3.3-70b-instruct:free` | OpenRouter | medium | yes | yes | no | 128K |
| `google/gemma-3-27b-it:free` | OpenRouter | medium | yes | yes | yes | 131K |
| `qwen/qwen3-coder:free` | OpenRouter | medium | yes | yes | no | 262K |
| `mistralai/mistral-small-3.1-24b:free` | OpenRouter | medium | yes | yes | no | 128K |
| `ollama-local` | Ollama | low | no | yes | no | 128K |

The registry exposes these methods:

- `get(model)` -- returns the full `ModelCapabilityProfile` for a specific model.
- `eligible(request)` -- filters models by required capabilities (`hasTools`, `requiresStreaming`). Models that lack a required capability are excluded before routing rules evaluate.
- `taskSuitability(provider, model)` -- returns advisory task evidence such as
  `backend-coding:preferred:static-profile` or
  `frontend-design:limited:static-profile`.

Profiles include pricing data (`inputPer1M`, `outputPer1M`) sourced from a single `MODEL_CATALOG` used by both the registry and the cost tracker.

Task suitability is not an execution gate. It is model-selection evidence for
parent sessions, managed child routing, and future settings surfaces. A route
still has to pass provider discovery, route health, authority admission, and
tool-capability checks before execution.

Operator overrides supersede static suitability for the same
provider/model/task. If both routes have the same suitability level, an
operator override outranks a static profile and the original `routing.routes`
order breaks any remaining tie.

## Complexity Scoring

The `scoreComplexity()` function produces a `ComplexityScore` (0.0--1.0) from 5 weighted signals. It runs in under 1ms with zero external calls.

| Signal | Weight | Measurement |
|--------|--------|-------------|
| Token estimate | 0.30 | `message.length / 4`, normalized against 2000 tokens |
| Tool availability | 0.25 | Number of tools available, normalized against 10 |
| Code blocks | 0.20 | Binary: does the message contain fenced code blocks? |
| Reasoning markers | 0.15 | Binary: does the message contain phrases like "step by step", "analyze", "debug", "refactor", "compare", "evaluate", "explain why", "reason about", "architect"? |
| Turn depth | 0.10 | Current turn index, normalized against 20 turns |

The numeric score maps to a `ComplexityClass`:

| Score Range | Class |
|-------------|-------|
| < 0.2 | `trivial` |
| 0.2 -- 0.4 | `simple` |
| 0.4 -- 0.6 | `moderate` |
| 0.6 -- 0.8 | `complex` |
| >= 0.8 | `expert` |

The full `ComplexityScore` object (score, class, and all signal values) is passed to the rules router as part of the `RoutingRequest`.

## Rules Router

The `RulesRouter` evaluates routing rules in priority order (lower number = higher priority) and returns the first match. Each rule has a name, a priority, a condition, and a target model.

### Condition Types

| Type | Parameters | Matches when |
|------|-----------|-------------|
| `has_tools` | -- | Request involves tool use |
| `complexity_above` | `threshold: number` | Complexity score exceeds threshold |
| `complexity_below` | `threshold: number` | Complexity score is below threshold |
| `budget_below_cents` | `cents: number` | Remaining budget is below the specified amount |
| `agent_tier` | `tier: "fast" \| "coding" \| "reasoning"` | Active agent's declared tier matches |
| `agent_id` | `agentId: string` | Active agent's ID matches |
| `always` | -- | Always matches (catch-all) |

Before returning a match, the router validates that the target model supports the request's required capabilities (tools, streaming). If validation fails, the rule is skipped and evaluation continues to the next rule.

If no rules match, the router returns the configured default target with routing tier `"default"`.

### Example Rules

```yaml
modelConfig:
  defaultProvider: anthropic
  defaultModel: claude-sonnet-4-6
  rules:
    - name: simple-queries-use-haiku
      priority: 10
      condition:
        type: complexity_below
        threshold: 0.3
      target:
        provider: anthropic
        model: claude-haiku-4-5-20251001

    - name: reasoning-agents-use-opus
      priority: 20
      condition:
        type: agent_tier
        tier: reasoning
      target:
        provider: anthropic
        model: claude-opus-4-6

    - name: low-budget-fallback
      priority: 30
      condition:
        type: budget_below_cents
        cents: 50
      target:
        provider: deepseek
        model: deepseek-chat

    - name: tool-heavy-uses-sonnet
      priority: 40
      condition:
        type: has_tools
      target:
        provider: anthropic
        model: claude-sonnet-4-6
```

## Tenant Configuration

Model routing is configured per-tenant via `modelConfig` in the tenant configuration:

```yaml
tenants:
  - id: acme
    modelConfig:
      defaultProvider: anthropic
      defaultModel: claude-sonnet-4-6
      rules:
        - name: simple-to-haiku
          priority: 10
          condition:
            type: complexity_below
            threshold: 0.25
          target:
            provider: anthropic
            model: claude-haiku-4-5-20251001
```

The `modelConfig` field is optional. When omitted, the tenant uses whatever provider and model are configured in the `OrchestratorDeps` (the gateway-level default).

## Fail-Open Behavior

Model routing is designed to never block a conversation. If any step in the routing pipeline throws an error -- complexity scoring, rule evaluation, or capability validation -- the system falls back to the tenant's default provider and model. The error is logged but does not surface to the user.

This fail-open design applies to the entire routing chain. A misconfigured rule targeting a nonexistent model simply gets skipped. A missing `modelConfig` means no routing occurs at all.

## Events

### Internal EventBus: `model_routed`

Emitted after every routing decision. Fields:

| Field | Type | Description |
|-------|------|-------------|
| `model` | string | Selected model |
| `provider` | string | Selected provider |
| `routingTier` | RoutingTier | `"rule"`, `"complexity"`, `"cascade"`, or `"default"` |
| `reason` | string | Human-readable explanation (e.g., `Rule "simple-to-haiku" matched`) |
| `previousModel` | string? | Model used in the prior turn, if changed |
| `complexityScore` | number? | The computed complexity score |

### External Conversation Event: `MODEL_ROUTED`

Emitted via `ConversationEventEmitter` to product webhooks. Includes the same routing metadata for external analytics dashboards.

## Related

- [Tool Use](tool-use.md) -- tool authorization, rate limiting, webhook tools
- [Multi-Tenant](multi-tenant.md) -- tenant configuration and per-tenant overrides
- [App YAML](../configuration/app-yaml.md) -- agent tier declarations
