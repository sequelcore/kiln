# Safety Pipeline

The safety pipeline enforces enterprise content policies on every message passing through the Gateway. It runs on both incoming (user input) and outgoing (agent output) messages.

Sources: `packages/core/src/safety/`, `packages/runtime/src/gateway/safety-middleware.ts`, `packages/runtime/src/gateway/message-pipeline.ts`

---

## Overview

The pipeline runs four stages in sequence:

```
Input message
  -> PII Detection
  -> Content Classification
  -> Policy Rails
  -> Allowed / Blocked

Agent response (when groundingMode: verified)
  -> Grounding Rail (post-generation LLM judge)
  -> Grounded / Replaced
```

**Short-circuit on block.** If PII detection blocks a message, the content classification and rails stages are skipped entirely. The first stage to block terminates the pipeline.

**Fail-open design.** Scanner errors (network failures, LLM timeouts) are logged but do not block message processing. The pipeline produces a result with `blocked: false` on internal errors, ensuring a scanner outage does not take down the application.

The pipeline is activated by declaring a `safety` block in `app.yaml`. It is applied by `safety-middleware.ts` as a Hono middleware layer on the Gateway's per-App routes.

---

## PII Detection

`PiiScanner` detects six categories of personally identifiable information:

| Type | Examples |
|------|---------|
| `email` | `user@example.com` |
| `phone` | `+52 664 123 4567`, `(619) 555-0100` |
| `ssn` | `123-45-6789` |
| `credit_card` | `4111 1111 1111 1111` |
| `ip_address` | `192.168.1.1`, `2001:db8::1` |
| `date_of_birth` | `DOB: 01/15/1990` |

### Detection Tiers

**Tier 1 (Heuristic):** Regex patterns. Zero cost, runs on every message.

**Tier 2 (LLM Deep Scan):** Secondary LLM call for cases where regex is insufficient. Only triggered when `deepScan: true` is set.

### Actions

| Action | Behavior |
|--------|---------|
| `detect` | Log the match; allow the message through. |
| `redact` | Replace matched text with `[REDACTED]`; allow the modified message. |
| `block` | Reject the message entirely. |

One action applies to all types listed in `detect`. To apply different actions per type, use multiple PII scanner configurations.

### Allowlist

Values in the `allowlist` array are exempt from detection. Use this for known-safe values such as support email addresses.

### YAML Example

```yaml
safety:
  pii:
    detect: [email, phone, ssn, credit_card]
    action: redact
    allowlist: ["support@company.com", "noreply@company.com"]
    deepScan: false
```

---

## Content Classification

`ContentClassifier` classifies messages across six categories:

| Category | Description |
|----------|-------------|
| `hate` | Hateful content targeting groups |
| `violence` | Graphic or threatening violence |
| `sexual` | Explicit sexual content |
| `self_harm` | Content promoting self-harm |
| `harassment` | Personal harassment or bullying |
| `misinformation` | Demonstrably false claims |

### Detection Tiers

**Tier 1 (Heuristic):** Keyword and pattern matching. Zero cost.

**Tier 2 (LLM):** LLM-based classification for nuanced content. Triggered when `deepScan: true`.

### Thresholds

Each category has an independent threshold (0.0–1.0). The classifier returns a confidence score per category. If the score meets or exceeds the threshold, the configured action is applied.

Lower thresholds are more aggressive. A threshold of `0.5` flags anything the classifier is uncertain about; a threshold of `0.9` flags only high-confidence matches.

### YAML Example

```yaml
safety:
  content:
    enabled: true
    deepScan: false
    categories:
      hate:       { threshold: 0.7, action: block }
      violence:   { threshold: 0.8, action: block }
      sexual:     { threshold: 0.9, action: block }
      self_harm:  { threshold: 0.7, action: block }
      harassment: { threshold: 0.7, action: block }
```

---

## Policy Rails

Four rail types enforce application-specific content policies. Multiple rails of the same type can be declared.

### TopicRail

Blocks or escalates messages based on topic keywords.

```yaml
- type: topic
  block: [medical_advice, legal_advice, financial_advice]
  escalate: [billing_dispute, account_suspension]
```

| Field | Type | Description |
|-------|------|-------------|
| `block` | `string[]` | Topics that cause the message to be rejected. |
| `escalate` | `string[]` | Topics that trigger escalation to a human agent. |

### CompetitorRail

Prevents discussion of competitor products or brands.

```yaml
- type: competitor
  competitors: [CompetitorA, CompetitorB, "Rival Corp"]
  response: "I can only help with questions about our products."
```

| Field | Type | Description |
|-------|------|-------------|
| `competitors` | `string[]` | Brand or product names to block. |
| `response` | `string` | Message returned when a competitor mention is detected. |

### EscalationRail

Automatically escalates messages containing trigger phrases to a human agent.

```yaml
- type: escalation
  triggers: [urgent, emergency, critical, legal action]
  escalateTo: human-support
```

| Field | Type | Description |
|-------|------|-------------|
| `triggers` | `string[]` | Phrases that activate escalation. |
| `escalateTo` | `string` | Identifier of the escalation target (agent, team, or queue). |

