# 05 - Native Operator Cockpit And Projection Performance

## Status

Deferred experimental roadmap.

Do not start this program before the completed plan/goal workflow-control
foundation has produced real high-density workloads, especially:

- effective turn authority
- model intelligence policy
- durable goal runs
- work-item materialization
- managed child invocations
- evidence-gated closeout
- dataset-ready authority/routing/tool traces
- stable config projection for local, cloud, team, CI, and project targets

This is a validation track, not a commitment to replace the web GUI.

This roadmap validates the high-density native cockpit and projection
performance layer that may grow after the native surface foundation and embedded
browser capability exist.

Performance is a version-1 design concern for every surface. This roadmap does
not postpone performance architecture. It owns the later proof that native
rendering, GPU paths, Rust/WASM/sidecar projection kernels, or specialized
cockpit layouts materially outperform the web GUI on approved high-density
operator workloads.

It must not become:

- a second runtime
- a scheduler
- a private session model
- a private memory model
- a private provider model
- a private policy model
- a replacement for the web GUI
- a Rust rewrite of Kiln
- an IDE/editor roadmap

## Canonical Placement

This file is the canonical roadmap for the deferred native cockpit and
projection-performance experiment.

Do not create a separate `03.5-pre-04.md` for Rust, parallelism, or simultaneous
session supervision.

Rust hot-path optimization and parallel-work supervision belong inside this
roadmap as experiment boundaries because they are only relevant once native
operator workloads exist and can be measured.

This roadmap depends on the completed plan/goal workflow-control foundation. It
does not supersede that canonical workflow doctrine.

It also does not own the focused real embedded browser work. That work now
lives in completed native/browser architecture:

- completed browser operator foundations in `docs/architecture/developer-tools.md`
  and `docs/guides/tool-use.md`
- completed native operator surface foundation in
  `docs/architecture/operator-surfaces.md`,
  `docs/architecture/runtime-surfaces.md`, and `@kilnai/native`
- completed embedded browser host capability in
  `docs/architecture/operator-surfaces.md`,
  `docs/architecture/developer-tools.md`, and `@kilnai/native`
- completed embedded browser operator product surface in
  `docs/architecture/operator-surfaces.md`,
  `docs/architecture/developer-tools.md`, and `@kilnai/native`

The native surface foundation and embedded browser host may use native shell
technology earlier than this broad high-density cockpit experiment. That does
not promote the whole cockpit or Rust/GPU projection program.

```text
completed plan/goal workflow-control foundation
  -> effective authority
  -> model intelligence policy
  -> goal runs
  -> work items
  -> managed invocation
  -> traces and evidence

05
  -> high-density supervision of those workloads
  -> multi-session and multi-instance cockpit validation
  -> optional Rust/GPU projection acceleration
```

## Sequel Standards Binding

This roadmap is governed by Sequel's non-negotiable standards:

- no dead code
- no redundancy
- no legacy compatibility hacks without real consumers
- no boilerplate that does not carry behavior or clarity
- prefer simple, explicit code over clever abstractions
- respect DDD, bounded contexts, dependency direction, and Clean Architecture
- validate inputs at boundaries
- fail closed for governance, authority, target, and policy decisions
- scout before broad or architecture-sensitive changes
- plan when work crosses boundaries or changes contracts
- use TDD for behavior changes when practical
- implement one bounded concern at a time
- run focused checks first, then broader gates
- surface blockers, tradeoffs, and architectural risks explicitly
- keep changes atomic
- avoid unrelated refactors
- do not mark complete until implementation and docs match canonical architecture
- findings before summaries
- treat missing tests, hidden coupling, boundary drift, unclear authority, and
  unclear target selection as real risks
- prefer clean deletion over compatibility layers when there are no real
  consumers

## Goal

Validate whether Kiln needs a native, GPU-accelerated operator surface for
high-density supervision workloads that exceed the practical comfort zone of the
web GUI.

The native surface would be a new operator projection over the same governed
runtime.

