# 07 - Native Operator Surface Experiment

## Status

Deferred experimental roadmap.

Do not start this program before `03-managed-agents-cross-provider-subagents.md`
creates real high-concurrency operator workloads and before
`04-config-projection-unification.md` defines how local, cloud, team, CI, and
project configuration are projected into a stable runtime view.

This is a validation track, not a commitment to replace the web GUI.

## Goal

Validate whether Kiln needs a native, GPU-accelerated operator surface for
high-density supervision workloads that exceed the practical comfort zone of
the web GUI.

The native surface would be a new operator projection over the same governed
runtime. It would not replace `@kilnai/gui`, become an editor, import
`@kilnai/core` or `@kilnai/runtime` implementations directly, or introduce a
second session, memory, config, provider, permission, audit, or policy model.

The product thesis is:

> The web GUI provides universal access: a Kiln instance can run on a local
> machine, VPS, team server, or CI environment and be reached from any browser.
> A native surface, if validated, provides a specialized high-density cockpit
> for local power users while connecting to the same App Gateway or Operator
> Gateway instance. Every surface shares the same sessions, memory, config,
> providers, policies, audit trail, and event history.

## Market Signal

The market signal is not that users broadly demand native UI frameworks. The
stronger signal is that AI coding usage is rising while trust, review burden,
and multi-agent observability remain unresolved.

- Stack Overflow's 2025 Developer Survey reports broad AI adoption intent
  while developer trust in AI output remains low. It also identifies
  "almost-right" AI output and time-consuming debugging as major frustrations.
- JetBrains' 2025 developer ecosystem research reports that AI tools are
  becoming normal in development, but developers remain concerned about
  inconsistent generated-code quality, limited understanding of complex logic,
  privacy/security, and missing context.
- Zed's 2026 agent work demonstrates a category direction: many agent threads
  in one window, worktree isolation, per-thread agent selection, and agent
  observability inside a fast editor surface.
- Zed's public agent metrics show that users are already running large numbers
  of agent sessions and turns through editor-integrated agent surfaces. The
  important lesson for Kiln is not that Kiln should become an editor; it is
  that multi-agent work creates a new need for dense, trustworthy operator
  evidence.
- Cursor and Windsurf user reports show the opposite failure mode: when agent
  workflows feel slow, opaque, or unstable, users lose trust even when the
  models are strong.

Kiln's opportunity is therefore a governed operator surface for agent work:
clear lineage, permissions, diffs, costs, memory evidence, replay, cancellation,
partial success, and cross-provider visibility.

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
```

The native surface consumes the same operator HTTP/WebSocket contract as the
web GUI. It may use Rust and a GPU rendering stack internally, but that is an
implementation detail of presentation and interaction, not a control-plane
boundary.

## Required Capabilities

- Connect to one or more Kiln instances through explicit attach targets.
- Render canonical session, invocation, memory, tool, cost, permission, and
  audit projections from gateway events.
- Support high-density views for managed-agent workloads:
  - many concurrent child invocations
  - lifecycle timelines
  - fan-out/fan-in progress
  - DAG-shaped workflow inspection
  - cancellation and partial-success state
  - replay-heavy inspection
  - large tool-call and artifact histories
- Preserve instance boundaries for local, cloud, team, and CI targets.
- Show the active instance, workspace, project, config source, memory scope,
  provider route, permission profile, and policy origin before any action.
- Treat cross-instance copy, handoff, promotion, or replay as explicit actions
  governed by runtime policy and audit.
- Provide measured comparison against the web GUI with virtualization,
  batching, event coalescing, and backpressure enabled.

## Non-Goals

- Do not replace `@kilnai/gui` by default.
- Do not build a full editor.
- Do not duplicate Zed, Cursor, Windsurf, VS Code, or JetBrains IDE behavior.
- Do not implement LSP, full text editing, terminal emulation, Git UI, file
  trees, search, or inline code review unless a future IDE/editor-surface
  roadmap explicitly accepts that scope.
- Do not create native-only runtime semantics.
- Do not import `@kilnai/core` or `@kilnai/runtime` implementation code into
  the native surface.
- Do not let the native surface read provider credentials, memory files,
  project config, or harness config directly.
- Do not resolve global/project/team/cloud config inside the surface.
- Do not share credentials or memory across local and cloud instances
  implicitly.
- Do not promote local memory to team/cloud memory without runtime policy,
  provenance, and operator review.

## Surface Boundary

The native surface must obey the same surface ownership rules as GUI, CLI, TUI,
SDK, widget, IDE, and remote surfaces:

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

surface owns:
  layout
  focus
  selected panel
  expanded rows
  visual density
  local draft text
  keyboard shortcuts
  presentation preferences
```

