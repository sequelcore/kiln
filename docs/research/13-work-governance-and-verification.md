# Work Governance And Verification

## Purpose

This note records the research basis for Kiln's work-governance posture:
operator intent should become structured, delegated, verified work rather than
remaining a prompt-engineering exercise.

The active doctrine lives in `docs/architecture/work-governance.md`.

## External Patterns

OpenAI's Agents SDK exposes agents, handoffs, guardrails, sessions, and tracing
as runtime primitives. The relevant lesson for Kiln is not to copy SDK shape,
but to treat delegation, guardrails, and trace evidence as first-class runtime
state instead of optional prompt instructions.

Anthropic's Claude Code guidance distinguishes small clear edits from uncertain
or multi-file work. Plan mode, subagents, hooks, and deterministic stop checks
all point to the same operational principle: when the work is broad or risky,
the system should plan, delegate, and verify rather than relying on a single
linear chat answer.

OpenCode exposes primary agents and subagents through project or user
configuration. Community usage shows useful delegation patterns, but also
recurring friction around when subagents retain context, how slash commands
behave inside delegated tasks, and how model/provider configuration is applied.
Kiln should therefore treat native harness agents as projection targets, not as
the canonical work-governance contract.

Verifier-in-the-loop projects such as `lemmafit` show the strongest form of
agentic correctness: the model proposes code or specs, a deterministic verifier
produces feedback, and the agent repairs until the proof obligations pass.
Kiln should not require formal verification for all work, but it should
represent verifier output as stronger evidence than model self-confidence.

## Paper Direction

Recent multi-agent orchestration research converges on:

- plan-execute-verify-replan loops
- structured goals and dependency visibility
- human oversight of multi-agent execution
- objective verifier feedback instead of self-critique alone
- bounded agent access to prior results and context

These patterns support Kiln's control-plane thesis. The key primitive is not
"more agents"; it is a governed work lifecycle with observable state and
evidence.

## Product Implications

Kiln should make orchestration the default posture for non-trivial work while
retaining a direct-execution envelope for small, low-risk tasks.

The parent agent should act as conductor and accountable closer:

- classify the work
- map the affected surface
- form risk hypotheses
- split work into bounded items
- select configured agents/routes by capability and authority
- collect verification evidence
- report residual risk

Child agents should not return only prose. They should return route identity,
authority identity, evidence produced, checks run, files touched, and residual
risk.

## Limits

Work governance must not become hidden prompt bloat. The policy needs typed
config, admission, events, and surface projection. Prompt/context projection is
only the first executable slice because current parent models need to see the
policy before deeper workflow primitives exist.

Formal verification must remain selective. It is appropriate for crisp logic
and state-machine invariants, not for every UI, integration, or exploratory
task.
