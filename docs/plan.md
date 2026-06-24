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
- Passed: `bun run typecheck`
- Passed: `git diff --check`
- Passed: public leakage scan for files changed in this slice
