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
  benchmark-facing profiles, baseline readiness, benchmark adapters, and public
  report evidence.
- `docs/architecture/managed-agents.md` for managed invocation, child
  authority, write evidence, and replay invariants.
- `docs/research/15-background-parallel-agent-surface.md` for the research
  finding that background and parallel agents require a separate lifecycle,
  explicit identity, isolation, status, cancellation, and handoff evidence.
- `docs/architecture/config-projection.md`,
  `docs/architecture/harness-integration-capabilities.md`, and
  `docs/guides/global-config.md` for config projection, harness capabilities,
  native projection, and governed config mutation.
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

1. [Background And Parallel Agent Surface](./01-background-parallel-agent-surface.md)
   Started on 2026-05-21. Slices 1-2 are complete in code: managed-child
   lifecycle evidence and nonblocking `start/status/join/cancel/list` tools now
   exist. Slice 3 is complete in code: lease evidence, operator projection,
   health/cleanup metadata, same-checkout write guards, runtime-owned
   isolated-worktree acquire/release, runtime-owned artifact-directory
   acquire/release, runtime-owned dev-server port acquire/release, and
   runtime-owned environment binding, credential-route, and policy-backed
   sandbox acquire/release exist.
   Same-path isolated collisions, path aliases, lease-manager drift, git
   worktree root confinement, pre-launch cancellation during acquire, product
   config wiring for git-backed isolated worktree leases, non-empty
   artifact-directory preservation, explicit port-pool allocation,
   concurrent port reservation, probe setup diagnostics, and in-memory stale
   recovery with immediate cleanup of already-acquired stages are covered;
   environment bindings now flow through runtime adapters into CLI harness
   sessions without leaking values into lifecycle URIs; credential-route
   leases now record route-id evidence without credential values and are wired
   through shared managed invocation service keys while runtime-selected routes
   fail closed without a credential-route lease manager; policy-backed sandbox
   leases now record `sandbox-policy` evidence for direct-provider routes and
   fallback runtime-tool services while harness sandbox routes fail closed until
   proof exists; persistent restart
   recovery now writes validated manifests, reconstructs abandoned children as
   `recovered`, reuses terminal lease cleanup, and preserves leaked evidence;
   runtime-owned cleanup daemon scheduling now runs startup persisted recovery
   once and recurring stale-only sweeps without overlapping recovery passes;
   dirty isolated worktree release failures now preserve the worktree and emit
   runtime-owned review-required evidence across recovery, gateway cockpit, and
   operator event surfaces without automatic adoption or parent checkout
   mutation. Slice 4A-D are code-complete: core now has typed orchestration modes,
   fail-closed request adapters for every planned mode, fan-out
   request/admission/result evidence, governed child work-item materialization
   with merge/adoption policy metadata, and `kiln run --workers` now uses the
   managed runtime lifecycle to start, observe, and join isolated worker
   children instead of recursive CLI fan-out, with signal-safe transcript
   finalization and worktree cleanup. Slice 5A is complete in code: managed
   child invocations now expose shared read-only resource-plane snapshots under
   `kiln://managed-agents/invocations`, and `kiln run` wires those resources
   into the model-facing builtin resource surface whenever a managed invocation
   service is present. Slice 5B is complete in code: `kiln managed-agent`
   renders read-only list/status/transcript/resources views from persisted
   canonical session events through the shared gateway cockpit projection.
   Slice 5C is complete in code: shared gateway cockpit projections and
   read-only view state now carry managed-child transcript, handoff,
   diagnostic, review, attention, lifecycle timeline, and resource targets for
   TUI/GUI/native rendering without surface-local lifecycle stores. Slice 5D
   is complete in code: GUI now keeps canonical session events available for
   shared cockpit projection and renders a read-only Agents workbench surface
   for active/review managed children, lifecycle timelines, transcript and
   resource links, and non-dispatched cancel state. Slice 5E is complete in
   code: TUI now preserves canonical managed-child session events from the
   gateway stream, projects them through the shared cockpit view-state, and
   renders a read-only managed-agent sidebar with attention/active counts,
   dirty-review markers, lifecycle event counts, transcript/resource URIs, and
   non-dispatched cancel state. Slice 5F is complete in code: native now
   renders a read-only managed-agent cockpit panel from the native wrapper over
   shared gateway cockpit view-state, including attention/active counts,
   status/route, dirty-review markers, transcript/resource URIs, lifecycle
   timeline entries, and disabled cancel controls without native-local
   lifecycle state. Slice 5G is complete in code: GUI now sends typed
   managed-agent cancel control frames to the runtime gateway, gateway
   cancellation fails closed without a live invocation service and matching
   session lineage, and accepted cancellation streams canonical terminal
   evidence back into the cockpit projection. Slice 5H is complete in code:
   native now opens a read-only gateway WebSocket attach for cockpit state,
   ingests canonical session events into the shared native cockpit projection,
   de-duplicates event ids, and ignores mutation acknowledgement frames without
   adding native dispatch. Slice 5I is complete in code: CLI now exposes
   gateway-mediated `managed-agent cancel`, validates the target from
   canonical transcript projection, sends the existing
   `managed_agent_control` cancel frame to `/gui/ws`, waits for the typed
   gateway acknowledgement, and does not create CLI-local lifecycle mutation.
   Slice 5J is complete in code: CLI now exposes gateway-mediated
   `managed-agent join`, validates the target from canonical transcript
   projection, sends the shared `managed_agent_control` join frame to
   `/gui/ws`, waits for runtime-owned terminal evidence and the typed gateway
   acknowledgement, replays existing terminal evidence on repeated joins
   without duplicating the ledger record, and does not create CLI-local
   lifecycle mutation. Slice 5K is complete in code: native now exposes
   gateway-mediated managed-agent cancellation over its existing `/gui/ws`
   cockpit attach, emits the shared `managed_agent_control` cancel frame only
   while the live channel is open, and keeps lifecycle projection owned by
   runtime-streamed session events. Slice 5L-P are complete in code: shared
   cockpit projections expose managed-agent drilldown and adoption-gate state,
   TUI/native render the shared drilldown, CLI renders adoption and governed
   worktree-review summaries from shared projection data, and model-facing
   managed invocation resources include de-duplicated governed review pointers.
   Slice 5 is closed in code after Slice 5P; paginated transcript/artifact
   content reads are deferred until storage exposes stable content boundaries
   and a shared resource-read contract exists. Slice 6A-E are complete in
   code: core work-governance now projects adoption-gate state from structured
   adoption evidence, goal closeout consumes that projection, and governed
   managed child result handoff evidence must be structured with matching work
   item, orchestration, child, summary, timestamp, and resource pointers before
   `managed-orchestration:result-handoff` can satisfy child completion or goal
   closeout. Managed child terminal failures now record blocked missing
   evidence through the canonical work item execution closeout path instead of
   remaining silent runtime absence, and code-writing child adoption now
   requires core-owned diff, verification, review, and adoption readiness.
   Worktree-backed child conflicts now return governed denied admission
   decisions with `resourceLease.worktreeConflict` evidence, shared operator
   projection/view attention, CLI rendering, and model-facing managed resource
   pointers instead of runtime-only overlap errors.
   This track owns the runtime primitive behind future background agents and
   should absorb transitional `kiln run --workers` behavior into the shared
   lifecycle.

