# Managed-child end-to-end advisor brief

Owner: Kiln operator and the Runtime execution maintainers, supporting
[Roadmap 06.5](../../roadmap/06.5-end-to-end-harness-efficiency.md).
Evidence cutoff: 2026-09-08, implementation commit
`b311a8fdb83bdf0b6543089512f2db2e2dfb42d0`.
Open question: why does the real managed-child workflow keep failing at different
boundaries despite focused regression suites passing?
Promotion target: the owning Runtime/tooling contracts, a bounded implementation
plan, and reproducible integration regressions. Close this investigation when
those findings are resolved and the complete workflow is verified; preserve
empirical results in evaluations and delete this task brief when superseded.

## Assignment

Review `sequelcore/kiln` on `dev`. Resolve and report the exact commit you inspect.
You have repository access, not access to the operator's local machine, accounts,
private configuration, databases, or raw transcripts. The incident summary below
is supplied evidence, not something you independently reproduced. Request only
specific sanitized missing evidence if it is necessary to distinguish causes.

Scout the code end to end and return a diagnosis and a durable solution plan.
Do not implement changes or run live provider calls for this assignment. Follow
all relevant callers, consumers, and tests; the file list below is an entry map,
not a limit on your investigation. Inspect adjacent flows for the same defect
mechanisms. Avoid an unrelated whole-repository style review.

Do not assume the latest patch is correct or the assistant's explanation is the
root cause. Challenge prior diagnoses, fixes, fixtures, and success criteria.
Determine whether the problem is policy/configuration, model-facing contracts,
Runtime enforcement, harness integration, telemetry, test composition, or some
combination. A valid denial is not itself a defect. Explain why a request reaches
that denial and whether the configured workflow was expected to be admissible.

## Sequel standards supplied for this assignment

These are the operator's effective engineering requirements, supplied because
you cannot read the private global instruction owner. They are task context,
not a new repository policy owner. Also read
[Kiln engineering standards](../../architecture/core/engineering-standards.md),
[architecture ownership](../../architecture/README.md), and root `AGENTS.md`.

- Keep one canonical owner per concept, policy, state machine, and lifecycle.
  Prefer deriving state or deleting duplication over introducing another layer.
  Use one familiar canonical term per concept within its owning context; make
  translations across contexts explicit.
- Respect bounded contexts and dependency direction. Core must not depend on
  Runtime or operator/provider infrastructure. Runtime owns execution policy and
  terminal truth. CLI, GUI, TUI, SDK, and harness projections consume shared
  contracts; they must not invent parallel policy or settlement semantics.
- Use the smallest direct design that satisfies actual consumers. No quick
  patches, legacy shims, speculative abstractions, boilerplate factories,
  benchmark-specific permission bypasses, or provider-name special cases.
  A refactor must repair an evidenced ownership or behavioral problem, not add
  indirection for appearance.
- Kiln has no external consumers. Replace changed contracts outright and update
  all consumers in the same change; remove the old path. Do not retain aliases,
  compatibility unions, deprecated APIs, or fallback paths for hypothetical users.
- Existing durable operator data is real. A persisted-schema change needs a
  forward migration or an explicitly authorized discard decision. API cleanup
  does not authorize deleting evidence, resetting accounts, or rewriting history.
- Mutable project state belongs under the private `~/.kiln/projects/<project-id>/`
  owner. Do not recreate repository-local `.kiln` state. Generated native files
  and snapshots are projections, not authority.
- Provider, model, account, routing, permissions, sandbox, approvals, budgets, and
  orchestration limits belong in executable configuration and enforcement.
  Discovery, stale caches, catalog availability, and prose do not grant authority.
  Do not weaken privacy, validation, sandboxing, or approval requirements to pass.
- Keep requested, admitted, dispatched, running, terminal, cleaned up, and
  economically settled distinct. Unknown external effects remain unknown and
  capacity-consuming until authoritative settlement. Timeout, cancellation,
  process death, or a successful CLI exit cannot fabricate no-dispatch evidence.
- Preserve atomic claims, generation/replay fences, idempotency, and ancestor
  authority attenuation. Local no-dispatch proofs must come from their owner.
- Diagnostics must preserve structured reasons across boundaries without exposing
  credentials, raw private content, or operator-specific filesystem details.
  Noninteractive Windows launches use `windowsHide: true` at the actual launch
  boundary; preserve argument, stream, cancellation, and process-group semantics.
- Use Bun 1.4 and repository workspace scripts. Verification starts at the owner,
  broadens for shared authority/contracts, and includes relevant typechecks.
  Tests use synthetic portable fixtures and no live credentials by default.
  Compose real owning components where mocks would erase the failing boundary.
  Include a non-primary surface when shared behavior changes. Prove regressions
  detect the defect by temporarily breaking the subject and observing failure.
  Never weaken assertions, increase timeouts, or disable isolation to hide defects.
- Keep changes scoped, assumptions explicit, and future-useful rationale with its
  owner. Findings are ranked by impact and backed by code evidence. Passing unit
  tests or reviewer confidence is not end-to-end verification. Report what remains
  unverified; distinguish unmeasured, failed, stale, incompatible, and unknown.

## Incident evidence and limits

Read [the preceding investigation](managed-child-startup-diagnosis.md), then
inspect these commits and their parents rather than accepting their messages:
`493ea5ad`, `e3742529`, and `b311a8fd`. Earlier work also addressed Windows console
flashes, account refresh, agent resolution, and economic admission/settlement.
Trace those changes when they affect this path.

At `e3742529`, one managed-child diagnostic exceeded its 180-second deadline.
The collector killed the CLI before a canonical terminal report was emitted.
Durable claims showed six successful parent model rounds and two child rounds;
that is not a complete physical-request count. The child checkpoint and cleanup
were pending. Its full eight-request reservation remained uncertain.

