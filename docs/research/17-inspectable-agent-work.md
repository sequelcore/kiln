# Inspectable Agent Work Research

Date: 2026-06-24

## Problem

Agent users do not only need a final answer. They need to inspect what happened:
what the agent attempted, which tools or subagents ran, what authority was used,
which evidence was produced, where failures occurred, and what remains unsafe
to claim. This matters more as work becomes long-running, delegated,
multi-harness, or expensive.

The product gap is not solved by adding a prettier dashboard. Dashboards,
traces, hooks, transcripts, and logs are useful only when they project the same
canonical evidence contract across surfaces and harnesses.

## External Basis

OpenAI Agents positions tracing as part of building, debugging, and evaluating
agent workflows. Its tracing model records spans for model generations, tool
calls, handoffs, guardrails, and custom events, then exposes traces for
inspection and monitoring.

Source: https://openai.github.io/openai-agents-python/tracing/

OpenAI's Agents platform guidance also frames inspect-and-improve workflows
around traces, evaluations, and observability instead of only final model
responses.

Source: https://developers.openai.com/api/docs/guides/agents

Claude Code hooks expose harness lifecycle points where projects can run shell
commands, HTTP callbacks, or LLM prompts. Hooks are useful evidence-adapter
points, but they are harness-specific and therefore cannot be the canonical
cross-harness contract by themselves.

Source: https://code.claude.com/docs/en/hooks

LangSmith markets traces, human review queues, evaluations, cost/latency
diagnostics, and agent observability as core infrastructure for debugging and
improving agent behavior. That supports Kiln's separation between evidence
capture, review, and verification.

Sources:

- https://www.langchain.com/langsmith-platform
- https://www.langchain.com/langsmith/observability

Human-AI interaction guidance from Microsoft Research emphasizes that systems
should make clear what the AI can do, what it is doing, and how users can
intervene or recover when behavior is uncertain. Kiln applies that principle at
the work-contract level: lifecycle, authority, evidence, and next action must
be visible as structured state.

Source: https://www.microsoft.com/en-us/research/wp-content/uploads/2019/01/Guidelines-for-Human-AI-Interaction-camera-ready.pdf

## Kiln Implication

Kiln should treat inspectable work as a native evidence-plane requirement:

- Work state must be replayable from canonical session events.
- Work items must expose expected evidence, provided evidence, verification
  gates, attempts, pauses, and residual risk.
- Managed invocations must expose route identity, provider/model proof,
  authority profile, capability snapshot, transcript/resource links,
  diagnostics, handoff, and write evidence.
- Long-running work must expose stable ids, current phase, latest event,
  staleness or heartbeat evidence, bounded summaries, control availability, and
  resource links while running.
- GUI, native, TUI, CLI, SDK/widget, IDE, remote surfaces, Claude Code, Codex,
  OpenCode, and direct-provider harnesses must all degrade through the same
  contract.

The implementation should reuse existing Kiln primitives instead of creating a
parallel dashboard database:

- `session_event` history
- `@kilnai/gateway-contracts` presentation projections
- operator cockpit projection
- governed work-item resources under `kiln://session/work-items`
- managed invocation resources under `kiln://managed-agents/invocations/...`
- artifact resource links for large outputs, transcripts, diffs, diagnostics,
  and result handoffs

## Product Standard

Inspectable work should answer five operator questions without requiring the
operator to parse raw logs:

1. What is this agent doing?
2. Why is it allowed to do that?
3. What evidence has it produced?
4. What is missing, failed, risky, or unavailable?
5. What governed action can happen next?

Any surface that cannot answer those questions from canonical state is not a
complete operator surface for long-running or delegated work.

## Current Local Evidence

The repository already contains the core primitives:

- `docs/architecture/core/session-model.md` defines canonical session events,
  activity frames, shared presentation, and resource links.
- `docs/architecture/surfaces/operator-surfaces.md` requires surfaces to consume shared
  gateway/operator contracts instead of inventing local state.
- `docs/architecture/core/work-governance.md` defines governed work items,
  execution attempts, evidence gates, verification results, and residual-risk
  closeout.
- `docs/architecture/coordination/managed-agents.md` defines managed invocation capability
  snapshots, lifecycle events, handoffs, diagnostics, resources, and replay.
- `packages/gateway-contracts/src/operator-cockpit-projection.ts` projects
  timelines, managed invocations, tool summaries, resources, costs, and
  adoption/attention evidence.
- `packages/gateway-contracts/src/operator-cockpit-view-state.ts` projects
  managed-agent attention, lifecycle timeline, transcript URI, resource URIs,
  and cancel availability.

The missing piece was a named architecture standard that binds those primitives
into one cross-surface/cross-harness inspectability contract.

## Decision

Promote inspectable agent work to canonical architecture in
`docs/architecture/surfaces/inspectable-agent-work.md`.

The first implementation slice is documentation-only because the current code
already exposes the necessary primitives for work items, managed invocations,
resources, timelines, and shared presentations. Future slices should add code
only when a surface or harness cannot answer the five product-standard
questions from canonical state.
