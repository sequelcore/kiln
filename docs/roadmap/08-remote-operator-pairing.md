# 08 - Kiln Connect Pairing And Sessions

Status: Queued
Priority: Normal
Execution: Queued - reassess the pairing/session contract after Roadmap 00
names a supported source baseline.
Created: 2026-07-24
Reprioritized: 2026-08-23

## Objective

Give an operator one `kiln connect` experience for authorizing a phone,
browser, CLI, GUI, or TUI against a local Kiln Operator Runtime without
requiring a browser or loopback callback on the machine being controlled.
Every surface consumes one authenticated operator-session contract with
explicit identity, device binding, scope, expiry, revocation, and audit
evidence.

## Product Contract

`Kiln Connect` is the product capability and CLI namespace. Pairing is one
internal phase of that capability; it is not the product name.

The intended command family is:

```text
kiln connect
kiln connect pair
kiln connect status
kiln connect devices
kiln connect revoke <device-id>
kiln connect disconnect
```

Command names remain provisional until Slice 0 closes the contract. CLI, GUI,
TUI, and future native surfaces must project the same operations rather than
inventing surface-local variants.

## Ownership

This track owns remote-operator pairing requests, one-time grants,
authenticated device identity, operator sessions, scopes, expiry, renewal,
revocation, and audit evidence. Gateway contracts own serializable shapes;
Runtime owns verification and enforcement; surfaces own only presentation.

Operator Runtime consumes the authenticated principal while retaining route
admission, economic commitment, credential, tool, approval, and dispatch
authority. A paired device is not automatically authorized for every Runtime
operation.

Roadmap 08.5 owns reachability, endpoint evidence, tunnel adapters, connector
lifecycle, and background service integration. Transport identity never
becomes operator identity.

This track does not own harness-native provider authentication or evidence;
the stable
[harness integration architecture](../architecture/surfaces/harness-integration-capabilities.md)
owns harness adapters while Core and Runtime own provider-model evidence. It
does not own Model Gateway ingress, and Model Gateway principals never become
operator-session identity.

## Scope

- One bounded pairing state machine shared by every operator surface.
- QR, link, and manual-code presentation over the same one-time grant.
- A no-loopback path suitable for headless and remote machines.
- A local-first operator identity that does not require a Kiln-hosted account.
- Device-bound sessions with explicit scopes, expiry, renewal, revocation, and
  last-seen evidence.
- Authenticated HTTP and WebSocket admission for the GUI and future remote
  surfaces.
- Exact origin, audience, project/runtime binding, and replay checks.
- Sanitized lifecycle evidence for pair, exchange, renew, reject, revoke, and
  disconnect outcomes.
- A future identity-provider adapter boundary without making OAuth or a hosted
  account mandatory for the first implementation.

## Initial Scope Profile

The first remote profile should be useful for supervision while remaining
narrower than local administrative access:

- `session:read`
- `turn:submit`
- `approval:resolve`
- `goal:control`

Terminal operation, provider authentication, credential management, setup
mutation, arbitrary filesystem access, route-authority expansion, and global
configuration mutation remain denied until separately admitted. Scope names
and grouping are Slice 0 decisions, not implementation authority from this
roadmap prose.

## Non-Goals

- No Kiln-hosted relay, account system, tunnel service, DNS service, or cloud
  control plane in this track.
- No provider identity, entitlement, route, credential, or ingress-principal
  contract.
- No replacement for Codex, Claude Code, OpenCode, or other harness
  authentication.
- No remote code-execution shortcut, tool-approval bypass, terminal exposure,
  or expansion of Runtime authority.
- No bearer token in query strings, normal transcript text, prompts, logs, or
  durable audit payloads.
- No assumption that a trusted network or tunnel authenticates the Kiln
  operator.
- No native mobile application requirement; the responsive web GUI is the
  first consumer.

## Research Basis

The active, dated evidence synthesis is
[Remote Operator Connection Research](../research/active/remote-operator-connection.md).
It compares current OpenAI Codex and Anthropic Claude Code remote-control
surfaces, VS Code Remote Tunnels, T3 Code/T3 Connect, community tools,
Cloudflare and Tailscale transports, and RFC 8252, RFC 8628, RFC 9449, and RFC
9700.

The evidence supports these bounded conclusions:

- Local execution with remote projection is an established product pattern;
  remote control need not move provider credentials or filesystem authority to
  the client.
- Account authentication, device pairing, environment authorization, and
  transport are distinct contracts even when a product presents one setup
  command.
- Public clients use authorization code plus PKCE when federated OAuth is
  present; device authorization is the standard browser-on-another-device
  pattern when the authorization server supports it.
- Sender-constrained credentials reduce replay risk, but DPoP is a later
  admission decision, not mandatory machinery for a local-first first slice.
- T3 Code's fragment-carried state/challenge and pasted `code.state` flow is
  useful mechanism evidence, not an architecture to copy verbatim.

## Ordered Slices

### Slice 0 - Threat Model And Contract Fixtures

Status: Queued behind Roadmap 00 Source Stability.

Define principals, protected assets, trust boundaries, session scopes, pairing
states, credential classes, expiry, renewal, revocation, replay behavior, and
audit events. Add portable fixtures for successful pairing and negative paths:
wrong runtime, wrong device, wrong audience, expired grant, consumed grant,
revoked session, origin mismatch, scope denial, and replay.

Exit gate: fixtures distinguish authentication, authorization, transport,
approval, and Runtime execution authority; every consequential operation has
an enforcement point outside prompts and surface code.