It would not replace `@kilnai/gui`, become an editor, import `@kilnai/core` or
`@kilnai/runtime` implementations directly, own session state, own memory,
resolve config, hold provider credentials, or introduce a second permission,
audit, replay, scheduling, or policy model.

The product thesis is:

> The web GUI provides universal access: a Kiln instance can run on a local
> machine, VPS, team server, or CI environment and be reached from any browser.
> A native surface, if validated, provides a specialized high-density cockpit
> for local power users and operators while connecting to the same App Gateway
> or Operator Gateway instance. Every surface shares the same sessions, memory,
> config, providers, policies, audit trail, event history, and authority model.

The native surface exists only if it proves a measurable advantage for:

- simultaneous session supervision
- high-volume event replay
- dense managed-agent inspection
- multi-instance operational dashboards
- low-latency timeline navigation
- large tool-output and artifact projection
- fan-out/fan-in visualization
- high-frequency cancellation/approval/inspection workflows

## Product Thesis

Kiln should not become another agent chat UI or another editor.

Kiln's opportunity is a governed operator cockpit for agentic work:

```text
many sessions
many child invocations
many tools
many providers
many targets
many events
one runtime truth
one authority model
one audit trail
```

The native surface is justified only if the operator needs to supervise work at
a density where browser DOM, browser memory pressure, or browser interaction
latency becomes a practical bottleneck.

The problem is not "native feels nicer."

The problem is:

```text
Can an operator reliably supervise, replay, cancel, inspect, and compare many
agentic workflows at once without losing authority, target, lineage, evidence,
or trust?
```

## Market Signal

The market signal is not that users broadly demand native UI frameworks.

The stronger signal is that AI coding and agentic development usage are rising
while trust, review burden, multi-agent observability, and long-running workflow
control remain unresolved.

Relevant category signals:

- AI coding tools are becoming normal in developer workflows, but developers
  remain concerned about quality, context, review burden, privacy, security,
  and "almost-right" output.
- Editor-integrated agent systems are moving toward many agent threads,
  worktree isolation, per-thread model selection, and richer observability.
- Users lose trust when agent workflows feel slow, opaque, unstable, or
  impossible to inspect, even when the underlying models are strong.
- Multi-agent work creates a new operator need: dense evidence, lineage,
  cancellation, replay, cost visibility, tool-call inspection, partial success,
  and clear authority.

Kiln should not copy an editor.

Kiln should own the governed operator layer.

## Canonical Position

The native surface is a surface, not a runtime.

```text
local machine / VPS / team server / CI
  -> App Gateway or Operator Gateway
  -> shared runtime, memory, config, sessions, events, policy
  -> web GUI
  -> native operator surface
  -> IDE/editor extension
  -> CLI/TUI
  -> SDK/widget
```

The native surface consumes the same operator HTTP/WebSocket contracts as the
web GUI.

It may use Rust, WASM, native code, and GPU rendering internally, but those are
implementation details of presentation, replay, indexing, projection, and
interaction.

They are not control-plane boundaries.

## Core Boundary Rule

Runtime owns what is true.

Surface owns how truth is inspected.

```text
runtime owns:
  session identity
  goal-run scheduling
  work-item dependency readiness
  managed-agent lifecycle
  child invocation admission
  parallel execution semantics
  cancellation semantics
  pause/resume semantics
  authority admission
  tool admission
  provider routing
  provider credentials
  memory
  config projection
  replay truth
  audit
  cost
  safety policy
  tenant policy

surface owns:
  layout
  focus
  selected panel
  expanded rows
  visual density
  local draft text
  keyboard shortcuts
  presentation preferences
  scroll position
  replay cursor UI
  graph viewport
  timeline zoom
  filter state
```

If a behavior affects what happened, what is allowed, what can be replayed, who
owns a resource, what target an action applies to, or what policy applies, it
belongs in core/runtime and is projected to the native surface.

## Relationship to Parallel Work

Kiln may eventually run or supervise many concurrent units of work, but the
native surface must not define that concurrency.

There are three distinct concurrency shapes:

### 1. Single-session, multi-invocation work

One session or goal run contains many child invocations or work items.

