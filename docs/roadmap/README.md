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

Completed tracks are removed after their stable doctrine and delivery evidence
are promoted. File numbers do not need to be renumbered solely to fill a removed
slot; ordering is defined by this queue and changed only through an explicit
roadmap reorganization.

## Execution Queue

| Order | Track | State | Next bounded work |
| --- | --- | --- | --- |
| 1 | [01 - External Runtime Governance](./01-external-runtime-governance.md) | Ready | Complete cross-surface parity and final closeout after Slice 3.2 integration. |
| 2 | [02 - Managed Invocation Routing](./02-managed-invocation-routing.md) | Ready | Complete per-job account leases and lifecycle evidence. |
| 3 | [03 - Model Gateway Lifecycle](./03-model-gateway-lifecycle.md) | Blocked | Fix deterministic teardown, then apply and live-prove the reviewed user-scoped gateway configuration on an operator machine. |
| 4 | [04 - Cross-Harness Integration](./04-cross-harness-integration.md) | Blocked | Close OpenCode live parity, then migrate and prove the harness-neutral control-plane bridge. |
| 5 | [05 - Skill Capability Plane](./05-skill-capability-plane.md) | Research | Define the provider-neutral skill evidence and admission contract. |
| 6 | [06 - Prompt Governance Plane](./06-prompt-governance-plane.md) | Queued | Persist one content-free effective-prompt observation after higher-priority Ready work. |
| 7 | [07 - Stack Governance Plane](./07-stack-governance-plane.md) | Research | Define read-only fixtures and the typed stack-policy contract. |
| 8 | [08 - Remote Operator Pairing](./08-remote-operator-pairing.md) | Deferred | No work admitted until `07` closes (explicit operator sequencing decision, 2026-07-24). |
| 9 | [09 - Rust Optimization Guardrail](./09-rust-optimization-guardrail.md) | Guardrail | Admit no implementation without a module-specific ADR and parity benchmark. |
| 10 | [10 - Native Operator Surface](./10-native-operator-surface.md) | Queued | Define workload fixture governance after release and control-plane work. |

## Dependency Rules

- `01` owns provider-neutral external-runtime evidence realization and closeout consistency.
- `02` owns managed-job routing, leases, account selection, lifecycle, result, and replay.
- `03` owns the user-scoped Model Gateway process, configuration, authentication, and supervision.
- `04` owns harness adapters, native projection, protocol parity, live cross-harness proof, and deferred federation research.
- `05` decides whether a skill is healthy, compatible, trusted, and admitted.
- `06` decides how admitted instructions and skill content enter provider prompts and become replayable evidence.
- `07` owns desired stack policy and drift evidence; skills may consume its result but never own versions.
- `08` owns the cross-surface remote/headless pairing flow and binds to `03`'s access contract; deferred behind `07` by explicit decision, not technical dependency.
- `09` is a decision boundary, not queued implementation.
- `10` remains last; native surface promotion depends on stable release, gateway, and benchmark evidence.

GUI execution presentation is canonical in
[`docs/architecture/gui-execution-presentation.md`](../architecture/gui-execution-presentation.md).
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

## Release Position

The GUI release-truth track is closed from implemented tests and operator use;
its stable invariants are promoted to architecture. `3.0.0-beta.1` nevertheless
remains a candidate until the exact commit passes `docs/operations/release.md`,
including trusted publishing, package contents, cross-platform smoke, provenance,
and registry installation verification. Kiln `2.1.0` remains the supported
public line until that succeeds.
