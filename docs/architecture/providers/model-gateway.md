# Model Gateway

## Purpose

The Model Gateway is Kiln's runtime-owned boundary for executing an admitted
model turn from any supported harness surface through one canonical route,
account-selection policy, session model, and evidence stream.

Codex, Claude Code, OpenCode, and Kiln-native surfaces are ingress adapters.
They do not own provider routing, account rotation, retry policy, authority,
budgets, or provider credentials. Direct providers and native harnesses are
execution adapters. They do not define session identity or operator policy.

## Scope

The supported deployment is one local Kiln runtime authority bound to a
loopback interface. Multiple harness processes may connect to that authority,
and each admitted virtual model may bind one or more explicitly configured
accounts from one direct provider.
Remote or multi-runtime account sharing is unsupported until Kiln has a
transactional lease store, fencing tokens, and crash-recovery semantics. A
runtime must reject configuration that implies unsupported shared authority.

The gateway does not:

- bypass provider quotas, restrictions, or terms;
- share personal accounts between operators;
- assume that protocol compatibility proves product entitlement;
- make every provider capability available through every harness;
- use provider or account identity as the canonical Kiln session identity.

## Bounded Contexts

### Core Domain

`@kilnai/core` owns pure decisions and state transitions:

- opaque account and route identity;
- account eligibility and deterministic selection;
- route-scoped session affinity;
- attempt lease, dispatch, commit, and terminal state;
- secret-free selection and rejection evidence.

Core does not know about OAuth tokens, API keys, environment variables, home
directories, HTTP, files, provider SDKs, native processes, or operator UI.

### Runtime Application

`@kilnai/runtime` owns:

- ingress admission and protocol adapters;
- provider/model eligibility before account selection;
- account catalog and secret resolution ports;
- durable affinity and attempt evidence for the local runtime;
- provider and harness adapter invocation;
- cancellation, streaming, budgets, health, and canonical events;
- redacted gateway projections for operator surfaces.

Secret resolution happens only after an account lease is admitted. Resolved
secrets never enter prompts, public contracts, session transcripts, logs, or
surface projections.

### Gateway Contracts And Surfaces

`@kilnai/gateway-contracts` owns versioned request and projection DTOs. CLI,
GUI, TUI, SDK, and native harness projections consume those DTOs. Surfaces may
request a route or an admitted policy mode, but they do not select accounts or
reconstruct runtime eligibility.

## Canonical Turn Flow

1. Authenticate the harness instance with a process-scoped capability.
2. Validate the ingress payload, authority envelope, limits, and protocol.
3. Normalize the request into a canonical model turn.
4. Resolve provider/model eligibility from current canonical evidence.
5. Resolve an existing route-scoped affinity when continuity requires it.
6. Select an eligible account and acquire a lease for one attempt.
7. Resolve the account secret inside the runtime adapter boundary.
8. Dispatch through the selected protocol or native harness adapter.
9. Commit the attempt no later than the point where upstream effects may have
   occurred.
10. Stream canonical events and project them back to the ingress protocol.
11. Record the terminal outcome, health evidence, usage, and affinity state.

## Selection Mode

Route eligibility resolves one admitted model turn under a public `selectionMode`
contract:

- `automatic`: the default routed path. The gateway selects the provider/model
  route from canonical evidence and must not silently honor a gateway-provided
  model override.
- `explicit-operator-only`: admitted only when the direct override carries
  valid literal operator provenance. Missing or non-operator provenance fails
  closed into `automatic` routing and produces no override rationale.

The obsolete `auto | manual_override` contract was replaced outright by
`automatic | explicit-operator-only` and is not parsed or projected.

## Account Selection

Account selection happens after route eligibility. Account health cannot make
an ineligible provider/model route eligible.

An account candidate must provide current evidence that it is:

- enabled and valid;
- entitled to the selected provider/model route;
- compatible with the requested execution authority and tenant scope;
- outside cooldown;
- below its concurrency limit;
- within configured budget and reserve policy.