Example:

```text
Goal Run: Refactor SafetyKernel
  ├─ Work Item 1 -> child agent: inspect safety docs
  ├─ Work Item 2 -> child agent: inspect tool authority
  ├─ Work Item 3 -> direct execution: patch core schema
  ├─ Work Item 4 -> waiting approval: run shell tests
  └─ Work Item 5 -> child agent: review residual risk
```

Runtime owns:

- work-item readiness
- dependency order
- fan-out/fan-in
- authority envelope
- child admission
- cancellation
- evidence gates
- closeout

Native surface owns:

- invocation tree view
- fan-out/fan-in visualization
- event filtering
- evidence inspection
- target clarity
- cancellation controls as projected runtime actions

### 2. Multi-session, single-instance work

One Kiln instance has many active or recently active sessions.

Example:

```text
Instance: Local / C:\Proyectos\Sequel\kiln
  ├─ Session: implement EffectiveTurnAuthority
  ├─ Session: inspect roadmap
  ├─ Session: run routing evals
  ├─ Session: review managed invocation failures
  └─ Session: export trace fixtures
```

Runtime owns:

- session identity
- session event streams
- active/paused/resolved state
- session authority
- cost and provider telemetry
- memory scope
- audit trail

Native surface owns:

- multi-session dashboard
- focus switching
- session grouping
- timeline previews
- compact cost/provider summaries
- attention indicators

### 3. Multi-instance, multi-session operation

One operator surface attaches to multiple Kiln instances.

Example:

```text
Target: Local / C:\Proyectos\Sequel\kiln
Target: Cloud / sequel-prod
Target: Team / staging
Target: CI / build-8421
```

Runtime/gateway owns:

- instance identity
- target-specific authority
- target-specific memory
- target-specific providers
- target-specific config
- target-specific audit

Native surface owns:

- explicit target selection
- visual instance boundaries
- mixed-dashboard labeling
- target-filtered commands
- cross-instance comparison layout

No operation may execute without a clear target.

## Parallel Work and Simultaneous Session Supervision

The native surface may optimize supervision of parallel work.

It must not implement parallel execution semantics.

The native surface may provide:

- simultaneous session dashboards
- multi-session event streams
- child invocation trees
- fan-out/fan-in progress views
- parallel timeline lanes
- per-session cost/provider summaries
- per-session authority status
- queue/blocked/waiting indicators
- operator focus management
- compact inspection panes
- replay cursor navigation
- cancellation buttons that call runtime APIs
- approval panels that call runtime APIs

The native surface must not provide:

- a private scheduler
- a private worker pool
- private session lifecycle rules
- private work-item readiness rules
- private managed-agent lifecycle rules
- private cancellation semantics
- private authority elevation semantics
- private provider routing
- private evidence gates
- private retry policies

If simultaneous sessions are not yet implemented as a mature web/GUI cockpit,
this roadmap must validate them as operator-projection capability, not assume
they already exist.

## Relationship to Rust Hot-Path Optimization

Rust may be used only for bounded hot paths where measurement shows real
pressure.

The canonical rule is:

> Rust should accelerate Kiln's evidence and projection plane, not fork Kiln's
> control plane.

Rust may be appropriate for:

- event replay indexing
- session/resource projection compaction
- invocation-tree projection
- timeline cursor maps
- trace normalization
- event coalescing
- event stream batching
- JSONL/export preparation
- large tool-output parsing
- artifact/diff preprocessing
- high-volume event codecs
- search/filter indexes over event streams
- graph layout preprocessing for invocation trees
- replay snapshot hashing
- redaction pipeline acceleration when policy remains in runtime
- WASM projection helpers shared by GUI/native when justified

Rust must not own:

- authority
- scheduling
- session lifecycle
- goal-run lifecycle
- work-item dependency readiness
- managed-agent lifecycle
- model routing
- provider credentials
- tool policy
- safety policy
- memory policy
- tenant policy
- config resolution
- audit truth
- evidence gates
- closeout semantics

## Rust Integration Options

Rust is an implementation option, not a roadmap requirement.

