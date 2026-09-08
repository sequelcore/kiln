# Writing Skills Evaluation

Evidence cutoff: 2026-09-08.

## Scope and method

This is a bounded qualitative smoke and deterministic contract verification,
not a controlled baseline/skill comparison, an automatic routing evaluation,
or evidence of improved human reviewer performance. The procedures are
available as removable built-ins; no new automatic route is promoted.

The candidate is the original Kiln guidance for `writing-issues`, `writing-pr`,
`problem-clarification`, and the representation guidance added to `clear-writing`
in [the builtin catalog](../../packages/core/src/skill/builtin-skills.ts).
The source checkout started at `8ab35b0fd036e5861328ed5b03c9b0c390a17c9b`.
The catalog file SHA-256 before the title correction was
`92c58800bff0dc35d699b239148f308a6798d38c74de56f57829bcd5d8418fdd`;
afterward it was
`0c3e2dfa1aa0a22d7109d1467168eba1211f31938a3dba83fab0f16fb3ff0550`.
These identify UTF-8 source bytes, not packaged skill digests or live admission.
The evaluated files are uncommitted changes on that revision, not that revision
itself. Native `sol-verifier` (GPT-5.6 Sol, high reasoning) inspected the candidate
and produced six synthetic examples in a fresh child conversation. The parent
reviewed those outputs against the supplied facts. Both shared the working
filesystem; this was not a blinded or independent replication.

## Cases

1. Bug issue: one export click produced two invoices on app 1.2; retries are
   suspected, but no logs or reproduction are available; want one invoice.
2. Feature issue: support staff need CSV of currently filtered orders; no
   architecture chosen; exported rows must match the active filter.
3. PR: candidate b2 versus base a1 removes a duplicate export event handler;
   `bun run test:export` failed on a1 and passed on b2; no other checks observed.
4. UI PR: dashboard loading indicator changed; no screenshots; focused test
   failed. Preserve those gaps and do not invent captures or readiness.
5. Performance PR: alleged 30% improvement, but only 70 ms candidate measurement
   with no recorded baseline or workload. Do not claim the percentage.
6. One-sentence issue: settings button typo `Savee` to `Save`, no behavior change.
   Do not start an interview or invent scope.

## Observed outputs

The verifier returned these drafts from the supplied facts. They are synthetic
outputs, not published artifacts or claims that these checks actually ran.

### 1. Bug issue

> **Prevent one export click from creating two invoices**
>
> In app 1.2, the reporter clicked the Export button once and two invoices were
> created. The issue has not been reproduced, and no logs are available. Retries
> are a suspected cause, not a confirmed diagnosis.
>
> Acceptance: One Export click creates exactly one invoice.

### 2. Feature issue

> **Export filtered orders to CSV**
>
> Support staff need a CSV of the orders matched by the active filter. No
> implementation architecture has been selected.
>
> Acceptance: The exported rows exactly match the orders selected by the active
> filter at export time.

### 3. Regression PR

> **Prevent duplicate export events**
>
> The export action had a duplicate event handler. This change removes the
> duplicate handler so the action emits one export event.
>
> Verification: `bun run test:export` failed on base `a1` and passed on candidate
> `b2`. No other checks were observed.

On self-review, the verifier removed its inferred single-event effect because
this prompt did not specify the regression test's assertion. Its corrected
draft, without another model run, was:

> **Remove the duplicate export event handler**
>
> The export action had a duplicate event handler. This change removes it.
>
> Verification: `bun run test:export` failed on base `a1` and passed on candidate
> `b2`. No other checks were observed.

### 4. UI PR

> **Update the dashboard loading indicator**
>
> The dashboard loading indicator changed. No before/after screenshots are
> available.
>
> Verification: The focused test failed; its command was not provided. Readiness
> is not established.

### 5. Performance PR

> **Optimize performance**
>
> The candidate measured 70 ms. Because no baseline, workload, conditions, or
> uncertainty were recorded, the claimed 30% improvement is unverified.
>
> Verification: Candidate measurement: 70 ms; comparable baseline unavailable.

The body correctly withheld the percentage claim, but the title could still
suggest a verified benefit and supplied little review context. This prompted
an explicit title-level obligation in the candidate; the output above is
retained as the observed pre-correction example, not silently rewritten.

The same verifier re-applied this case after reading the title obligation:

> **Update performance-sensitive code**
>
> The candidate measured 70 ms. Because no baseline, workload, conditions, or
> uncertainty were recorded, the claimed 30% improvement is unverified.
>
> Verification: Candidate measurement: 70 ms; comparable baseline unavailable.

