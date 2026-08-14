# Roadmap

This directory contains unfinished implementation tracks and explicit admission
boundaries. Stable behavior belongs in `docs/architecture/`; completed delivery
evidence belongs in the changelog or a release record.

## Operating Model

Roadmap numbers define dependency order. Only the first `Ready` item is the
default next task. Starting another item requires an explicit priority decision
recorded here.

States: `Ready`, `Queued`, `Research`, `Blocked`, `Deferred`, and `Guardrail`.
Every track must name one next admissible action or an exact blocker.

No slice may scope a compatibility path, deprecation window, or retained legacy
reader for external callers. Kiln has none. A slice that replaces a contract
removes the old one in the same change, and discarding local state with no
future-useful evidence is an admitted outcome. See
`docs/architecture/core/engineering-standards.md`, section "Consumer Surface".

Completed tracks are removed after their stable doctrine and delivery evidence
are promoted. File numbers do not need to be renumbered solely to fill a removed
slot; ordering is defined by this queue and changed only through an explicit
roadmap reorganization.

## Execution Queue

| Order | Track | State | Next bounded work |
| --- | --- | --- | --- |
| 1 | [06 - Prompt Governance Plane](06-prompt-governance-plane.md) | Queued | Persist one content-free effective-prompt observation after higher-priority Ready work. |
| 2 | [07 - Stack Governance Plane](07-stack-governance-plane.md) | Research | Define read-only fixtures and the typed stack-policy contract. |
| 3 | [08 - Remote Operator Pairing](08-remote-operator-pairing.md) | Deferred | No work admitted until `07` closes (explicit operator sequencing decision, 2026-07-24). |
| 4 | [09 - Rust Optimization Guardrail](09-rust-optimization-guardrail.md) | Guardrail | Admit no implementation without a module-specific ADR and parity benchmark. |
| 5 | [10 - Native Operator Surface](10-native-operator-surface.md) | Queued | Define workload fixture governance after release and control-plane work. |
| 6 | [11 - Capability Fabric](11-capability-fabric.md) | Research | Define the canonical capability catalog and its fail-closed public projection contract. |
| 7 | [12 - Configuration Experience](12-configuration-experience.md) | Research | Inventory every field owner, scope, authority impact, activation behavior, and intent/evidence/state classification; record the schema and mutation ADR. |

## Dependency Rules

- `06` decides how admitted instructions and skill content enter provider prompts and become replayable evidence.
- `07` owns desired stack policy and drift evidence; skills may consume its result but never own versions.
- `08` owns the cross-surface remote/headless pairing flow and its authenticated operator-session contract; deferred behind `07` by explicit decision, not technical dependency.
- `09` is a decision boundary, not queued implementation.
- `10` owns native surface promotion and remains sequenced behind stable release,
  gateway, and benchmark evidence.
- `11` owns cross-harness capability discovery, deferred tool search, portable
  execution, agent-backed capabilities, and the portable operator-question
  lifecycle. It reuses `06` progressive disclosure and existing Agent Task/A2A
  authority instead of duplicating them. Interaction promotion is GUI-first,
  then behaviorally equivalent in TUI and native harnesses; GUI components are
  never shared execution authority.
- `12` owns configuration discoverability, desired intent, effective-value
  explanation, governed mutation, activation planning, and cross-surface
  settings parity. It consumes `11` capability identities but never owns
  capability eligibility or execution.

GUI execution presentation is canonical in
[`docs/architecture/gui-execution-presentation.md`](../architecture/surfaces/gui-execution-presentation.md).
Routine UI improvements are product maintenance, not an active release-debt track.

## Delivery Gates

Every implementation track distinguishes:

1. **Code complete** — contracts, implementation, focused tests, typecheck, and docs align.
2. **Integration complete** — affected packages and cross-surface projections pass together.
3. **Live validated** — operator-specific credentials, harnesses, services, and restore paths are proven.
4. **Release ready** — exact committed candidate passes the release runbook and registry checks.

A track must not describe live validation as incomplete code or describe passing
source tests as release evidence.

## Roadmap File Standard

Every numbered file uses `NN-kebab-case-title.md`, matching H1, `Status`,
`Execution`, and `Created`/`Started`. Required sections are Objective, Ownership,
Scope, Non-Goals, ordered slices, promotion gates, verification, and completion
criteria. Keep one bounded concern per slice. Do not retain completed narrative
that already belongs in architecture or release history.

## Admission Rules

- Scout code and canonical architecture before implementation.
- Prefer shared contracts over surface-, provider-, or harness-local policy.
- Record dependencies as `Blocked`; do not hide them in prose.
- No dead code, duplicate owners, prompt-only fixes, hidden fallbacks, or unsupported compatibility shims.
- Live tests require explicit authority for credentials, quota, subscription, machine configuration, and destructive restore operations.
- Update this index and the owning track atomically when state or priority changes.

## Release position

The current repository has no active release candidate and no supported
installable package line. The historical `3.0.0-beta.1` candidate was not
published and is no longer the target: additional live validation, a complete
rebrand, and new package coordinates must precede any future release process.
Release work starts only after those product decisions are canonical and the
exact committed candidate satisfies `docs/operations/release.md`.
