# Credential Governance

## Purpose

Credential governance is Kiln's provider-agnostic boundary for referencing,
resolving, and diagnosing secrets without leaking secret values into domain
contracts, reports, logs, or operator diagnostics.

The public contract is a secret reference, not a secret-manager integration.
Secret managers, shell injection tools, cloud runtimes, and local environment
variables are adapters behind the same boundary.

## Core Contract

`@kilnai/core` owns the IO-free model:

- `SecretRef`
- `SecretSource`
- `CredentialRotationMetadata`
- `CredentialRefreshMetadata`
- `SecretDiagnostic`
- `SecretResolver`
- `SecretLifecycleDiagnostic`

A `SecretRef` describes:

- the reference id;
- the credential purpose;
- the credential scopes;
- the source handle;
- optional expiry metadata;
- optional rotation or lease metadata;
- optional OAuth refresh metadata.

Core does not read environment variables, local files, secret-manager APIs, or
provider SDKs. It validates reference shape and builds secret-free diagnostics.

## Source Boundary

Kiln models three provider-agnostic source handles:

- `env`: the launching environment provides the value.
- `managed`: an operator-configured secret manager provides the value.
- `credential-pool`: the runtime credential-pool subsystem provides the value
  for provider routes.

The first CLI adapter resolves env-backed references:

```json
{
  "id": "x-oauth2-access-token",
  "purpose": "external-engagement:x:read",
  "scopes": ["x:post.read", "x:user.read"],
  "source": {
    "kind": "env",
    "name": "KILN_X_OAUTH2_ACCESS_TOKEN"
  }
}
```

An env source means Kiln expects the launching environment to provide the
secret value. That environment may be populated by the operator's shell, a CI
secret store, a cloud secret manager, or a tool that injects secrets into the
process environment. Kiln must not assume one public provider.

Managed sources use stable provider-neutral handles:

```json
{
  "kind": "managed",
  "providerId": "operator-secret-manager",
  "reference": "project/external-engagement/x/access-token",
  "version": "current"
}
```

Credential-pool sources bridge to runtime-owned provider route credentials
without importing runtime code into core:

```json
{
  "kind": "credential-pool",
  "providerId": "openai",
  "field": "apiKey"
}
```

Doppler is a valid internal example for teams that use env injection, but it is
not a public Kiln dependency or default.

## Diagnostics

Diagnostics are safe to show to operators. They may include:

- reference id;
- purpose;
- scopes;
- source kind and env variable name;
- status: `available`, `missing`, `expired`, or `invalid`;
- expiry, rotation, lease, and refresh timestamps.
- lifecycle status: `usable`, `refresh-due`, `rotation-due`, or `expired`.

Diagnostics must never include secret values, refresh token values, API keys,
authorization headers, screenshots of credentials, or provider response bodies
that contain credentials.

Expiry metadata is fail-closed. If a reference says the credential is expired,
resolution diagnostics report `expired` even when the backing source still has a
non-empty value.

Refresh and rotation metadata are executable governance signals for resolvers
and operator surfaces. Core evaluates whether refresh or rotation is due before
provider calls; provider-specific refresh execution remains behind resolver or
runtime adapters.

## Adapter Ownership

`@kilnai/cli` currently owns `EnvSecretResolver`, the small adapter that reads
env-backed references for CLI commands.

External engagement owns its platform-specific credential declarations in core.
For X, `createXReadAccessTokenRef` returns the reusable `SecretRef` for
read-only evidence access. CLI commands consume that declaration and fail before
network access when diagnostics report a non-usable lifecycle state such as
`refresh-due`, `rotation-due`, or `expired`.

Runtime credential pools remain runtime-owned for provider route rotation,
cooldown, health persistence, and cross-process reload. Core now has a
`credential-pool` source handle so integrations can depend on the credential
governance contract without importing runtime or duplicating pool semantics.
