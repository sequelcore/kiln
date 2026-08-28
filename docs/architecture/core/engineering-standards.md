# Engineering Standards

The global `sequel-engineering` instruction profile is the canonical owner of
Sequel-wide engineering doctrine. This document owns Kiln-specific application
of that doctrine and the repository facts and contracts that other Sequel
projects must not inherit. `AGENTS.md` is project/team-owned repository
guidance. A project-owned `CLAUDE.md` may import `@AGENTS.md` and add only genuine
Claude-specific deltas; OpenCode consumes `AGENTS.md` natively. Kiln-generated
native files remain opt-in projections and never replace repository ownership.

## Source Of Truth

- Universal Sequel doctrine lives in `~/.kiln/instructions/sequel-engineering.md`.
- Kiln architecture and repository-specific standards live in `docs/architecture/`.
- Guides explain usage; they do not create doctrine.
- Research explains rationale; it does not override contracts.
- Project-owned `AGENTS.md` is durable repository guidance; an optional
  project-owned `CLAUDE.md` may import it and add genuine Claude-specific
  deltas.
- Global native instruction files and private workflow snapshots are generated
  projections, never durable owners or repository guidance.

## Content Ownership

Classify context before placing or projecting it:

- **Project context** — non-derivable reviewed project notes belong in the
  private project-context owner when they are not shared repository guidance.
  Derived repository evidence such as manifests, scripts, workspace metadata,
  and generated facts stays with its executable or source owner. Intentional
  shared guidance belongs in project-owned `AGENTS.md`; a project-owned `CLAUDE.md` may
  import it and add genuine Claude-specific deltas.
- **Global preference/doctrine** — operator or team defaults belong in a
  global or private-project instruction profile, not in repository guidance by
  accident.
- **Runtime config** — provider, model, routing, workers, depth, permissions,
  sandbox, and MCP credentials belong in canonical configuration, never prose.
- **Procedure/skill** — reusable procedures belong in skills; guidance may
  reference a skill but must not duplicate its workflow.
- **Executable enforcement** — hard policy belongs in schemas, runtime, tools,
  hooks, or tests. Prose explains policy but does not enforce it.
- **Derived/redundant cache** — generated snapshots, indexes, status, and
  workflow evidence are disposable projections with no authority.

Private or global material must not leak into repository guidance. In
particular, runtime route details, operator paths, credentials, and local
permission or sandbox posture stay out of `AGENTS.md` and `CLAUDE.md`.

Global native instruction projections are opt-in managed renderings of neutral
doctrine. The private workflow snapshot is likewise a generated projection for
private consumers; neither is repository guidance or an authority source.

The `agent-context-doctor` skill diagnoses ownership, classification, leakage,
and proposed diffs. Existing repository guidance is project-owned by default;
Kiln never routinely regenerates or overwrites it.

## Consumer Surface

The `@kilnai/*` packages are published, but Kiln has no external consumers. The
operator is the only one, confirmed 2026-08-01. Publication is distribution, not
a compatibility obligation.

This is a load-bearing fact, not a footnote. The standing rule against
compatibility paths "without real consumers" therefore applies at full strength
everywhere in this repository:

- Replace a contract outright instead of adding a compatible variant beside it.
- Rename and change public types freely. Delete the old path in the same change.
- Do not propose deprecation windows, `@deprecated` markers, version unions kept
  "for safety", or dual-path support for hypothetical callers.
- A published version number is not a reason to preserve anything.

One boundary survives: the operator's durable local state under `~/.kiln/` —
global config, private project bindings, Agent Task records, SQLite authorities,
credentials, and projections. Project state lives under
`~/.kiln/projects/<krp_sha256>/`; a repository-local `.kiln/` tree is not a
supported state owner. That data exists on a real machine, so a schema change
needs either a forward migration or an explicit recorded decision to discard
it. That is data migration, and it is decided per change by the operator; it is
never a reason to retain an API compatibility layer.

Reset is an admitted outcome. When local state has no future-useful evidence,
discarding it is preferred over carrying readers that exist only to parse it.

## Architecture

- Respect bounded contexts. Cross-context work flows through explicit ports,
  adapters, DTOs, or events.
- Domain and core contracts do not import runtime, GUI, TUI, CLI, or provider
  infrastructure.
