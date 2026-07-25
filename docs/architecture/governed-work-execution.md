# Governed Work Execution

## Thesis

Kiln is a domain-agnostic control plane for assigning, executing, reviewing, and
reconciling bounded work across agents, tools, runtimes, and human operators.
Software engineering is Kiln's first deeply integrated workload, not its
architectural boundary.

A coding loop is one workload-specific agent loop. Kiln owns the wider governed
work execution loop around it: admission, route and attachment selection,
authority, context, evidence, approval, review, recovery, replay, and canonical
completion.

This doctrine refines [`identity.md`](identity.md),
[`work-governance.md`](work-governance.md),
[`coordination.md`](coordination.md), and
[`managed-agents.md`](managed-agents.md). It does not create a second workflow,
route, job, evidence, or replay owner.

## Operating Model

The canonical outer loop is:

```text
goal
  -> bounded work item
  -> classification and evidence requirements
  -> route, agent profile, and attachment admission
  -> authorized execution
  -> evidence collection
  -> independent review when required
  -> repair, recovery, or arbitration
  -> canonical reconciliation
  -> completed, blocked, failed, cancelled, or deferred state
```

The outer loop is governed and stateful. It must be reproducible from canonical
records rather than inferred from model prose, terminal history, or a provider's
private task abstraction.

Inside an admitted execution, an agent may use a domain-specific loop such as:

```text
observe -> plan -> act -> inspect -> adjust
```

For software work this may become:

```text
inspect -> edit -> test -> debug -> deliver
```

For research, operations, document production, data work, or external-runtime
control, the inner loop and its evidence differ. The outer governance contract
does not.

## Canonical Work Primitives

Kiln composes existing owners rather than defining workload-local substitutes:

- **Goal** — the desired operator outcome and durable parent for related work.
- **Work item** — one bounded, verifiable unit of execution or review.
- **Classification** — task intent, artifacts, domains, effects, and modes used
  for recommendation and governance; classification never grants authority.
- **Route** — one eligible provider or harness-backed execution path selected by
  canonical route policy.
- **Agent profile** — an operator-owned child identity and role, not an authority
  profile or route-selection shortcut.
- **Attachment** — the exact project, runtime, application, account, or external
  target instance against which admitted work is performed.
- **Authority** — the explicit observation and mutation envelope admitted for one
  execution.
- **Context** — the governed instructions, project facts, skills, resources, and
  memory admitted for the task.
- **Evidence** — structured observations that support or reject a required claim.
- **Approval** — a canonical request and resolution for an action that exceeds
  unattended authority.
- **Review** — an independent evaluation against the work contract and evidence.
- **Recovery** — an explicit transition that preserves failed history while
  resolving or superseding a blocking condition.
- **Replay** — canonical, redacted evidence of the trajectory and state changes.
- **Completion** — agreement among the work item, goal, invocation or job,
  evidence, replay, operator surfaces, and final prose.

A workload may specialize required evidence and decomposition, but it must not
create a private owner for any of these primitives.

## Deterministic Workflow, Agentic Execution

Kiln combines workflows and agents deliberately:

- Deterministic code owns admission, authority, state transitions, approvals,
  review requirements, retry and recovery bounds, and completion gates.
- An admitted agent owns bounded problem solving inside that envelope: which
  relevant resources to inspect, how to implement or analyze the task, and how
  to produce the required evidence.
- A model may recommend decomposition, routing, tools, or follow-up work, but the
  recommendation becomes executable only after canonical validation.
- Provider-native concepts such as subagents, tasks, plans, sessions, sandboxes,
  or approvals remain adapter observations. They do not replace Kiln state.

This boundary preserves useful autonomy without letting model prose become a
second workflow engine or policy system.

## Workload Specialization

Workload-specific behavior belongs in admitted capabilities, evidence
requirements, skills, configuration, and portable fixtures. It does not belong
in provider-specific branches inside the governance core.

Representative evidence profiles include:

| Workload | Typical evidence |
| --- | --- |
| Software delivery | diff, focused tests, typecheck/build, review findings, delivery record |
| Research | source identity, citations, coverage, contradiction checks, uncertainty |
| Operations | health and diagnostic evidence, approved change, rollback, post-change verification |
| Data analysis | dataset identity, transformation lineage, checks, reproducible outputs, limitations |
| Document production | source coverage, validation results, review or approval, publication state |
| External runtime work | explicit target attachment, tool results, runtime observation, approval and replay evidence |

