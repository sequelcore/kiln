# Session Feedback Pipeline

Created: 2026-05-18

## Purpose

The session feedback pipeline turns operator feedback about a Kiln session into
a governed local artifact that can later become a maintainer issue, repair work
item, or reviewed pull request.

This is separate from CLI resume feedback. Resume feedback evaluates continuity
quality inside the wrapper. Session feedback is an operator-facing product
feature for reporting session errors, missing behavior, confusing output, unsafe
tool results, or broken automation with enough evidence for maintainers to fix
the product.

## Product Shape

The pipeline has three audience levels:

- Quick feedback for non-technical users: short description, expected result,
  actual result, and safe default evidence.
- Diagnostic feedback for technical users: selectable transcript excerpts, tool
  failures, command output, environment, git status, and logs.
- Maintainer report for Kiln contributors: normalized issue draft, evidence
  bundle, redaction findings, local reproduction notes, and repair candidate
  metadata.

Publication is never automatic. A feedback bundle starts as a local draft. Any
network publication, issue creation, branch creation, or pull request requires
explicit operator approval and the normal work-governance gates.

## Ownership Boundaries

- `@kilnai/core` owns the session-feedback domain contract, local bundle shape,
  redaction policy, evidence selection semantics, and maintainer issue draft
  rendering.
- `@kilnai/runtime` owns extraction from session ledgers, managed-agent events,
  tool failures, and persisted session evidence.
- `@kilnai/gateway-contracts` owns cross-surface presentation contracts only
  after the domain contract is stable enough to expose to GUI, TUI, native,
  SDK, or widget consumers.
- `@kilnai/cli`, `@kilnai/gui`, and `@kilnai/tui` own user
  interaction and consent UX. They do not own feedback semantics.
- External issue and pull-request providers are adapters behind explicit
  outbound ports. GitHub is one adapter, not the domain.

## Contract Invariants

- Feedback artifacts are local-first.
- Redaction runs before export, preview, issue drafting, or network handoff.
- Transcript evidence is opt-in, not selected by default.
- Evidence selection is explicit and represented in the bundle.
- Publication state is fail-closed until explicit approval.
- Generated repair work must enter the existing work-governance lifecycle.
- Pull requests are drafts unless review, verification, and operator approval
  promote them.
- Feedback must not create a second hidden execution engine.

## Evidence Model

Initial evidence kinds are:

- Session summary.
- Transcript excerpt.
- Tool failure.
- Command output.
- Environment.
- Git status.
- Log excerpt.
- File-change summary.
- Diagnostic finding.

Sensitive evidence is redacted in the core bundle before any adapter can see it.
Provider keys, bearer tokens, GitHub tokens, email addresses, and phone numbers
are handled in the first slice. Later slices can reuse the broader safety
pipeline for additional PII classes and policy findings.

## Repair Path

The long-term repair path is:

1. Create local feedback bundle.
2. Preview redacted report and selected evidence.
3. Generate maintainer issue draft.
4. Create a governed work item linked to the feedback bundle.
5. Produce a repair proposal with changed files, tests, and risk hypothesis.
6. Run tests, typecheck, and reviewers.
7. Create a draft pull request only after explicit approval.

The repair path reuses work-governance, managed-agent evidence, and existing
review gates. It does not bypass delegation, verification, or approval.

## Implemented Contract

The session feedback pipeline is implemented as a local-first, governed
feedback-to-fix path:

- `packages/core/src/feedback/index.ts` defines feedback reports, evidence
  selection, redacted local bundles, maintainer issue drafts, explicit
  publication approval evidence, GitHub issue-provider port requests and
  redacted provider responses, and local draft pull-request metadata.
- `packages/runtime/src/session/session-feedback-evidence.ts` extracts selected
  evidence from runtime session ledgers, conversation history, canonical
  session events, managed-agent events, tool failures, command failures,
  file-change summaries, logs, and caller-provided git status snapshots.
- `packages/cli/src/commands/feedback.ts` implements `kiln feedback draft`,
  which writes a local redacted bundle and maintainer issue draft and prints a
  redacted preview. Publication remains disabled unless an explicit adapter
  path receives approval evidence.
- `packages/gateway-contracts/src/session-feedback-projection.ts` defines the
  surface-facing feedback preview shape. GUI, TUI, and native consumers validate
  this shared contract and keep their own projection helpers thin.
- `packages/core/src/work-governance/feedback-repair.ts` converts explicitly
  approved local feedback bundles into existing work-governance work items with
  bundle, approval, risk, file-impact, verification, tests, typecheck, review,
  and residual-risk evidence.

## Redaction And Publication

Feedback redaction is mandatory before preview, bundle export, issue draft
rendering, issue-provider handoff, repair materialization, or draft PR
metadata creation. The first-class policy redacts common bearer credentials,
OpenAI/Anthropic-style keys, GitHub tokens, email addresses, and phone numbers.
Unselected transcript evidence is omitted instead of redacted and exported.

Publication is fail-closed:

- Local bundles and maintainer issue drafts carry publication gates with
  `allowed: false`.
- Issue-provider adapters require explicit approval evidence with actor,
  canonical UTC timestamp, and local feedback approval resource URI.
- Provider responses are stored as redacted evidence, and response provenance
  must match the approved provider.
- Default tests use injected provider ports and do not perform live network
  calls. Any live adapter test path must remain explicitly gated.

## Governed Repair And Draft PR

Feedback repair does not create a separate repair engine. Approved local
bundles materialize into normal work-governance items with feedback provenance
and required evidence. Work-item completion requires the existing closeout
rules: tests, typecheck, managed-agent review, all repair verification gates,
and residual-risk reporting.

Draft pull-request metadata can be created only from a completed feedback repair
work item. It requires explicit PR approval evidence, changed-file evidence,
review evidence URIs, passing repair verification gates, managed-agent review,
tests, typecheck, and residual risk. The result is a local draft artifact; branch
push or external PR creation remains outside the default path and requires
separate human approval.

## Verification

The durable verification suite for this pipeline includes:

- `packages/core/tests/feedback/session-feedback.test.ts` for redaction,
  local-only bundles, issue drafts, issue-provider approval and response
  evidence, repair work items, and draft PR gates.
- `packages/runtime/tests/session/session-feedback-evidence.test.ts` for
  runtime evidence extraction and transcript opt-in.
- `packages/cli/tests/commands/feedback.test.ts` for local draft command
  behavior.
- `packages/gateway-contracts/tests/session-feedback-projection.test.ts` plus
  GUI, TUI, and native projection tests for contract-backed surface consumers.
