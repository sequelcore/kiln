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
| 1 | [12 - Configuration Experience](12-configuration-experience.md) | In progress | Urgent | Execute Slice 7: replace raw target-material JSON with the guided Available Models target wizard. |
| 2 | [08 - Kiln Connect Pairing And Sessions](08-remote-operator-pairing.md) | Ready | Urgent | Define the threat model, scope matrix, pairing state machine, and portable negative contract fixtures. |
| 3 | [08.5 - Kiln Connect Remote Connectivity](08.5-remote-operator-connectivity.md) | Ready | Urgent | Independently bind the GUI gateway to loopback, replace wildcard CORS, and inventory HTTP/WebSocket route scopes. |
| 4 | [06 - Prompt Governance Plane](06-prompt-governance-plane.md) | Research | Normal | Define the versioned prompt-component inventory, evaluation fixtures, and promotion thresholds, then run component-removal ablations after higher-priority Ready work. |
| 5 | [07 - Stack Governance Plane](07-stack-governance-plane.md) | Research | Normal | Define read-only fixtures and the typed stack-policy contract. |
| 6 | [09 - Rust Optimization Guardrail](09-rust-optimization-guardrail.md) | Guardrail | Conditional | Admit no implementation without a module-specific ADR and parity benchmark. |
| 7 | [11 - Capability Fabric](11-capability-fabric.md) | Research | Normal | Implement read-only discovery adapters over the completed canonical catalog. |
| 8 | [08.75 - Inbound Agent Workers](08.75-inbound-agent-workers.md) | Research | Deferred | Land the bounded verification surface as locally useful work; inbound slices wait on `08` identity. |
| 9 | [10 - Native Operator Surface](10-native-operator-surface.md) | Deferred | Deferred | Reassess the product need only after every other executable roadmap track is closed. |

## Dependency Rules

- `06` decides how admitted instructions and skill content enter provider prompts and become replayable evidence.
- `07` owns desired stack policy and drift evidence; skills may consume its result but never own versions.
- `08` owns `Kiln Connect` pairing, device identity, authenticated operator
  sessions, scopes, expiry, and revocation.
- `08.5` owns loopback exposure, operator-owned transport adapters, endpoint
  evidence, connector lifecycle, and reconnection. Its Slice 0 is independently
  admissible safety work; later slices consume `08` session identity, and
  configuration-bearing slices consume `12` effective-state and governed-
  mutation contracts.
- The 2026-08-14 operator decision removed `07` as a prerequisite for `08`. The
  2026-08-20 operator priority decision supersedes its queue priority: execute
  `12` through the first safe-turn-without-YAML vertical proof, then reassess
  Connect sequencing. This is product sequencing, not a transfer of bounded-
  context ownership. Roadmap `08.5` Slice 0 remains independently admissible
  safety hardening, but is not the default product task. Neither Connect track
  admits a Kiln-hosted cloud; a managed relay requires a separate future
  decision.
- `08.75` owns inbound agents Kiln did not launch: their identity, bounded
  verification surface, lease-scoped sandboxes, and settlement. It consumes `08`
  identity and `08.5` transport and widens neither. An agent identity never
  becomes an operator identity. Its Slice 1 verification surface is
  independently useful to local and outbound delegates, so it is admissible
  before the inbound premise resolves.
- `09` is a decision boundary, not queued implementation.
- `10` is the final roadmap track. It owns the future native-surface product
  decision and is not admissible until every other executable roadmap track is
  closed by completion, rejection, or removal. No native implementation or
  native-only runtime contract is retained while it is deferred.
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
Release work starts only after those product decisions are canonical and the
exact committed candidate satisfies `docs/operations/release.md`.
