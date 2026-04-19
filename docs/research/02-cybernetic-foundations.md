# Cybernetic Foundations

## Purpose

This document explains why cybernetics is the primary control vocabulary for
Kiln.

It does not restate the full research synthesis and it does not replace the
architecture docs. Its job is narrower: justify the control-plane frame.

## Why Cybernetics Is Central

Cybernetics provides the strongest integrative framework for Kiln because it
describes:

- sensors
- controllers
- actuators
- state
- feedback loops
- setpoints
- corrections
- stability and drift risks

This maps directly to Kiln in a way that is mechanically useful.

Kiln's strongest research conclusion is not that it resembles an organism. It
is that it behaves like a governed control system with explicit sensors,
controllers, actuators, and correction paths.

## Core Concepts

### Setpoints

Configured bounds that define acceptable operation, such as:

- token budget
- approval requirement
- safety sensitivity
- mode transition thresholds

### Error

Deviation from the configured bound. Error should not remain implicit. It
should be measurable and should drive a correction path.

### Correction

A bounded response to error, such as:

- deny
- retry
- fallback
- degrade
- escalate
- lock down

### Feedback

A controller is only real if the effect of its correction is observed. Kiln
must not contain unobserved corrective behavior.

### Regulation Horizons

Not all controls operate on the same time scale. Kiln needs different control
horizons for:

- per-call
- per-turn
- per-session
- longer-lived adaptation

## Homeostasis And Allostasis

The research indicates that Kiln should not stop at homeostatic correction.

It also needs allostatic behavior:

- anticipatory regulation
- pre-emptive budget reservation
- pre-emptive compression
- pre-emptive downgrade or supervision when instability is likely

Reactive control alone is not enough.

## Kiln Control Translation

The cybernetic framing maps cleanly into Kiln:

- sensors: event streams, telemetry, policy detections, provider outcomes,
  budget usage, and coordination state
- controllers: governors, routers, safety pipeline, mode control, and chain
  control
- actuators: provider calls, tool execution, approvals, escalations, fallbacks,
  memory mutation, and mode transitions
- feedback: event emission, metrics, traces, status transitions, and audit
  records

This matters because corrections that cannot be observed cannot be governed.

## Hierarchy And Horizon

Biological control is layered. Kiln needs the same principle without the
biological metaphor:

- local fast loops for cheap and urgent corrections
- slower supervisory loops for policy, adaptation, and long-horizon stability
- explicit handoff between local and supervisory control rather than hidden
  coupling

This is the clean explanation for fast-path gates, slow-path review, circuit
breakers, and mode changes.

## Control Loop Types

The absorbed research material points to four loop types that Kiln should keep
distinct:

- immediate corrective loops for low-latency safety and execution control
- local stabilizing loops for provider health, retry control, and budget
  containment
- supervisory loops for mode changes, routing policy, and cross-subsystem load
- long-horizon learning loops for evaluation, tuning, and doctrine refinement

Mixing those loops into one mechanism creates either latency inflation or
governance blind spots.

## Missing Feedback Paths

The earlier research notes also highlighted missing or weak feedback paths that
still matter:

- user-outcome feedback rather than only internal telemetry
- model-quality drift signals rather than only provider availability signals
- context-quality signals that measure usefulness, not only token count
- explicit verification that corrections improved the state they were meant to
  stabilize

## Stability Risks

Cybernetic framing also makes the risks explicit:

- oscillation
- mode thrashing
- escalation cascades
- context saturation
- budget boundary instability
- coordination deadlock

These risks must be designed against, not discovered accidentally in runtime.

## Limits And Boundaries

Cybernetics is the primary integrative framework for Kiln.

It is not the only useful mechanism source. It should integrate the stronger
biological mechanism families, not erase them.

## Integration Rule

Use cybernetics as the control vocabulary for Kiln, but preserve high-value
mechanism families where they add real design leverage.

In practice:

- cybernetics explains the control logic
- biological mechanism families explain useful subsystem patterns
- neither should be used as branding language
