# Work Governance

Work governance is Kiln's canonical contract for turning operator intent into
bounded, delegated, verified work. It is not prompt engineering. Prompt text is
only one input to the control plane.

Kiln treats non-trivial work as a governed lifecycle:

1. intent intake
2. surface map
3. risk hypothesis
4. specification or PRD clarification when needed
5. work decomposition
6. route and agent selection
7. delegated execution
8. verification gates
9. adversarial or specialist review
10. evidence summary and residual-risk closeout

Direct execution is an actuator inside that lifecycle, not the default identity
of the system.

## Doctrine

Kiln's default posture is orchestration. Parent agents are conductors,
integrators, and accountable closers. They may execute directly only when the
task is local, low-risk, and inside the configured direct-execution envelope.

The operator should not need magic prompts such as asking whether the model is
"100% confident." Kiln should turn that intent into explicit work evidence:
surface mapping, loophole/risk hypotheses, tests or proof obligations, minimal
fixes, verification, cleanup, and residual-risk reporting.

Model self-review is useful but weak evidence. Stronger evidence comes from:

- executable tests
- typecheck and build results
- browser QA for user-interface changes
- managed-agent specialist review
- security, DDD, and architecture boundary review
- deterministic verifier feedback when a formal-methods workflow applies
- replayable session and artifact evidence

## Orchestration Preference

Kiln should prefer orchestration when work has any of these triggers:

- architecture or bounded-context impact
- security, credentials, permissions, sandboxing, or data-flow impact
- UI/UX behavior or browser-facing surfaces
- runtime, session, memory, tool, or provider-routing changes
- managed-agent, route, model, or evidence-plane changes
- global or project configuration changes
- multi-file or cross-package edits
- cross-surface behavior
- long-running work
- verification-heavy work
- formal-proof candidates

Direct execution is allowed when all of these are true:

- the scope is clear
- the likely file count is inside `workGovernance.directExecution.maxFiles`
- the risk is no higher than `workGovernance.directExecution.maxRisk`
- the required verification is simple and local
- no configured delegation trigger applies

## Configuration Contract

Global and project config may declare:

```yaml
workGovernance:
  defaultPosture: orchestrate
  directExecution:
    maxFiles: 1
    maxRisk: low
  requireDelegationFor:
    - architecture
    - security
    - ui
    - runtime
    - provider-routing
    - managed-agents
    - config
    - multi-file
    - cross-surface
    - long-running
    - verification-heavy
    - formal-proof-candidate
  requiredEvidence:
    - surface-map
    - risk-hypothesis
    - plan
    - tests
    - typecheck
    - residual-risk
```

Global config establishes operator/team defaults. Project `.kiln/kiln.yaml`
may narrow or extend triggers and evidence expectations for the repository.

The resolved policy is projected as required instruction context in CLI, GUI,
TUI, and benchmark sessions. Repo shims also include the resolved policy so
standalone native harness usage sees the same posture. Projection is not the
authority boundary; managed invocations, tools, approvals, and verification
gates still enforce the actual authority.

The same resolved policy is exposed through the read-only
`work_governance.assess` builtin tool in CLI-owned runtime surfaces. Parent
agents should call it when the task may be broad, risky, cross-surface,
provider/runtime-related, UI-related, or verification-heavy. The tool returns
a direct-versus-orchestrate recommendation, matched triggers, reasons, and the
evidence expected before closeout.

## Work Items

Future workflow automation should represent decomposed work with explicit
fields instead of prose-only plans:

- id
- summary
- trigger classification
- risk level
- affected surface
- assigned agent profile
- provider/model route
- authority profile
- expected evidence
- verification gates
- dependencies
- residual risk

This allows GUI, TUI, CLI, SDK, and MCP consumers to render different views of
the same work contract without each surface inventing its own planning model.

## Managed Agents

Managed child invocations are the execution substrate for delegated work. A
child should receive a bounded work item and return:

- substantive result handoff
- route, provider, model, profile, and authority identity
- evidence produced
- checks run
- files read or changed when applicable
- open questions or residual risk

The parent remains accountable for integration and closeout. A child completion
is not the same as task completion unless the required evidence gates are
satisfied.

## Formal Verification Candidates

Formal verification is not a universal requirement. It is appropriate for
small, high-value logic surfaces with crisp invariants: pure domain logic,
state machines, authorization rules, financial calculations, protocol
transitions, scheduling constraints, and concurrency models.

When a task is classified as `formal-proof-candidate`, Kiln should consider a
verifier-backed workflow such as Dafny, TLA+, Alloy, Lean, property tests, or
another deterministic checker. The proof is only as good as the specification,
so spec review remains part of the gate.

## Research Basis

The current market and research direction supports this contract:

- OpenAI Agents SDK documents manager-style orchestration, handoffs,
  guardrails, and tracing as first-class concepts.
- Anthropic Claude Code guidance recommends plan mode for uncertain,
  multi-file, unfamiliar, or higher-risk work, and direct action for tiny
  clear tasks.
- Claude Code and OpenCode both expose subagent concepts, but community usage
  reports show that deciding when to delegate and how to preserve context and
  evidence remains operationally hard.
- Recent multi-agent orchestration papers emphasize plan-execute-verify-replan,
  human oversight, dependency visualization, and objective verifier feedback.
- Verifier-in-the-loop projects such as `lemmafit` demonstrate the strongest
  form of this pattern: model output is corrected by deterministic proof or
  verification feedback, not by confidence language.

Kiln's contribution is to make these patterns provider-neutral, cross-surface,
auditable, and configurable through the control plane.

## Invariants

- Do not encode workflow discipline only as prompt text.
- Do not let GUI, TUI, CLI, SDK, or native harness shims invent different
  orchestration rules.
- Do not treat child completion as task completion without evidence.
- Do not treat self-confidence as proof.
- Do not require delegation for trivial low-risk local work.
- Do not bypass managed invocation authority when delegating.
- Do not hide residual risk at closeout.