If a behavior affects what happened, what is allowed, what can be replayed, or
what policy applies, it belongs in core/runtime and is projected to the native
surface.

## Multi-Instance Model

The native surface may attach to multiple Kiln instances at once, but every
operation must have an explicit target.

Examples:

```text
Target: Local / C:\Proyectos\Sequel\kiln
Target: Cloud / sequel-prod
Target: Team / shrad-staging
Target: CI / build-8421
```

Rules:

- Every session has an `instanceId`.
- Every memory resource has an owning instance and scope.
- Every provider route and credential lease belongs to one instance.
- Every action requires a selected target or a target encoded in the selected
  resource.
- Cross-instance transfer is a policy-governed action, not drag-and-drop state
  mutation.
- Local filesystem authority never leaks into cloud/team/CI instances.
- Cloud/team permission profiles never apply to local work by accident.
- The UI must make mixed-instance dashboards visually explicit.

This model lets an operator supervise local and remote work from one surface
without creating a hidden global state space.

## Relationship to the Web GUI

The web GUI remains the default rich operator surface because it provides:

- universal browser access
- VPS and remote deployment reach
- fast product iteration
- straightforward accessibility enforcement
- easier testing and onboarding
- attach mode for existing App Gateway instances
- a stable surface for non-power-user workflows

The native surface, if validated, is a specialized power-user surface for
workloads where a GPU-driven renderer can materially outperform a browser DOM
implementation:

- 25-50 or more concurrent child invocations
- 100k or more lifecycle events in a replayable session
- dense timeline and graph inspection
- heavy telemetry and tool-call streams
- large artifact and diff-review projections
- multi-instance operational dashboards

The native surface can be abandoned without deleting the web GUI or changing
runtime semantics. If it repeatedly wins against the web GUI on measured real
workloads, a later ADR may promote it to a first-class power-user surface. That
promotion still must not remove the web GUI's remote-access role.

## Relationship to Tauri

Tauri is a desktop wrapper option for the web GUI. It is not the same thing as
a native GPU operator surface.

Use Tauri when the product need is:

- packaged install and update flow
- native window lifecycle
- tray/background operation
- native notifications
- OS credential integration
- enterprise device-management expectations

Use a native GPU surface experiment when the product need is:

- high-density rendering
- low-latency interaction over very large event sets
- custom timeline/graph views
- replay-heavy visual debugging
- multi-agent supervision at scale

Both approaches must consume the same gateway/operator contracts. Neither may
introduce a private runtime.

## Relationship to IDE and Editor Surfaces

The native surface is not the answer to code editing.

When users need inline diffs, navigation, code review, LSP context, editor
selection, or file-local review, Kiln should integrate with existing editors
and IDEs through a dedicated IDE/editor surface. That surface should also be a
client of Kiln gateway and/or MCP contracts.

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
- `01-memory-lattice-governed-memory.md`
  Provides governed memory projection and provenance.
- `03-managed-agents-cross-provider-subagents.md`
  Creates the high-concurrency managed-agent workloads this experiment is meant
  to measure.
- `04-config-projection-unification.md`
  Provides config projection and drift-aware runtime configuration so local,
  cloud, team, CI, GUI, native, CLI, and IDE surfaces do not invent separate
  config truth.

## Initial MVP

1. Define a native surface contract document that restates the operator
   gateway-only boundary and multi-instance target rules.
2. Build a prototype that attaches to one local Operator Gateway and one remote
   App Gateway in read-only mode.
