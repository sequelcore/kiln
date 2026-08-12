# Context Governance

## Purpose

This document captures the research basis for Kiln's context-governance model.

It consolidates attention, salience, working-memory, and shared-medium
research that is too specific to live only in the synthesis but too distinct to
smear across unrelated docs.

## Core Conclusion

Context should be treated as a governed working set, not as transcript replay
or a generic prompt assembly problem.

The strongest research inputs are:

- selective attention
- inhibitory control
- working-memory limits
- active shared-medium behavior
- contextual permeability and membrane-like boundaries

## Selective Attention

The useful lesson from attention research is competitive selection:

- many candidate context items compete for a bounded working set
- top-down goals should bias selection toward task-relevant material
- bottom-up novelty should still be able to interrupt when risk or urgency is
  high
- low-value or distracting material should be inhibited, not merely ranked low

This is the research basis for salience scoring, pruning, and context
projection.

## Working Memory Constraint

Working memory is not just "small memory." It is the currently active set that
supports action.

The software consequence is that context governance should explicitly decide:

- what is active now
- what is available for recall but not injected
- what must be suppressed despite availability

Without that separation, token budget logic turns into a crude truncation
mechanism rather than a governance system.

## Active Shared Medium

The fungal and biofilm-derived research is useful here only in one narrow way:
context behaves like an active medium whose properties shape the system.

The important properties are:

- retention
- decay
- permeability
- damping
- reinforcement of hot paths
- controlled dispersal or reset when the current state is maladaptive

This explains why context, memory, and coordination cannot be treated as fully
separate once they interact inside the same working set.

## Context Membranes And Zones

The older research on gradients and compartments translates into a simple rule:
context should cross boundaries by policy, not by accident.

Useful software abstractions are:

- context membranes that define what may cross into a prompt or tool call
- zones with different sensitivity, budget, and sanitization rules
- explicit redaction, allowlist, and denylist behavior at boundaries

This is cleaner than vague talk about "context hygiene."

## Direct Kiln Mappings

- projected CLI context maps to working-memory projection under budget and
  salience rules
- runtime support artifacts map to recallable but not always injected context
- continuity decisions map to whether episodic traces are promoted back into
  the working set
- token budget regulation maps to active inhibition, pruning, and overflow
  handling rather than simple length checks
- knowledge auto-inject versus tool-retrieval is an attentional gating
  decision, not only a product convenience flag

## Design Consequence

Kiln needs explicit rules for:

- salience
- inhibition
- reinforcement
- overflow
- pruning
- dispersal or reset

Those rules should be owned by context governance, even when they rely on
memory or coordination inputs.

## Risks / Misuse

- over-injection will saturate the working set and reduce reliability
- purely semantic ranking without inhibition will preserve too much junk
- overly rigid membranes will hide necessary context and degrade task quality
- treating all context as equally injectable will erase trust boundaries

## Where The Analogy Breaks

- Kiln has no biological consciousness or endogenous drive state
- model attention weights are not a substitute for context policy
- software membranes are explicit rules, not emergent tissue boundaries

## Actionable Research Follow-Ups

- define salience inputs and inhibition rules for context selection
- define overflow and dispersal behavior when the active working set becomes
  maladaptive
- define context zones and membrane policy for prompts, tools, and continuity
- separate recall eligibility from injection eligibility
