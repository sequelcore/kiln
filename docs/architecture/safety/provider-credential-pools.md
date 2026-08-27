# Provider Credential Pools

## Purpose

Provider credential pools supply Runtime with current, secret-bearing account
evidence. They are not an operator-facing model catalog and do not choose a
target. The canonical target catalog maps an opaque account ID to a provider
and credential ID; Runtime resolves that credential only after a target and
account have been committed.

See [Global Config](../../guides/config/global-config.md) for configuration and
[Model Gateway](../providers/model-gateway.md) for gateway ingress.

## Boundary

Core owns secret-free account eligibility, deterministic ordering, admission,
and commitment evidence. Runtime owns credential stores, health/quota evidence,
capacity, revision observation, secret resolution, and provider-specific error
mapping. Surfaces receive target availability and repair guidance, never
credentials or secrets.

Credential storage is private Runtime state. A credential ID is stable local
configuration identity, not an authentication claim. Tokens, API keys, account
claims, home paths, and credential contents are never placed in global config,
surface persistence, prompts, logs, events, or fixtures.

## Target Catalog

The V4 intent catalog has three distinct concepts plus one exact evidence reference:

- `evidenceRevision`: the immutable managed snapshot containing current
  capacity, discovery, data-policy, adapter, and price facts.

- `accounts`: configured execution identities. Each has `id`, `providerId`,
  `credentialId`, concurrency intent, and credit/overage posture.
- `accountPolicies`: an eligible account set and a selection strategy.
- `targets`: an operator-facing direct or harness execution choice. A direct
  target references either an automatic account policy or one exact account.

This prevents the previous ambiguity between “model”, “provider”, and
credential binding. A target is what an operator selects. An account is what
Runtime commits. A credential is private runtime material used only to execute
that account.

```yaml
targetCatalog:
  accounts:
    - id: codex-work
      providerId: codex-oauth
      credentialId: work
      maxConcurrency: 2
      economics: { costClass: subscription }
  accountPolicies:
    - id: codex-automatic
      accountIds: [codex-work]
      strategy: economic-least-pressure
  targets:
    - id: terra
      label: Terra
      providerId: codex-oauth
      providerModelId: gpt-5.6-terra
      accountPolicyId: codex-automatic
targetRouting:
  defaultTargetId: terra
```

## Selection And Commitment

Automatic selection gates candidates by safety, health, quota, and live shared
capacity before ordering viable accounts by economics, pressure, and stable
account ID. If a selected automatic candidate is saturated before dispatch,
Runtime can try the next eligible candidate. An exact selection uses its one
account and fails closed; it never rotates or falls back.

The commitment sequence fences capacity and then rechecks the exact credential
ID and revision. A changed or unavailable credential rejects the turn before
provider dispatch. The resulting binding evidence is singular: route ID,
account ID, credential ID, and credential revision. It is secret-free and is
the only binding a provider adapter may execute.

Once provider effects may have escaped, Runtime records an ambiguous or
terminal outcome rather than replaying through another credential. Health and
settlement evidence inform later work; an adapter cannot silently retry across
accounts.

## Operator Experience

GUI and TUI display targets, availability, a reason, and a repair action. They
may offer an account override only from the selected automatic policy's current
eligible account IDs. The default is automatic. Credential IDs are never shown
or selected. `kiln run` accepts `--target <id>`; it does not accept
`--provider`, `--model`, or `--api-key` as execution-selection overrides.

`directModels` and `kiln model bind/list` are not supported configuration or
commands. They are rejected rather than translated, so there is no second
credential-binding path to drift from the catalog.

## Related Consumers

Model Gateway virtual models reference `targetId` and introduce no account
catalog of their own. Managed agents use the same target identity and a
separate `authorityProfileId`.
Both therefore share the same candidate admission, capacity, fence, and
credential-revision validation as direct operator sessions.
