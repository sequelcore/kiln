# Provider-Neutral Benchmark Integrity Plan

Status: Complete
Updated: 2026-07-02
Roadmap owner: `docs/roadmap/04-verified-efficiency-control-plane.md`, Slice 0

## Objective

Make live route comparisons valid before Kiln promotes any quality-per-token
policy. The benchmark path must use provider-safe reversible tool identities,
classify route failures from canonical evidence, distinguish charged cost from
subscription/quota economics, and preserve provider-reported cumulative usage.

## Non-Goals

- Do not tune the personal routing profile from `k=1` observations.
- Do not add provider-specific benchmark prompts, tool catalogs, or retries.
- Do not report subscription execution as metered `$0` evidence.
- Do not suppress genuine cumulative token usage because the number is large.
- Do not retain parallel legacy serializers or compatibility branches.

## Evidence And Risk

Live `kiln-tool-agent` probes on 2026-07-02 showed:

- GPT-5.5 and GLM-5.2 completed with `passAtK = 0.5` at `k=1`.
- MiniMax M3 completed both items but over-called tools and scored `0`.
- Kimi K2.7 rejected canonical dotted function names.
- DeepSeek V4 Pro and Flash returned upstream `400` failures.
- Qwen3.7 Max returned transient `503 failover_exhausted` failures.
- subscription routes emitted zero charged cost and incomplete economic evidence;
- successful two-item runs accumulated 421k-521k provider-reported input tokens.

The original benchmark evidence was not promotion-ready. Expanding to `k=5`
before repairing these integrity gaps would have spent quota without producing
comparable evidence.

The integrity prerequisites are now implemented and committed:

- `d0d9ecf9 fix(core): preserve canonical tool identities across providers`
- `41d28e5f fix(routing): classify provider route failures`
- `e74eb1b3 feat(cost): expose comparable execution cost evidence`
- `bd2c0480 feat(benchmark): emit reproducible baseline evidence`

## Slice 1 - Reversible Provider Tool Names

Owner: `@kilnai/core` provider infrastructure.

Status: Complete in commit `d0d9ecf9`.

- Extract one provider-neutral reversible tool-name codec from the existing
  Codex OAuth implementation.
- Apply it to OpenAI-compatible request tools, forced tool choice, assistant
  replay, streamed responses, and non-streamed responses.
- Preserve canonical names at the runtime boundary and handle collisions
  deterministically.
- Add focused tests for dotted names, leading punctuation/digits, collisions,
  replay, streaming, and Kimi-compatible function-name constraints.

Gate: focused core tests, full `@kilnai/core` suite, typecheck, boundary review.

## Slice 2 - Canonical Route Failure Evidence

Owner: `@kilnai/core` route-health policy; CLI records outcomes only.

Status: Complete in commit `41d28e5f`.

- Distinguish transient upstream unavailability (`503`, failover exhaustion),
  request/schema incompatibility (`400` with invalid tool/schema evidence),
  authentication, quota, rate limit, and unknown failures.
- Cool down only retryable route outcomes; preserve non-retryable compatibility
  evidence for operator diagnosis without pretending the whole provider is down.
- Prove benchmark and normal execution record the same classification.

Gate: core route-health tests, CLI benchmark executor tests, package suites,
typecheck.

## Slice 3 - Honest Economic And Usage Evidence

Owner: core cost contracts and runtime telemetry; benchmark projects evidence.

Status: Complete in commit `e74eb1b3`.

- Keep charged cost, reference metered value, subscription/quota usage, and
  unknown pricing as distinct evidence.
- Remove misleading missing-meter warnings for known subscription/free routes.
- Never invent provider charges from public list prices.
- Preserve cumulative provider usage across tool rounds, including cache reads
  and writes, and expose call/round counts required to interpret totals.
- Make readiness block when a requested cost comparison lacks comparable
  economic evidence.

Gate: core cost tests, runtime telemetry/ledger tests, benchmark contract tests,
package suites, typecheck.

## Slice 4 - Reproducible Routing Baseline

Owner: existing benchmark runner; no benchmark-only execution path.

Status: Complete in commit `bd2c0480`.

- Persist resolvable result, transcript/tool, diagnostic, usage, route, and
  economic evidence for each run.
- Record provider/model, reasoning behavior when observable, config hash,
  dataset version, scorer set, `k`, and commit.
- Run a bounded pilot, then `k >= 5` only for routes whose execution and
  economic evidence pass readiness gates.
- Update the personal operator example from evidence; do not promote a route
  from vendor claims or one run.

Gate: benchmark readiness, report generation, focused live probes with explicit
operator authorization, relevant package tests, typecheck, build, review.

## Verification And Commit Sequence

1. `fix(core): preserve canonical tool identities across providers`
2. `fix(routing): classify provider route failures`
3. `feat(cost): expose comparable execution cost evidence`
4. `feat(benchmark): emit reproducible baseline evidence`
5. Documentation promotion and Roadmap 04 status update after all gates pass.

Each production slice starts with a failing test, changes one owner, runs its
focused and package gates, receives code/architecture review, and commits only
related files. Rollback reverts the slice commit; no feature flag, shadow path,
or compatibility shim remains.

## Completion Criteria

- Kimi-compatible tool names round-trip to canonical Kiln tool identities.
- Route errors are classified consistently and transient failures cool down.
- Subscription runs do not masquerade as measured metered `$0` executions.
- Provider-reported cumulative usage and cache evidence remain intact.
- Baseline artifacts are resolvable and meet the benchmark profile's declared
  reproducibility requirements.
- No routing configuration changes until comparative evidence reaches its gate.
- Focused tests, package tests, typecheck, build, review, and `git diff --check`
  pass with a clean worktree.

## Closeout

Status: complete as prerequisite repair work for Roadmap 04 Slice 0.

Verification completed:

- `bun run --filter @kilnai/core test`
- `bun run --filter @kilnai/runtime test` passed before Slice 3 and affected
  runtime suites passed after Slice 3; one later full-runtime run hit a
  Windows timeout in `tui-gateway-clear.test.ts`, and that file passed cleanly
  on immediate isolated rerun.
- `bun run --filter @kilnai/cli test`
- `bun run typecheck`
- `bun run --filter @kilnai/core build`
- `bun run --filter @kilnai/cli build`
- `git diff --check`

Residual risk:

- Live `k >= 5` provider comparisons were not rerun after these repairs.
  They still require explicit operator authorization because they use network,
  credentials, quota, and possibly paid inference.
- The next Roadmap 04 action is to run a bounded post-repair pilot and promote
  only routes whose execution, economic, and artifact evidence pass readiness
  gates.
