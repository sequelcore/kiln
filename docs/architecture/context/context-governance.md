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
- skill and procedural context
- cross-agent coordination state
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

- `memory`: scoped user/session memory
- `summary`: runtime continuity and compacted turn state
- `procedural`: active skills and reusable execution recipes
- `coordination`: cross-agent memory, handoff state, and swarm state

Storage and retrieval remain owned by their subsystems. Context admission is
owned by the governor.

## Runtime Contract

An admitted runtime turn passes a `GovernedRuntimeContext` to the orchestrator.
If governed content is present, it must carry a `DefaultContextGovernor` audit.
Raw object-wrapped strings are rejected at the prompt assembly seam.

Runtime assembles the provider system prompt as one `EffectivePromptManifest`.
The manifest records ordered static, dynamic, and deferred components, then
produces the only string that may be sent to the provider. Routing-owned
suffixes are reconciled into that manifest before invocation. Provider-request
telemetry fails closed if the manifest and transmitted system prompt differ.

`ContextGovernor` still owns admission and deferral. The prompt manifest does
not rank, admit, truncate, or recover context; it describes the exact result of
those decisions. Request evidence contains hashes, scopes, and token estimates,
not prompt text or caller-controlled provenance strings.

Direct API, webhook, WebSocket, CLI, GUI, and TUI paths must not assemble raw
prompt memory such as `combinedMemory` after admission. Route-local retrieval
may remain as input collection, but model admission goes through the governed
projection.

### Model-Facing Conversation Projection

The canonical transcript and the model-facing conversation are different
projections of the same session. Kiln always retains the complete transcript
for replay, operator inspection, resources, and future continuation. Before
each provider request, runtime applies one deterministic cross-provider
projection to accumulated tool results:

- below the configured tool-result threshold, the original message array is
  passed through unchanged;
- above the threshold, oldest tool-result payloads are replaced with stable
  disclosure placeholders until the projection is within budget;
- the most recent configured number of tool results is always retained so the
  model can continue the active tool loop;
- assistant `tool_use` parts, user `tool_result` identity, error state, and
  message order are preserved;
- the canonical transcript is never mutated by projection.

The default `tool-result-clearing-v1` policy triggers at 24,000 estimated tool
result tokens and retains the three most recent results. Runtime execution
envelopes may override both positive integer values. Each provider-request
record carries the policy, original/projected token estimates, cleared tool-use
ids, and overflow state. Request byte/hash evidence is measured from the exact
projected messages sent to the provider.

This local deterministic policy is the portable baseline across Codex OAuth,
OpenCode, native harnesses, and API providers. Provider-native compaction can
remain an additional transport optimization, but it cannot become Kiln's
canonical transcript owner or silently change replay state. This separation
matches the server-side editing/full-client-history boundary documented by
[Anthropic context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing)
and the canonical compacted-window continuation model documented by
[OpenAI compaction](https://developers.openai.com/api/docs/guides/compaction).

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
- runtime continuity content is scoped to the same logical session identity;
  task-shape similarity alone never admits another session's summaries or tool
  outcomes
- cached continuity is non-authoritative. Goal, work-item, attempt, invocation,
  approval, authority, and execution state must be re-read from canonical tools
  or resources before use
- cross-session continuity feedback may aggregate strategy, latency, token, and
  outcome measurements, but it must not transport raw tool results or
  state-bearing identifiers into a new model turn
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
- each runtime provider request identifies the exact effective prompt without
  persisting its text
- a summary candidate cannot establish live operational authority or resource
  existence
