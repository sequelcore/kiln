# 03 - Model Gateway Ingress Lifecycle

Status: Blocked
Execution: Code closeout is ready; live proof is blocked on operator-machine configuration and secret inheritance.
Created: 2026-07-23
Reframed: 2026-08-12
Tracking: [#74](https://github.com/sequelcore/kiln/issues/74)

## Objective

Prove one secure user-scoped ingress service that exposes configured virtual
model aliases through OpenAI Responses and Anthropic Messages protocols, then
recovers and uninstalls exactly without becoming a second execution authority.

## Ownership

This track owns Model Gateway ingress configuration, principals and tokens,
virtual-model mappings to canonical execution route IDs, protocol translation,
PID/lock/digest/log/SQLite/health state, supervision, autostart, recovery, and
exact uninstall.

The [execution catalog](../architecture/providers/model-gateway.md) remains the
canonical route authority. Core owns catalog validation, admission, and route
ordering. Runtime owns account evidence, capacity, fencing, credential
resolution, and dispatch. This track does not own provider/model discovery,
provider entitlement evidence, account selection, economic commitment,
Operator Runtime, harness adapters, or remote operator sessions.

## Scope

- Resolve the canonical `modelGateway` configuration and virtual-model aliases.
- Bootstrap and rotate ingress tokens without persisting secret values.
- Start, ensure, stop, restart, inspect, diagnose, and supervise the service.
- Preserve exact process identity and fail closed on foreign or stale state.
- Prove Windows user-scoped autostart, recovery, update, and exact uninstall.
- Close listeners, SQLite, timers, and supervised promises deterministically.

## Non-Goals

- No execution-catalog, provider-discovery, entitlement, account, or lease policy.
- No harness picker, native provider adapter, or remote-pairing ownership.
- No project-scoped service state or manual HTTP process as a product workflow.
- No credentials or token values in YAML, logs, status, or delivery evidence.
- No compatibility aliases, duplicate route owners, or legacy lifecycle path.

## Current Foundation

Lifecycle commands, identity and digest checks, foreign-process refusal,
user-scoped runtime state, Windows Task Scheduler integration, secret-safe
output, execution-route-backed virtual models, and hardened shutdown behavior
are implemented.

The current operator configuration contains an execution catalog, one ingress
principal, and virtual-model mappings. A source-based doctor run reports the
service stopped with stale state, configuration drift, and unresolved secret
environment references in the current shell. That evidence admits diagnosis
only; mutation and live validation remain operator-authorized work.

## Ordered Slices

### Slice 0 - Deterministic Teardown Closeout

Status: Ready.

Add one focused behavioral regression proving the listener, SQLite connection,
timers, request completions, eviction work, and supervised promises settle
before process completion. Run the affected suite to a clean exit.

### Slice 1 - Configuration And Secret Inheritance

Status: Blocked on operator authorization and environment.

Reconcile the committed configuration with durable service state, clear only
owned stale state, make every referenced secret available to the supervised
process, and rotate the ingress token if required. Record no secret values.

### Slice 2 - Autostart And Recovery Proof

Status: Blocked on Slice 1 and operator-machine access.

Install the user-scoped supervisor, restart the operator session or machine,
verify exact identity, digest, protocols, and health, then exercise the
documented update and restart path.

### Slice 3 - Exact Uninstall

Status: Blocked on Slice 2 and operator authorization.

Uninstall the owned scheduled task and runtime projections, prove all owned
processes and state are removed, and prove unmanaged state is unchanged.

## Dependencies

- Model Gateway consumes canonical execution route IDs and Runtime dispatch; it
  never reconstructs route eligibility or credential authority.
- Cross-Harness Integration depends on this track only where a harness projects
  or recovers Model Gateway virtual models.
- Remote Operator Pairing owns its own authenticated operator-session contract
  and does not bind session identity to this ingress service.

## Promotion Gates

- Malformed configuration and install-state failures fail closed.
- Foreign processes are never terminated by identity guess.
- Secrets remain environment-resolved and absent from durable evidence.
- The affected test process exits zero with no late rejection or open handle.
- Restart proves the expected identity, digest, protocols, and health.
- Exact uninstall removes only state owned by Model Gateway.

## Verification

Focused lifecycle, authentication, supervisor, teardown, and Windows fixture
tests; affected package typecheck; `git diff --check`; source-based doctor; and
operator-authorized restart, recovery, and uninstall evidence.

## Completion Criteria

Model Gateway is live-validated as one user-scoped ingress service, survives an
operator-session or machine restart, recovers through the documented path, and
uninstalls exactly. Its virtual models resolve only through canonical execution
routes, and no ingress code owns provider evidence, account selection, capacity,
credentials, or dispatch.