Acceptable integration shapes:

### Option A - WASM projection module

Use when the workload is pure projection/parsing and should be reusable by web
GUI and native surface.

Pros:

- portable
- usable by browser/native/runtime-adjacent clients
- good fit for deterministic parsing/projection
- lower deployment friction than native addons

Cons:

- limited IO
- memory constraints
- not always faster than optimized TypeScript for small workloads

### Option B - Sidecar projection service

Use when the workload is heavy, streaming, or benefits from process isolation.

Pros:

- clear boundary
- no Bun native-addon packaging complexity
- can scale independently
- works for local and remote operator gateways
- explicit runtime/surface separation

Cons:

- process management
- deployment complexity
- health monitoring required

### Option C - Native module / N-API package

Use only if measurement proves a tight in-process path is required.

Pros:

- direct integration
- fast IPC-free calls

Cons:

- platform builds
- CI complexity
- packaging complexity
- higher risk of hidden coupling

Default recommendation:

```text
WASM first for pure projection.
Sidecar when streaming or heavy replay requires it.
N-API only with strong evidence.
```

## Required Capabilities

The native surface must support:

- connecting to one or more Kiln instances through explicit attach targets
- rendering canonical session projections from gateway events
- rendering canonical invocation projections from gateway events
- rendering canonical memory, tool, cost, permission, and audit projections
- supervising many concurrent child invocations
- supervising multiple active sessions in one instance
- supervising multiple attached instances with explicit targets
- lifecycle timelines
- fan-out/fan-in progress
- DAG-shaped workflow inspection
- cancellation and partial-success state
- replay-heavy inspection
- large tool-call histories
- artifact and diff projections emitted by runtime
- event-stream backpressure
- high-volume event filtering
- search over event projections
- stable replay cursors
- instance boundary preservation
- workspace/project/config source display
- active provider route display
- effective authority display
- policy origin display
- target-aware cancellation
- target-aware replay
- target-aware resource opening
- measured comparison against web GUI

The native surface may not infer runtime facts from local files, provider
credentials, memory files, or project config.

It must consume projected runtime facts.

## Non-Goals

- Do not replace `@kilnai/gui` by default.
- Do not build a full editor.
- Do not duplicate Zed, Cursor, Windsurf, VS Code, or JetBrains IDE behavior.
- Do not implement LSP, full text editing, terminal emulation, Git UI, file
  trees, search, or inline code review unless a future IDE/editor-surface
  roadmap explicitly accepts that scope.
- Do not create native-only runtime semantics.
- Do not import `@kilnai/core` or `@kilnai/runtime` implementation code into the
  native surface.
- Do not let the native surface read provider credentials, memory files, project
  config, or harness config directly.
- Do not resolve global/project/team/cloud config inside the surface.
- Do not share credentials or memory across local and cloud instances
  implicitly.
- Do not promote local memory to team/cloud memory without runtime policy,
  provenance, and operator review.
- Do not implement scheduling in the native surface.
- Do not implement session concurrency semantics in the native surface.
- Do not implement managed-agent lifecycle semantics in the native surface.
- Do not implement cancellation semantics in the native surface.
- Do not implement authority admission in the native surface.
- Do not create Rust duplicates of TypeScript governance logic.
- Do not add Rust modules without measured bottlenecks.
- Do not add a compatibility layer for an abandoned native prototype.

## Surface Boundary

The native surface must obey the same surface ownership rules as GUI, CLI, TUI,
SDK, widget, IDE/editor, and remote surfaces.

```text
runtime owns:
  session identity
  memory
  provider routing
  permissions
  tool authority
  managed-agent lifecycle
  cancellation
  replay
  audit
  cost
  config projection
  safety policy
  tenant policy
  scheduler semantics
  work-item lifecycle
  goal-run lifecycle

surface owns:
  layout
  focus
  selected panel
  expanded rows
  visual density
  local draft text
  keyboard shortcuts
  presentation preferences
  display density
  local window state
```

Any ambiguity defaults to runtime ownership.

## Multi-Instance Model

