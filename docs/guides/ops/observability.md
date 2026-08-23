# Observability

## Overview

Kiln provides three observability subsystems that work together through the `EventStore` interface:

1. **OpenTelemetry** -- distributed tracing with `gen_ai.*` semantic conventions
2. **Prometheus** -- counters and histograms exposed at `GET /metrics`
3. **EventStore** -- the internal event persistence layer that all sinks implement

All three integrate via `CompositeEventStore`, which fans out every event to all registered sinks. This means adding a new observability backend requires implementing a single `EventStore` interface with one write method.

## OpenTelemetry Integration

### Architecture

The OTel integration has two layers:

- **SpanMapper** (`core/observability/span-mapper.ts`) -- a pure, stateless function that maps every `KilnEvent` type to a `SpanOperation` descriptor. Zero external dependencies. The switch is exhaustive: adding a new event type without a corresponding case produces a compile error via a `never` guard.
- **OTelExporter** (`core/observability/otel-exporter.ts`) -- an `EventStore` implementation that receives `SpanOperation` descriptors and dispatches them to an OpenTelemetry `TracerProvider`. Write-only; retrieval is delegated to the OTel backend (Jaeger, Datadog, Grafana Tempo, etc.).

### Span Operations

The mapper produces 4 operation types:

| Operation | Used For |
|-----------|----------|
| `startSpan` | Phase transitions, task starts, tool calls, worker assignments, webhook triggers |
| `endSpan` | Task completions, tool results, errors, trigger failures, conversation close |
| `addEvent` | Thinking blocks, verification results, memory ops, approvals, security events, safety events, and routing decisions |
| `setAttributes` | Cost updates (token counts, USD totals) |

### gen_ai.* Semantic Conventions

Cost update events set OTel attributes following the emerging `gen_ai` semantic conventions:

| Attribute | Source |
|-----------|--------|
| `gen_ai.usage.input_tokens` | Token count from provider response |
| `gen_ai.usage.output_tokens` | Token count from provider response |
| `gen_ai.usage.cache_read_input_tokens` | Anthropic cache read tokens |
| `gen_ai.request.model` | Selected model (on `model_routed` events) |
| `gen_ai.system` | Provider name (on `model_routed` events) |

### Span Lifecycle

Active spans are tracked per-session in an internal Map. Span keys are derived from event fields (`toolName:taskId`, `worker:index`, `task:id`, `trigger:name`, `phase:name`). Spans are cleaned up on `endSpan` operations, and empty session maps are removed to prevent memory leaks. On gateway shutdown, `OTelExporter.shutdown()` ends any leaked spans and flushes the tracer provider.

### Configuration

`@opentelemetry/api` is a peer dependency of `@kilnai/runtime`, not a direct dependency of `@kilnai/core`. The `TracerProvider` is created and injected by the gateway server. To enable OTel:

```typescript
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

const provider = new NodeTracerProvider();
provider.addSpanProcessor(
  new BatchSpanProcessor(new OTLPTraceExporter({ url: "http://jaeger:4318/v1/traces" }))
);
provider.register();

const otelExporter = new OTelExporter(provider, { serviceName: "kiln-gateway" });
```

Use `BatchSpanProcessor` (not `SimpleSpanProcessor`) in production to avoid blocking the event loop on every span export.

## Prometheus Metrics

The `PrometheusCollector` implements `EventStore` and translates events into Prometheus counters and histograms. It dynamically imports `prom-client` as an optional peer dependency -- if the package is not installed, metrics are silently disabled.

### Counters

| Metric | Labels | Source Event |
|--------|--------|--------------|
| `kiln_llm_requests_total` | `provider`, `model`, `status` | `cost_update` |
| `kiln_llm_tokens_total` | `direction`, `provider`, `model` | `cost_update` |
| `kiln_cost_usd_total` | `provider`, `model` | `cost_update` |
| `kiln_tool_calls_total` | `tool_name`, `success` | `tool_result` |
| `kiln_tool_cache_hits_total` | `tool_name` | `tool_cache_hit` |
| `kiln_errors_total` | `code` | `error` |
| `kiln_agent_routings_total` | `agent_name`, `routing_tier` | `agent_routed` |
| `kiln_model_routings_total` | `provider`, `model`, `routing_tier` | `model_routed` |

