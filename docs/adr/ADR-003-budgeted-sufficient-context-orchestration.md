# ADR-003: Budgeted Sufficient Context Orchestration

## Status

Accepted

## Context

Kiln coordinates agents across surfaces and providers. Each turn needs enough
context to execute correctly, but unbounded prompt assembly creates cost,
latency, drift, stale instructions, and unverifiable behavior.

Context selection must therefore be explicit, budgeted, auditable, and shared
by CLI, TUI, GUI, native, runtime gateway, and managed-agent execution.

## Decision

`DefaultContextGovernor` is the canonical context admission owner for governed
turns. It assembles projected context from structured candidates, required
blocks, preferred sources, resource artifacts, memory snapshots, cache state,
and policy inputs. It returns selected blocks, deferred blocks, token evidence,
and an audit record.

The governor model has these rules:

- Context candidates are structured inputs, not concatenated prompt strings.
- Required blocks are admitted first and overflow is recorded when required
  context exceeds the budget.
- Optional blocks compete by effective score inside the remaining budget.
- Preferred sources, summary aggressiveness, cache state, exact artifacts, and
  field salience may affect score, but they must be visible in the audit.
- Memory and resource context admitted into a turn must produce admission
  evidence through `ContextAdmissionSink`.
- Surfaces and harness wrappers may format projected context, but they must not
  bypass admission by assembling hidden runtime prompt state.

## Boundaries

- The governor lives in `packages/core/src/context/governor.ts`.
- Token-budget selection lives in `packages/core/src/memory/context-budget.ts`.
- Context projection types live in `packages/core/src/context/projected-context.ts`.
- Runtime surfaces may collect candidates and format output; they do not own
  admission policy.
- Memory recall can propose candidates, but the governor decides turn
  admission.

## Consequences

Kiln gains predictable prompt budgets and auditable context sufficiency. Agents
may receive less optional context when budgets are tight, so feature work must
prefer high-quality structured candidates over large prose dumps.

## Verification

Professional acceptance for this ADR requires tests that cover:

- required context admission and overflow evidence
- optional context ranking within budget
- preferred-source and summary-aggressiveness scoring
- memory snapshot and exact artifact admission
- selected/deferred audit blocks
- admission records persisted for governed memory evidence

Canonical architecture reference: `docs/architecture/context-governance.md`.