The native surface may attach to multiple Kiln instances at once, but every
operation must have an explicit target.

Examples:

```text
Target: Local / C:\Proyectos\Sequel\kiln
Target: Cloud / sequel-prod
Target: Team / staging
Target: CI / build-8421
```

Rules:

- every instance has an `instanceId`
- every session has an `instanceId`
- every memory resource has an owning instance and scope
- every provider route and credential lease belongs to one instance
- every action requires a selected target or a target encoded in the selected
  resource
- cross-instance transfer is a policy-governed action, not drag-and-drop state
  mutation
- local filesystem authority never leaks into cloud/team/CI instances
- cloud/team permission profiles never apply to local work by accident
- mixed-instance dashboards must be visually explicit
- instance labels must remain visible in dense layouts
- keyboard shortcuts that execute actions must be target-aware
- destructive actions must require target confirmation when multiple instances
  are attached

This model lets an operator supervise local and remote work from one surface
without creating a hidden global state space.

## Multi-Session Model

The native surface may display multiple sessions from one instance
simultaneously.

Rules:

- every visible session must preserve its session id
- every visible event must preserve its session id
- every visible tool call must preserve its session id and turn id
- every visible child invocation must preserve parent session and goal/work item
  linkage
- every action must be scoped to one selected session, resource, or invocation
- cross-session copy, replay, handoff, and promotion require explicit runtime
  policy
- local UI focus must not imply runtime authority
- switching focus must not mutate active runtime state
- background sessions must not auto-approve or auto-execute actions through the
  surface
- cancellation from a dashboard must identify the session, goal/work item, and
  invocation target

The surface may show many sessions.

Runtime still owns session truth.

## Relationship to the Web GUI

The web GUI remains the default rich operator surface because it provides:

- universal browser access
- VPS and remote deployment reach
- fast product iteration
- straightforward accessibility enforcement
- easier testing and onboarding
- attach mode for existing App Gateway instances
- stable surface for non-power-user workflows

The native surface, if validated, is a specialized power-user surface for
workloads where native rendering, GPU pipelines, Rust-assisted projection, or
process-level isolation can materially outperform the browser implementation.

Candidate workloads:

- 10 or more active sessions in one dashboard
- 25-50 or more concurrent child invocations
- 100k or more lifecycle events in a replayable session
- 100k or more lifecycle events across a multi-session dashboard
- dense timeline and graph inspection
- heavy telemetry and tool-call streams
- large artifact and diff-review projections
- multi-instance operational dashboards
- event replay with low-latency cursor navigation
- fan-out/fan-in inspection under high event volume

The native surface can be abandoned without deleting the web GUI or changing
runtime semantics.

If it repeatedly wins against the web GUI on measured real workloads, a later
ADR may promote it to a first-class power-user surface. That promotion still
must not remove the web GUI's remote-access role.

## Relationship to Native Surface Foundation

The completed native operator surface foundation owns the accepted
`@kilnai/native` stack and gateway-only boundary. This roadmap owns the later
cockpit and projection-performance proof.

The native surface foundation is not a wrapper decision. It establishes a
first-class local operator surface. This roadmap validates whether that surface
should grow into a specialized high-density cockpit for:

- high-density rendering
- low-latency interaction over very large event sets
- custom timeline/graph views
- replay-heavy visual debugging
- multi-agent supervision at scale
- simultaneous session dashboards
- multi-instance dashboards
- Rust/WASM/sidecar projection acceleration

Every option must consume the same gateway/operator contracts.

No option may introduce a private runtime.

## Relationship to IDE and Editor Surfaces

The native surface is not the answer to code editing.

When users need inline diffs, navigation, code review, LSP context, editor
selection, or file-local review, Kiln should integrate with existing editors and
IDEs through a dedicated IDE/editor surface.

That surface should also be a client of Kiln gateway and/or MCP contracts.

The native surface may inspect changed files and render diff projections when
the runtime emits them, but it must not become the primary code editor.

## Architecture Dependencies

This roadmap depends on:

- `docs/architecture/operator-surfaces.md`
  Defines one runtime with many replaceable operator projections.
