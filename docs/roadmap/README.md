# Roadmap

This directory contains active and deferred implementation tracks only.
Completed programs are promoted into stable architecture, guide, or changelog
documentation instead of being archived here.

## How To Read This Roadmap

- Active roadmap files describe scoped work that is still in progress.
- Deferred items are parked until their product or architecture trigger exists.
- Completed work is summarized here only to point readers to stable doctrine.
- Historical implementation detail belongs in `docs/changelog.md`.

## Canonical References

Use these documents as the stable source of truth before starting roadmap work:

- `docs/architecture/work-governance.md` for work admission, delegation,
  verification, and evidence closeout.
- `docs/architecture/engineering-standards.md` for Clean Architecture,
  cross-surface parity, native acceleration boundaries, and verification rules.
- `docs/architecture/operator-surfaces.md` for GUI, TUI, CLI, native, IDE,
  desktop, and remote operator surfaces.
- `docs/architecture/provider-model-discovery.md` for provider/model
  discovery, stale startup projections, cache behavior, and fail-closed
  execution admission.
- `docs/architecture/native-operator-surface.md` for native operator surface
  projection boundaries and promotion gates.
- `docs/architecture/benchmark-validation.md` and `docs/guides/eval.md` for
  benchmark-facing profiles, exact-format eval output contracts, baseline
  readiness, benchmark adapters, and public report evidence.
- `docs/architecture/managed-agents.md` for managed invocation, child
  authority, write evidence, replay invariants, background lifecycle, parallel
  orchestration, isolation, cockpit projection, and remote harness routes.
- `docs/architecture/context-resource-plane.md` for resource registry,
  resource-read pagination, artifact-backed content, and model-facing resource
  tools.
- `docs/research/15-background-parallel-agent-surface.md` for the research
  finding that background and parallel agents require a separate lifecycle,
  explicit identity, isolation, status, cancellation, and handoff evidence.
- `docs/architecture/config-projection.md`,
  `docs/architecture/harness-integration-capabilities.md`, and
  `docs/guides/global-config.md` for config projection, harness capabilities,
  native projection, remote harness route configuration, and governed config
  mutation.
- `docs/architecture/developer-tools.md` and `docs/guides/tool-use.md` for
  browser/computer use, controlled web research, tool execution, and operator
  evidence.
- `docs/architecture/memory.md` and `docs/guides/memory.md` for governed
  memory, Memory Lattice, lifecycle policy, recall, and memory resources.

## Active Roadmaps

0.0.1. [Rust Module Optimization](./00.0.1-rust-module-optimization.md)
   Active on 2026-05-17. Scope is the Rust optimization boundary:
   Bun/TypeScript owns control-plane semantics while Rust/WASM/sidecars enter
   as measured module hot paths or native helpers behind TypeScript-owned ports
   that consume shared contracts. This is separate from the native surface
   roadmap.

