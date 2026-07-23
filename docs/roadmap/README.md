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

## Execution Queue

| Order | Track | State | Next bounded work |
| --- | --- | --- | --- |
| 1 | [00 - Public Release Truth](./00-public-release-truth.md) | Ready | Complete operator live validation for implemented GUI execution evidence. |
| 2 | [01 - External Runtime Governance](./01-external-runtime-governance.md) | Ready | Encode the deterministic MCP-only failing trace before policy changes. |
| 3 | [02 - Managed Invocation Routing](./02-managed-invocation-routing.md) | Ready | Complete per-job account leases and lifecycle evidence. |
| 4 | [03 - Model Gateway Lifecycle](./03-model-gateway-lifecycle.md) | Blocked | Apply and live-prove the reviewed user-scoped gateway configuration on an operator machine. |
| 5 | [04 - Cross-Harness Integration](./04-cross-harness-integration.md) | Blocked | Close OpenCode live parity, then migrate and prove the harness-neutral control-plane bridge. |
| 6 | [05 - Skill Capability Plane](./05-skill-capability-plane.md) | Research | Define the provider-neutral skill evidence and admission contract. |
| 7 | [06 - Prompt Governance Plane](./06-prompt-governance-plane.md) | Queued | Persist one content-free effective-prompt observation after higher-priority Ready work. |
| 8 | [07 - Stack Governance Plane](./07-stack-governance-plane.md) | Research | Define read-only fixtures and the typed stack-policy contract. |
| 9 | [08 - Rust Optimization Guardrail](./08-rust-optimization-guardrail.md) | Guardrail | Admit no implementation without a module-specific ADR and parity benchmark. |
| 10 | [09 - Native Operator Surface](./09-native-operator-surface.md) | Queued | Define workload fixture governance after release and control-plane work. |

## Dependency Rules

- `00` owns public GUI truth and presentation only; it consumes shared contracts.
- `01` owns provider-neutral external-runtime evidence realization and closeout consistency.
- `02` owns managed-job routing, leases, account selection, lifecycle, result, and replay.
- `03` owns the user-scoped Model Gateway process, configuration, authentication, and supervision.
- `04` owns harness adapters, native projection, protocol parity, live cross-harness proof, and deferred federation research.
- `05` decides whether a skill is healthy, compatible, trusted, and admitted.
- `06` decides how admitted instructions and skill content enter provider prompts and become replayable evidence.
- `07` owns desired stack policy and drift evidence; skills may consume its result but never own versions.
- `08` is a decision boundary, not queued implementation.
- `09` remains last; native surface promotion depends on stable release, gateway, and benchmark evidence.

## Delivery Gates

Every implementation track distinguishes:

1. **Code complete** — contracts, implementation, focused tests, typecheck, and docs align.
2. **Integration complete** — affected packages and cross-surface projections pass together.
3. **Live validated** — operator-specific credentials, harnesses, services, and restore paths are proven.
4. **Release ready** — exact committed candidate passes the release runbook and registry checks.

A track must not describe live validation as incomplete code or describe passing source tests as release evidence.

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

`3.0.0-beta.1` remains a candidate. Tagging is blocked until Roadmap 00 live
validation closes and the exact candidate passes `docs/operations/release.md`,
including trusted publishing, package contents, cross-platform smoke, provenance,
and registry installation verification. Kiln `2.1.0` remains the supported
public line until that succeeds.
