# Regulation And Adaptation

## Purpose

This document captures the research basis for Kiln's regulation model through
homeostasis and allostasis.

## Core Conclusion

Reactive correction is necessary but insufficient.

Kiln needs:

- homeostatic control to keep key variables within acceptable bounds
- allostatic control to anticipate pressure and reconfigure before failure
- explicit accounting for load so adaptation does not become invisible drift

## Homeostasis

Useful for:

- threshold-based correction
- stable operating bounds
- local negative-feedback loops
- clear sensor-controller-actuator design

This supports rate limiting, circuit breaking, threshold checks, and budget
enforcement.

## Allostasis

Useful for:

- predictive regulation
- mode changes before hard failure
- budget reservation before expensive work
- pre-emptive compression, downgrade, or supervision when pressure rises

This is the research basis for treating adaptation as policy-governed
anticipation rather than as an after-the-fact patch.

## Load

Biological allostasis becomes harmful when load accumulates for too long. The
software lesson is that Kiln should make accumulated stress visible.

That means treating persistent combinations of:

- budget pressure
- latency pressure
- repeated retries
- degraded provider health
- coordination instability

as a first-class system condition rather than as isolated metrics.

## Direct Kiln Mappings

- token and cost budgets are homeostatic variables
- context pressure is a regulated load variable
- provider circuit breakers and retry policy are local correction loops
- mode changes and capability downgrade are allostatic responses
- predictive compaction and budget reservation are allostatic rather than
  purely reactive behavior
- rate limiting, approval escalation, and fallback depth are all candidate
  setpoints rather than ad-hoc constants

## Load-Shaping Rules

The regulation research implies a few explicit rules:

- corrections should reduce pressure, not merely move it elsewhere
- retry storms and fallback storms are signs of failed regulation
- persistent degradation should become a mode transition, not an infinite local
  patch
- regulation should account for subsystem tradeoffs rather than optimize one
  metric in isolation

## Allocating Deliberation Effort

Reasoning effort is a regulated resource, and the evidence says the setpoint is
per-task rather than global. Test-time compute can improve difficult reasoning,
but the compute-optimal strategy varies with model and problem difficulty:
difficulty-aware allocation reported more than a fourfold efficiency gain over
best-of-N, from allocation rather than from a larger universal budget. Adaptive
selection can improve efficiency and quality together, with one method reporting
53% shorter average responses alongside 2.4% higher accuracy on its own
evaluation.

The consequence Kiln adopts is that maximum effort is not a default. It is
justified per task class, or by an explicit operator or provider decision, and
an unsupported effort level is omitted rather than guessed. A permanent
route-wide override is exceptional precisely because it forces the same compute
onto difficult and trivial work alike.

- [Snell et al., scaling test-time compute](https://arxiv.org/abs/2408.03314)
- [AdaptThink](https://arxiv.org/abs/2505.13417)

## Design Consequence

Kiln should expose regulation through:

- explicit setpoints
- explicit load signals
- explicit operating modes
- explicit criteria for predictive versus reactive control

Without those, adaptation becomes hidden drift.

## Risks / Misuse

- static thresholds will thrash under changing conditions
- predictive control without observability will become guesswork
- permanent degraded mode will act like chronic allostatic overload
- local optimizations can destabilize the system globally if load is not shared

## Where The Analogy Breaks

- Kiln has budgets, policies, and SLAs instead of hormones and metabolism
- there is no single biological brain-like controller; the software design must
  choose ownership explicitly
- software modes can change instantly in ways biological systems cannot

## Actionable Research Follow-Ups

- define the system's primary regulated variables and their setpoints
- define a first-class load signal or load composite
- formalize when predictive regulation is allowed or required
- keep mode transitions hysteretic and observable
