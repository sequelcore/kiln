# Bounded-Context Decisions

This document is the canonical bounded-context decision reference for the major
Kiln packages and modules.

Its job is narrow:

- declare which areas survive
- declare which areas must be split, merged, renamed, or deleted
- map each area to the current architecture doctrine

It is not a changelog, not a slice diary, and not a step-by-step execution
plan.

## Source Hierarchy

If this document conflicts with the modular architecture docs, the architecture
docs win.

Read these first:

- `docs/architecture/invariants.md`
- `docs/architecture/subsystems.md`
- `docs/architecture/context-governance.md`
- `docs/architecture/coordination.md`
- `docs/architecture/tool-execution.md`
- `docs/roadmap/README.md`

## Decision Vocabulary

Allowed decisions:

- `keep`
- `split`
- `merge`
- `rename`
- `delete`

Definitions:

- `keep`: retain the area as a valid bounded context or support surface
- `split`: separate mixed responsibilities into clearer seams
- `merge`: move ownership into a better canonical boundary
- `rename`: replace unstable or obsolete architecture language
- `delete`: remove the area when no valid responsibility remains

Multiple decisions may apply to the same area.

## Reading Rule

Each row answers:

- what this area should become
- what canonical boundary should own it
- why that decision is correct

Rows are normative. They describe the intended architectural outcome, not the
historical sequence of how the repo got here.

Existing code is evidence, not authority. A module may already exist and still
deserve `merge`, `rename`, or `delete` if its quality or boundary shape does
not meet the current doctrine.

## Decision Table

