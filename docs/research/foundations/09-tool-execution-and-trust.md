# Tool Execution And Trust

## Purpose

This document captures the research basis for real tool execution, approval
gating, trust boundaries, interrupts, and observability in Kiln.

It consolidates nervous-system gating, immune checkpoint, cybernetic control,
and execution-specific research that does not fit cleanly inside the memory,
safety, or regulation docs alone.

## Core Conclusion

Tool execution should be treated as controlled actuation across trust
boundaries.

The strongest research consequences are:

- tools are actuators, not just capabilities on a list
- approvals are explicit checkpoints, not a UI afterthought
- trust is boundary ownership, not a vague reputation feeling
- interruption and resumption need first-class control ownership

## Gating Before Actuation

The nervous-system analogy is useful only for one point: some actions should be
blocked before they propagate.

That leads to three software rules:

- cheap pre-flight checks should stop obviously unsafe execution early
- ambiguous cases should escalate rather than silently proceed
- irreversible actions should require explicit gate transitions before
  execution

This is the research basis for authorization levels, approval-required states,
and pre-execution sanitization.

## Trust Boundaries

Tool execution crosses boundaries:

- model to runtime
- runtime to local environment
- runtime to external services
- one tenant's policy boundary to another tenant's prohibition boundary

Trust therefore needs explicit ownership in policy, not just in adapters or
wrappers. "Can the model name the tool?" is not the same question as "may this
session execute it now?"

## Approval As Control Loop

Approval belongs to the control system, not merely to the surface layer.

Its role is to:

- pause actuation across a risky boundary
- require stronger evidence before execution
- create an auditable checkpoint in the execution chain

This is why approval should not be buried inside individual tools or
presentation logic.

## Interrupts And Resumption

Interrupts are the execution equivalent of hard safety gates.

The system needs explicit ownership for:

- who may interrupt execution
- what state is captured before interruption
- how resumption verifies that the original trust and approval state still
  holds

Without that, resumptions become hidden privilege escalations.

## Fake Capability Claims

The absorbed research strongly supports one practical rule: advertised
capability and executable capability must stay separate.

Kiln should defend against fake capability claims by requiring:

- registry-backed capability definition
- environment verification where relevant
- policy verification before use
- execution-time observation of what really happened

That is the clean way to stop a model, adapter, or integration from claiming a
capability it cannot actually perform safely.

## Tool Surface Evidence

Two findings from protocol research reinforce the separation above.

Production MCP deployments need infrastructure-level mechanisms around timeouts,
errors, observability, and server contracts; the protocol alone does not make a
deployment reliable. Separately, tool descriptions themselves affect tool-choice
quality, which makes a description part of the executable contract rather than
documentation attached to it.

- [Bridging Protocol and Production: Design Patterns for Deploying AI Agents with MCP](https://arxiv.org/abs/2603.13417)
- [Model Context Protocol Tool Descriptions Are Smelly!](https://arxiv.org/abs/2602.14878)

Retrieval providers show the same gap between advertised and executable
capability. Holding one agent policy fixed and varying only the search provider
produced close final accuracy while snippet support, rank concentration,
contradiction exposure, fetch behavior, tokens, and latency differed materially.
The useful abstraction is therefore a provider's evidence decision surface, not
an accuracy leaderboard.

- [Equal Accuracy, Unequal Evidence](https://arxiv.org/abs/2607.10198)

## Deciding When The System Acts

Approval gating is a human-computer interaction problem as much as a policy one.
Mixed-initiative research argues for coupling automated services with direct
manipulation, and for deciding deliberately when the system acts versus when the
operator stays in control. Human-AI interaction guidelines add that a system
should make its capability clear, support efficient invocation, show context,
handle uncertainty, and enable correction.

The consequence Kiln takes is that a natural request becomes a bounded,
inspectable plan before it becomes authority. The model works over explicit
artifacts the operator can review; it does not receive unbounded execution
authority because a request sounded broad.

- [Horvitz, Principles of Mixed-Initiative User Interfaces](https://erichorvitz.com/chi99horvitz.pdf)
- [Microsoft Research, Guidelines for Human-AI Interaction](https://www.microsoft.com/en-us/research/project/guidelines-for-human-ai-interaction/)
- [CHI 2019](https://dl.acm.org/doi/10.1145/3290605.3300233)

## Direct Kiln Mappings

- tool registries map to declared actuator surfaces
- authorization and approval states map to gate states
- per-session policy and sandbox mode map to boundary-specific trust state
- result sanitization and indirect injection scanning map to post-actuation
  safety review
- event emission, traces, and audit logs map to execution observability
- capability registries and environment checks map to anti-fake-capability
  controls

## Design Consequence

Kiln should keep these concerns distinct:

- tool selection
- execution authorization
- approval gating
- trust-boundary ownership
- interruption and resumption
- capability verification

Blurring them creates dangerous hidden coupling.

## Risks / Misuse

- putting approval logic inside tools will fragment trust enforcement
- resuming execution without revalidating trust state will create unsafe
  privilege carryover
- relying on model claims instead of verified capability will create phantom
  tool support
- treating observability as optional will make actuator failures invisible

## Where The Analogy Breaks

- software actuation is explicit and auditable in ways biological actuation is
  not
- trust boundaries are contractual and tenant-scoped, not physiological
- approvals are governance constructs, not natural inhibitory reflexes

## Actionable Research Follow-Ups

- define which subsystem owns approval as a control loop
- define which subsystem owns trust-boundary state
- define interruption and resumption contracts for tool execution
- define capability-verification rules that block fake capability claims