- Runtime owns execution policy, session state, event emission, and adapter
  invocation. Operator surfaces project runtime evidence; they do not re-create
  runtime policy.
- Provider/model catalog discovery is evidence, not authority. Runtime and
  operator surfaces must consume canonical eligibility decisions instead of
  deriving local selectability from model arrays, provider availability, stale
  caches, or static display metadata.
- Surface parity is implemented through shared contracts. GUI, TUI, CLI,
  widget, SDK, and future surfaces should attach to common runtime ports instead
  of duplicating per-surface executors.
- Bun/TypeScript owns Kiln control-plane semantics. Native helpers, Rust, WASM,
  or sidecars may only accelerate measured hot paths or provide OS capability
  behind explicit TypeScript-owned ports.
- Safety is fail-closed unless the owning architecture document explicitly
  defines a fail-open exception.

## Evidence And Authority

- Measurement is evidence. It never confers or revokes authority by itself. A
  law, an operator policy, or a declared release rule may use evidence to confer
  or withhold authority; a benchmark result may not become that rule silently.
- The operator configures routes, models, and providers. A Kiln measurement
  reports what was observed on a route and never removes a route from the
  operator's selector.
- Where evidence does condition something, it conditions the privilege or the
  deployment profile, not the model. A configuration unqualified for production
  writes may still be admitted for read-only work, a sandbox, or a supervised
  run. Withdrawing a model from every purpose because it lacks evidence for one
  is disproportionate and usually wrong.
- Evidence covers the configuration it was produced against: model version,
  scaffold, tools, permissions, environment, and task class. A result attached
  to a bare model name overstates its own scope, and a model, prompt, tool,
  permission, or retrieval change invalidates or narrows it.
- Keep `unmeasured`, `failed`, `stale`, and `incompatible` distinct. Collapsing
  them into "did not pass" treats an untested new model as equivalent to one
  that demonstrably failed, and treats a missing capability as a competence
  judgment.
- A gate declares its protected action, required evidence, threshold, and
  expiry before the result is observed. A threshold chosen after seeing the
  number is not a gate.
- An authorized risk owner may override a gate. Record the scope and expiry of
  that override, and who accepted the residual risk. Only a legal or
  nondelegable rule forecloses the override entirely.
- Passing a gate grants nothing beyond the privilege it names. Least privilege,
  sandboxing, approval boundaries, and rollback remain in force, because a
  measurement predicts behavior and does not constrain it.

## Native Acceleration Boundary

- Rust, WASM, and sidecars must consume and produce canonical contract-shaped
  data. They must not define private schemas, private operator state, or
  surface-specific runtime semantics.
- Native acceleration must be replaceable by the TypeScript implementation
  without changing runtime behavior, operator authority, or cross-surface
  contracts.
- Native code must not own authority decisions, provider/model routing, tool
  admission, memory/config mutation, managed-agent policy, approval lifecycle,
  work-item lifecycle, or closeout semantics.
- Any native candidate needs an approved roadmap or ADR, documented
  TypeScript-owned port contract, parity fixtures, deterministic ordering,
  failure semantics, material benchmark evidence, tests, typecheck, and review.

## Ports And Events

- Cross-boundary callbacks must be named ports when they represent stable
  behavior. Prefer an interface such as `SessionEventSink.publish(...)` over an
  anonymous callback property.
- Event producers emit canonical events. Surfaces translate those events into
  presentation frames through projection helpers.
- Event sinks must compose without replacing existing sinks unless replacement
  is the documented behavior.
- A model-callable tool must not grant itself authority. Authority comes from
  runtime policy, configured routes, and approval gates.

## Shared Capacity

- Capacity follows authoritative settlement, not terminal projection. Timeout,
  cancellation, or surface state must not free work whose execution may still
  be active.
- Shared capacity has one durable owner outside ephemeral catalogs, adapter
  factories, and request objects.
- Unknown external work remains capacity-consuming and explicit in recovery
  evidence. A liveness timer must not fabricate settlement.
- Selection policy belongs to Core; adapters report capability and settlement
  but do not select accounts, rotate credentials, or release leases.
- Recovery policy follows workload semantics. Reusing a store engine does not
  authorize reusing another workload's stale-owner cleanup behavior.

