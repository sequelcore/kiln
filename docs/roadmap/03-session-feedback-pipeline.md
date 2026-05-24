# 03 - Session Feedback Pipeline

Status: Active
Started: 2026-05-18
Architecture: `docs/architecture/session-feedback-pipeline.md`

## Objective

Build a long-term feedback-to-fix pipeline for Kiln sessions. Operators should
be able to report what went wrong, choose safe evidence, preview the redacted
bundle, and eventually convert that bundle into a maintainer issue, governed
work item, or draft pull request.

This roadmap is separate from:

- `00.0.1-rust-module-optimization.md`, which decides Bun and Rust execution
  boundaries for hot-path modules.
- `02-native-operator-surface.md`, which decides native operator surface
  projection and benchmark admission.
- Existing CLI resume feedback, which scores session continuity and is not the
  same product feature.

## Long-Term Feature Decision

Kiln should support `/feedback`-style workflows across surfaces, but the
feature should be broader than a transcript dump:

- Non-technical users get a simple feedback form with safe defaults.
- Technical users can attach diagnostic evidence intentionally.
- Maintainers get a normalized issue draft with redaction evidence.
- Contributors can promote a feedback bundle into a governed repair workflow.
- Pull requests are possible later, but only as draft artifacts behind explicit
  approval and review gates.

## Slices

### Slice 1 - Core Contract And Redaction

Status: Completed on 2026-05-18

Deliverables:

- Domain contract for reporter input, evidence selection, local bundle, and
  issue draft.
- Redaction for common credentials and basic PII before export.
- Local-only publication gate.
- Focused tests in `@kilnai/core`.

Verification:

- `bun run --cwd packages/core test -- tests/feedback/session-feedback.test.ts`
- `bun run --filter @kilnai/core typecheck`
- `bun run --filter @kilnai/core test`
- `bun run --filter @kilnai/core build`

### Slice 2 - Runtime Evidence Collector

Status: Completed on 2026-05-18

Deliverables:

- Extract feedback evidence from runtime session ledgers.
- Map managed-agent tool failures and command failures into feedback evidence.
- Preserve transcript excerpts only when selected by the operator.
- Avoid changing canonical session events unless replay or projection requires
  it.
- Accept caller-provided git status snapshots because git status is not stored
  on `RuntimeSession`.

Verification:

- `bun run --filter @kilnai/runtime test`
- `bun run --filter @kilnai/core test`
- `bun run --filter @kilnai/runtime build`

### Slice 3 - CLI Feedback Command

Status: Completed on 2026-05-18

Deliverables:

- Added `kiln feedback draft` as a CLI adapter that writes a local bundle and
  maintainer issue draft.
- Supports quick, diagnostic, and maintainer reporter modes.
- Prints a redacted preview and local output paths.
- Keeps publication disabled until explicit approval.
- Captures git status only when explicitly provided or requested.

Verification:

- `bun run --filter @kilnai/cli test`
- `bun run --filter @kilnai/cli typecheck`
- `bun run --filter @kilnai/cli build`

### Slice 4 - Gateway And Surface Projection

Status: Started on 2026-05-18

Deliverables:

- Added the first gateway preview contract after the core, runtime, and CLI
  draft shapes stabilized.
- Expose feedback preview state to GUI, TUI, and native surfaces.
- Keep surface components thin; core owns semantics.
- Reuse the CLI draft semantics; do not add external publication in this slice.

Verification:

- `bun run --filter @kilnai/gateway-contracts test`
- `bun run --filter @kilnai/gateway-contracts typecheck`
- `bun run --filter @kilnai/gateway-contracts build`
- GUI/TUI/native focused tests for projection consumers.

### Slice 5 - Issue Adapter

Status: Pending

Deliverables:

- Add outbound issue-provider port.
- Implement GitHub issue draft or creation adapter behind explicit consent.
- Store provider response as evidence without leaking credentials.

Verification:

- Adapter unit tests with no live network dependency by default.
- Live tests gated behind explicit environment flags.

### Slice 6 - Repair Work Item

Status: Completed in code on 2026-05-24.

Completed:

- Core work-governance now converts explicitly approved local feedback bundles
  into pending `feedback-repair` work item inputs.
- Repair work items attach redacted approval actor/time/resource pointers, risk
  hypothesis, file impact, verification criteria, and source feedback metadata.
- Repair closeout uses existing work-governance evidence for feedback bundle,
  explicit approval, risk hypothesis, file impact, verification criteria,
  tests, typecheck, managed-agent review, and residual risk.
- Missing approval, file impact, or verification criteria fails closed before a
  repair work item can be created.

Deliverables:

- Convert approved feedback bundles into governed work items. Complete.
- Attach risk hypothesis, file impact, and verification criteria. Complete.
- Route implementation through existing Sequel/Kiln workflow. Complete.

Verification:

- `bun run --cwd packages/core test -- tests/feedback/session-feedback.test.ts`
- `bun run --cwd packages/core test -- tests/work-governance/work-item-materializer.test.ts tests/work-governance/goal-execution.test.ts`
- `bun run typecheck`
- `bun run --cwd packages/core test`

### Slice 7 - Draft Pull Request Flow

Status: Pending

Deliverables:

- Create draft PR metadata after repair verification passes.
- Require human approval before branch push or external PR creation.
- Include feedback bundle, tests, review findings, and residual risk.

Verification:

- No network in default tests.
- Explicit live adapter test path.
- Reviewer gate before any claim of completion.

## Gates

- No automatic upload.
- No unredacted transcript export.
- No public issue creation without explicit approval.
- No PR creation without work-governance evidence and review.
- No gateway-contract expansion until core/runtime shapes prove stable.
- No duplicated feedback engine beside existing work-governance.
