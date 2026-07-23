# 03 - Model Gateway Lifecycle

Status: Implemented foundation; live activation blocked
Execution: Blocked - operator-machine configuration and service proof are required.
Created: 2026-07-23

## Objective

Provide one secure user-scoped Model Gateway process with explicit configuration,
authentication, supervision, health, recovery, and exact uninstall semantics.

## Ownership

This track owns the gateway process and its durable user-scoped lifecycle. It
does not own managed-job route policy, account leases, harness picker behavior,
or surface-specific diagnostics.

## Scope

- Canonical `modelGateway` configuration resolution.
- Ingress token bootstrap and rotation.
- PID, lock, identity, digest, logs, SQLite, and health state.
- Start, ensure, stop, restart, status, and doctor.
- Windows least-privilege autostart and exact uninstall.
- Reliable full-suite teardown for gateway-related processes.

## Non-Goals

- No credentials or tokens in YAML, logs, native config, or durable status.
- No harness catalog or picker ownership.
- No project-scoped service state.
- No manual HTTP process as a product workflow.

## Ordered Slices

### Slice 0 - User-Scoped Runtime

Status: Code complete.

Lifecycle commands, identity/digest checks, foreign-process refusal, user runtime
state, Windows Task Scheduler ownership, and secret-safe output are implemented.

### Slice 1 - Test Teardown Reliability

Status: Ready for repository work.

Eliminate the late-handled rejection that can make a fully passing CLI suite exit
non-zero. Add a regression proving all supervised processes, listeners, timers,
and promises settle before test completion.

### Slice 2 - Operator Configuration And Token

Status: Blocked on operator machine.

Review and apply the real global `modelGateway` block. Bootstrap/rotate the token
through an explicit user-environment flow and verify inheritance after harness
restart.

### Slice 3 - Autostart And Recovery Proof

Status: Blocked on operator machine.

Install autostart, reboot/restart, verify exact process identity and health,
exercise update/restart, and prove exact uninstall without deleting unmanaged
state.

## Promotion Gates

- Malformed config and install-state failures fail closed and roll back exactly.
- Foreign or stale processes are never terminated by identity guess.
- Secrets remain environment-resolved and absent from durable evidence.
- The full affected suite exits zero without late rejection.
- Live recovery and uninstall are operator-authorized and recorded.

## Verification

Focused lifecycle/auth/supervisor tests, Windows fixture tests, workspace
typecheck/build, full CLI suite with clean teardown, `git diff --check`, and
operator-authorized restart/uninstall proof.

## Completion Criteria

The gateway is code-complete, integration-complete, live-validated, recoverable,
and removable as one user-scoped service without owning route or harness policy.