3. Render session list, active session timeline, child-invocation lifecycle
   events, tool-call summaries, and cost/provider metadata from canonical
   events only.
4. Render a synthetic managed-agent workload with at least 50 child invocations
   and 100k lifecycle events from replay data.
5. Compare latency, memory usage, event ingestion, scroll/zoom responsiveness,
   and interaction latency against the web GUI using the same workload.
6. Add explicit target selection and instance labeling before any mutating
   action is allowed.
7. Allow only safe runtime actions in MVP: inspect, replay, cancel, and open
   resource links. No write approvals, memory promotion, or config mutation.

## Verification Gates

- The native surface starts with zero access to core/runtime implementation
  modules.
- All runtime facts come from gateway/operator contracts.
- A session reload preserves the same view from canonical events.
- Multi-instance dashboards cannot issue an action without a clear target.
- Cross-instance transfer is unavailable or policy-gated in MVP.
- Provider credentials are never exposed to the native process except through
  gateway-mediated capability status.
- Local and cloud/team memory scopes remain separate unless a governed transfer
  action is explicitly implemented.
- The native surface demonstrates a measured advantage over the optimized web
  GUI on at least one accepted high-density workload.
- If the measured advantage is absent, the experiment closes without migration.

## Promotion Criteria

The experiment may become a first-class roadmap implementation only if all of
the following are true:

- Real `03` managed-agent workloads show web GUI limits after reasonable web
  optimizations.
- The native prototype materially improves at least two of:
  - large-session rendering latency
  - interaction latency under event load
  - memory footprint under replay
  - multi-instance dashboard usability
  - graph/timeline inspection clarity
- Maintenance cost is acceptable relative to the product gain.
- Accessibility, keyboard operation, packaging, update, and crash-reporting
  implications are documented.
- The web GUI remains supported for browser, VPS, remote, and general operator
  workflows.

## Rejection Criteria

Close this roadmap without implementation if:

- The web GUI handles accepted high-density workloads with virtualization,
  batching, event coalescing, and backpressure.
- The native prototype creates pressure to duplicate runtime state or config
  resolution.
- Users primarily ask for editing workflows better served by IDE/editor
  integration.
- The surface cannot preserve clear instance boundaries across local, cloud,
  team, and CI targets.
- The team cannot afford long-term maintenance of a custom rendering stack.

## Open Questions

1. Which Rust UI substrate should be tested first if the experiment starts:
   GPUI-like custom rendering, egui, wgpu-based custom canvas, iced, Slint, or
   another toolkit?
2. Should the native surface use the same TypeScript-generated gateway
   contracts through code generation, or should it consume a language-neutral
   OpenAPI/JSON Schema contract?
3. What is the minimum accessibility standard for a power-user native surface,
   and how is it tested outside the browser stack?
4. Should a native surface be able to supervise multiple instances in one
   window during MVP, or should multi-instance support be validated after the
   single-instance performance baseline?
5. What is the explicit handoff model between native surface and IDE/editor
   surface for opening files, diffs, and resource links?

## References

- `docs/architecture/operator-surfaces.md`
- `docs/architecture/runtime-surfaces.md`
- `docs/architecture/context-resource-plane.md`
- `docs/architecture/shared-tooling-intelligence.md`
- `docs/architecture/developer-tools.md`
- `docs/architecture/session-model.md`
- `docs/architecture/tool-execution.md`
- `docs/roadmap/03-managed-agents-cross-provider-subagents.md`
- `docs/roadmap/04-config-projection-unification.md`
- Stack Overflow 2025 Developer Survey:
  https://survey.stackoverflow.co/2025
- Stack Overflow 2025 AI section:
  https://survey.stackoverflow.co/2025/ai
- Stack Overflow 2025 survey press release:
  https://stackoverflow.co/company/press/archive/stack-overflow-2025-developer-survey/
- JetBrains State of Developer Ecosystem 2025:
  https://blog.jetbrains.com/research/2025/10/state-of-developer-ecosystem-2025
- Zed Parallel Agents:
  https://zed.dev/blog/parallel-agents
- Zed Agent Metrics:
  https://zed.dev/agent-metrics
