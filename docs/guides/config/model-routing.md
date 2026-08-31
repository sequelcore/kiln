# Model routing

Kiln separates operator targets from tenant application routing. They solve
different problems and do not fall back to one another.

| Concern | Owner | Applies to |
| --- | --- | --- |
| Operator execution | Global V7 `targetCatalog` intent, exact managed evidence, and `targetRouting` | GUI, TUI, `kiln run`, Model Gateway, and managed children |
| Tenant model routing | Application `modelConfig` | That application's session orchestrator and provider pool |

## Operator targets

A target is the only operator-selectable execution identity. Configure targets
in `~/.kiln/config.yaml`; projects cannot add or replace them.

The catalog separates:

| Record | Owns |
| --- | --- |
| `targetCatalog.evidenceRevision` | Exact immutable managed-evidence snapshot admitted with this intent |
| `targetCatalog.accounts` | Opaque credential reference, concurrency intent, and credit/overage posture |
| `targetCatalog.accountPolicies` | Eligible accounts and deterministic automatic selection |
| `targetCatalog.targets` | Destination, classification, account selection, and material execution constraints |

`targetRouting.defaultTargetId` selects the normal default. A surface preference
may persist `ui.targetSelection.targetId`. The CLI accepts an explicit target:

```bash
kiln target
kiln run --target codex-terra "Inspect this repository"
```

The GUI and TUI use the same target catalog. The TUI opens it with `/target`.
No operator surface selects a raw provider, model, account policy, or
credential.

To create a direct target without authoring route material, first inspect the
current discovery projection and then request a guided preview:

```bash
kiln target available
kiln target create <provider>/<model> --classification internal --confirm-data-policy
```

Add `--label "Review model"` when a custom display label is useful. Review the
normalized, secret-free proposal, then repeat the same command with `--approve`.
The approved invocation prints its freshly derived proposal and asks for an
interactive yes/no confirmation before applying that exact proposal. A
declined or non-interactive confirmation writes nothing.
`--confirm-data-policy` explicitly accepts the conservative posture shown in
the proposal: provider service operation, training may be permitted, and
retention may be as long as 3650 days for data up to the selected
classification. It is not a claim of a stricter provider privacy guarantee.
Kiln chooses an unambiguous current discovery route, derives configured account,
policy, economics, capability, target identity, and evidence, and revalidates
them before mutation. If the provider/model match is ambiguous, account policy
is absent or ambiguous, or evidence changed, the command fails closed and asks
for refresh or configuration rather than requesting internal IDs.

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

Every operational target resolves against one immutable managed-evidence
snapshot. It owns discovery, data policy, account capacity classification,
adapter facts, rate-card evidence, auxiliary charges, and freshness. Operator
YAML retains billing channel, execution mode, service tier, envelope, fallback,
and overage choices.

Do not copy partial YAML fragments from prose. Use the complete
[V7 target example](../../examples/configs/managed-targets-v7-subscription.yaml).
Its adjacent JSON demonstrates the managed store; operational snapshots are
published by Kiln and must not be hand-edited.

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