`b311a8fd` added an explicit approval response bridge, cancellation-aware pending
approvals, an absolute CLI benchmark deadline, and a separate 30-second terminal
drain allowance. The composed child test reproduced an unattended approval wait
when the previous gate was restored. Verification passed 1,127 Runtime tests,
107 CLI executor/provider-session tests, 21 benchmark command tests, 55 collector
and report tests, full workspace typecheck, and documentation validation.
These checks did not establish that the real production discovery-to-child path
was reachable or successful.

The subsequent live attempt at `b311a8fd` had these observed properties:

- One cold managed-child trial, read-only authority, one child maximum, eight
  physical requests maximum, 180 seconds, zero automatic retries. Same configured
  Luna target and low deliberation as the preceding diagnostic.
- Freeze and preflight verification passed. The CLI completed in about 55 seconds.
  Four physical requests were settled and counted; there were no unknown requests
  for this attempt. The prior attempt's uncertainty was not reconciled by this.
- Collection reconciliation was complete and trial validity was `valid`.
  `sessionSucceeded` was true, but the task oracle was `failed`, with
  `managed_child_count_mismatch` and `canonical_admission_failed`. Do not call this
  a passed managed-child workflow or assume these different fields are necessarily
  inconsistent without inspecting their contracts.
- There were zero managed invocations and no `managed_agent.invoke` call.
  The observed tool sequence was `kiln_config.read` for agents, routes, and
  permissions; `capability.search`; `tool_catalog_search`; `capability.describe`.
  Both capability discovery calls returned tool errors.
- `capability.search` used kind `agent-backed` and a managed-child query.
  `tool_catalog_search` searched the `managed_agent.` prefix with schemas.
  `capability.describe` used `capabilityId: managed_agent.invoke`,
  `revision: current`, and a descriptor digest. Investigate whether these inputs
  represent the correct capability identity/revision contract; do not presume so.
- The assistant's final answer attributed the failure to the absence of an
  approval handler. The retained benchmark tool diagnostics exposed `isError`
  but no exact error code for those two calls. That explanation is a hypothesis,
  not an independently established Runtime denial reason.
- Account usage refresh succeeded for eligible Plus accounts; login was not
  required. Exact temporary read grants were restored through canonical config
  rollback. The worktree remained clean. No further live retry followed.

The raw artifacts remain operator-private. Do not infer their missing contents.
This attempt never exercised child execution, so its prompt completion cannot
validate child cancellation, cleanup, budget exhaustion, or recovery.

## Required trace

Map producers, schemas, owners, consumers, and failure propagation for:

1. Benchmark protocol, freeze/verification, CLI startup and config capture,
   operator adoption, route/account admission, and the parent provider session.
2. Tool projection and discovery: catalog search, capability search/describe,
   revision/digest identity, progressive admission, permission classification,
   model-facing descriptions, and actionable error feedback.
3. Managed invocation admission: configured agent resolution, requested versus
   admitted authority, parent host capability and sandbox intersection, economic
   commitment, atomic tool/model claims, replay fencing, and direct child startup.
4. Approval request/response/cancellation in CLI, direct children, and other
   consumers. Distinguish observation buses from live approval bridges and
   authority sources. Check abort propagation before and during waits/effects.
5. Child tools and provider rounds, shared physical-request budget, handoff,
   lifecycle events, durable checkpoints, lease release, and recovery after
   cancellation, timeout, crash, or partial settlement.
6. Parent transcript and terminal evidence through benchmark artifacts, collector
   projection, validity, task oracle, physical accounting, and final exit/status.
   Identify where an exact denial reason or a child outcome gets lost.

Start with `scripts/context-efficiency-diagnostic.ts` and its protocol, oracle,
provider-evidence, command-runner, and report-integrity siblings;
`packages/cli/src/application/benchmark-session-executor.ts`,
`canonical-run-session-dispatcher.ts`, and `run-session.ts`;
`packages/cli/src/wrapper/provider-session.ts` and
`permission-policy-authorizer.ts`; `packages/runtime/src/capabilities/`;
`packages/runtime/src/session/`; and
`packages/runtime/src/agents/managed-invocation/`. Follow the discovery tools and
Core contracts to their actual implementations. Examine the dataset at
`packages/core/evals/benchmark/kiln-context-efficiency-managed-child-v1.jsonl`
and the corresponding tests, including fixture omissions and mocked boundaries.

## Deliverable

Return a review with:

1. Findings first, ranked by severity, each with exact commit/path/line evidence,
   trigger, violated invariant, user effect, and confidence. Separate proven code
   defects, plausible incident explanations, configuration requirements, and
   missing evidence. Include counterevidence and rejected hypotheses.
2. An end-to-end dependency and authority map showing the first demonstrable
   divergence, additional independent defects, and downstream consequences.
3. A concrete solution with canonical ownership, contracts to replace, obsolete
   paths to delete, affected surfaces, data migration/recovery requirements, and
   tradeoffs. Justify each abstraction or refactor using current consumers.
4. An ordered implementation plan with bounded edits and acceptance criteria.
   No live trial should be the first test that composes the real workflow.
5. A synthetic regression matrix covering discovery-to-child success, legitimate
   denial, absent/stale capability identity, missing approval channel, cancellation
   while waiting, pre-dispatch versus ambiguous post-dispatch failure, shared
   budget exhaustion, terminal reporting, crash recovery, and cleanup. State
   which owners must be real, which dependencies may be fake, and how each test
   will fail when its subject is broken.
6. A final assessment of what can be concluded from repository inspection alone,
   what you actually ran, and the smallest remaining local evidence or live
   validation required. Do not claim access to private evidence or tests you did
   not execute. Do not propose another live retry as a substitute for diagnosis.