Every virtual-model account pool is provider-homogeneous. Kiln rejects unknown
providers, duplicate provider/credential bindings, cross-provider account
references, and credential revisions that change between selection and secret
resolution. Account references contain only configured IDs plus opaque
filesystem identity/revision evidence; they never contain keys, tokens, or
provider account claims.

Selection is deterministic. A healthy compatible affinity wins. New work uses
the least-pressure eligible candidate, with explicit priority and stable account
identity as tie breakers. Reserved accounts are excluded from new work unless
the policy explicitly admits their use. Random selection is not an operational
gateway policy.

Direct `kiln run` accepts a virtual-model ID only when that model binds exactly
one configured account. CLI resolution separates the operator's virtual ID from
the physical provider model, validates discovery against the physical model,
and materializes the exact selected credential revision. Session evidence records
the virtual-model ID, configured account ID, and immutable credential revision
before provider dispatch. A rejected binding records an explicit pre-dispatch
state without a fabricated revision; neither path records the credential ID or
secret material.

An affinity binds a Kiln session and provider route to an opaque account
reference. It does not pin the whole Kiln session to one provider, model, or
account. A provider-native thread created under one account must never be
resumed under another account.

## Attempt And Failover Semantics

The canonical attempt lifecycle is:

```text
planned -> leased -> dispatching -> committed -> terminal
```

Before dispatch, a known local failure may release the lease and select another
eligible account. Once request effects may have reached the provider, the
attempt is committed for retry purposes. After commit or the first observable
model/tool event, Kiln must not replay the turn through another account.

A connection loss after possible dispatch is `ambiguous`, not safely
retryable. Kiln may reconcile only when the provider exposes a proven
idempotency or request-status contract. Otherwise it records a failed or paused
terminal outcome and requires an explicit retry. An account rebind starts a new
provider-native thread from the canonical Kiln transcript and emits continuity
rebind evidence.

`PooledProviderAdapter` remains available to legacy non-gateway consumers, but
the Model Gateway does not use it. Gateway turns bind one exact credential,
disable adapter and SDK retries, perform one provider call, and let the
governed attempt lifecycle own any later explicit retry or rebind decision.

## Harness Protocols

The local gateway exposes versioned ingress adapters for:

- OpenAI Responses for Codex;
- OpenAI Responses projections for OpenCode and compatible clients;
- Anthropic Messages for supported Claude Code gateway routes;
- Kiln-native gateway contracts.

The runtime can dispatch an admitted virtual model to `codex-oauth`,
`opencode-go`, `opencode-zen`, `anthropic`, `openai`, `deepseek`, `openrouter`,
`ollama`, or `lmstudio`. Codex OAuth uses its dedicated Responses dispatcher.
The other providers use a capability-limited one-round bridge over a raw,
exact-credential adapter.

The portable adapter intersection is text, URL/base64 images where the
transport supports them, function tools, a positive output-token limit, and
the sequential default represented by `parallelToolCalls: false`. Codex OAuth
may additionally advertise its proven Responses capabilities. Custom Lark
tools, parallel execution, JSON-schema response formats, reasoning controls,
and text verbosity are rejected for generic adapter routes before provider
dispatch; config may not advertise them on those routes.

Function identity is the pair `(namespace, name)`, not an unqualified name.
Codex namespace envelopes map to that neutral identity and are reconstructed
for Codex OAuth. Flat function transports receive bounded, collision-safe
aliases for one provider round; responses are mapped back to the original
namespace identity before returning to the caller. Namespace metadata is never
silently discarded or concatenated into a canonical tool name.

Provider-hosted search is not the same capability as Kiln's governed
`web_search` tool. Until a route has an explicit hosted-search capability and
proven response projection, the Codex native projection disables hosted web
search and the Responses ingress rejects an advertised `web_search` tool
before dispatch. No adapter substitutes one search authority for the other.

Every provider/model/harness combination has explicit capability evidence.
Protocol translation does not imply tool, reasoning, context, resume, billing,
or contractual compatibility. Unsupported combinations fail closed and remain
absent from generated model catalogs.

## Tool Execution Ownership

