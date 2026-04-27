# Context Governance

## Purpose

Context governance controls what enters the model context window, in what
order, under what budget, and with what policy.

This is not formatting. It is a control function.

## Canonical Owner

`ContextGovernor` is the owner of admitted-turn context assembly.

Runtime, CLI, gateway routes, and surface adapters may collect or normalize
context inputs, but they do not decide what the model sees. They submit context
candidates to the governor and consume the governed projection plus audit
record.

Context policy should not remain fragmented across:

- prompt builders
- formatters
- loaders
- session managers
- orchestration helpers
- route handlers
- transport gateways

## Inputs

- current session state
- episodic memory
- semantic knowledge
- skill and procedural context
- cross-agent coordination state
- contact and visitor context
- runtime continuity summaries
- complexity signals
- token budget
- operational mode

## Core Duties

- allocate the turn budget
- rank context blocks by salience
- merge blocks in governed order
- enforce truncation and compression rules
- preserve safety-critical context
- emit an audit trail for admitted and deferred blocks

## Attention And Salience

The context window is an attentional bottleneck.

Important consequences:

- complexity should influence budget allocation
- context ranking should consider relevance, recency, and task utility
- retrieval and context injection should not be separate ungoverned decisions

The control-plane version of attention is explicit budget allocation and ranked
selection, not implicit LLM luck.

## Budget Policy

- context is budgeted, not best-effort
- overflow should trigger truncation or summary by rule
- safety-critical context is protected from arbitrary truncation
- lower-priority layers should be reduced before higher-priority control data

## Governed Layers

The governor ranks these context layers under one policy:

- `memory`: scoped user/session memory and contact context
- `summary`: runtime continuity and compacted turn state
- `knowledge`: retrieval and grounding context
- `procedural`: active skills and reusable execution recipes
- `coordination`: cross-agent memory, handoff state, and swarm state

Storage and retrieval remain owned by their subsystems. Context admission is
owned by the governor.

## Runtime Contract

An admitted runtime turn passes a `GovernedRuntimeContext` to the orchestrator.
If governed content is present, it must carry a `DefaultContextGovernor` audit.
Raw object-wrapped strings are rejected at the prompt assembly seam.

Direct API, webhook, WebSocket, CLI, GUI, and TUI paths must not assemble raw
prompt memory such as `combinedMemory` after admission. Route-local retrieval
may remain as input collection, but model admission goes through the governed
projection.

## Coordination Provider Failures

Coordination providers are runtime dependencies because they read operational
state. Their output is normalized before projection:

- provider-supplied kind, source, required flags, and estimated token counts do
  not override governor policy
- scores must be finite and bounded
- malformed provider output is dropped
- provider exceptions do not inject fallback text into model context
- sanitized provider failure metadata is recorded in runtime-local audit data

The shared core audit contract stays provider-agnostic. Runtime-specific
failure labels do not move into `@kilnai/core`.

## Target Design

The current target is:

- one `ContextGovernor`
- one explicit per-turn `ContextBudget`
- one ranking policy
- one truncation policy
- one audit trail for context assembly decisions

## Boundary Rules

- ingress and route layers may normalize input, but they must not own lasting
  turn context assembly after admission
- session managers may surface continuity artifacts, but they must not become a
  second context-policy center
- runtime support seams should emit context and continuity presentation from
  dedicated owners, not from local helper formatting
- skills are procedural context candidates, not a parallel system-prompt
  injection path
- coordination state is a coordination context candidate source, not a hidden
  shared-memory paste into the prompt

## Invariants

- assembled context never exceeds budget
- truncation follows declared order
- memory sparsity or retrieval failure is explicit
- context policy is not hidden in helper utilities
- admitted/deferred context decisions are auditable
