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

OpenAI's guardrails and human-review guidance explicitly separates automatic
checks from approval decisions: guardrails validate behavior, while human review
pauses a run until a person or policy approves or rejects a sensitive action.
This supports Kiln's split between projected instructions and runtime-owned
approval/admission state.

Anthropic's Claude Code guidance distinguishes small clear edits from uncertain
or multi-file work. Plan mode, subagents, hooks, and deterministic stop checks
all point to the same operational principle: when the work is broad or risky,
the system should plan, delegate, and verify rather than relying on a single
linear chat answer.

Claude Agent SDK subagents are explicitly separate agent instances used to
isolate context, run parallel analysis, and apply specialized instructions.
That makes them useful adapter targets, but it also confirms that subagent
availability is harness-specific rather than a universal cross-harness contract.

OpenCode exposes primary agents and subagents through project or user
configuration. Community usage shows useful delegation patterns, but also
recurring friction around when subagents retain context, how slash commands
behave inside delegated tasks, and how model/provider configuration is applied.
Kiln should therefore treat native harness agents as projection targets, not as
the canonical work-governance contract.

OpenCode's configuration model supports custom config paths and directories, as
well as managed settings. That provides concrete projection mechanisms for
Kiln-launched or governed OpenCode use, but it does not make OpenCode config the
canonical policy source for Claude Code, Codex, direct providers, GUI, TUI, or
replay surfaces.

MCP security guidance reinforces the same boundary. Exposing tools is not the
same as granting authority: MCP deployments must preserve per-client consent,
validate redirects and state, and avoid token-passthrough patterns that bypass
accountability and audit controls. Kiln should therefore treat MCP as a tool
surface and authorization integration, not as a substitute for work governance.

NIST's AI Risk Management Framework frames governance as a cross-cutting,
continual function with documented roles, policies, monitoring, inventory, and
accountability. That supports Kiln's product posture that agent governance must
be durable control-plane state across surfaces, not session-local prompt text.

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

The implementation implication is a typed work contract: workflow profiles for
common task shapes, session-scoped work items for decomposition, evidence gates
that fail closed before closeout, and managed-child handoff fields that carry
expected evidence and done criteria through canonical session events.

Cross-harness execution needs one additional rule: if a projected policy asks
for a delegated agent, approval, review, or tool route that the active harness
cannot actually provide, Kiln must degrade through admitted capability evidence.
The parent can use another admitted managed route, continue locally only when
the required evidence gates can still be satisfied, or pause with a typed
missing-capability requirement. It must not fabricate delegation evidence,
create transient project memory files, or treat native harness instructions as
runtime authority.

## Limits

Work governance must not become hidden prompt bloat. The policy needs typed
config, admission, events, and surface projection. Prompt/context projection is
only the first executable slice because current parent models need to see the
policy before deeper workflow primitives exist.

Formal verification must remain selective. It is appropriate for crisp logic
and state-machine invariants, not for every UI, integration, or exploratory
task.

## Sources

- OpenAI Agents, guardrails and human review:
  https://developers.openai.com/api/docs/guides/agents/guardrails-approvals
- Model Context Protocol security best practices:
  https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices
- NIST AI Risk Management Framework Core:
  https://airc.nist.gov/airmf-resources/airmf/5-sec-core/
- Claude Agent SDK subagents:
  https://code.claude.com/docs/en/agent-sdk/subagents
- OpenCode configuration:
  https://opencode.ai/docs/config/
