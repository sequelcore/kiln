# Model Routing

Kiln has two routing concerns with separate authority. Do not configure one as
an alias or fallback for the other.

| Concern | Owner | Applies to |
| --- | --- | --- |
| Operator execution | Global V2 `executionCatalog` and `executionRouting` | GUI, TUI, `kiln run`, Model Gateway, and managed direct agents |
| Tenant model routing | A tenant application's `modelConfig` | The application's `RuntimeSessionOrchestrator` and its configured provider pool |

The operator catalog is the only authority for an operator-facing provider,
model, account policy, credential reference, and route economics. A surface
selects a route; it never selects a credential.

## Operator execution catalog

Configure the catalog in the global configuration (`~/.kiln/config.yaml`) with
`version: "2"`. The complete, parser-validated example is
[task-aware-model-team.yaml](../../examples/configs/task-aware-model-team.yaml).

The catalog has three intentionally separate records:

| Record | Contains | Does not contain |
| --- | --- | --- |
| `executionCatalog.accounts` | An opaque `credentialId`, capacity limits, and account economics | Credential material or surface preferences |
| `executionCatalog.accountPolicies` | Eligible accounts and `economic-least-pressure` selection | Model, provider model ID, or a surface-visible credential |
| `executionCatalog.routes` | Route label, provider, provider model, account-selection rule, and route economics | A second fallback hierarchy or copied managed-agent authority |

`executionRouting.defaultRouteId` selects the default route. A GUI or TUI
preference can persist the same `routeId` in `ui.executionRouteSelection`.
For CLI use, select a configured route with `kiln run --route <route-id>`; omit
it to use the default.

### Automatic accounts and explicit overrides

An automatic route references one account policy. At dispatch time, Kiln first
rejects candidates that fail safety, health, quota, or capacity admission.
Among the remaining accounts it chooses by economic cost, then pressure, then
account ID for a deterministic tie break.

An operator may temporarily narrow an automatic route to an eligible account
with `accountOverrideId`. The override must be a member of that route's account
policy; exact routes do not accept overrides. Neither UI exposes a credential
ID or secret.

After selection, Runtime acquires capacity, fences the commitment, verifies the
credential revision, and dispatches through that exact binding. If no candidate
is admissible, operator execution is rejected before dispatch. It does not
silently fall back to another provider, model, route, or credential.

### Required economics

Every account declares its capacity and subscription/quota posture. Every route
declares its adapter capability, billing channel, service tier, rate-card basis,
fallback and overage posture, price evidence, auxiliary charges, and execution
envelope. This is deliberate: economics is route authority, not display
metadata. Use the full example rather than copying a partial fragment.

## Model Gateway and managed agents are overlays

Model Gateway provides authenticated ingress and virtual model names. It does
not own accounts, provider/model identity, or route economics. Each virtual
model references the catalog with `executionRouteId`:

```yaml
modelGateway:
  virtualModels:
    - id: managed-codex-terra
      executionRouteId: codex-terra
      capabilities: [text]
      affinity: { continuity: none }
```

A managed direct route follows the same rule. It contributes its authority
profile and exactly one execution route reference; it does not repeat provider,
model, credential, or economics fields:

```yaml
managedAgents:
  schemaVersion: 2
  routes:
    - id: architecture-review
      kind: direct
      executionRouteId: codex-sol
      profiles: [foundation-readonly-plan]
```

Managed economic policy candidates name the managed route ID, while the managed
route itself names the canonical execution route. This keeps economic admission
and physical execution identity in one place.

## Native worker engines are separate

`workerRouting` and `workerModels` configure native CLI harness workers such as
Codex, Claude, or OpenCode. They are not an operator execution catalog and must
not contain account-backed direct-provider routes such as `codex-oauth` or
`opencode-go`. Omit both settings when the installation has no native harness
worker concern, as the complete example does.

## Tenant application model router

Tenant `modelConfig` remains a distinct application feature. Its
`RulesRouter`, `ModelCapabilityRegistry`, complexity score, and `model_routed`
events choose among the application's configured provider pool before an
application LLM call. It may use a tenant default when no rule matches, and the
runtime preserves that configured default when its internal router fails without
an authority-sensitive deliberation request.

That behavior never authorizes operator execution fallback. Tenant routing does
not select an account, read `executionCatalog`, or bypass the catalog's
admission and exact credential commitment. Configure it in the tenant
application configuration, not the global V2 execution catalog. See
[App YAML](../../configuration/app-yaml.md) for application configuration and
[Multi-Tenant](multi-tenant.md) for tenant ownership.

## Related

- [Global Configuration](global-config.md) — global configuration reference
- [Control Model](../../architecture/core/control-model.md) — control-loop placement
- [Coordination](../../architecture/coordination/coordination.md) — runtime coordination boundaries