Completed background and parallel managed-agent work is canonicalized in
`docs/architecture/managed-agents.md`, `docs/architecture/context-resource-plane.md`,
`docs/architecture/config-projection.md`, `docs/architecture/operator-surfaces.md`,
`docs/architecture/work-governance.md`, `docs/guides/global-config.md`, and
`docs/changelog.md`. The 2026-05-27 UTC GUI live-test follow-up is also closed
there: resource pagination cursors are model-visible, and managed invocation
start/status/list/join/cancel remain scoped to the stable outer Kiln session
across recreated provider turns. Adapter-private managed invocation resource
pointers are projected to public `kiln://managed-agents/invocations/...` or
artifact resource URIs before crossing GUI, TUI, CLI, replay, or model-facing
`resource_read` surfaces. Replay also reconstructs managed-child cockpit state
from persisted GUI/TUI managed tool-completion evidence when canonical
`agent_invocation_*` events are absent or only partially persisted through the
shared gateway-contract normalizer, with duplicate running snapshots collapsed
and stale nonterminal snapshots ignored after terminal evidence; terminal
`managed_agent.list` evidence stays provisional until richer terminal tool
evidence arrives, and later join evidence can complete a canonical-start-only
stream.
Direct-provider and CLI-harness children share resource-context construction for
`contextMode: "resources"`; attached readers hydrate through shared
`resource_read` content, both route families resolve the reader from the current
session-scoped builtin tool surface at invocation time, and unattached surfaces
receive only the admitted URI list.
The 2026-05-27 timeout ergonomics follow-up is closed there as well:
synthesized managed-agent routes use a five-minute default timeout, the
model-facing route catalog exposes timeout budgets and resource-mode guidance,
CLI-harness timeout handoffs point to replayable timeout evidence, and an
expected `managed_agent.cancel` result is accepted when terminal cancellation
evidence is recorded. The live-session follow-up also keeps managed-child
lineage tied to the persisted GUI/TUI turn id, projects terminal join evidence
into model-visible output, accepts non-completed terminal joins as lifecycle
observations, and exposes whether each route timeout came from the synthesized
default or an explicit route config. The final live-session evidence follow-up
keeps direct-provider child handoffs bounded while preserving long child output
as managed replay resources, so broad reviews with clipped summaries remain
actionable through `resource_read` without leaking full child tails into
session events or model-facing metadata.
The 2026-05-28 provenance closeout is also closed: managed-agent route
projection now carries required `routeSource` evidence across healthy and
unavailable routes, admission snapshots, session events, status/list/join/cancel
tools, cockpit replay, CLI inspection, and transcript resources. Managed-child
lineage is first-class through `parentTurnId` on the same cross-surface paths.
Timeout source remains route-owned (`default` or `explicit-route`) and
request-local timeout shims remain intentionally invalid. Runtime recovery
quarantines invalid or stale-contract filesystem checkpoints with metadata
instead of adopting them or synthesizing compatibility values. Full
runtime/session budget admission enforcement beyond route timeout/source
evidence, and core resource-read pagination ownership beyond model-visible
cursors, remain separate runtime/resource-plane dependencies; no local
compatibility shims were added.
The follow-up replay and timeout-evidence slice is closed as of 2026-05-28 UTC:
model-facing managed-agent start/status/list/join/cancel projections expose
timeout budgets and terminal child lineage, GUI/TUI transcript persistence
writes canonical `agent_invocation_*` lifecycle events through the managed
invocation session-event sink and shared transcript sequence allocator,
`managed_agent.start` registers a runtime terminal observer so background child
completion is persisted even without later join/cancel, startup failures that
terminalize after side-effected runtime lease acquisition record requested,
started, and failed events, out-of-band GUI join/cancel controls reuse the same
terminal events for transcript replay, and cockpit projection carries child
session ids, child turn ids, timeout budgets, and timeout provenance across
normalized managed-tool evidence. GUI, TUI, and native managed-agent cockpit
views render the same lineage and timeout fields from the shared view-state
model. Timeout behavior remains route-owned; deterministic timeout tests use
fake time instead of wall-clock races.
The managed handoff recovery slice is closed as of 2026-05-29 UTC: local
frontend-reference research can satisfy visual-reference governance when it
cites code-backed UI evidence from concrete repository paths such as
`C:/Proyectos/Sequel/t1code` or `C:/Proyectos/Sequel/vllm-studio`; generic
screenshots, repository chrome, and placeholder notes remain rejected.
`handoff_not_substantive` is a terminal child status but not governed phase
evidence, so parent execution stays blocked until the required
`work_item.update` records substantive phase evidence. Direct-provider children
that finish without final handoff text now emit an actionable no-handoff summary
and transcript pointer instead of a generic success-like completion. Runtime
diagnostic resources project `timeoutMs` and `timeoutSource` for timed-out
managed invocations, and GUI/TUI/CLI cockpit projection surfaces recovery and
phase-completion instructions as review attention. The 2026-05-29 follow-up
also persists bounded direct child execution replay resources for empty
handoffs and child tool calls, including stop reason, token usage, tool
execution summaries, and clipped outputs. No-handoff visual-reference recovery
now includes a blocked work-item update template for the case where transcript,
child-execution resources, and local inspection still cannot produce qualifying
evidence, so the parent must block rather than record placeholder evidence or
continue execution. Gateway cockpit projection preserves that blocked template
and projects `handoff_not_substantive` as failed managed-child attention, not a
success-like completed state. Timeout guidance follows
published reliability doctrine: AWS Builders Library recommends explicit
timeouts, idempotent retries, backoff, and jitter
(`https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/`);
Google SRE warns that naive retries and waiting the full deadline can amplify
cascading failures
(`https://sre.google/sre-book/addressing-cascading-failures/`);
Dean and Barroso's tail-latency work treats slow tails as a scale problem that
must be bounded and observed (`https://research.google/pubs/the-tail-at-scale/`);
Microsoft and Google Cloud retry guidance require bounded total retry time or
max attempts, idempotency awareness, and jittered exponential backoff
(`https://learn.microsoft.com/en-us/azure/architecture/best-practices/transient-faults`,
`https://cloud.google.com/java/docs/client-retries`);
OpenAI Agents SDK exposes `maxTurns`, `AbortSignal`, tool timeout errors, and
run error handlers as explicit execution boundaries
(`https://openai.github.io/openai-agents-js/guides/running-agents/`,
`https://openai.github.io/openai-agents-js/guides/tools/`); and Anthropic
long-request guidance recommends streaming or batch-style polling for
requests that can exceed long network windows instead of relying on an
uninterrupted connection (`https://docs.anthropic.com/en/api/errors`). Kiln's
managed-agent timeout policy therefore remains evidence-first: separate
per-route budgets from end-to-end work governance, emit replayable diagnostics,
avoid hidden retry loops, and require phase-sliced recovery evidence before
continuing a governed workflow.
The final 2026-05-29 GUI follow-up closes the route-owned request admission
gap seen in session
`.kiln/sessions/kiln-gui%3A_gui%3A297d1c6d-1d59-44c7-8178-f4567e4c1df9%3A1780030948334`:
visual-reference managed invocation requests now carry
`forbiddenInputFields: ["agentProfile"]`, and `managed_agent.invoke` returns a
structured `route_profile_conflict` recovery payload with a retry template that
omits `agentProfile` while preserving the explicit route, provider, work item,
goal, attempt, and execution phase. Route/profile validation remains
fail-closed, adapters are not invoked on contradictory input, and no child
lifecycle events are emitted before admission is coherent.
The subsequent 2026-05-29 GUI stress session
`.kiln/sessions/kiln-gui%3A_gui%3A8d0f06a4-6189-47d1-96ff-bcc1beb51e37%3A1780046728980`
closed the remaining route-owned retry loop. The attached runtime surface no
longer derives `agentProfile` from `routeId` when
`forbiddenInputFields` forbids it, and `managed_agent.invoke` canonicalizes
forbidden `agentProfile` before route/profile validation so repeated parent
materialization cannot turn the same route-owned request into another
`route_profile_conflict`. Explicit visual-reference phase routes also own the
effective model: stale write-route `managedModel` hints are omitted by
`work_item.execution.start`, and attached/runtime hydration uses the selected
route catalog model for the child. When a route intentionally uses the provider
default model, stale caller model hints are removed rather than preserved. This
follows the timeout/retry research
stance already recorded above: do not add hidden retry loops; make repeated
failure states deterministic, bounded, replayable, and safe to resume from the
same canonical request.
Verification for this closeout passed the focused route-owned canonicalization
tests, the related package suites, `bun run typecheck`, `bun run build`,
`git diff --check`, and a sequential full `bun run test`. A concurrent
test/build attempt briefly surfaced a core field-runtime lifecycle timeout;
the Vitest file passed in isolation and the later sequential workspace test
passed.
The latest 2026-05-29 GUI stress session
`.kiln/sessions/kiln-gui%3A_gui%3A20afacf8-3b10-4b7d-905b-77d60686976a%3A1780050552811`
proved that route-owned canonicalization is now effective: the child ran on
the visual-reference route, the forbidden `agentProfile` was canonicalized
away, and no stale write-route model controlled the child identity. The
remaining failure was not timeout or route admission; it was a missing governed
state transition after `handoff_not_substantive`. Runtime now rejects final
assistant text while `managedInvocationRecovery` or
`managedInvocationPhaseCompletion` requires a next work-item tool, and it fails
closed with `managed_invocation_state_transition_required` when the tool-round
budget is exhausted before that transition is recorded. GUI session projection
now renders failed `turn_completed` outcomes as error tone so the operator does
not see a success-colored closeout for a failed governed turn. Additional
verification passed `bun run typecheck`, the runtime orchestrator tool test
file, the GUI session-store test file, the full GUI package suite, and the
gateway-contracts package suite. An initial full runtime package suite exposed
one suite-level timeout in `tests/gateway/tui-gateway-clear.test.ts:350`;
rerunning that file in isolation passed all 18 tests, and a later standalone
runtime package suite passed with 177 test files and 2353 tests.
The final 2026-05-29 GUI stress session
`.kiln/sessions/kiln-gui%3A_gui%3A0eb1c062-b0bb-4d8e-bd71-a461a33f06e8%3A1780052576091`
showed the state-transition guard failing closed correctly, but also showed
that the parent could spend the last normal tool round inspecting child
resources and local frontend-reference code before it recorded the required
`work_item.update`. Runtime now treats that unresolved handoff transition as a
first-class state with exactly one reserve round after normal tool rounds are
exhausted. The reserve round projects only the required next work-item tool,
adds a one-tool executor allowlist, returns any non-transition tool calls as
blocked results, resolves either evidence or blocked-pause transitions, and
fails closed when the transition tool is not admitted or still not called. This
keeps timeout and retry behavior aligned with the research stance above:
bounded extra work, no hidden retry loop, no automatic state mutation, and no
success-colored closeout until the governed state transition is recorded.
Focused verification passed `bun run typecheck` and `bun run --cwd
packages/runtime test tests/session/runtime-session-orchestrator-tools.test.ts`.
Reviewer follow-up also closed a multi-child edge case: unresolved managed
transitions are now tracked in execution order, so recording a later child's
state transition cannot hide an earlier unresolved child handoff. The focused
runtime test file now includes that regression and passes 61 tests.
The final 2026-05-29 GUI stress session
`.kiln/sessions/kiln-gui%3A_gui%3A4ee1ae9f-586c-4839-bef4-7f4fdf858135%3A1780081054547`
closed the remaining direct-child no-handoff protocol gap. The session proved
route-owned admission, child execution, and parent blocking were working, but
the child provider ended on `stop_reason: "tool_calls"` with no final handoff
text after tool use. Runtime no-tools fallback is now a hard protocol
boundary: when fallback still returns tool calls, a tool-continuation stop
reason, or empty text, Kiln emits deterministic non-substantive output instead
of executing, retrying, or treating it as a final answer. Max-round fallback
uses `tool_rounds_exhausted`; repeated malformed tool-call fallback uses
`no_tool_finalization_failed`. Direct-provider managed children project these
states through the existing no-handoff summary and child-execution replay
resource, preserving stop reason, token usage, and executed tool summaries for
`resource_read` without adding a hidden repair call or adapter-local retry.
This matches the timeout and retry research already recorded here: AWS,
Google SRE, Microsoft Azure, OpenAI Agents SDK, and tail-latency guidance all
favor explicit deadlines, bounded retry/finalization attempts, idempotency
awareness, and replayable evidence over indefinite waiting or opaque retries.
Verification passed the focused orchestrator fallback regressions, the direct
runtime adapter regression, the full runtime package suite with 177 test files
and 2362 tests, and `bun run typecheck`.
The latest 2026-05-29 GUI stress session
`.kiln/sessions/kiln-gui%3A_gui%3Ae294e374-2b9e-4c4b-a144-dc03579522f2%3A1780083012476`
closed the sibling-reference authority gap. The parent could see
`C:/Proyectos/Sequel/t1code` and `C:/Proyectos/Sequel/vllm-studio`, but the
read-only managed child could not because the direct sandbox was limited to
the Kiln working directory. Managed routes now support explicit
`readAuthority.workspace.allowedPaths` for read-only reference roots; CLI route
projection preserves those roots, and direct-provider child sandboxes admit
them for reads while keeping writes denied. A blocked visual-reference recovery
transition no longer depends on one hard-coded pause id: if the same work item
is blocked with a pending operator pause and a failed verification gate for the
required evidence, the runtime resolves the managed-invocation recovery
transition cleanly. This keeps the research route capable of reading Sequel
reference repos without turning sibling repos into writable workspaces.
Reviewer follow-up closed two final operator-safety gaps from this same slice:
direct-provider children that end with
`managed_invocation_state_transition_required` now fail closed instead of
recording a completed handoff, and cancelled GUI `turn_completed` events now
render as error-tone timeline entries instead of success-tone entries. The
local `~/.kiln/config.yaml` read-only research routes were updated with
read-only roots for `C:/Proyectos/Sequel/t1code` and
`C:/Proyectos/Sequel/vllm-studio`, with `.git` and `node_modules` denied.
Final verification passed `bun run test`, `bun run typecheck`,
`bun run build`, `bun run --filter @kilnai/runtime test`,
`bun run --filter @kilnai/gui test`, and `git diff --check`.