| Area | Decision | Target boundary | Why |
|------|----------|-----------------|-----|
| `packages/core/src/engine` | `keep`, `split`, `rename` | core domain contracts and configuration boundaries that support the control plane without reintroducing app-first identity language | The engine still contains useful foundational contracts, but broad or product-shaped naming should not define doctrine |
| `packages/core/src/orchestrator` | `split`, `merge`, `rename` | `Orchestration`, `IngressGovernor`, `DemandAllocator`, `ChainGovernor`, `TaskRegistry` | Useful coordination logic exists here, but the directory should stop acting as a catch-all umbrella for unrelated control concerns |
| `packages/core/src/tree` | `merge`, `delete` | `TaskRegistry` under `Coordination` | Explicit task-state ownership should survive where valid; speculative tree abstractions should not persist as a parallel model |
| `packages/core/src/memory` | `keep`, `split` | `Memory`, with context assembly owned by `Context Governance` | Memory is canonical, but retrieval, budgeting, and assembly must not stay mixed without a clear owner |
| `packages/core/src/knowledge` | `keep`, `merge` | `Memory` and `Context Governance` | Retrieval and grounding remain valid, but should serve governed context assembly rather than act as a separate product identity |
| `packages/core/src/field` | `merge`, `rename`, `delete` | explicit control-plane contracts under `Context Governance`, `Coordination`, or `Adaptation` only where justified | Field language is allowed only when the owning contract is explicit; any residue that remains metaphor-first rather than contract-first should be removed |
| `packages/core/src/safety` | `keep`, `merge` | `Safety` | Safety is a canonical subsystem and should remain explicit and fail-closed |
| `packages/core/src/security` | `keep`, `merge` | `Safety` and `Tool Execution` enforcement where applicable | Security should support canonical safety and actuation boundaries rather than drift into a parallel doctrine |
| `packages/core/src/sandbox` | `keep`, `merge` | `Tool Execution` with safety-aligned enforcement | Sandbox behavior is real, but it exists to constrain actuation, not to define an independent architecture center |
| `packages/core/src/tools` | `keep`, `split`, `merge`, `rename` | `Tool Execution` | Tool capability is central, but policy, authority, execution, and transport should not remain mixed under a loose tools umbrella |
| `packages/core/src/events` | `keep` | `Telemetry And Audit` | Event infrastructure aligns with the sensor-fabric doctrine and should stay explicit |
| `packages/core/src/observability` | `keep` | `Telemetry And Audit` | Metrics and traces are part of the telemetry subsystem, not an independent product concept |
| `packages/core/src/cost` | `keep`, `merge` | `Telemetry And Audit` feeding `Orchestration` and `Adaptation` | Cost is a feedback input, not a free-floating architecture pillar |
| `packages/core/src/enrichment` | `split`, `merge`, `delete` | whichever canonical owner is justified by code: `Memory`, `Context Governance`, or support tooling | Enrichment should survive only where concrete ownership is clear; vague augmentation layers should not be preserved out of inertia |
| `packages/core/src/eval` | `keep`, `merge` | operator and quality support adjacent to `Safety` and `Adaptation` | Evaluation is useful, but should remain clearly subordinate to canonical subsystem ownership |
| `packages/core/src/verification` | `keep`, `merge` | `Orchestration`, `Safety`, or `Tool Execution` depending on actual owning flow | Verification can survive where concrete, but should not float as an isolated doctrinal island |
| `packages/core/src/domain` | `keep`, `split`, `rename` | explicit subsystem-owned interfaces only | The name is too broad unless the exports are tightly constrained by real bounded contexts |
| `packages/core/src/domains` | `keep`, `merge` | support configuration and packaged defaults only | This area should not compete with actual bounded-context language |
| `packages/core/src/package` | `keep` | packaging and distribution support only | Operationally useful, low doctrine pressure |
| `packages/core/src/presets` | `merge`, `delete` | `Identity And Policy` only where still justified | Presets should survive only as explicit policy-compilation inputs. Demo YAMLs, stale canned flows, and legacy preset residue should be deleted rather than endlessly reshaped |
| `packages/core/src/skill` | `keep` | support capability surface under runtime and operator policy | Useful, but not architecture-defining |
| `packages/runtime/src/session` | `split`, `rename`, `merge` | runtime turn core under `Orchestration`, with one canonical session-turn pipeline | Session state, persistence, lifecycle, and orchestration seams must be explicit. Surface-specific turn assembly must not bypass the canonical runtime turn core |
| `packages/runtime/src/gateway` | `keep`, `split`, `rename`, `merge` | `Ingress` runtime boundary with explicit `admission/`, `hosting/`, `middleware/`, and `transport/` seams | Gateway remains important, but as a runtime ingress surface. All surfaces must converge on one canonical turn handoff after ingress-specific preparation |
| `packages/runtime/src/channels` | `keep` | runtime I/O surface | Operationally necessary and conceptually stable |
| `packages/runtime/src/trigger` | `keep`, `split`, `merge` | `Ingress`, `Identity And Policy`, and `Orchestration` | Trigger mechanics are real, but admission, policy, and execution ownership must be explicit |
| `packages/runtime/src/tenant` | `keep`, `split`, `merge` | `Identity And Policy` and `Ingress` | Tenant isolation is important, but should not leak into unrelated routing or surface identity |
| `packages/runtime/src/mcp` | `keep`, `split`, `merge`, `rename` | integration surface coordinated with `CoordinationStore` where shared state becomes real | MCP exposure is a real runtime integration capability, but overlapping shared-state or coordination mechanics should be folded into explicit owners instead of growing as a second hidden model |
| `packages/runtime/src/execution` | `split`, `merge`, `rename`, `delete` | `Orchestration` and `Tool Execution` with explicit ownership boundaries | Execution is canonical, but thin executor wrappers, subscription bypasses, or duplicated backend abstractions should not survive unless they clarify ownership materially |
| `packages/runtime/src/observability` | `keep` | `Telemetry And Audit` | Runtime visibility belongs to telemetry and audit, not to a separate runtime identity |
| `packages/runtime/src/a2a` | `keep`, `merge`, `rename` | delegation and integration capability only | A2A has a concrete runtime role through delegation, but it should remain narrowly scoped as integration capability rather than architecture identity |
| `packages/cli/src/wrapper` | `keep`, `split`, `rename`, `merge` | operator-facing runtime surface aligned to `Ingress`, `Context Governance`, and `Identity And Policy` | Important surface, but it still risks masking multiple unrelated responsibilities behind one vague name and must not become a second owner of context assembly or turn execution |
| `packages/cli/src/commands` | `keep` | command surface | Stable operator entrypoint |
| `packages/cli/src/config` | `keep` | local operator configuration support | Low architectural conflict |
| `packages/cli/src/sync` | `keep`, `merge` | support tooling only | Useful utility, not doctrine center |
| `packages/tui` | `keep`, `merge` | operator surface, subject to the separate GUI parity and deletion decision path | The bounded-context call here is subordinate to the explicit GUI/TUI roadmap |
| `packages/sdk` | `keep` | integration surface | Stable enough conceptually |
| `packages/widget` | `keep` | embeddable runtime surface | Stable enough conceptually |
| `packages/studio` | `keep` | inspection and development surface | Useful operator and developer tooling surface |
| `packages/tools*` | `keep` | infrastructure and packaging support | Low conceptual pressure; should not define doctrine |

## Explicit Boundary Calls

The following boundary calls are intentional and should be treated as doctrine,
not as incidental file cleanup:

### Runtime Gateway

`packages/runtime/src/gateway` is retained, but only as the runtime ingress
surface. Its internal ownership should be explicit:

- `admission/`
  app resolution, config validation, runtime-entry preparation, and related
  ingress-admission concerns
- `hosting/`
  server lifecycle, static mounting, and operator-facing gateway hosting
- `middleware/`
  request-time guard and policy layers
- `transport/`
  WebSocket, webhook, delegation, and transport-specific mechanics

This split is part of the bounded-context decision itself. It is not merely a
preferred folder layout.

### Canonical Turn Flow

Kiln gets one canonical runtime turn flow after ingress admission.

The intended backbone is:

- ingress admission and surface-specific normalization
- one canonical runtime turn handoff
- governed context assembly under `ContextGovernor`
- `RuntimeSessionOrchestrator` model and turn coordination
- `RuntimeSessionToolExecutor` tool loop and actuation control
- uniform response assembly, audit, and session persistence

The consequence is explicit:

- HTTP, provider-adapter, CLI, TUI, GUI, and future surfaces may differ at the
  ingress edge
