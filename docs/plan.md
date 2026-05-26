# Slice 1 Plan - Answer-Only Eval Output

## Objective

Implement the first `01.1-answer-only-eval-output` slice: `kiln run` must have
a clean output-mode contract so benchmark/eval callers can receive deterministic
assistant-only or structured output without parsing human operator telemetry.

## Non-Goals

- Do not remove the existing human-readable default run output.
- Do not add benchmark-specific prompts, provider routing, or authority paths.
- Do not hide session telemetry; separate it from stdout in non-human modes.
- Do not change runtime provider semantics, managed-agent lifecycle semantics,
  or transcript persistence.
- Do not support interactive plan approval in non-human output modes.

## Surface Map

- `packages/cli/src/index.ts` - parse and document `--output`.
- `packages/cli/src/commands/run.ts` - apply output mode to startup telemetry,
  final report, verification failures, plan-mode admission, and JSON envelope
  emission.
- `packages/cli/src/application/run-session.ts` - route assistant deltas,
  tool-use notices, and fallback notices through an explicit output sink.
- `packages/cli/src/application/session-report.ts` - expose report/context
  formatting so output destinations are not tied to `console.log`.
- `packages/cli/src/application/run-output.ts` - new CLI-owned output contract,
  writer helpers, and structured envelope types.
- `packages/cli/tests/commands/run.test.ts` - CLI flag parsing coverage.
- `packages/cli/tests/application/run-session-output.test.ts` - focused
  assistant/tool/fallback output sink coverage.
- `packages/cli/tests/commands/run-builtin-tools.test.ts` - run-command output
  mode integration coverage with mocked session execution.
- `docs/guides/eval.md` - benchmark invocation guidance.
- `docs/roadmap/01.1-answer-only-eval-output.md` - status and verification
  evidence after tests pass.

## Risk Hypothesis

- The highest risk is accidentally keeping human telemetry on stdout in
  `answer` or `json` mode through scattered `console.log` calls.
- JSON mode must not stream assistant deltas before the final JSON envelope.
- Existing default operator output must remain stable.
- Failure paths need deterministic diagnostics instead of exiting before an
  output envelope can be written.

## Implementation Steps

1. Add failing tests for CLI parsing, run-session output sink routing, and
   run-command answer/json behavior.
2. Add the CLI output contract and use it at the run-session streaming boundary.
3. Refactor report/context formatting into reusable line formatters while
   keeping the existing `print*` helpers.
4. Route run-command human telemetry through the output contract and emit a
   structured JSON envelope after session finalization.
5. Reject `--plan` combined with `--output answer|json` because plan mode is an
   interactive planning/approval flow, not an assistant-answer contract.
6. Update eval guidance and the roadmap with verified behavior.

## Verification

```bash
bun run --cwd packages/cli test -- tests/commands/run.test.ts tests/application/run-session-output.test.ts tests/commands/run-builtin-tools.test.ts
bun run --filter @kilnai/cli typecheck
bun run typecheck
git diff --check
```

## Residual Risk To Recheck

- Some provider or wrapper implementations may still write directly to process
  streams outside the CLI output contract. This slice covers the Kiln CLI
  output boundary and should leave any provider-native stdout/stderr behavior as
  a separately testable adapter concern if discovered.
