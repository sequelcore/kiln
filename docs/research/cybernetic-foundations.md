# Cybernetic Foundations

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

## Stability Risks

Cybernetic framing also makes the risks explicit:

- oscillation
- mode thrashing
- escalation cascades
- context saturation
- budget boundary instability
- coordination deadlock

These risks must be designed against, not discovered accidentally in runtime.

## Limits

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