- `docs/architecture/runtime-surfaces.md`
  Defines App Gateway, Operator Gateway, GUI, CLI, TUI, SDK/widget, and MCP
  ownership boundaries.
- `docs/architecture/context-resource-plane.md`
  Defines high-volume resource projection and resource-link patterns that the
  native surface should consume rather than bypass.
- `docs/architecture/shared-tooling-intelligence.md`
  Defines structured tool outputs, task state, monitors, resource links, and
  consumer projection.
- `docs/architecture/developer-tools.md`
  Defines builtin developer-tool metadata and shared presentation contracts.
- `docs/architecture/session-model.md`
  Defines provider-agnostic session identity and provider-thread metadata.
- `docs/architecture/tool-execution.md`
  Defines tool authority and execution evidence.
- `docs/architecture/memory.md`
  Defines governed memory lifecycle, scope, provenance, projection, and
  retention.
- `docs/guides/memory.md`
  Defines operator-facing memory behavior.
- `docs/architecture/managed-agents.md`
  Defines managed invocation lifecycle, authority, replay, handoff, and live
  adapter evidence.
- `docs/architecture/config-projection.md`
  Provides config projection and drift-aware runtime configuration so local,
  cloud, team, CI, GUI, native, CLI, and IDE surfaces do not invent separate
  config truth.
- `docs/architecture/work-governance.md`, `docs/guides/plan-mode.md`, and
  `docs/architecture/managed-agents.md`
  Provide goal runs, work items, effective authority, model intelligence
  policy, managed delegation, evidence gates, and dataset-ready traces required
  before native high-density supervision can be evaluated.

## Initial MVP

1. Define a native surface contract document that restates the operator
   gateway-only boundary, multi-session rules, multi-instance target rules, and
   Rust hot-path constraints.
2. Build a prototype that attaches to one local Operator Gateway and one remote
   App Gateway in read-only mode.
3. Render from canonical events only:
   - session list
   - active session timeline
   - simultaneous session dashboard
   - child-invocation lifecycle events
   - invocation tree
   - tool-call summaries
   - cost/provider metadata
   - authority status
   - evidence status
4. Render a synthetic single-session managed-agent workload with:
   - at least 50 child invocations
   - at least 100k lifecycle events
   - fan-out/fan-in progress
   - replay cursor navigation
5. Render a synthetic simultaneous-session workload with:
   - at least 10 active sessions in one instance
   - at least 3 sessions with active managed child invocations
   - at least 50 total child invocations across all visible sessions
   - at least 100k lifecycle events across the dashboard
   - visible target/session boundaries under dense layout
6. Compare latency, memory usage, event ingestion, scroll/zoom responsiveness,
   replay cursor responsiveness, filter latency, and interaction latency
   against the web GUI using the same workloads.
7. Add explicit target selection and instance labeling before any mutating
   action is allowed.
8. Allow only safe runtime actions in MVP:
   - inspect
   - replay
   - cancel
   - open resource links
   - focus session
   - filter events
9. Exclude from MVP:
   - write approvals
   - memory promotion
   - config mutation
   - cross-instance transfer
   - private scheduling
   - native-side tool execution
   - native-side provider routing

## Rust Experiment MVP

Only start this sub-experiment if the initial MVP demonstrates a measured
bottleneck in projection, replay, parsing, indexing, or stream processing.

Deliverables:

- benchmark report identifying the bottleneck
- bounded Rust/WASM/sidecar design note
- explicit boundary statement
- minimal hot-path module
- TypeScript fallback or deletion plan
- tests against canonical event fixtures
- no duplicated governance logic

Candidate first module:

```text
session-event projection kernel
```

Input:

```text
canonical session events
```

Output:

```text
timeline projection
invocation tree projection
session summary projection
replay cursor map
cost/provider summary projection
```

Forbidden outputs:

```text
authority decisions
routing decisions
tool admission decisions
memory mutation decisions
goal/work-item lifecycle decisions
provider credential decisions
tenant policy decisions
```

## Verification Gates