### Histograms

| Metric | Labels | Buckets |
|--------|--------|---------|
| `kiln_llm_request_duration_seconds` | `provider`, `model` | 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0 |

### Cardinality Protection

`tenant_id` is intentionally excluded from all metric labels. In a multi-tenant gateway with hundreds of tenants, including tenant ID as a label would cause cardinality explosion in Prometheus. Per-tenant analytics should use the session and event stores instead.

### /metrics Endpoint

The gateway exposes `GET /metrics` which returns Prometheus text format from the collector's registry. The endpoint returns 404 if `prom-client` is not installed.

### Configuration

```typescript
const prometheus = new PrometheusCollector({ prefix: "kiln" });
```

The `prefix` option (default: `"kiln"`) is prepended to all metric names.

## Credential Pool Health

Gateway `GET /observability` includes live credential-pool snapshots when
providers are registered with the runtime observability registry. When gateway
JWT auth is configured, this endpoint requires a valid bearer token.

Credential-pool observations are secret-free. Each observation includes the
provider route, pool provider ID, selection strategy, aggregate metrics, and
entry-level health fields such as credential ID, label, source, priority, tier,
request count, last success, last exhaustion, and cooldown deadline.

Multiple active pools for the same provider family are reported separately, so
tiered routes such as `opencode-go` and `opencode-zen` remain distinguishable.

Gateway `GET /health` derives provider subsystem status from the same pool
snapshots for providers that do not use `apiKeyEnv`. A pooled provider is `ok`
when at least one credential is available, `degraded` when credentials exist but
none are currently available, and `error` when the route has no credential
evidence. Direct API-key providers continue to use their configured environment
variable for health.

## CompositeEventStore

`CompositeEventStore` fans out every `save()` call to all registered sinks using `Promise.allSettled()`. This ensures that a failure in one sink (e.g., OTel backend is down) does not prevent other sinks from receiving the event.

For read operations (`getBySession`, `getAfter`), it delegates to the first store that does not reject. This allows combining a write-only sink (OTel, Prometheus) with a readable sink (in-memory EventStore) in the same composite.

```typescript
const composite = new CompositeEventStore([
  eventStore,        // readable, in-memory or SQLite
  otelExporter,      // write-only, traces
  prometheus,        // write-only, metrics
]);
```

## Cost Tracking

The `CostTracker` accumulates token usage keyed by `role:model` tuple. This ensures accurate cost attribution when a role switches models mid-session (e.g., via model routing).

Provider billing mode comes from the canonical direct-provider execution
profile. Subscription and free routes therefore remain non-metered even when a
model has no entry in the metered pricing table. A metered route without known
pricing emits `costEvidence.kind: "unknown"` and `comparable: false` in its
`cost_update`; it does not write a repeated terminal warning.

## Runtime Trace Output

Runtime request traces use structured records with observation time, severity,
trace ID, component, message, and attributes. The process sink writes each
record atomically with the platform line ending so Windows terminal wrapping
cannot carry cursor position into a later record.

Normal operator commands suppress routine `info` traces. Set the process
environment only when runtime diagnostics are needed:

```powershell
$env:KILN_LOG_LEVEL = "info"
kiln gui
```

Accepted levels are `info`, `warn`, `error`, and `silent`; the default is
`warn`. Runtime trace records use the compact human format by default. For
machine ingestion, select JSON Lines:

```powershell
$env:KILN_LOG_FORMAT = "json"
kiln gui
```