- they may not fork into separate long-lived turn pipelines once a request is
  admitted
- any current surface that calls orchestration directly while bypassing the
  canonical runtime handoff is transition debt, not a valid end state
- request-contract gating such as plan or tier eligibility stays in ingress
  admission and must fail before a turn is considered admitted

### Presets

`packages/core/src/presets` is not entitled to survive as a general-purpose
architecture surface.

Only two outcomes are acceptable:

- merge the truly necessary policy inputs into explicit `Identity And Policy`
  ownership
- delete stale preset examples, canned workflows, and residue that exists only
  because earlier architectures needed it

### Runtime Execution

`packages/runtime/src/execution` should remain only where it expresses a real
runtime execution boundary.

It should not become a parking lot for:

- thin naming wrappers around other adapters
- duplicated executor abstractions with no independent ownership value
- surface-specific subscription executors that bypass the canonical runtime
  turn flow
- backend splits that are better expressed at `Orchestration` or `Tool
  Execution`

### MCP And A2A

`packages/runtime/src/mcp` and `packages/runtime/src/a2a` are allowed to
survive, but only as concrete integration capabilities.

They must not quietly become:

- alternate coordination centers
- hidden policy owners
- vague architecture identity surfaces

If either area carries stateful or authority-bearing logic, that ownership
should be made explicit and moved under the canonical subsystem that actually
owns it.

### Wrapper

`packages/cli/src/wrapper` is allowed to survive functionally, but not as a
vague umbrella forever.

The likely long-term direction is:

- keep concrete operator-session and provider-session capabilities
- split context assembly, permission policy, process execution, and worktree
  concerns into clearer ownership seams
- merge any surviving turn-execution entrypoints into the canonical runtime
  handoff instead of preserving wrapper-local flow control
- rename or shrink the umbrella once the surviving responsibilities are easier
  to explain without folklore

### Safety And Actuation

Safety, security, sandbox, and tool execution must remain distinguishable in
code, but their cross-boundary relationships must be explicit:

- safety owns threat detection and enforcement
- sandbox and command constraints exist to govern actuation
- tool execution owns authority, rate limits, execution, and result
  sanitization

No second informal safety model should grow through helper files or middleware
names alone.

### Context Assembly

Memory, knowledge, and any field-derived context pressure may all contribute to
context assembly, but the canonical owner of assembly remains one explicit
context-governance seam such as `ContextGovernor`, not a pile of route, helper,
or wrapper-local assemblers.

No helper, formatter, loader, or wrapper should silently become the real owner
of context policy.

That rule also applies to:

- route handlers that pre-assemble runtime context before calling the pipeline
- wrapper session managers that build their own lasting context policy
- surface-specific orchestration helpers that append context outside governed
  budget control

### Wiring Rule

If a control concern is canonical, it must be wired once and observed
everywhere.

This applies especially to:

- context assembly policy
- tool authorization and dangerous-command enforcement
- authority-decision audit recording
- budget enforcement
- safety escalation

Commercial plan/tier gating is intentionally separate from runtime turn
ownership:

- it validates whether a request may enter the admitted-turn pipeline at all
- it depends on ingress contract fields, not on lasting session state
- it should fail fast before session creation, context assembly, or turn audit
  side effects
- it should not be generalized into `processAdmittedTurn(...)` unless multiple
  admitted surfaces truly share the same contract and enforcement shape

Surface parity is not achieved when UI outputs match while enforcement,
auditing, or budget behavior differs by transport.

## Named Pressure Points

These names remain unstable unless they are justified by a concrete owning
contract:

- `orchestrator`
- `router`
- `field`
- `presets`
- `wrapper`
- old swarm-era mechanism names

Use preferred doctrine terms from `docs/architecture/` wherever possible.

## Deletion Rule

No area is considered truly refactored if the replacement boundary exists but
the obsolete path remains active without a concrete reason.

Replacement work must end with old names, old abstractions, or dead modules
being removed.

Already-implemented but low-quality work does not get grandfathered in. If the
quality is not good enough, the correct decision can still be `merge`,
`rename`, or `delete`.

## High-Confidence Delete Targets

The following shapes should be treated as deletion-biased unless a concrete
owner and use case are demonstrated:

- stale example presets and canned YAML flows under `packages/core/src/presets`
- thin executor wrappers in `packages/runtime/src/execution` that only rename
  another abstraction without adding ownership clarity
- surface-local turn pipelines or subscription executors that bypass the
  canonical runtime handoff
- metaphor-first field residue that cannot be defended in explicit
  control-plane terms
- duplicate helper layers that shadow canonical owners such as
  `Context Governance`, `Tool Execution`, or `Identity And Policy`
- route-local or wrapper-local context assembly that competes with the chosen
  context-governance owner
- audit capture paths that record different authority evidence depending on the
  ingress surface

## Closure Standard

This document is in good standing when all of the following are true:

- the table reads as one consistent architectural stance
- target boundaries match the modular architecture docs
- major runtime and core areas have an explicit fate
- execution plans live in their own roadmap files instead of being embedded
  here
- a reader can use this file to decide what to preserve, split, merge, rename,
  or delete before starting refactor work
