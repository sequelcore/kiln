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

OpenAI Responses validation follows the current caller wire contract without
turning caller-hosted features into route requirements. In particular,
`web_search.search_content_types` accepts only the unique admitted values
`text` and `image`. Provider-hosted web search is optional at the model-turn
boundary: when the selected virtual route does not advertise it, Runtime omits
that hosted tool, records degraded compatibility evidence, and preserves the
remaining caller-owned tools. Unknown fields, values, and required route
capabilities still fail closed.

Anthropic Messages ingress admits the current Claude Code caller shape without
turning harness metadata into downstream provider identity. The official
`metadata.user_id` field is bounded and validated, then omitted because Kiln
authenticates and namespaces the caller independently. Claude Code text-only
`messages[].role: system` turns map to protocol-neutral `developer` history;
non-text system turns remain unrepresentable and fail closed. Unknown metadata,
thinking/signature replay, cache controls, sampling, and other unsupported
Messages fields remain rejected rather than silently degraded.

## Ingress Lifecycle

Ingress byte limits are explicit availability and memory-safety controls, not
model context-window controls. The OpenAI Responses surface admits at most 64
MiB of raw JSON; Codex composite routing applies the same ceiling to both the
wire body and each decoded representation so compressed requests cannot bypass
the bound. The Anthropic Messages surface should be configured at no more than
32 MiB, matching the direct API envelope. A 413 response identifies Kiln's
configured limit in `x-kiln-request-body-limit-bytes` and `max_body_bytes`
without logging request content.

Clients still compact long histories according to model token and task-quality
policy. A larger HTTP envelope is necessary for tool-rich coding-agent turns,
but it neither expands a model context window nor proves that the model can use
all admitted context effectively.

The dedicated listener owns model-request lifetime separately from model and
ingress limits. Authentication and bounded body receipt retain Bun's finite
transport timeout. After authentication, concurrency admission, and bounded
body receipt, the listener disables the idle timeout before JSON, protocol, and
model validation because unary operations such as `/responses/compact` may
legitimately produce no downstream bytes while an upstream model is working,
and streamed responses may also be quiet between events. Control,
unauthenticated, overloaded, oversized, and body-stalled requests never acquire
this lifetime; a later-invalid JSON or protocol request may acquire it briefly
before returning 4xx. This is not an infinite
execution budget: the downstream connection remains the lifetime authority,
and its abort signal propagates to native Codex forwarding and governed
virtual-model fetches. Closing the client therefore cancels upstream work
instead of leaving an unbounded orphan request.

One user-scoped supervisor owns the loopback listener, lifecycle state, lock,
and optional Windows logon task. The Runtime-owned economic authority database
is shared with the Operator Runtime under
`~/.kiln/runtime/economic-authority/`; it is not gateway lifecycle state and is
not deleted with the listener. Readiness returns an
authenticated identity containing the instance ID, PID, version, configuration
digest, and port. Lifecycle commands act only when that identity exactly matches
the owned state; an unauthorized, mismatched, or unrecognized listener is
foreign and fails closed.

Shutdown is an authenticated request to the exact listener instance. The
process stops accepting work, awaits the Bun server stop promise, closes ingress
state, releases Runtime account-capacity ownership, and only then exits. The
supervisor waits for both listener disappearance and process exit before it
removes state or starts a replacement. Forced process termination is a bounded
last resort after graceful shutdown times out; it is never the normal Windows
path.

Windows autostart is a least-privilege, current-user logon task with one owned
description digest, `IgnoreNew` instance policy, and no execution time limit.
Install replaces only a task carrying that ownership marker. Exact uninstall
refuses a foreign task or listener, restores every listener-dependent Codex and
Claude projection plus the owned additive OpenCode projection, then stops the
owned process and removes the owned task and Model Gateway lifecycle directory.
Projection failure leaves the listener running. Canonical config, shared
economic evidence, and unmanaged native state remain unchanged. Operator
commands and recovery procedure
are documented in [Model Gateway Operations](../../operations/model-gateway.md).

## Native Projection

Kiln config is canonical. Native configuration is a derived projection with
ownership, backup, drift, adoption, sync, uninstall, and exact restore rules.
Projection never becomes route or account authority, and it must not replace a
native provider catalog, default, search setting, or unrelated user field.

### Codex composite routing

The Codex projection installs one loopback base URL under the authenticated
`codex-composite` path. This gives Codex one model catalog containing both its
native models and Kiln virtual models without changing which system owns each
model:

```text
Codex client
    |
    v
Kiln codex-composite listener
    |-- native Codex model ID --> Codex backend
    `-- Kiln virtual model ID --> canonical Kiln execution route
```

For a native Codex model ID, Kiln authenticates the composite capability,
applies ingress safety limits, preserves only admitted native headers, and
forwards the original request to the Codex backend. Kiln does not translate
that turn into a Kiln execution route and does not change the selected native
model. For a virtual model ID admitted to the projected principal, Kiln maps
the request to that virtual model's canonical `executionRouteId`.

This means selecting Codex's default model still sends the HTTP request through
the local listener. A URL containing
`127.0.0.1:<port>/.well-known/kiln/codex-composite/` identifies that transport
path; it does not by itself mean that a Kiln virtual model was selected. Errors
returned before forwarding, including Kiln's bounded-body 413, can therefore
affect native Codex turns. Upstream responses and errors remain attributable to
the Codex backend.

## Related Overlays

Managed-agent direct routes also reference `executionRouteId`; they do not
copy execution account facts. Native-harness managed routes are separate
physical-harness routes and retain only the facts needed for that boundary.

## Verification

Required focused evidence covers virtual-model-to-route validation, deterministic
selection and rejection reasons, shared capacity/fencing, credential revision
drift after fencing, post-fence dispatcher materialization, deterministic
resource close, authenticated exact-instance shutdown, no secret projection,
exact native projection restore, quiet requests beyond Bun's configured idle
timeout, and downstream cancellation reaching both composite routing branches.

Lifecycle commands preserve the native projection/listener invariant: installed
Codex composite and globally registered Claude projections may be restarted or
uninstalled, but not left pointing at an intentionally stopped listener.
Retained post-fence capacity is
observable only through a secret-free incident projection; absent authoritative
terminal evidence remains capacity-consuming rather than becoming an
operator-asserted settlement.