These are examples, not standing global requirements. A work item receives only
the evidence contract appropriate to its classification, risk, route, and
admitted capabilities. Generic labels such as `tests`, `typecheck`, `visual`, or
`review` must be realized through the actual target surface rather than
silently widening authority.

## Review, Repair, And Arbitration

Independent review is a governed role, not a second implementation attempt by
default.

- The author and required reviewer should use separate invocation identities and
  contexts.
- Reviews evaluate the same immutable candidate identity, such as a commit,
  artifact, document revision, dataset version, or external-runtime state.
- Findings name severity, location or evidence, failure scenario, impact, and a
  minimum safe correction.
- A correction creates new evidence and a new candidate identity; affected
  findings are re-evaluated rather than assumed closed.
- Material disagreements may be assigned to a separate arbitration work item.
  The arbiter receives the disputed contract, evidence, arguments, and candidate
  state, not hidden reasoning from either party.
- No unresolved high- or medium-severity finding may be concealed by a passing
  aggregate score or a successful unrelated check.

Not every task requires independent review. The work-governance policy decides
when risk, authority, cross-surface effects, or completion claims require it.

## Attachments And External Targets

The execution target must be explicit whenever selecting the wrong instance
would change the meaning or safety of the work.

Examples include a repository checkout, git worktree, browser session,
application document, game or simulation runtime, cluster, tenant, data source,
or remote machine.

- Route eligibility does not prove target identity.
- Caller identity and target attachment identity answer different questions and
  must not be conflated.
- Parent and child execution must agree on the required target.
- Missing or mismatched required attachment identity fails closed before work.
- Kiln must not heuristically retarget to a convenient or sole visible instance.
- Attachment identity and relevant evidence remain replayable without persisting
  credentials, operator-specific absolute paths, or unsafe raw payloads.

## Canonical Completion

A model's statement of success is not completion evidence by itself.

A work item may close only when:

1. the admitted execution reached a valid terminal state;
2. every required evidence item is passed, explicitly unavailable, waived through
   an authorized decision, or represented as an unresolved blocker;
3. required approvals and reviews have canonical resolutions;
4. recovery has preserved and explicitly superseded obsolete blocking evidence;
5. goal, work item, execution record, replay, operator surfaces, and final prose
   agree; and
6. no workload-local adapter or surface reports a stronger result than canonical
   state supports.

A successful inner agent loop cannot override a failed or blocked outer governed
work execution loop.

## Roadmap Ownership

This doctrine is horizontal. Existing roadmap tracks implement bounded parts of
it:

- external-runtime evidence, attachment, recovery, and closeout consistency;
- managed invocation routing, leases, lifecycle, result, and replay;
- gateway process and provider-access lifecycle;
- cross-harness projection and conformance;
- skill capability evidence and admission;
- prompt and context activation evidence;
- stack-policy evidence and governed mutation; and
- operator-surface presentation and benchmark admission.

A roadmap may implement a concrete workload or control-plane capability, but it
must consume the shared contracts. It must not become a private owner of route
selection, authority, attachments, work state, evidence, lifecycle, approvals,
review, recovery, replay, or completion.

A dedicated workload-profile roadmap is warranted only after at least two
materially different non-software workloads require a shared typed contract that
has no existing owner. It must begin from deterministic fixtures and evidence,
not from a catalog of prompts or speculative enums.

## Non-Goals

- Kiln is not defined as an IDE, coding agent, project manager, or provider
  wrapper, even when those are important product surfaces or workloads.
- This doctrine does not require every task to use multiple agents, independent
  review, or a managed child.
- It does not introduce a universal decomposition template or evidence checklist.
- It does not permit workload profiles to grant tools, credentials, mutation, or
  network authority.
- It does not make prompts, harness configuration, terminal history, issue prose,
  or provider-native task state canonical.
- It does not justify a new roadmap without a bounded implementation gap and an
  explicit owner not already covered by an active track.

## Architectural Invariants

1. Software engineering is a workload specialization, not Kiln's architectural
   boundary.
2. One canonical owner exists for each horizontal primitive.
3. Deterministic governance surrounds agentic execution.
4. Classification and recommendations never grant authority.
5. Route identity and attachment identity are explicit and independently
   validated.
6. Evidence requirements are realized through admitted target capabilities.
7. Review and recovery preserve history rather than rewriting it.
8. Canonical state is stronger than provider or model prose.
9. Operator surfaces project shared state and never reconstruct private truth.
10. New workload planes consume the control plane instead of forking it.
