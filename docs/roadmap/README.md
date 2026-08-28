# Roadmap

This directory contains unfinished implementation tracks and explicit admission
boundaries. Stable behavior belongs in `docs/architecture/`; completed delivery
evidence belongs in the changelog or a release record.

## Operating Model

Roadmap numbers normally define dependency order. The execution queue and an
explicit recorded priority decision may supersede numeric order. Only the first
`Ready` item at the highest priority is the default next task; parallel safety
work must be named as independently admissible.

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

| Order | Track | State | Priority | Next bounded work |
| --- | --- | --- | --- | --- |
| 1 | [11 - Capability Fabric](11-capability-fabric.md) | In progress | High | Complete the operator-owned MCP binding/auth digest projection into the strict v2 tool adapter; then begin OpenAPI discovery. |
| 2 | [08 - Kiln Connect Pairing And Sessions](08-remote-operator-pairing.md) | Ready | Normal | Begin Slice 0 when Capability Fabric reaches a blocker or the remote-access need becomes current again. |
| 3 | [08.5 - Kiln Connect Remote Connectivity](08.5-remote-operator-connectivity.md) | Queued | Normal | Slice 0 is complete; later connectivity slices wait on Roadmap 08 session identity. |
| 4 | [06 - Prompt Governance Plane](06-prompt-governance-plane.md) | Research | Normal | Admit the narrow capability-disclosure dependency when Roadmap 11 Slice 2 completes; broader prompt evaluation remains behind higher-priority Ready work. |
| 5 | [06.5 - End-To-End Harness Efficiency](06.5-end-to-end-harness-efficiency.md) | Research | Normal | Define the production-path benchmark and attribution contract after higher-priority Ready work; optimization waits on a measured bottleneck. |
| 6 | [07 - Stack Governance Plane](07-stack-governance-plane.md) | Research | Normal | Define read-only fixtures and the typed stack-policy contract after higher-priority Ready work. |
| 7 | [09 - Rust Optimization Guardrail](09-rust-optimization-guardrail.md) | Guardrail | Conditional | Admit no implementation without a module-specific ADR and parity benchmark. |
| 8 | [08.75 - Inbound Agent Workers](08.75-inbound-agent-workers.md) | Research | Deferred | Its bounded verification surface remains independently useful but is not the default ahead of the Ready track. |
| 9 | [10 - Native Operator Surface](10-native-operator-surface.md) | Deferred | Deferred | Reassess the product need only after every other executable roadmap track is closed. |

## Dependency Rules

- `06` decides how admitted instructions and skill content enter provider
  prompts, become replayable evidence, and project into provider-specific cache
  topology.
- `06.5` owns production-path latency and cost attribution across provider,
  tools, orchestration, retries, compaction, and startup. It consumes `06`
  prompt-cache evidence but does not own prompt content or provider cache
  semantics. A measured native candidate must also pass `09`.
- `07` owns desired stack policy and drift evidence; skills may consume its result but never own versions.
- `08` owns `Kiln Connect` pairing, device identity, authenticated operator
  sessions, scopes, expiry, and revocation.
- `08.5` owns loopback exposure, operator-owned transport adapters, endpoint
  evidence, connector lifecycle, and reconnection. Its Slice 0 completed the
  independently admissible safety work; later slices consume `08` session identity, and
  configuration-bearing slices consume the canonical effective-state and
  governed-mutation contracts.
- The 2026-08-14 operator decision removed `07` as a prerequisite for `08`.
  Roadmap 12 then completed the first safe-turn-without-YAML vertical proof.
  The 2026-08-23 source-stability decision temporarily superseded the former
  Connect priority, and Roadmap `00` completed the supported local source
  baseline on 2026-08-25. On 2026-08-28 the operator moved Roadmap `11` ahead
  of Connect because remote pairing is no longer the current operational need
  and cross-harness verification is. Roadmap `08` remains Ready rather than
  blocked; Roadmap `08.5` Slice 0 remains its independently completed safety
  boundary, and later connectivity slices still wait on Roadmap `08` session
  identity. This sequencing does not transfer bounded-context ownership.
  Neither Connect track admits a Kiln-hosted cloud; a managed relay requires a
  separate future decision.
- `08.75` owns inbound agents Kiln did not launch: their identity, bounded
  verification surface, lease-scoped sandboxes, and settlement. It consumes `08`
  identity and `08.5` transport and widens neither. An agent identity never
  becomes an operator identity. Its Slice 1 verification surface is
  independently useful to local and outbound delegates, so it is admissible
  before the inbound premise resolves.
- `09` is a decision boundary, not queued implementation. It never becomes the
  general performance owner; `06.5` must first identify a bounded hot path.
- `10` is the final roadmap track. It owns the future native-surface product
  decision and is not admissible until every other executable roadmap track is
  closed by completion, rejection, or removal. No native implementation or
  native-only runtime contract is retained while it is deferred.
- `11` owns cross-harness capability discovery, deferred tool search, portable
  execution, agent-backed capabilities, and the portable operator-question
  lifecycle. It reuses `06` progressive disclosure and existing Agent Task and
  managed-invocation authority instead of duplicating them. Interaction promotion is GUI-first,
  then behaviorally equivalent in TUI and native harnesses; GUI components are
  never shared execution authority. Its first implementation vertical is the
  existing verification plane; the narrow Roadmap `06` disclosure work becomes
  an admitted dependency after Slice 2 rather than a reason to return Connect
  to the front of the queue.
- Configuration discoverability, desired intent, effective-value explanation,
  governed mutation, activation planning, and cross-surface settings parity
  are stable architecture. Project-state relocation is tracked by
  [#100](https://github.com/sequelcore/kiln/issues/100). Crash-recovery and
  authorized live validation are tracked separately by
  [#97](https://github.com/sequelcore/kiln/issues/97).

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

Every numbered file uses `NN-kebab-case-title.md` or
`NN.N-kebab-case-title.md`, matching H1, `Status`, `Execution`, and
`Created`/`Started`. A decimal track denotes an intentionally split adjacent
concern, not an implicit compatibility version. Required sections are
Objective, Ownership, Scope, Non-Goals, ordered slices, promotion gates,
verification, and completion criteria. Keep one bounded concern per slice. Do
not retain completed narrative that already belongs in architecture or release
history.

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
Closed issue [#103](https://github.com/sequelcore/kiln/issues/103) records the
supported source baseline. Issue
[#104](https://github.com/sequelcore/kiln/issues/104) owns the separately
blocked installable-candidate admission. Roadmap `00` completion does not admit
a release: the product decisions must become canonical and an exact committed
candidate must still satisfy `docs/operations/release.md`.