## Runtime Diagnostics And Terminal Output

- Runtime state must use canonical events or evidence contracts. Do not print a
  warning for a recoverable state that is already represented by an event such
  as `cost_update`.
- Provider billing defaults have one owner in the direct-provider execution
  profiles. Routing, cost tracking, wrappers, and operator surfaces consume
  that policy instead of maintaining provider-name conditionals.
- Runtime traces are structured records containing observation time, severity,
  trace identity, component, message, and attributes. Trace producers write
  through a sink; they do not call the global `console`.
- Process-backed sinks emit one complete record per write, use the platform
  line ending, send routine information to stdout, and send warnings or errors
  to stderr. JSON mode is JSON Lines, not JSON embedded in human prose.
- Normal operator commands show actionable status rather than internal
  per-request traces. Diagnostic verbosity is explicit and must not change
  runtime behavior.
- CLI commands own their human-facing startup, warning, and failure prose
  through an output adapter so tests and embedding surfaces do not have to
  intercept global process state.

## Tests And Verification

- Behavior changes need focused tests at the owning boundary.
- Test fixtures must be synthetic, portable, and limited to the behavior under
  test. Never persist operator-specific paths, usernames, home directories,
  credentials, tokens, or raw incident payloads. Use temporary directories for
  filesystem behavior and generic OS-specific paths only when path syntax is
  part of the contract.
- Do not paste user-supplied bug text verbatim into a regression test unless
  the exact literal is the contract. Preserve the smallest sanitized value
  that still reproduces the failure.
- Shared surface behavior needs at least one non-primary surface test so parity
  is protected.
- Classify tests by resource ownership. Isolated tests may use bounded file
  parallelism. Tests that mutate process state, exercise real subprocesses, or
  share filesystem, port, database, or repository resources must run in an
  explicit sequential lane or integration project after isolated tests complete.
- A test names the bounded context it exercises. When a workspace package
  publishes bounded-context subpaths, import the context, never the package root
  barrel: the root barrel re-exports every context and costs seconds of
  module-graph instantiation per test file, because Vitest gives each file a
  fresh module registry. `scripts/workspace-import-boundaries.test.ts` enforces
  this and derives the rule from each package's exports map.
- Package tests resolve workspace dependencies through the exports map, which
  points at compiled output. Compilation is an explicit prerequisite of the test
  lanes, not a side effect of typechecking.
- Test sources are typechecked. Package build configs cover `src` only, so each
  package admits its suites through a `tsconfig.test.json` wired into
  `typecheck:tests`. A package joins that gate once its suites compile clean and
  never leaves it; the gate ratchets forward one package at a time and never
  carries a tolerated-error baseline. Until a package is admitted, its tests can
  assert against shapes the production types no longer have.
- A test's observable contract is the set of failures it can detect. Changes made
  to satisfy a compiler, a linter, or a refactor must not shrink that set. Never
  select a value by a predicate and then assert that predicate: it restates the
  search and cannot fail. Where positional access carried an ordering guarantee,
  keep it positional and guard it with a length assertion rather than replacing it
  with a search. Loosening an assertion — an existence check in place of an
  equality check, a partial match in place of a whole-value match — is a behavior
  change to the test and needs the same justification as any other.
- Prove an assertion still detects what it claims by breaking its subject and
  confirming the test fails. A suite that passes both before and after its input
  is invalidated asserts nothing, and compiling clean does not reveal that.
- Keep package worker limits proportional to available CPUs and validate them
  with repeated full-suite measurements. Do not disable isolation or increase
  timeouts to conceal shared state, leaked resources, or accidental integration
  work in unit tests.
- CLI package tests must be deterministic and diagnosable in the canonical
  workspace command. Keep the CLI suite single-worker while its process-global
  and subprocess-heavy tests cannot pass repeated parallel runs. Emit a progress
  reporter under workspace filters and bound test, hook, and teardown stalls at
  the package config boundary.
- CLI tests must stay hermetic by default. Do not depend on live credentials,
  installed native harnesses, operator-local state, broad skips, or sleep-based
  stabilization unless the test is explicitly marked live and excluded from
  default package verification.
- Before claiming done, run the relevant typecheck and test suites documented in
  `CLAUDE.md`.
- Documentation changes must preserve the modular architecture hierarchy.