Every ingress route declares one admitted tool execution mode:

- `kiln-owned`: `RuntimeSessionOrchestrator` owns the multi-round tool loop,
  runtime tool admission, execution, and terminal governance.
- `caller-owned`: Model Gateway performs exactly one provider round and returns
  admitted tool calls to the native harness. Kiln does not instantiate a runtime
  tool executor for that turn.

Tool ownership is fixed by the authenticated ingress capability and executable
route policy. It is not inferred from prompt text, model output, tool names, or
managed-agent caller metadata. Caller-owned mode records the native harness's
authority evidence and must not claim that Kiln enforced filesystem or network
isolation that belongs to the harness.

Caller-owned mode uses a dedicated one-round dispatcher contract. Generic
provider adapters with internal request retries or `PooledProviderAdapter`
cross-account retries do not satisfy this contract. The gateway records the
attempt as committed before provider effects can escape, returns function and
freeform/custom tool calls without changing their ownership, and never retries
the turn through another account after commit.

OpenAI Responses, Anthropic Messages, and OpenAI-compatible wire adapters are
anti-corruption layers around these two runtime modes. Wire compatibility does
not choose the mode. Codex normally uses caller-owned mode so its native tool
and subagent lifecycle remains intact, while a Kiln chat surface normally uses
kiln-owned mode.

## Native Projection

Kiln config is canonical. The admitted global projection is additive provider
registration: Codex receives `model_providers.kiln` and OpenCode receives
`provider.kiln`. It does not replace Codex's provider/catalog/default/search or
create an OpenCode provider allowlist/default. Claude Code gateway settings are
an explicit project-local takeover because Claude does not expose an additive
provider contract. Projection uses install-state, managed-field ownership,
backup, drift, adoption, sync, and uninstall. Native files never become route
or account authority.

Model-catalog projection and native-agent-file projection are separate bounded
contexts. Codex picker integration is deferred until a verified composite
catalog and native provider-identity passthrough exist and a supervised
loopback listener is healthy before projection. Until then, an OpenCode-backed
route is available to Codex through Kiln's MCP/managed-agent surface, not by
replacing Codex's native picker. An agent definition whose `providerRoute`
names `opencode-go` still means a direct managed-invocation route; it is not
rewritten into a Codex-native agent model. Unsupported direct native-agent
encodings remain fail-closed.

## Security Invariants

- Loopback location is not authentication; every ingress request requires an
  admitted harness capability.
- Harness-supplied headers are allowlisted and cannot select credentials or
  widen authority.
- Request size, duration, concurrency, tool authority, and spend are bounded
  before provider dispatch.
- Account references and diagnostics are secret-free and tenant-scoped.
- Untrusted prompt or tool content cannot alter route, account, disclosure, or
  retry policy.
- Provider errors are normalized before they reach operator surfaces.

## Migration

Migration is provider-by-provider and consumer-complete:

1. Introduce core selection and attempt contracts with focused tests.
2. Introduce the runtime Model Gateway and adapt the existing credential stores
   behind its application boundary.
3. Add protocol ingress and progressive streaming.
4. Cut direct API providers over across CLI, App Gateway, and managed
   invocation.
5. Cut Codex OAuth and OpenCode routes over.
6. Cut native harness-home routes over.
7. Delete old pool-owned retry and per-surface construction paths once no
   consumer remains.

Dual reads or writes are temporary only inside a versioned migration. Mixed or
unknown credential metadata versions fail closed instead of being inferred.

## Verification

Required focused evidence includes:

- deterministic account selection and rejection reasons;
- affinity continuity and explicit rebind behavior;
- concurrent lease limits and stale lease recovery;
- failure before dispatch, during dispatch, after commit, and after first stream
  event;
- cancellation and backpressure;
- provider-native thread isolation between accounts;
- no secret, token, home path, or authorization header in contracts, events,
  logs, snapshots, or fixtures;
- install, drift, adoption, sync, uninstall, and exact native-config restore;
- Codex, OpenCode, and supported Claude Code live tests isolated from default
  hermetic test suites.
