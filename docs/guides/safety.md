# Safety Pipeline

The safety pipeline enforces enterprise content policies on every message passing through the Gateway. It runs on both incoming (user input) and outgoing (agent output) messages.

Sources: `packages/core/src/safety/`, `packages/runtime/src/gateway/safety-middleware.ts`

---

## Overview

The pipeline runs three stages in sequence:

```
Input / Output message
  -> PII Detection
  -> Content Classification
  -> Policy Rails
  -> Allowed / Blocked
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

## Events Emitted

The safety pipeline emits three event types to the EventBus on every scan:

| Event | Key Payload Fields | When |
|-------|--------------------|------|
| `pii_detected` | `direction`, `piiTypes`, `action`, `count`, `tier` | One or more PII matches found |
| `content_classified` | `direction`, `categories`, `blocked`, `tier` | Classification completes (regardless of outcome) |
| `policy_evaluated` | `railType`, `allowed`, `reason`, `direction` | Each rail evaluates a message |

`direction` is either `"input"` (user message) or `"output"` (agent response). Subscribe to these events via the `useKilnEvents` hook in the SDK or via `GET /dev/events` in dev mode.
