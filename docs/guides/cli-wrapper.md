# CLI and Runtime Surfaces

This guide explains the CLI-facing execution surfaces without reviving the old
idea that Kiln's identity is a wrapper around other runtimes.

Kiln may integrate with external runtimes and providers, but those integrations
are downstream of the control plane. They are execution surfaces, not the
system's identity.

For doctrine, start with:

- [Identity](../architecture/identity.md)
- [Tool Execution](../architecture/tool-execution.md)
- [Safety](../architecture/safety.md)
- [Flows](../architecture/flows.md)

## What This Layer Does

The CLI and related runtime surfaces are responsible for:

- exposing operator-facing entry points
- selecting an execution surface compatible with the current task
- carrying Kiln policy and context into execution
- reporting tool use, file changes, failures, and completion back into the control loop

They are not the source of truth for architecture.

## Execution Surfaces

Kiln currently operates across multiple execution surfaces:

- harness-style runtime integrations
- direct provider-backed execution paths
- local operator interfaces such as CLI and TUI

The important architectural point is not which brand or backend is selected.
The important point is that execution remains governed by Kiln's admission,
context, safety, and coordination rules.

## Canonical Responsibilities

### Surface selection

The runtime surface should be selected according to capability, policy,
availability, and operating mode.

### Policy carriage

Execution surfaces must receive Kiln's effective constraints. If a surface
cannot enforce a given rule natively, that limitation must remain explicit.

### Event return path

Execution is only useful to the control plane if it returns observable events:

- text or result output
- tool intent and execution outcome
- file mutations
- completion state
- cost or budget signals where available
- failure signals suitable for recovery and telemetry

## Key Rule

Execution capability does not outrank architecture.

That means:

- an external runtime's native affordances do not redefine Kiln
- a fast backend does not justify bypassing policy
- unsupported enforcement on a given surface must remain visible rather than implied

## TUI and CLI Position

The CLI and TUI should be treated as operator-facing control surfaces. Their
role is to expose what Kiln is regulating:

- current task state
- execution mode
- safety posture
- coordination activity
- completion and recovery signals

They should not present Kiln as if the backend itself were the product.

## Context Usage

When CLI already prints a session report, it includes the shared context-usage
projection. Structured JSON exposes the field only as an optional extension;
exact-answer and benchmark contracts remain unchanged. CLI does not derive a
ratio from transcript, cost, selected provider, or a configured default model.
Persisted transcript evidence is restored as historical with its original
observation and source. See [Context Usage Projection](../architecture/context-usage-projection.md).

## CLI Package Test Harness

The `@kilnai/cli` package participates in the canonical workspace test command,
so its harness must fail loudly and exit cleanly. The package test script uses
single-worker Vitest execution with a verbose reporter so filtered workspace
runs show progress instead of appearing to hang silently.

CLI Vitest config owns the lifecycle bounds for default tests:

- test timeout: `10_000ms`
- hook timeout: `10_000ms`
- teardown timeout: `10_000ms`

These bounds are package-level diagnostics, not a substitute for cleanup. Tests
that create child processes, servers, watchers, timers, temporary directories,
or process-level mocks must own teardown in the same test or hook that creates
the resource. Default CLI tests must not require live credentials, installed
native harnesses, or operator-local state. If a live harness check is needed, it
belongs in an explicitly named live test path outside default package
verification.

## Transitional Note

Older documentation may describe this layer mainly as a wrapper architecture or
backend-family matrix. Keep that information secondary. The active doctrine is:

- Kiln is the control plane
- runtime integrations are execution surfaces
- enforcement strength differs by surface and must be documented honestly