- The native surface starts with zero access to core/runtime implementation
  modules.
- All runtime facts come from gateway/operator contracts.
- A session reload preserves the same view from canonical events.
- Multi-session dashboards cannot issue an action without clear session target.
- Multi-instance dashboards cannot issue an action without clear instance target.
- Cross-instance transfer is unavailable or policy-gated in MVP.
- Provider credentials are never exposed to the native process except through
  gateway-mediated capability status.
- Local and cloud/team memory scopes remain separate unless a governed transfer
  action is explicitly implemented.
- The native surface demonstrates a measured advantage over the web GUI on at
  least one approved high-density workload before promotion is considered.
- Rust/WASM/sidecar modules demonstrate measured advantage over TypeScript on an
  approved hot path before adoption is considered.
- Rust/WASM/sidecar modules do not duplicate governance logic.
- Cancellation, approval, and target actions are always gateway-mediated.
- No native-side scheduler exists.
- No native-side session lifecycle exists.
- No native-side managed-agent lifecycle exists.
- No native-side authority resolver exists.
- No native-side provider router exists.
- No native-side memory policy exists.
- No native-side config resolver exists.

## Benchmark Requirements

Benchmarks must compare web GUI and native surface on the same canonical event
fixtures.

Required benchmark shapes:

### Single-session heavy workload

- 1 session
- 1 goal run
- 50 or more child invocations
- 100k or more lifecycle events
- large tool-output history
- fan-out/fan-in timeline
- cancellation target selection
- replay cursor navigation

### Multi-session workload

- 10 or more active sessions
- 3 or more sessions with active child invocations
- 50 or more total child invocations
- 100k or more total lifecycle events
- simultaneous timeline previews
- target/session clarity under dense display
- focus switching
- filter latency
- memory usage measurement

### Multi-instance workload

- 2 or more attached instances
- 1 local instance
- 1 remote or simulated remote instance
- visually explicit instance boundaries
- target-aware actions
- no cross-instance implicit state mutation

### Projection hot-path workload

- canonical event fixture
- TypeScript projection baseline
- Rust/WASM/sidecar candidate
- identical output assertion
- cold start measurement
- warm path measurement
- memory usage measurement
- error behavior measurement

Benchmark reports must include:

- fixture source
- event counts
- session counts
- invocation counts
- machine/environment
- web GUI result
- native surface result
- Rust/native module result if applicable
- failure modes
- operator-visible tradeoffs
- recommendation

## Promotion Criteria

A later ADR may promote the native surface only if all are true:

- Plan/goal workflow control is implemented enough to generate real
  high-density goal/work-item/managed-invocation workloads.
- The web GUI remains the default universal surface.
- Native surface demonstrates measured superiority on approved workloads.
- Gateway/operator contracts remain the only runtime interface.
- Multi-instance and multi-session target safety is proven.
- No private runtime semantics were introduced.
- Accessibility and keyboard support meet a defined operator baseline.
- Maintenance burden is justified by measured operator value.
- Rust/WASM/sidecar modules, if used, are bounded and testable.
- Canonical docs are updated to reflect promoted behavior.

## Failure Criteria

Abandon or pause the experiment if:

- native performance does not materially beat the web GUI on approved workloads
- the prototype requires private runtime imports
- the prototype creates hidden session state
- the prototype creates hidden target state
- the prototype duplicates scheduler/session/authority logic
- Rust modules duplicate governance behavior
- multi-instance target clarity is unreliable
- multi-session target clarity is unreliable
- cancellation or approval actions can target the wrong session or instance
- the maintenance burden exceeds measured operator value
- the surface starts drifting toward editor scope
- web GUI improvements solve the measured bottleneck first

Abandonment should delete or archive the prototype cleanly. Do not preserve
compatibility layers for a failed experiment without real consumers.

## Implementation Order

### Phase 0 - Precondition Review

Confirm:

- Plan/goal workflow control has produced real or synthetic high-density
  workloads
