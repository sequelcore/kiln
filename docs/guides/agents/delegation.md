# Cross-App Delegation

Delegation is the mechanism by which one App's agent requests cognitive work from another App's agent and receives a structured JSON result. It is distinct from an API call: delegation asks for reasoning, not data retrieval. The calling agent provides a task description and a JSON Schema; the target agent reasons and returns a response that must validate against that schema.

Two delegation protocols are supported: Kiln-native (same Gateway process) and A2A (remote agent over HTTP).

## Kiln-Native Delegation

### Declaring a Delegation Capability

In the calling App's YAML, declare a capability with `type: delegation`:

```yaml
capabilities:
  - name: request_legal_review
    description: Ask the legal-ai app to review a contract clause
    type: delegation
    targetApp: legal-ai
    task: "Review the following clause for compliance issues"
    timeout: 60000
    schema:
      type: object
      properties:
        compliant:
          type: boolean
        issues:
          type: array
          items:
            type: string
        recommendation:
          type: string
      required: [compliant, issues, recommendation]
    tags: [delegation]
```

`targetApp` must match the `name` of another App in the same Gateway. `schema` is a JSON Schema object that the target's response must satisfy. `timeout` is in milliseconds (default: 120,000).

Self-delegation (`fromApp === toApp`) is rejected at validation time.

### DelegationRegistry

At startup, `startGateway()` builds a `DelegationRegistry` from all provider-adapter apps (`runtime: provider-adapter`). Apps using the subprocess runtime are not eligible as delegation targets. The registry maps each App name to its provider adapter and system prompt. It is built once at startup and is immutable for the lifetime of the process.

### executeDelegation() Lifecycle

1. Validates the `AppDelegation` request via `validateDelegation()`. Returns `PROVIDER_ERROR` on failure.
2. Looks up `toApp` in the `DelegationRegistry`. Returns `TARGET_APP_NOT_FOUND` if absent.
3. Generates a `delegationId` via `crypto.randomUUID()`.
4. Builds a composite system prompt: target's base system prompt + delegation task + optional context.
5. Races `provider.createMessage()` against the configured timeout. Returns `TIMEOUT` on expiry.
6. Parses the response body as JSON. Returns `SCHEMA_VALIDATION_FAILED` if parsing fails.
7. Validates the parsed object against `delegation.schema`. Returns `SCHEMA_VALIDATION_FAILED` on mismatch.
8. Returns `AppDelegationResult` on success.

Delegation sessions do not write to git-synced memory scopes and have no workspace access. No phase machine runs — delegation is a single reasoning call.

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `TARGET_APP_NOT_FOUND` | 404 | `toApp` is not registered in the delegation registry. |
| `TIMEOUT` | 408 | Provider call did not complete within `timeout` ms. |
| `SCHEMA_VALIDATION_FAILED` | 422 | Response is not valid JSON or does not match the declared schema. |
| `TARGET_APP_NOT_READY` | 503 | Target App registered but not currently available. |
| `PROVIDER_ERROR` | 502 | Provider returned an error, or validation of the delegation request failed. |

## A2A Delegation

A2A (Agent-to-Agent) delegation communicates with a remote agent over HTTP using the A2A protocol. It does not use the `DelegationRegistry` — it communicates directly with the remote agent's URL.

### Declaring an A2A Capability

```yaml
capabilities:
  - name: analyze_with_remote
    description: Delegate analysis to a remote specialized agent
    type: delegation
    delegationType: a2a
    agentUrl: https://agent.example.com/a2a
    task: "Analyze the provided dataset for anomalies"
    timeout: 90000
    schema:
      type: object
      properties:
        anomalies:
          type: array
        confidence:
          type: number
      required: [anomalies, confidence]
    tags: [delegation, a2a]
```

`delegationType: a2a` routes delegation through `executeA2ADelegation()` instead of the Kiln-native flow. `agentUrl` is required; without it, `TARGET_APP_NOT_FOUND` is returned.

### A2A Execution Flow

1. Validates that `agentUrl` is present.
2. Constructs an `A2AMessage` from `a2aMessage` (if provided) or wraps `delegation.task` as a text part.
3. Sends the task via `A2AClient.sendTask()` with the configured timeout.
4. If the remote task completes, extracts the result from the first artifact's first part (data or text).
5. Returns `PROVIDER_ERROR` if the task ends in a non-completed state or no extractable data is present.

Kiln uses `A2AClient` for outbound A2A delegation to external agents. The client sends tasks via JSON-RPC 2.0 to remote A2A-compliant agents.

## Internal Routes

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/_internal/delegation/delegate` | Execute a cross-app delegation. Body: `AppDelegation`. Returns `AppDelegationResult` or `{ error, code }`. |
| `GET` | `/_internal/delegation/delegation-targets` | List App names registered as delegation targets. Returns `{ targets: string[] }`. |

These routes are mounted at `/_internal/delegation` when a `DelegationRegistry` is available.