1. [Native Operator Surface](./01-native-operator-surface.md)
   Started on 2026-05-15. Current scope is the native operator surface benchmark
   path: contract-only runner admission, orchestration planning, workload
   governance, and approval evidence before any live browser or native
   benchmark execution. It does not implement Rust optimization.

2. [Session Feedback Pipeline](./02-session-feedback-pipeline.md)
   Started on 2026-05-18. Scope is the operator feedback-to-fix pipeline:
   local-first feedback bundles, redaction, evidence selection, issue drafts,
   governed repair work items, and later draft pull-request flow. This is
   separate from CLI resume feedback.

## Deferred Roadmaps

- OS-pack packaging for web extraction and browser helpers.
  Deferred until controlled web primitives need platform-specific helper
  binaries or dependencies.
- Binary and PDF source artifacts for controlled web research.
  Deferred until research workflows need reliable PDF text extraction, OCR, or
  binary artifact handling.
- Learning-based governance and routing.
  Deferred until there are enough real workflow traces, eval data, and stable
  runtime policies to justify machine-learned routing or governance advice.
- Full external benchmark expansion.
  Deferred until a stable product surface can support public benchmark claims
  without benchmark-only prompt paths, tool schemas, or authority shortcuts.

## Completed Areas

Stable doctrine for completed work lives in the architecture and guide docs,
not in roadmap files. Current completed areas include:

- GUI parity and operator surface foundations.
- TUI and GUI gateway-backed operation.
- Managed agent invocation, background and parallel lifecycle, write authority,
  live adapter hardening, cockpit projection, route-source provenance,
  parent-turn lineage, background terminal transcript persistence, timeout
  diagnostics, and remote harness route constraints.
- Work governance, plan mode, goal execution, and evidence-gated closeout.
- Config projection, native harness projection, and governed config mutation.
- Agent context, instruction profiles, skills, and repo shims.
- Memory Lattice, memory lifecycle policy, and context resource projection.
- Provider credential pooling and provider/model discovery.
- Operator-surface startup discovery staging and stale provider diagnostics.
- Controlled web research, browser/computer use, and tool execution.
- Multimodal artifact transport and capability-aware route admission.
- Agent QA showcase recorder.
- External benchmark validation platform.
- CLI answer/json output contracts for exact-format evals and benchmark
  harnesses.
- Native operator surface foundation and embedded browser operator capability.
- Native operator surface projection foundation with defer/no-promotion status.

## Execution Priority

1. Keep active roadmap work limited to the explicit scope in its roadmap file.
2. Promote stable results into architecture or guide docs when a track closes.
3. Delete completed roadmap files after doctrine is absorbed.
4. Do not create near-duplicate roadmap files for one concern.
5. Do not add background or parallel child execution paths outside
   `docs/architecture/managed-agents.md` and core/runtime managed invocation
   contracts; child lifecycle, worktree/sandbox leases, cancellation, status,
   join, handoff, and cockpit projection must use the shared runtime-owned
   lifecycle.
6. Do not start live native benchmark execution, native operator UI, dispatch
   paths, or gateway attach loops without an approved native-surface roadmap
   slice or ADR.
7. Do not start Rust/WASM/sidecar modules without an approved Rust optimization
   roadmap slice or ADR and the Rust module promotion gates in `00.0.1`.
