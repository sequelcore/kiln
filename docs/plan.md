# Inspectable Agent Work Plan

Date: 2026-06-24
Status: Documentation slice completed on 2026-06-24

## Objective

Resolve the next memo problem: operators need inspectable agent work, not only
final text. Kiln must solve this natively across surfaces and harnesses so
Claude Code, Codex, OpenCode, GUI, native, TUI, CLI, SDK/widget, IDE, remote,
and direct-provider routes converge on one evidence contract.

## Problem

Agent work becomes hard to trust when the only artifact is a final assistant
message or an unstructured raw transcript. Long-running work, delegated child
work, background execution, external tools, verification gates, and residual
risk all require inspectable structured state. If every surface invents its own
dashboard rows, task badges, terminal summaries, or hook logs, the operator
cannot reliably tell what happened or what is still unsafe to claim.

## Decision

Kiln treats inspectable agent work as a session evidence-plane contract:

- canonical session events are the replay source
- work items carry expected/provided evidence, attempts, verification gates,
  pauses, and residual risk
- managed invocations carry route, provider/model proof, authority,
  capability snapshots, handoffs, diagnostics, transcripts, resources, and
  write evidence
- gateway contracts project shared event presentation and cockpit state
- resource links carry large artifacts instead of inline transcript dumps
- external traces, hooks, and provider logs are adapter inputs, not the
  canonical source of truth

## Implementation Slices

1. Documentation baseline
   - Add `docs/architecture/inspectable-agent-work.md`.
   - Add research basis in `docs/research/17-inspectable-agent-work.md`.
   - Link both documents from their canonical README files.
   - Update the private memo with the decision and remaining follow-up.

   Status: completed on 2026-06-24.

2. Contract audit follow-up
   - For each surface, verify it can answer the five operator questions from
     canonical state:
     1. What is this agent doing?
     2. Why is it allowed to do that?
     3. What evidence has it produced?
     4. What is missing, failed, risky, or unavailable?
     5. What governed action can happen next?
   - Add code only where a projection or surface cannot answer those questions.

3. Surface follow-up
   - Audit GUI, native, and TUI managed-agent cockpit panels for parity with
     the named inspectable-work contract.
   - Add focused tests before changing behavior.

   Status: completed on 2026-06-24 for managed invocation recovery and phase
   completion next-action visibility. GUI, native, and TUI now render the
   governed next tool chain, work item id, reason, evidence labels, required
   tools, and source resources from shared cockpit view state.

4. Work-item visibility follow-up
   - Make GUI work items expose their canonical resource URI from session event
     state.
   - Render the authority profile alongside workflow and surface metadata.
   - Wire the Work surface to the shared resource opener so operators can open
     `kiln://session/work-items/{id}` from the app, not only from tests.

   Status: completed on 2026-06-24 for GUI work-item inspectability. The Work
   surface now shows authority metadata, evidence gaps, and an inspectable
   canonical work-item resource action backed by the gateway resource plane.

5. TUI work-item parity follow-up
   - Preserve canonical work-item resource URI, authority profile, missing
     evidence, and residual-risk state in the TUI work-item projection.
   - Render those fields in the Work sidebar so terminal operators can answer
     why work is allowed and what evidence/risk is still missing.

   Status: completed on 2026-06-24 for TUI work-item inspectability. The TUI
   sidebar now surfaces authority, missing evidence, residual-risk, and
   `kiln://session/work-items/{id}` resource identity from canonical work-item
   events.

6. CLI goal work-item parity follow-up
   - Load linked governed work items during `kiln goal inspect` so the CLI
     plain-text view shows more than goal-level IDs.
   - Render canonical work-item resource URI, authority profile, route/agent
     assignment, evidence counts, and missing evidence during goal inspection.
   - Render the next work item's resource URI, authority profile, and missing
     evidence during `kiln goal resume`.

   Status: completed on 2026-06-24 for CLI goal work-item inspectability.
   `kiln goal inspect` and `kiln goal resume` now expose linked work-item
   authority, evidence gaps, and `kiln://session/work-items/{id}` identity
   from canonical session events.

7. Native work-item parity follow-up
   - Project governed work items from native gateway cockpit session events
     without introducing native-owned work state.
   - Render a native Work Items panel with status, summary, authority profile,
     agent assignment, evidence count, missing evidence, pause count, and
     `kiln://session/work-items/{id}` resource identity.

   Status: completed on 2026-06-24 for native work-item inspectability. The
   native operator surface now derives governed work-item visibility from the
   same canonical event stream used by the managed-agent cockpit.

8. Shared presentation and resource-plane follow-up
   - Add canonical work-item resource URI rows to shared operator event
     presentation for work-item update and execution events.
   - Derive missing evidence from the work item itself when presentation
     payloads omit top-level closeout fields.
   - Enrich `kiln://session/work-items` and
     `kiln://session/work-items/{id}` resource reads with canonical
     `resourceUri` and derived `missingEvidence` fields without mutating the
     work-item store.

   Status: completed on 2026-06-24 for upstream inspectable-work contracts.
   New and existing surfaces can now consume the shared presentation/resource
   plane for work-item resource identity and evidence gaps instead of
   re-deriving them locally.

