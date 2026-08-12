# Model Gateway

## Purpose

Model Gateway is an ingress overlay on Kiln's canonical execution catalog. It
accepts a virtual-model request, maps that virtual model to an
`executionRouteId`, and executes the admitted route through the same Runtime
authority used by `kiln run`, GUI, and TUI. It is not a second provider,
credential, account-pool, or routing authority.

The authoritative configuration and selection rules are documented in
[Global Config](../../guides/config/global-config.md) and
[Provider Credential Pools](../safety/provider-credential-pools.md).

## Boundary

`@kilnai/core` owns the pure execution-catalog validation, route admission,
candidate ordering, and secret-free commitment evidence. `@kilnai/runtime`
owns current account evidence, shared capacity, fencing, credential resolution,
provider dispatch, and terminal evidence. Gateway contracts and surfaces own
only validated request and projection DTOs.

The Gateway overlay owns ingress policy: virtual model names, protocol exposure,
and authentication. A virtual model has one `executionRouteId`; it does not
repeat provider/model, credential, account-policy, capacity, economics, or
failover data. The referenced route remains the only authority for those facts.

```yaml
modelGateway:
  virtualModels:
    - id: kiln/terra
      executionRouteId: terra
```

## Canonical Turn Flow

1. Authenticate and validate the ingress request.
2. Resolve the virtual model to its canonical execution route.
3. Admit the route and obtain current account candidates from Runtime.
4. Apply the account policy: safety, health, quota, and live capacity first;
   then economics, pressure, and stable account identity.
5. Fence the selected account and revalidate its credential ID and revision
   before a provider effect can escape.
6. Dispatch exactly that committed credential, stream canonical events, and
   settle capacity and health evidence.

For an automatic route, a candidate found saturated before dispatch may yield
to the next eligible candidate. An exact account selection never falls back.
After a potentially observable provider effect, Kiln does not replay the turn
through another account; ambiguous outcomes require explicit reconciliation or
retry.

## Surface And Security Rules

Gateway clients select a virtual model, which is a route alias. They never
receive or submit a credential ID. Account IDs remain Runtime configuration
identity; secret material, provider tokens, and credential revisions never
enter prompts, public contracts, transcripts, logs, or catalog projections.

Loopback location is not authentication. Each ingress request requires its
admitted harness capability. Provider/harness protocol compatibility does not
prove entitlement, tool authority, resume compatibility, billing semantics, or
permission parity; unsupported combinations fail closed.

## Native Projection

Kiln config is canonical. Native configuration is a derived projection with
ownership, backup, drift, adoption, sync, uninstall, and exact restore rules.
Projection never becomes route or account authority, and it must not replace a
native provider catalog, default, search setting, or unrelated user field.

## Related Overlays

Managed-agent direct routes also reference `executionRouteId`; they do not
copy execution account facts. Native-harness managed routes are separate
physical-harness routes and retain only the facts needed for that boundary.

## Verification

Required focused evidence covers virtual-model-to-route validation, deterministic
selection and rejection reasons, shared capacity/fencing, credential revision
drift after fencing, no secret projection, and exact native projection restore.
