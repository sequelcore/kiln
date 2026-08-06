# Conversation Enrichment

## Overview

Kiln runs a post-conversation enrichment pipeline after each session closes. The pipeline extracts structured metadata from the conversation transcript: topic classification, sentiment analysis, resolution status, CSAT prediction, and customer effort scoring. Enrichment runs asynchronously (fire-and-forget, 10-second timeout) so it never delays the user experience.

The pipeline combines two complementary approaches: a deterministic, rule-based Customer Effort Score that requires zero LLM calls, and an LLM-powered analysis pass that extracts everything else in a single structured prompt.

## Customer Effort Score

The `computeEffortScore()` function produces a score on a 0--10 scale, where 10 means zero effort. It is deterministic, requires no LLM call, and runs in microseconds.

The score starts at 10 and subtracts penalties from 5 components:

| Component | Penalty | Cap |
|-----------|---------|-----|
| User turns beyond 2 | -0.3 per extra turn | -3.0 max |
| Clarification requests | -0.5 each | -2.0 max |
| Tool errors | -0.4 each | -2.0 max |
| Agent handoffs | -0.5 each | -1.5 max |
| Escalation to human | -1.5 (flat) | -1.5 |

The formula clamps at 0.0 minimum and rounds to 2 decimal places. Example: a session with 5 user turns (3 extra), 1 clarification, 0 tool errors, 0 handoffs, and no escalation scores `10 - 0.9 - 0.5 = 8.6`.

Clarification requests are initially set to 0 and updated from the LLM enrichment response when available.

## LLM Enrichment

The `LlmConversationEnricher` sends the full conversation transcript to a provider adapter in a single call with a structured system prompt. The LLM returns a JSON object containing:

| Field | Type | Description |
|-------|------|-------------|
| `summary` | string | 2--4 sentence summary of the conversation |
| `topics` | TopicTag[] | Up to 5 topics with label, subtopic, confidence, and prominence |
| `topicDrift` | boolean | Whether the conversation shifted topics |
| `resolution` | ResolutionResult | Status (`resolved`, `partial`, `unresolved`, `ambiguous`), confidence, evidence |
| `sentimentArc` | SentimentPoint[] | Per-turn sentiment for user turns only (-1.0 to 1.0) |
| `overallSentiment` | SentimentScore | Aggregate polarity, score, and confidence |
| `csatPrediction` | CsatPrediction | Predicted CSAT (0--5), confidence, and basis |
| `agentContributions` | array | Per-agent resolution contribution and sentiment delta |
| `language` | string | ISO 639-1 language code |
| `multilingual` | boolean | Whether multiple languages were used |
| `clarificationRequests` | number | Count of clarification requests (feeds back into effort score) |

The enrichment prompt includes a PII guard: the LLM is instructed to exclude customer names, order numbers, email addresses, and phone numbers from all output fields.

### Sentiment Arc Patterns

The sentiment arc is classified into one of 6 patterns by comparing the first and second halves of the conversation:

- `consistently_positive` -- all scores above 0.1
- `consistently_negative` -- all scores below -0.1
- `improving` -- second-half average exceeds first-half by more than 0.3
- `declining` -- first-half average exceeds second-half by more than 0.3
- `volatile` -- average per-turn change exceeds 0.4
- `neutral_throughout` -- default when no pattern is detected, or fewer than 2 data points

### Agent Performance

When the session involved multiple agents (multi-agent routing), the enrichment output includes per-agent metrics: turns handled, resolution contribution (`primary`, `partial`, `none`), and sentiment delta. This data is built from the session's `agentTurnHistory` combined with the LLM's contribution analysis.

## Short-Conversation Guard

Conversations with fewer than 2 user turns skip the LLM enrichment call entirely. These sessions produce a minimal enrichment record with:

- Effort score computed from available components
- Resolution status set to `ambiguous` with zero confidence
- Empty topics, sentiment arc, and summary
- Neutral sentiment pattern

This guard avoids wasting LLM tokens on sessions where the user sent a single message or abandoned immediately. The threshold is `MIN_USER_TURNS_FOR_LLM = 2`.

## Enrichment Failures

If the LLM call fails (timeout, parse error, provider outage), the pipeline falls back to the same minimal enrichment record used for short conversations. Enrichment is non-critical infrastructure -- failures are absorbed silently.

## Storage

Enrichment records are stored in a `SqliteEnrichmentStore` (WAL mode). The store supports:

- `save(enrichment)` -- upsert by session ID
- `get(sessionId)` -- retrieve a single record
- `listByTenant(tenantId, limit?, cursor?)` -- cursor-based pagination
- `delete(sessionId)` -- remove a single record (GDPR)

## Admin API

### List Enrichments

```
GET /api/tenants/:tenantId/enrichment?limit=20&cursor=<cursor>
```

Returns paginated enrichment records for a tenant. Response includes a `nextCursor` field for pagination.

### Get Enrichment

```
GET /api/tenants/:tenantId/enrichment/:sessionId
```

Returns the enrichment record for a specific session.

### Delete Enrichment (GDPR)

```
DELETE /api/tenants/:tenantId/enrichment/:sessionId
```

Permanently removes the enrichment record. Returns 204 on success, 404 if not found.

## Events

### Internal EventBus: `conversation_enriched`

Emitted after enrichment completes. Fields:

| Field | Type | Description |
|-------|------|-------------|
| `enrichmentId` | string | The session ID that was enriched |

### External Conversation Event: `CONVERSATION_ENRICHED`

Emitted via `ConversationEventEmitter` to product webhooks, enabling external systems to fetch and process enrichment data.

## Related

- [Model Routing](../config/model-routing.md) -- per-request model selection
- [Multi-Tenant](../config/multi-tenant.md) -- tenant configuration
- [Observability](../ops/observability.md) -- metrics and event infrastructure