- config projection is stable enough for local/cloud/team/CI targets
- gateway/operator contracts expose required event streams
- GUI baseline benchmarks exist
- managed invocation lifecycle events are sufficiently rich
- authority and provider route projections exist
- cancellation target semantics are gateway-mediated

### Phase 1 - Contract-Only Design

Deliver:

- native surface boundary document
- multi-session supervision contract
- multi-instance target contract
- Rust hot-path boundary contract
- benchmark fixture definitions
- no implementation yet

### Phase 2 - Read-Only Prototype

Deliver:

- attach to local Operator Gateway
- attach to remote App Gateway or simulated remote
- render sessions
- render timelines
- render invocation trees
- render tool summaries
- render cost/provider/authority metadata
- no mutating actions except safe replay/focus
- no Rust unless Phase 2 benchmarks justify it

### Phase 3 - Benchmark and Compare

Deliver:

- web GUI benchmark
- native prototype benchmark
- bottleneck report
- target clarity report
- memory and interaction-latency report
- recommendation:
  - abandon
  - continue native without Rust
  - continue native with bounded Rust/WASM/sidecar projection kernel
  - improve web GUI instead

### Phase 4 - Bounded Rust Projection Experiment

Only if Phase 3 justifies it.

Deliver:

- one hot-path module
- identical-output tests against TypeScript baseline
- failure behavior tests
- packaging/deployment review
- deletion plan if not adopted

### Phase 5 - ADR Decision

Deliver:

- promote
- defer
- abandon
- keep only the native surface foundation and embedded browser capability
- keep as internal diagnostic prototype

## Open Questions

These must be answered before implementation:

- Which real high-density workload is the native surface solving?
- Is the bottleneck rendering, event ingestion, replay projection, graph layout,
  memory pressure, or operator cognition?
- Can the web GUI solve the bottleneck with virtualization, batching, resource
  projection, or event coalescing first?
- What simultaneous-session workload is considered realistic?
- How many active sessions should a power-user cockpit support?
- How many child invocations should be visible at once?
- Which actions are allowed from a multi-session dashboard?
- Which actions are allowed from a multi-instance dashboard?
- How should target confirmation work when multiple instances are attached?
- What is the minimum accessibility baseline for a native cockpit?
- What is the maintenance budget for a native surface?
- What Rust integration shape is acceptable if measurement justifies it?
- Should Rust modules be reusable by the web GUI through WASM?
- How will native surface benchmarks be kept stable over time?
- What is the deletion plan if the experiment fails?

## Documentation Requirements

If this roadmap advances beyond design, update canonical docs:

- `docs/architecture/operator-surfaces.md`
- `docs/architecture/runtime-surfaces.md`
- `docs/architecture/context-resource-plane.md`
- `docs/architecture/session-model.md`
- `docs/architecture/tool-execution.md`
- `docs/architecture/managed-agents.md`
- `docs/architecture/config-projection.md`
- `docs/architecture/work-governance.md` if goal/work-item projection changes
- `docs/architecture/invariants.md` if new surface-boundary invariants are added
- `docs/roadmap/README.md`
- `docs/changelog.md`

If Rust/WASM/sidecar modules are adopted, add a canonical ADR:

```text
docs/adr/0xx-rust-projection-kernel.md
```

That ADR must include:

- problem statement
- measured bottleneck
- rejected TypeScript/browser alternatives
- boundary statement
- module responsibility
- forbidden responsibilities
- integration shape
- packaging implications
- test strategy
- deletion/rollback plan

No roadmap slice is complete until code, tests, benchmarks, and docs agree.

## Final Documentation Standard

Documentation must remain:

- canonical
- implementation-aligned
- professional
- non-duplicative
- explicit about runtime ownership
- explicit about surface ownership
- explicit about target selection
- explicit about multi-session boundaries
- explicit about Rust boundaries
- explicit about what is implemented versus experimental
- explicit about failure criteria

Do not leave roadmap language claiming validated native superiority before
benchmarks prove it.

Do not leave Rust optimization claims in docs without measured evidence.

Do not let native-surface docs contradict the web GUI's default role.

Do not let native-surface docs imply runtime ownership.
