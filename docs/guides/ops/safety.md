# Safety Operations

Use this guide for safety configuration, runtime stages, and emitted events. For
doctrine and control-plane ownership, start with:

- [Safety](../../architecture/safety/safety.md)
- [Flows](../../architecture/core/flows.md)

Sources: `packages/core/src/safety/`,
`packages/runtime/src/gateway/safety-middleware.ts`,
`packages/runtime/src/gateway/message-pipeline/`

## Pipeline Shape

The Gateway evaluates safety in a fixed sequence:

```text
Input message
  -> PII Detection
  -> Content Classification
  -> Policy Rails
  -> Allowed / Blocked

Agent response (when groundingMode: verified)
  -> Grounding Rail
  -> Grounded / Replaced
```

Operational behavior:

- the first blocking stage stops later stages
- scanner or model failures are fail-open and logged
- the pipeline is enabled from the top-level `safety` block in `app.yaml`

## PII Detection

`PiiScanner` detects six categories:

- `email`
- `phone`
- `ssn`
- `credit_card`
- `ip_address`
- `date_of_birth`

Two detection tiers are supported:

- regex heuristics on every message
- optional LLM deep scan when `deepScan: true`

Actions are `detect`, `redact`, or `block`.

## Content Classification

`ContentClassifier` evaluates these categories:

- `hate`
- `violence`
- `sexual`
- `self_harm`
- `harassment`
- `misinformation`

Each category has its own threshold and action. Lower thresholds are more
aggressive. Deep scan is optional.

## Policy Rails

The runtime supports four rail types:

- `topic`
- `competitor`
- `escalation`
- `compliance`

Multiple rails of the same type can be declared in one config.

## `app.yaml`

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

See the [App YAML reference](../../configuration/app-yaml.md) for the current
file boundary. Verify the exact safety shape against the application parser.

## Grounding Rail

The grounding rail runs only when:

1. `groundingMode` is `verified`
2. knowledge context was retrieved
3. the session is not queued

It compares the generated response against retrieved chunks and can replace an
unsupported answer with a safe fallback. If the grounding check fails
internally, the original response passes through and a warning is traced.

Grounding modes:

| Mode | Behavior |
|------|----------|
| `off` | No grounding enforcement. |
| `strict` | Adds a prompt-side instruction to answer only from context. |
| `verified` | Runs `strict` plus a post-generation grounding judge. |

## Events

The safety pipeline emits:

- `pii_detected`
- `content_classified`
- `policy_evaluated`
- `grounding_evaluated`

When a response is replaced, the product webhook surface also receives
`GROUNDING_BLOCKED`.
