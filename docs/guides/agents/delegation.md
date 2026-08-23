# Cross-App Delegation

Delegation is the mechanism by which one App's agent requests cognitive work from another App's agent and receives a structured JSON result. It is distinct from an API call: delegation asks for reasoning, not data retrieval. The calling agent provides a task description and a JSON Schema; the target agent reasons and returns a response that must validate against that schema.

Kiln supports one cross-App delegation protocol: Kiln-native delegation within the same Gateway process.

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

At startup, `startGateway()` builds a `DelegationRegistry` from admitted App
runtime targets. The registry maps each App name to its Runtime-owned execution
entrypoint and system prompt. It is built once at startup and is immutable for
the lifetime of the process. Delegation never receives a provider adapter and
cannot call a provider directly.

### executeDelegation() Lifecycle

1. Validates the `AppDelegation` request via `validateDelegation()`. Returns `PROVIDER_ERROR` on failure.
2. Looks up `toApp` in the `DelegationRegistry`. Returns `TARGET_APP_NOT_FOUND` if absent.
3. Generates a `delegationId` via `crypto.randomUUID()`.
4. Builds a composite system prompt: target's base system prompt + delegation task + optional context.
5. Races the target's Runtime-owned admitted execution against the configured
   timeout. That execution uses the same Model Gateway action claim and
   settlement path as an ordinary model round. Returns `TIMEOUT` on expiry;
   timeout does not authorize redispatch.
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

## Internal Routes

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/_internal/delegation/delegate` | Execute a cross-app delegation. Body: `AppDelegation`. Returns `AppDelegationResult` or `{ error, code }`. |
| `GET` | `/_internal/delegation/delegation-targets` | List App names registered as delegation targets. Returns `{ targets: string[] }`. |

These routes are mounted at `/_internal/delegation` when a `DelegationRegistry` is available.
