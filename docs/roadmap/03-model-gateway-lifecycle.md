# 03 - Model Gateway Lifecycle

Status: Implemented foundation; contract work ready; live activation blocked
Execution: Ready for provider identity contract; operator-machine service proof remains blocked.
Created: 2026-07-23

## Objective

Provide one secure user-scoped Model Gateway process with explicit configuration,
authentication, supervision, health, recovery, exact uninstall semantics, and one
provider-neutral contract for the route identity, access, authentication, and
entitlement evidence that the gateway projects to every consumer.

## Ownership

This track owns the gateway process, its durable user-scoped lifecycle, and the
canonical provider-route identity and entitlement projection emitted by the
gateway. It owns stable machine identity, provider-neutral access semantics,
authentication capabilities, provider-native tier evidence, and human-facing
presentation metadata shared by all operator and integration surfaces.

It does not own managed-job route policy, credential selection or account leases,
provider-specific entitlement inference, harness picker behavior, harness-local
identity rules, or surface-specific diagnostics. Managed Invocation Routing
consumes this contract for admission and affinity. Cross-Harness Integration maps
harness-native observations into it without creating a second owner.

## Scope

- Canonical `modelGateway` configuration resolution.
- Ingress token bootstrap and rotation.
- PID, lock, identity, digest, logs, SQLite, and health state.
- Start, ensure, stop, restart, status, and doctor.
- Windows least-privilege autostart and exact uninstall.
- Reliable full-suite teardown for gateway-related processes.
- Provider-neutral route identity and presentation metadata.
- Separate execution kind, access kind, and supported authentication flows.
- Credential/account identity references that never expose secrets.
- Runtime entitlement evidence, including provider-native subscription tier when
  the provider proves it.
- One cross-surface projection for GUI, TUI, CLI, SDK, MCP, replay, native, and
  harness integrations.

## Non-Goals

- No credentials or tokens in YAML, logs, native config, or durable status.
- No harness catalog or picker ownership.
- No project-scoped service state.
- No manual HTTP process as a product workflow.
- No static claim that OAuth implies subscription or a specific plan.
- No global enum of provider marketing tiers such as Plus, Pro, Go, or Zen.
- No route eligibility, quota, or availability derived from display metadata.
- No provider-specific branches in shared entitlement derivation.
- No duplicate GUI-, TUI-, CLI-, SDK-, MCP-, or harness-local metadata owner.

## Ordered Slices

### Slice 0 - User-Scoped Runtime

Status: Code complete.

Lifecycle commands, identity/digest checks, foreign-process refusal, user runtime
state, Windows Task Scheduler ownership, and secret-safe output are implemented.

### Slice 1 - Provider Identity, Access, And Entitlement Contract

Status: Ready for repository work.

Define the provider-neutral contract shared by runtime discovery, credential
pools, managed routing, harness adapters, replay, and operator surfaces. Preserve
stable machine identifiers separately from operator-facing labels and keep these
dimensions explicit:

- provider, product, provider-route, and optional harness-route identity;
- execution kind, such as direct provider, native harness, local endpoint, or
  remote gateway;
- access kind, such as subscription, metered API, enterprise, local, or unknown;
- supported authentication flows, including browser OAuth, device code, API key,
  environment credential, harness-managed auth, or no auth;
- concrete credential/account reference without secret material;
- provider-native entitlement tier as an opaque value, not a core marketing enum;
- entitlement status, evidence source, observation time, and operator-facing
  label;
- explicit `unknown`, `partial`, `expired`, and unavailable states.

Replace GUI-only ownership of provider labels and grouping with a shared contract.
Remove or migrate ambiguous semantics such as `free`, which currently conflates
no per-request API billing with no economic cost. Preserve existing provider IDs,
including `codex-oauth`, `openai`, `codex`, `opencode-go`, and `opencode-zen`, so
config, replay, and route identity remain stable.

The initial Codex OAuth projection should retain `codex-oauth` as the machine ID
and may present an operator label such as `ChatGPT Subscription (Codex)` only when
the wording is backed by the shared presentation contract. Authentication may be
confirmed while subscription tier remains unknown.

#### Promotion Gates

- The canonical contract is owned outside GUI-specific code and imported by all
  projections.
- Execution kind and access kind are independent dimensions.
- OAuth does not imply subscription, entitlement, route availability, or tier.
- Subscription does not imply a known tier or remaining quota.
- Provider-native tiers remain opaque at the provider boundary and are never
  normalized into an incomplete global marketing enum.
- Entitlement claims include status, source, and observation time; absent or stale
  evidence remains explicit and fails closed where entitlement is required.
- Static presentation metadata cannot authorize execution or override runtime
  discovery, health, policy admission, or provider evidence.
- GUI, TUI, CLI, SDK, MCP, replay, native, and harness projections agree on stable
  identity and preserve unknown values without inference.
- Existing provider IDs remain backward compatible without compatibility shims or
  duplicate aliases.
- Focused tests prove cross-surface parity and that secrets never enter the shared
  projection.

### Slice 2 - Test Teardown Reliability

Status: Ready for repository work.

Eliminate the late-handled rejection that can make a fully passing CLI suite exit
non-zero. Add a regression proving all supervised processes, listeners, timers,
and promises settle before test completion.

### Slice 3 - Operator Configuration And Token

Status: Blocked on operator machine.

Review and apply the real global `modelGateway` block. Bootstrap/rotate the token
through an explicit user-environment flow and verify inheritance after harness
restart.

### Slice 4 - Autostart And Recovery Proof

Status: Blocked on operator machine.

Install autostart, reboot/restart, verify exact process identity and health,
exercise update/restart, and prove exact uninstall without deleting unmanaged
state.

## Dependencies

- Managed Invocation Routing may consume stable account, access, and entitlement
  evidence but must not redefine it or infer provider tiers.
- Cross-Harness Integration may attach harness-native provider/model observations
  but must preserve separate harness and provider-route identity.
- Provider model discovery remains the runtime-owned availability and eligibility
  evidence plane. This track supplies identity and entitlement projection; it
  does not weaken fail-closed route admission.
- Surface implementations may abbreviate labels but must derive them from the
  shared projection and preserve canonical machine identifiers.

## Promotion Gates

- Malformed config and install-state failures fail closed and roll back exactly.
- Foreign or stale processes are never terminated by identity guess.
- Secrets remain environment-resolved and absent from durable evidence.
- Provider identity, access, auth capability, and entitlement semantics have one
  shared owner and one cross-surface projection.
- Unknown or stale entitlement evidence is never upgraded by static metadata.
- The full affected suite exits zero without late rejection.
- Live recovery and uninstall are operator-authorized and recorded.

## Verification

Focused provider-contract, discovery, credential-pool, gateway-contract,
GUI/TUI/CLI/SDK/MCP/replay parity, lifecycle/auth/supervisor, and Windows fixture
tests; workspace typecheck and build; full CLI suite with clean teardown;
`git diff --check`; and operator-authorized restart/uninstall proof.

## Completion Criteria

The gateway is code-complete, integration-complete, live-validated, recoverable,
and removable as one user-scoped service. Provider identity, access,
authentication capabilities, and entitlement evidence have one provider-neutral
contract consumed consistently across surfaces without owning route policy,
credential leases, or harness-local behavior.
