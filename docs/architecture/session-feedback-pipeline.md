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
- `@kilnai/cli`, `@kilnai/gui`, `@kilnai/tui`, and native surfaces own user
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

## Current State

The first slice exists in `@kilnai/core`:

- `packages/core/src/feedback/index.ts` defines the feedback domain contract,
  redaction, local bundle creation, and issue draft rendering.
- `packages/core/tests/feedback/session-feedback.test.ts` verifies credential
  and PII redaction, local-only bundle behavior, evidence selection, fail-closed
  validation, and maintainer issue draft rendering.

The runtime evidence collector slice exists in `@kilnai/runtime`:

- `packages/runtime/src/session/session-feedback-evidence.ts` collects selected
  evidence from `RuntimeSession` ledger state, conversation history, canonical
  session events, managed-agent events, and optional caller-provided git status.
- `packages/runtime/tests/session/session-feedback-evidence.test.ts` verifies
  transcript opt-in, command/tool failure evidence, file changes, logs, managed
  invocation diagnostics, and git-status snapshot handling.

This is not yet a CLI command, GUI flow, gateway contract, GitHub integration,
or PR automation.