9. SDK consumer closeout
   - Export a typed SDK resource shape for `kiln://session/work-items` reads
     that includes canonical work-item data plus projection-only
     `resourceUri` and `missingEvidence` fields.
   - Verify the React SDK package (`@kilnai/react`) exposes the enriched
     contract for Studio and external consumers.
   - Keep the embeddable widget unchanged because it is a chat transport
     surface and does not consume the session resource plane directly.

   Status: completed on 2026-06-24 for SDK consumer inspectability. SDK
   consumers can now type resource-enriched work-item reads without creating
   local parallel models, while the widget remains scoped to chat frames.

10. Managed invocation resource-bundle closeout
   - Include admitted source resource URIs in managed invocation aggregate and
     resource-bundle reads, not only child-produced transcript, handoff, write,
     diagnostic, and lease resources.
   - Preserve the existing canonical resource projection while adding an
     explicit `sourceResourceUris` field for replay, remote, IDE, and SDK
     consumers that need to trace which governed resources the child received.

   Status: completed on 2026-06-24 for managed invocation resource bundles.
   Consumers following `kiln://managed-agents/invocations/{id}/resources` can
   now see both admitted source context and produced evidence from one
   canonical bundle.

11. Operator cockpit source-resource closeout
   - Preserve admitted source resource URIs in the shared managed invocation
     cockpit projection.
   - Include those source resources in UI-facing managed-agent resource lists
     so GUI, native, TUI, replay, remote, IDE, and SDK consumers inherit the
     same source/evidence visibility from gateway contracts.

   Status: completed on 2026-06-24 for shared cockpit projection. Managed
   invocation view state now carries source work-item/context resources through
   the same read-only projection used by operator surfaces.

12. Replay and session-event source-resource closeout
   - Add source resource URIs to canonical managed invocation lifecycle
     evidence.
   - Persist source resources in runtime managed invocation terminal events so
     replayed sessions do not need to infer them from transient request state.
   - Verify replay normalization preserves source resources from persisted
     managed-agent tool evidence.

   Status: completed on 2026-06-24 for replay/session persistence. Managed
   invocation source context now survives core lifecycle evidence, runtime
   session events, and gateway replay normalization.

13. Operator event presentation source-resource closeout
   - Preserve managed invocation lifecycle `sourceResourceUris` in shared
     operator event details.
   - Render source resources beside lease resources and diagnostics so
     conversation, activity, inspector, replay, remote, IDE, and SDK consumers
     that rely on shared presentation can inspect admitted context without
     local inference.

   Status: completed on 2026-06-24 for shared operator event presentation.
   Managed invocation events now expose source resource rows through the same
   canonical presentation path used for route, lease, diagnostic, and child
   identity evidence.

## Verification Criteria

- Architecture docs define a cross-surface and cross-harness contract.
- Research docs cite external observability, tracing, hook, and human-AI
  interaction sources.
- Public docs contain no private X source list, handles, tweet ids, or secrets.
- `git diff --check` passes.

## Verification

- Passed: `bun run --cwd packages/gui test tests/managed-agent-cockpit-panel.test.tsx`
- Passed: `bun run --cwd packages/native test tests/managed-agent-cockpit-panel.test.tsx`
- Passed: `bun run --cwd packages/tui test tests/managed-agent-cockpit.test.ts`
- Passed: `bun run --cwd packages/gui test tests/work-items-panel.test.tsx`
- Passed: `bun run --cwd packages/gui test tests/session-store.test.ts`
- Passed: `bun run --cwd packages/gui test tests/app-shell-sidebar-modes.test.tsx`
- Passed: `bun run --cwd packages/tui test tests/handlers-managed-agent.test.ts tests/render-work-items.test.ts`
- Passed: `bun run --cwd packages/cli test src/commands/goal.test.ts`
- Passed: `bun run --cwd packages/native test tests/native-boundary.test.ts tests/work-items-panel.test.tsx`
- Passed: `bun run --cwd packages/gateway-contracts test tests/operator-event-presentation.test.ts`
- Passed: `bun run --cwd packages/core test tests/tools/domain/tool-resource-registry.test.ts`
- Passed: `bun x tsc --noEmit --module NodeNext --moduleResolution NodeNext --target ES2022 --jsx react-jsx --skipLibCheck packages/sdk/tests/resource-exports.test.ts`
- Passed: `bun run --cwd packages/sdk test tests/resource-exports.test.ts`
- Passed: `bun run --cwd packages/runtime test tests/managed-agent/resource-provider.test.ts`
- Passed: `bun run --cwd packages/gateway-contracts test tests/operator-cockpit-projection.test.ts tests/operator-cockpit-view-state.test.ts`
- Passed: `bun run --cwd packages/core test tests/managed-agent/invocation-contracts.test.ts`
- Passed: `bun run --cwd packages/runtime test tests/session/managed-invocation-session-events.test.ts`
- Passed: `bun run --cwd packages/gateway-contracts test tests/operator-cockpit-projection.test.ts`
- Passed: `bun run typecheck`
- Passed: `git diff --check`
- Passed: public leakage scan for files changed in this slice