### ComplianceRail

Enforces regulatory language requirements. Blocks messages that violate the specified compliance standards.

```yaml
- type: compliance
  required: [GDPR, HIPAA]
```

| Field | Type | Description |
|-------|------|-------------|
| `required` | `string[]` | Compliance frameworks to enforce. |

---

## Complete YAML Configuration

```yaml
safety:
  pii:
    detect: [email, phone, ssn, credit_card, ip_address, date_of_birth]
    action: redact
    allowlist: ["support@company.com"]
    deepScan: false

  content:
    enabled: true
    deepScan: false
    categories:
      hate:         { threshold: 0.7, action: block }
      violence:     { threshold: 0.8, action: block }
      sexual:       { threshold: 0.9, action: block }
      self_harm:    { threshold: 0.7, action: block }
      harassment:   { threshold: 0.7, action: block }
      misinformation: { threshold: 0.8, action: block }

  rails:
    - type: topic
      block: [medical_advice, legal_advice]
      escalate: [billing_dispute]
    - type: competitor
      competitors: [CompetitorA, CompetitorB]
      response: "I can only help with questions about our products."
    - type: escalation
      triggers: [urgent, emergency, legal action]
      escalateTo: human-support
    - type: compliance
      required: [GDPR]
```

Place the `safety` block at the top level of `app.yaml`. See the [App YAML Reference](../configuration/app-yaml.md#safety) for context.

---

## Grounding Rail (Tier 2)

The **Grounding Rail** is a post-generation safety stage that verifies an agent response is factually supported by the retrieved knowledge chunks. It is designed for regulated industries (finance, healthcare, legal) where hallucinations must be caught and suppressed, not just discouraged.

This stage runs only when:
1. `groundingMode` is set to `"verified"` on the tenant config.
2. A knowledge context was retrieved for the request (i.e., knowledge is configured).
3. The response is not queued (session is `ai_active`).

### How It Works

```
Agent generates response
  -> GroundingRail.evaluate(response, chunks, provider, model)
  -> LLM judge outputs { grounded, confidence, ungroundedClaims }
  -> if !grounded: replace response with safe fallback message
  -> emit grounding_evaluated event (always)
  -> emit GROUNDING_BLOCKED event (if blocked)
```

The LLM judge uses a strict system prompt to compare the response against the retrieved reference chunks. It identifies specific factual claims not supported by the chunks. Conversational filler and hedging phrases (`"I think"`, `"based on the information"`) are not flagged as claims.

**Model selection:** The pipeline automatically selects the cheapest model available in the provider pool that supports structured output. This uses the same `ModelCapabilityRegistry` infrastructure as model routing — no hardcoded provider.

**Fail-open design:** If the grounding check fails (network error, LLM timeout, parse error), the original response is passed through unchanged. A warning is traced but the message is never blocked silently.

### Grounding Modes

| `groundingMode` | Behavior |
|-----------------|----------|
| `off` (default) | No grounding enforcement. |
| `strict` | System prompt directive added when knowledge context is present: instructs the model to answer only from context, never fabricate, and offer escalation when the answer is not in context. Zero cost, zero latency. |
| `verified` | `strict` directive **plus** post-generation LLM judge. If judge marks response ungrounded, response is replaced with a generic safe fallback and `GROUNDING_BLOCKED` is emitted. ~200ms + 1 LLM call per message. |

### YAML Configuration

```yaml
gateway:
  tenants:
    - id: my-tenant
      groundingMode: verified  # off | strict | verified
```

`groundingMode` is a mutable tenant field — it can be updated via the tenant admin API without restarting the gateway.

### Grounding Result

The pipeline returns a `GroundingResult` in `InboundMessageResult.groundingResult`:

| Field | Type | Description |
|-------|------|-------------|
| `grounded` | `boolean` | Whether the response is supported by retrieved chunks. |
| `confidence` | `number` (0–1) | Judge's confidence in the grounding verdict. |
| `ungroundedClaims` | `string[]` | Specific claims not found in the reference chunks. |
| `durationMs` | `number` | Time taken by the judge LLM call. |
| `model` | `string` | Model used for the grounding check. |

---

## Events Emitted

The safety pipeline emits four event types to the EventBus:

| Event | Key Payload Fields | When |
|-------|--------------------|------|
| `pii_detected` | `direction`, `piiTypes`, `action`, `count`, `tier` | One or more PII matches found |
| `content_classified` | `direction`, `categories`, `blocked`, `tier` | Classification completes (regardless of outcome) |
| `policy_evaluated` | `railType`, `allowed`, `reason`, `direction` | Each rail evaluates a message |
| `grounding_evaluated` | `grounded`, `confidence`, `ungroundedClaims`, `durationMs`, `model` | Grounding check completes (only when `groundingMode: verified`) |

`direction` is either `"input"` (user message) or `"output"` (agent response). In addition, a `GROUNDING_BLOCKED` conversation event is emitted to the product webhook when a response is replaced.

Subscribe to these events via the `useKilnEvents` hook in the SDK or via `GET /dev/events` in dev mode.