`KILN_LOG_FORMAT` changes runtime trace records only. CLI startup and operator
guidance remain human-facing output. Canonical execution telemetry continues to
flow through `EventBus`, `EventStore`, OTel, and Prometheus rather than through
the terminal trace sink.

## Lifecycle Attribution

Runtime execution appends `lifecycle_attribution_recorded` session events after
provider usage is known. These events reconcile provider-reported totals with
semantic sources such as admitted memory, procedural context, repository
context, cache activity, final output, and unknown remainder.

Lifecycle attribution is observability evidence. It does not alter provider
requests, context admission, routing, or task outcomes. Provider usage remains
the billing source of truth; semantic allocations are labeled as provider
reported, runtime estimated, adapter estimated, or unknown according to the
route capability.

For the architecture contract, see
[Lifecycle Attribution](../../architecture/coordination/lifecycle-attribution.md).

### LLM Cost

Costs are computed using `MODEL_PRICING`, which derives rates from the same `MODEL_CATALOG` used by the capability registry. Anthropic models receive cache-aware pricing (cache read at 10% of input rate, cache write at 125%).

### STT Cost

| Method | Pricing Source |
|--------|---------------|
| `recordStt(model, durationSeconds)` | `gpt-4o-transcribe`: $0.006/min, `nova-3`: $0.0043/min |

### Cost Summary

`CostTracker.summary` returns a `CostSummary` with:

- `totalInputTokens`, `totalOutputTokens`, `totalCacheReadTokens`, `totalCacheWriteTokens`
- `totalCostUsd` (includes LLM + STT)
- `byRoleModel` -- keyed by `"role:model"` for precise per-model attribution

## Event Reference

### Internal EventBus Events (Observability-Relevant)

| Event | Category | Description |
|-------|----------|-------------|
| `cost_update` | state | Token usage and cost after each LLM call |
| `model_routed` | phase | Model routing decision with provider, model, tier, reason |
| `agent_routed` | state | Agent routing decision with agent ID, tier, confidence |
| `conversation_closed` | state | Session end with closedBy, turnCount, durationMs, effortScore |
| `tool_called` | tool | Tool invocation start |
| `tool_result` | tool | Tool invocation end with success/failure and duration |
| `tool_cache_hit` | tool | Tool result served from cache |
| `error` | error | Engine error with code and message |

### External Conversation Events

There is no external conversation-event webhook or automatic retry path. Canonical
session and turn evidence remains owned by the runtime event stores; consequential
external sends use the claimed channel-egress path with workload-local durable
idempotency.

## CLI Cost Tracking

When Kiln wraps CLI backends via kiln run, per-turn cost is tracked and surfaced in the session report.

### Cost Tracking Modes

Each backend reports cost differently:

| Backend | Mode | Mechanism |
|---------|------|-----------|
| Claude Code | native | SDK reports cost_update events with USD amounts |
| Codex CLI | computed | Token counts from JSONL events, priced via models.dev cache |
| OpenCode | none | No cost reporting available from SDK |

### models.dev Price Cache

For backends using computed cost tracking, Kiln fetches model pricing from the models.dev API and caches it locally:

- Cache location: .kiln/models-cache.json
- TTL: 24 hours
- Fallback: if fetch fails, uses last cached data (fail-open)

### Diminishing Returns Detection

Kiln monitors token output across continuations to detect when a session is producing diminishing value:

- Triggers after 3+ continuations where each delta is less than 500 tokens
- Signals the orchestrator to stop rather than burn budget on low-yield turns
- Surfaced in the session report as a stop reason

## Related

- [Model Routing](../config/model-routing.md) -- per-request model selection and routing rules
- [Provider Credentials](../config/provider-credentials.md) -- credential-pool operation and status
- [Provider Credential Pools](../../architecture/safety/provider-credential-pools.md) -- credential-pool architecture
- [Multi-Tenant](../config/multi-tenant.md) -- tenant configuration and billing
- [Gateway Configuration](../../configuration/gateway-yaml.md) -- gateway setup and deployment