1.1. [Answer-Only Eval Output](./01.1-answer-only-eval-output.md)
   Added on 2026-05-21. Scope is the CLI/eval output boundary discovered during
   local Codex CLI vs Kiln CLI testing: benchmark harnesses need deterministic
   assistant-only or structured output so exact-format evals do not grade Kiln
   operator telemetry as part of the answer.

2. [Native Operator Surface](./02-native-operator-surface.md)
   Started on 2026-05-15. Current scope is the native operator surface benchmark
   path: contract-only runner admission, orchestration planning, workload
   governance, and approval evidence before any live browser or native
   benchmark execution. It does not implement Rust optimization.

3. [Session Feedback Pipeline](./03-session-feedback-pipeline.md)
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
- Managed agent invocation, write authority, and live adapter hardening.
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
- Native operator surface foundation and embedded browser operator capability.
- Native operator surface projection foundation with defer/no-promotion status.

## Execution Priority

1. Keep active roadmap work limited to the explicit scope in its roadmap file.
2. Promote stable results into architecture or guide docs when a track closes.
3. Delete completed roadmap files after doctrine is absorbed.
4. Do not create near-duplicate roadmap files for one concern.
5. Do not add background or parallel child execution paths outside
   `01-background-parallel-agent-surface.md`; child lifecycle, worktree/sandbox
   leases, cancellation, status, join, handoff, and cockpit projection must use
   the shared runtime-owned lifecycle.
6. Do not start live native benchmark execution, native operator UI, dispatch
   paths, or gateway attach loops without an approved native-surface roadmap
   slice or ADR.
7. Do not start Rust/WASM/sidecar modules without an approved Rust optimization
   roadmap slice or ADR and the Rust module promotion gates in `00.0.1`.