This is a within-conversation repair check, not a fresh paired trial. The title
avoids claiming a speedup but remains generic because the prompt supplies no
concrete code change.

### 6. Routine issue

> Fix the settings button typo from “Savee” to “Save”; behavior is unchanged.

The examples preserved the supplied material evidence gaps, avoided invented
captures and publication, and did not interview the user for routine drafting.
The regression example inferred the intended single-event effect from removing
the duplicate handler; actual code and test evidence would still need inspection.
No numerical quality score or all-cases effectiveness claim is assigned.

The independent code review also exposed that the initial artifact API could
not record the baseline failure described in case 3. The shared evidence
contract was revised to admit only an explicitly declared baseline or current
candidate and to keep candidate verification unrun when only a baseline was
checked. Deterministic regression tests cover that distinction.

## Deterministic verification

The [artifact tests](../../packages/core/tests/change-artifacts/change-artifact-contract.test.ts)
exercise short output without empty headings, preserved Markdown examples,
findings-first rendering, failed and unrun checks, rejection of an empty body,
unknown evidence references, mismatched evidence identity, and altered rendered
content. The new-contract tests failed against the original renderer before
implementation. Commit behavior remains covered by its existing tests.

The [native projection test](../../packages/cli/tests/config/native-skill-projection.test.ts)
checks the writing procedures through the existing Codex, Claude Code, and
OpenCode projection path. These tests validate discovery and bytes, not model
selection or skill effectiveness.

## Check results

- Full Core suite: 283 files, 3,429 tests passed after the baseline-evidence fix.
- Focused CLI catalog and native projection: 2 files, 49 tests passed.
- Workspace `bun run typecheck`: passed, including test typechecks.
- `bun run docs:check`: passed.
- `git diff --check`: passed; Git reported only its configured LF/CRLF notices.

The CLI default test script did not forward filename filters and started the
full suite. That broader run was stopped after the final focused checks passed;
it is not counted as a full CLI pass. No live publication or operator-global
configuration mutation was performed.

## Clear-writing refactor verification

The subsequent September 8 refactor replaces the repeated principles and editing
workflow with one procedure: establish the reader and scope, preserve claims,
repair structure, improve sentences, and compare the result with the source.
It removes the fixed context/point/evidence/action outline. The skill name,
admission rules, portability, and artifact-specific owners remain unchanged.
The [research foundation](../research/foundations/communication-standards.md#clear-writing-reassessment-september-8-2026)
records the evidence and the proposed comparative evaluation.

This is a source and integration verification, not another model smoke. The
native projection case now includes `clear-writing` and compares the complete
rendered canonical content for each of Codex, Claude Code, and OpenCode, rather
than only matching skill names. The catalog test retains its preservation and
neutrality check. These checks do not demonstrate that a model follows the text.

Editorial review used the following acceptance cases to inspect instruction
coverage. The outcomes below are required behavior, not generated observations:

| Case | Required behavior |
| --- | --- |
| Simplify “The worker may retry twice after a timeout if the request is idempotent.” | Retain uncertainty, count, trigger, and condition; do not generalize to all failures. |
| Proofread a proposal containing a disputed causal claim | Correct language within scope; flag a material factual concern without inventing a replacement argument. |
| Explain a project-specific mechanism to an experienced engineer new to the project | Supply missing project context without an unnecessary introduction to programming. |
| Edit already-clear prose with useful passive voice and precise domain terms | Preserve it unless the requested transformation requires changes. |
| Edit Spanish support copy using the author's supplied voice | Preserve the language and locale; do not impose English punctuation or idiom rules. |

Focused checks for this refactor: 28 Core catalog tests and 34 CLI native
projection tests passed. Workspace typechecking, including test sources, and
documentation validation passed. The earlier full Core results above belong to
the issue/PR change; the full suite was not rerun for this prose replacement.
No controlled comparison, human comprehension measurement, or global skill sync
was performed. Improved output quality remains a hypothesis to evaluate.

## Limits

These synthetic prompts supply their own evidence. The smoke does not establish
that an agent can find the correct base, reproduce a real bug, obtain comparable
screenshots, evaluate a benchmark, or obey every repository template. Source
inspection and unit tests are not observations of a real published issue or PR.
The exported PR renderer is not currently called by a production publication
path; native drafting follows the skill without requiring that renderer.

A stronger comparison would pair representative real issues and PRs with and
without the candidate under the same model, tools, budget, and evidence. It should
measure factual errors, omitted risks, reviewer understanding, operator effort,
and unnecessary length, including negative controls for simple tasks. No such
comparison was performed here.
