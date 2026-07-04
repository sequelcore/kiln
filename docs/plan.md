# Verified Efficiency Slice 2 - Stable Prefix Evidence

Status: Complete
Updated: 2026-07-04

## Objective

Record provider-request cache topology for a true leading stable prefix without
changing admitted context, prompt-visible content, routing, or provider
behavior.

## Decisions

- Cache eligibility is evidence first. No savings policy is promoted in this
  slice.
- A stable prefix is contiguous from the start of the provider request. Once a
  volatile region appears, later stable regions are not reusable prefix
  material for that request.
- Request identities use `sha256:*` hashes only.
- Cache topology is telemetry/control-plane evidence and must not be injected
  into model-visible prompts.

## Slices

1. Add focused failing tests for leading-prefix topology and hash shape.
2. Extend runtime provider-request evidence with stable-prefix bytes, region
   count, volatile bytes, and region-level hashes.
3. Partition cache evidence by tenant, route, policy, and authority scope using
   hashes rather than raw identifiers.
4. Add benchmark readiness and scoring evidence for cache topology without
   adding private benchmark prompt/tool paths.
5. Emit reproducible cache-topology benchmark artifacts with baseline/candidate
   cache-gain comparison evidence.
6. Add cache-policy promotion gate evidence: rollback must restore the baseline
   policy, and candidate behavior must be non-inferior on output, authority,
   tool trajectory, and non-cache scorers.
7. Preserve existing provider request construction and benchmark metadata
   projection.
8. Run focused runtime/eval tests, workspace typecheck/build, and
   review before closing.

## Verification

- `bun test packages/runtime/tests/session/runtime-session-orchestrator-cache.test.ts`
- `bun run --filter @kilnai/core test -- tests/eval/experiment-comparator.test.ts`
- `bun run --filter @kilnai/core test -- tests/eval/benchmark-runner.test.ts`
- `bun run --filter @kilnai/core test -- tests/eval/benchmark-baseline.test.ts tests/eval/benchmark-scorers.test.ts`
- `bun run --filter @kilnai/cli test -- tests/application/benchmark-session-executor.test.ts`
- `bun run --filter @kilnai/core test`
- `bun run --filter @kilnai/runtime typecheck`
- `bun run typecheck`
- `bun run build`
- `git diff --check`

## Residual-Risk Gate

No public benchmark or policy-promotion claim may be made from this slice alone.
It supplies request-topology evidence for later measurement.
