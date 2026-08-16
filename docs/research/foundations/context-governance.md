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

## Transport Envelope Is Not Effective Context

HTTP request admission and model context governance solve different problems.
An ingress must accept the serialized history, tool schemas, metadata, and
multimodal references produced by admitted clients while enforcing a hard raw
and decoded byte ceiling against memory exhaustion and decompression bombs.
The ceiling does not establish that every admitted request fits a selected
model or that the model will use all of it reliably.

Current first-party envelopes provide useful interoperability bounds rather
than quality targets: Anthropic documents a 32 MiB Messages limit, while AWS
Bedrock documents 25,000,000 bytes for `InvokeModel`. OpenAI does not publish a
general Responses JSON byte ceiling in the searched documentation; Kiln's
64 MiB Responses ceiling is therefore a local bounded transport policy aligned
with current Codex client behavior and the repository's parser budget, not a
claim about an OpenAI service limit.

Long-context evaluations reinforce the separation. *Lost in the Middle* found
position-sensitive degradation even for long-context models, and RULER found
that effective context can be materially shorter than the advertised window.
Kiln therefore preserves compaction and context selection as quality controls
after transport admission succeeds.

Sources, verified 2026-08-12:

- [Anthropic API errors and request-size limits](https://platform.claude.com/docs/en/api/errors)
- [Amazon Bedrock InvokeModel request contract](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_InvokeModel.html)
- [RFC 9110, 413 Content Too Large](https://www.rfc-editor.org/rfc/rfc9110.html#name-413-content-too-large)
- [Lost in the Middle](https://arxiv.org/abs/2307.03172)
- [RULER](https://openreview.net/forum?id=kIoBbc76Sy)

Repository comparison used current local snapshots of OpenAI Codex
(`32329b289d05eb6a3f8e35c267ceb25ba46716a2`), which zstd-compresses eligible
Responses requests and supports remote compaction, and `codex-router`
(`91a64bc52bb913687845763e45c357b5d0635063`), which defaults to a 64 MiB
bounded body and rejects decoded overflow.

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
