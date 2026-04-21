# Subsystems

## Overview

Kiln is composed of explicit subsystems with bounded responsibilities. Each
subsystem should own its state, publish its transitions, and avoid leaking
policy into unrelated layers.

## Ingress

**Responsibility:** Receive all external input, perform fast-path gate
evaluation, authenticate, resolve tenant, and pass pre-validated requests to
downstream subsystems.

**Inputs:** Raw HTTP requests, WebSocket frames, webhook payloads, CLI stdin,
email, cron ticks.

**Outputs:** Validated `IngressRequest` with tenant identity, authenticated
principal, parsed message content, and fast-path results.

**Owned state:** None. Ingress is stateless per request.

**Invariants:**

- Every request passes through ingress before reaching any actuator.
- Fast-path evaluation completes before any LLM is invoked.
- Auth failures stop the request immediately.
- Rate-limit failures never silently overflow.

**Failure modes:**

- Auth unavailable -> fail-closed.
- Rate limiter unavailable -> fail-open with warning.
- Budget service unavailable -> current design remains fail-open, but this is a
  policy decision, not an accident.

## Context Governance

**Responsibility:** Assemble the full context window for the turn, manage the
attentional bottleneck, and enforce token budget per layer.

**Inputs:** `AgentTarget`, `SessionState`, `MemoryStore`, `KnowledgeStore`,
`SkillRegistry`, `ComplexityScore`.

**Outputs:** `AssembledContext` within token budget.

**Owned state:** Current per-turn `ContextBudget`.

**Invariants:**

- Context assembly stays within token budget.
- Knowledge injection is salience-ranked, not arbitrary.
- Contact context leads the merged memory block.
- Truncation happens by governed policy, not ad hoc dropping.

**Failure modes:**

- Knowledge timeout -> skip that layer with warning.
- Budget overflow -> truncate or summarize by policy.
- Summarization failure -> emit error, do not silently erase context.

## Memory

**Responsibility:** Persistent storage across scoped layers with explicit
retention, decay, forgetting, and reconsolidation policy. Separate mutable
operational memory from immutable audit memory.

**Inputs:** `memory_store`, `memory_recall`, `memory_forget`, checkpoint
signals, GDPR delete signals.

**Outputs:** recalled entries, write results, delete confirmations.

**Owned state:**

- Layer 0: `SessionState`
- Layer 1: `MemoryStore`
- Layer 2: `KnowledgeStore`
- Audit: append-only log

**Invariants:**

- No cross-scope leakage.
- GDPR forget is explicit and complete.
- Reconsolidation uses `topic_key` plus scope, not silent overwrite.
- Decay policy is explicit and layer-specific.

**Failure modes:**

- mutable store write failure -> emit error and fail operation
- vector store unavailable -> degrade to FTS5 retrieval
- decay job failure -> retry later, do not silently mutate policy

## Safety

**Responsibility:** Multi-layer threat detection and enforcement across input,
tool output, and model output.

**Inputs:** all content entering or leaving the system.

**Outputs:** `SafetyResult` and `SafetySignal` events.

**Owned state:** threat signatures, tenant safety policy, approval queue.

**Invariants:**

- fast detection layers are fail-closed
- any fail-open behavior is an explicit layer exception
- every block is auditable
- safety interrupts abort the current operation

**Failure modes:**

- regex scanner pathological behavior -> bounded timeout and controlled
  degradation
- LLM judge unavailable -> degraded analysis path with explicit warning
- escalation queue unavailable -> block rather than silently bypass

## Orchestration

**Responsibility:** Run the agent loop, own the canonical admitted-turn
handoff, invoke providers, execute tool loops, enforce gates, manage
checkpoints, and emit turn-level events.

**Inputs:** `AssembledContext`, `AgentTarget`, session configuration.

**Outputs:** `TurnResult`, updated session state, cost and safety signals.

**Owned state:** session state, phase-machine state, checkpoints.

**Invariants:**

- admitted API, TUI, and GUI turns converge on one canonical runtime handoff
- every tool call goes through authorization and policy
- safety scans tool results before reinjection
- deny-by-default tool execution remains in force
- phase gates block entry instead of retroactive abortion
- transport gateways do not keep a separate long-lived turn pipeline after
  admission

**Failure modes:**

- provider unavailable -> circuit breaker and fallback chain
- tool timeout -> retry policy then fail
- phase gate failure -> halt with approval or gate event
- context exhaustion mid-turn -> compaction path, not silent collapse

## Tool Execution

**Responsibility:** Authorize and execute tool calls, enforce allowlists, rate
limits, sandbox rules, and sanitize results before re-entry.

**Inputs:** `ToolCall`, `ToolExecutionRequest`, `AuthorityDescriptor`, `ToolExecutionContext`.

**Outputs:** sanitized `ToolResult`, authority decisions, and runtime-visible
authority projections consumed by routing, audit, and operator surfaces.

**Owned state:** tool registry, sandbox policy, rate-limit counters.

**Invariants:**

- authorization occurs before execution
- request authority descriptors take precedence when present and valid
- malformed authority descriptors are denied (fail closed)
- destructive actions require approval unless policy explicitly says otherwise
- rate limits queue or reject, never silently overflow
- result sanitization happens before reinjection
- runtime-visible authority projections are derived from execution policy, not
  independent evaluators
- operator-attached surfaces default fail-closed when no richer authority
  source is in scope

**Failure modes:**

- missing tool binary -> explicit error
- rate-limit overflow -> reject and emit event
- sandbox violation -> deny and audit

## Adaptation

**Responsibility:** Adjust operating parameters using observed outcomes while
keeping behavior bounded and auditable.

**Inputs:** outcome events, cost records, safety events.

**Outputs:** threshold updates, specialization updates, allostatic load
updates.

**Owned state:** threshold profiles, specialization index, allostatic load
accumulator.

**Invariants:**

- adaptation uses bounded, rate-controlled adjustment
- thresholds have floor and ceiling bounds
- persistent adaptation requires explicit enablement
- reset remains available

**Failure modes:**

- missing outcome signals -> no-information, no update
- oscillation -> pause adaptation and emit alert

## Telemetry And Audit

**Responsibility:** Provide the sensor fabric for the control system through
events, metrics, traces, and append-only audit records.

**Inputs:** all subsystem events and state transitions.

**Outputs:** event streams, Prometheus metrics, traces, audit log entries.

**Owned state:** ring buffer, metric accumulators, trace context, audit log.

**Invariants:**

- every significant transition emits a typed event
- audit remains append-only with integrity chain
- active-session event buffering stays available
- metric cardinality remains bounded
- tool-execution authority is carried by authority-bearing execution and
  orchestration records, not by unrelated middleware rows
- safety and security middleware audit rows must remain explicitly
  non-authority surfaces

**Failure modes:**

- telemetry export failure must not block operation
- subscriber crash must be isolated
- observability degradation must remain visible

## Identity And Policy

**Responsibility:** Compile operator intent into runtime policy that other
subsystems enforce.

**Inputs:** `app.yaml`, `gateway.yaml`, permission policy, tenant safety
configuration.

**Outputs:** compiled `RuntimePolicy`.

**Owned state:** per-session compiled runtime policy.

**Invariants:**

- policy is compiled before execution
- safety-critical policy is not silently hot-reloaded
- policy version is explicit and auditable
- no subsystem may bypass compiled policy through hidden local logic

**Failure modes:**

- YAML or policy conflict -> reject at load time
- conflicting rules -> fail fast, no runtime guesswork