Recovery: fixtures and contract decisions create no durable credentials and
can be replaced atomically before Slice 1.

### Slice 1 - Shared Session Contract And Local Registry

Status: Queued behind Slice 0.

Add the provider-neutral pairing, device, session, scope, and revocation
contracts to Gateway Contracts and implement the local Runtime registry. Store
only hashed opaque grants/session secrets or admitted asymmetric public-key
material. Bound capacity, lifetime, clock skew, request size, and audit output.

Exit gate: schema and Runtime tests prove one-time consumption, exact binding,
scope attenuation, expiry, renewal, revocation, capacity limits, and secret
redaction. Existing internal Operator Runtime credentials are not silently
reinterpreted as remote-browser sessions.

Recovery: registry state has an explicit version and may be discarded before
release; invalid or unknown state fails closed.

### Slice 2 - `kiln connect pair`

Status: Queued behind Slice 1.

Expose one pairing initiation flow through CLI and shared presentation data.
Render a QR code, link, and manual code from the same grant. Put sensitive
browser-carried material in the URL fragment, exchange it once over TLS, and
establish an HttpOnly browser session or an equivalently protected non-browser
session. Never require a callback listener on the controlled machine.

Exit gate: a synthetic phone/browser fixture pairs without loopback, the grant
cannot be replayed, URLs and logs contain no reusable credential, and cancel or
timeout leaves no active session.

Recovery: pairing cancellation and process failure invalidate the pending
grant; no partial device record becomes authorized.

### Slice 3 - Scoped GUI HTTP And WebSocket Admission

Status: Queued behind Slice 2 and Roadmap 08.5 Slice 0.

Authenticate every protected GUI HTTP route and WebSocket upgrade, validate
the exact origin, bind the connection to the canonical operator/device
principal, and authorize each inbound operation immediately before its effect.
Replace the client-supplied anonymous `userId` as identity. Do not project
local high-authority capabilities to the initial remote profile.

Exit gate: unauthenticated, expired, revoked, cross-origin, wrong-scope, and
stale WebSocket/HTTP requests fail closed; revocation terminates active
connections; local GUI behavior retains the same Runtime authority semantics.

Recovery: disabling Connect rejects remote sessions while preserving local
Runtime state and transcript evidence.

### Slice 4 - Device Lifecycle And Cross-Surface Projection

Status: Queued behind Slice 3.

Project status, devices, scopes, expiry, last-seen evidence, revoke, and
disconnect through CLI, GUI, and TUI from the shared contract. Add explicit
session renewal and version-skew behavior. A disconnected surface detaches
without cancelling active Runtime work.

Exit gate: cross-surface fixtures show equivalent lifecycle state; revocation
is visible and effective everywhere; reconnect observes the canonical active
turn without duplicate dispatch.

Recovery: device/session records can be revoked independently of project,
provider, transcript, and Runtime economic state.

### Slice 5 - Federated Identity And Proof-Binding Decision

Status: Deferred until the local-first contract is live validated.

Evaluate whether a future hosted or organization-managed deployment needs
OAuth/OIDC, RFC 8628 device authorization, WebAuthn/passkeys, DPoP, or another
sender-constrained credential. Admit only mechanisms justified by a concrete
deployment and threat model.

Exit gate: an ADR adopts or rejects each mechanism with issuer, audience,
rotation, recovery, privacy, and operational ownership evidence. No identity
provider becomes mandatory for local-first Connect by accident.

## Dependencies

- The 2026-08-23 source-stability decision queues this track behind Roadmap 00.
  Remote pairing is product expansion, not a prerequisite for stable local
  source use.
- The 2026-08-14 operator priority decision supersedes the former sequencing
  gate behind Roadmap 07. Roadmap 07 is no longer a prerequisite.
- Roadmap 08.5 Slice 0 must close the current GUI listener/exposure guardrail
  before any remote ingress is admitted.
- Roadmap 08.5 transport slices consume this track's session contract; they do
  not mint or widen operator authority.
- Operator Runtime remains the authenticated-session consumer and execution
  authority.

## Promotion Gates

- One typed contract owns pairing, device identity, sessions, scope, expiry,
  renewal, and revocation.
- Authentication never substitutes for operation authorization.
- Pairing, session, transport, provider, route, credential, approval, and
  dispatch identities remain structurally distinct.
- Sensitive values are never logged, placed in query strings, persisted in
  plaintext, or projected into prompts/transcripts.
- Every credential is audience-, runtime-, device-, and purpose-bound to the
  degree admitted by its slice.
- CLI, GUI, and TUI consume one lifecycle contract.
- Negative tests prove rejection, revocation, and replay behavior outside
  model instructions.
- No cloud service is required for completion through Slice 4.

## Verification

Contract/schema tests, portable pairing fixtures, Runtime registry tests,
HTTP/WebSocket negative-boundary tests, scope-matrix tests, revocation of live
connections, cross-surface projection tests, responsive browser tests, affected
package typecheck, `git diff --check`, and documentation-link verification.

Live validation requires explicit operator authority and a synthetic device;
it must not persist real pairing codes, cookies, provider credentials, or raw
incident payloads as fixtures.

## Completion Criteria

An operator can use `kiln connect` to pair, inspect, renew, and revoke a remote
device through one shared session contract. The paired device can exercise
only its admitted scopes against Operator Runtime, without acquiring provider,
route, credential, economic, tool, approval-bypass, ingress, or dispatch
authority. The result works without a Kiln-hosted cloud and is ready for the
transport and lifecycle adapters owned by Roadmap 08.5.
