# Model routing

Kiln separates operator targets from tenant application routing. They solve
different problems and do not fall back to one another.

| Concern | Owner | Applies to |
| --- | --- | --- |
| Operator execution | Global V3 `targetCatalog` and `targetRouting` | GUI, TUI, `kiln run`, Model Gateway, and managed children |
| Tenant model routing | Application `modelConfig` | That application's session orchestrator and provider pool |

## Operator targets

A target is the only operator-selectable execution identity. Configure targets
in `~/.kiln/config.yaml`; projects cannot add or replace them.

The catalog separates:

| Record | Owns |
| --- | --- |
| `targetCatalog.accounts` | Opaque credential reference, capacity, quota, and account economics |
| `targetCatalog.accountPolicies` | Eligible accounts and deterministic automatic selection |
| `targetCatalog.targets` | Direct or harness provider/model destination, data policy, account selection, and target economics |

`targetRouting.defaultTargetId` selects the normal default. A surface preference
may persist `ui.targetSelection.targetId`. The CLI accepts an explicit target:

```bash
kiln target
kiln run --target codex-terra "Inspect this repository"
```

The GUI and TUI use the same target catalog. The TUI opens it with `/target`.
No operator surface selects a raw provider, model, account policy, or
credential.

Start from the parser-validated
[task-aware model team](../../examples/configs/task-aware-model-team.yaml).

## Automatic accounts

A direct target may reference an automatic account policy. At dispatch,
Runtime rejects accounts that fail safety, data-policy, health, quota, or
capacity admission. It orders the remaining accounts by configured economics,
pressure, and stable account identity.

An eligible `accountOverrideId` may narrow the selected target for one surface.
It cannot add an account or expose a credential ID. After selection, Runtime
fences capacity and verifies the exact credential revision before provider
dispatch.

If no account is admissible, the target is unavailable. Kiln does not silently
switch provider, model, target, or credential after an effect may have escaped.

## Economics and data policy

Every operational direct target carries complete data-policy and economic
evidence. These records are execution authority, not display metadata. They
include the adapter and billing channel, rate-card basis, price evidence,
auxiliary charges, execution envelope, fallback posture, and overage posture.

Do not copy partial YAML fragments from prose. Use the complete
[V3 target example](../../examples/configs/managed-targets-v3-subscription.yaml)
and replace its synthetic evidence with current facts.

## Managed children

Managed execution reuses physical targets. It does not define a second route
graph.

- Agent profiles reference `targetId` and `authorityProfileId`.
- `authorityProfiles` owns tools, workspace, memory, timeouts, approvals, and
  optional voice identity.
- Managed economic policy candidates reference `targetId`.
- `managedAgents` owns enablement, default authority, approval posture,
  worktree leasing, and economic selection policy.

Runtime may persist a `routeId` after it admits a target for a specific child
execution. That route identity belongs to lifecycle, settlement, and replay;
it is not another configuration field for the operator.

## Model Gateway

Model Gateway adds authenticated ingress and virtual names. Each virtual model
references one catalog target:

```yaml
modelGateway:
  virtualModels:
    - id: managed-codex-terra
      displayName: Codex Terra through Kiln
      contextTokens: 200000
      outputTokens: 8192
      targetId: codex-terra
      capabilities: [text]
      affinity: { continuity: none }
```

The virtual model does not repeat provider, model, account, credential,
data-policy, or economics authority.

## Direct and harness targets

A direct target uses a Kiln provider adapter and account policy. A harness
target identifies a supported native CLI boundary. Both live in
`targetCatalog.targets`; separate worker routing and worker-model defaults are
not operator selection authorities.

Harness availability and native model encoding still require current capability
evidence. Ambient harness defaults do not become Kiln model authority.

## Tenant application routing

Tenant `modelConfig` remains an application feature. Its rules and capability
registry choose within the application's configured provider pool before an
application LLM call.

That behavior cannot authorize operator targets, access the global account
catalog, or bypass exact credential commitment. Configure tenant routing in
the application configuration. See [App YAML](../../configuration/app-yaml.md)
and [Multi-Tenant](multi-tenant.md).

## Related

- [Global configuration](global-config.md)
- [Provider credential pools](../../architecture/safety/provider-credential-pools.md)
- [Model Gateway](../../architecture/providers/model-gateway.md)
- [Coordination](../../architecture/coordination/coordination.md)
