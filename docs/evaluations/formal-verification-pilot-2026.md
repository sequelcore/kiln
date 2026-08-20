# Formal Verification Pilot 2026

## Decision

Keep `formal_verify` globally configured and selectively available. This pilot
does not support making it required by default, and it does not justify the
planned 80-trial expansion without a redesigned task set.

Verdict: `blocked-for-comparative-claim`.

## Claim Under Test

For small backend tasks with crisp invariants, does exposing deterministic
Dafny feedback improve hidden functional correctness for the same
provider/model, prompt, fixture, account assignment, and execution policy?

The primary outcome was fixed out-of-process functional tests. Formal-proof
compliance, diff scope, tool trajectory, latency, tokens, route identity, and
invalid attempts were separate evidence; none could rescue a functional
failure.

## Frozen Setup

- Date: 2026-08-20
- Source revision at execution: `2c23f1390e5f15764c1239d8aa0829bed2122e0b`
- Profile/dataset: `kiln-formal-verification-pilot` v1 /
  `kiln-formal-verification-pilot-v1` v1
- Target: `codex-oauth/gpt-5.6-sol`, provider-default deliberation
- Accounts: two available subscription accounts, assigned by stable pair with
  explicit failover
- Design: four matched task pairs, control versus treatment, `k=2`
- Treatment difference: strict projection additionally exposed
  `formal_verify`
- Verifier: Dafny `4.11.0`; observed version and final proof bytes had to match
- Functional oracle: fixed Node tests in a network-disabled, read-only-root
  Docker container
- Config hash: `sha256:7a110ed9761f7e4baddd6cb0182344c51c9942256b8f19f83083b3baba7001e9`
- Local evidence: `.kiln/benchmarks/formal-verification-pilot-v1-final.json`
  and its typed artifact directory

Account identifiers and credentials are operator-local evidence and are not
persisted in the repository.

## Observations

| Outcome | Control | Treatment |
| --- | ---: | ---: |
| Counted valid trials | 8 | 8 |
| Hidden functional tests passed | 8/8 | 8/8 |
| Arm compliance passed | 8/8 | 8/8 |
| Median duration | 55.6 s | 49.7 s |
| Median input tokens | 12,652 | 12,466 |
| Median output tokens | 2,110 | 1,654 |

All counted treatment trials invoked Dafny and carried proved correctness
evidence for the final `proof/model.dfy` bytes. Counted controls had no
`formal_verify` calls. Provider, model, and account identity matched the
requested execution identity for every counted valid trial, and subscription
cost remained non-comparable rather than being interpreted as zero economic
cost.

The runner needed 19 relevant attempts to obtain 16 valid trials: three route
failures produced an invalid-trial rate of 15.8%, above the profile's 10%
limit. The underlying execution log also exposed a runner defect: retry rounds
re-executed already-complete items. That caused four extra valid provider calls
and one extra pre-dispatch route failure outside the baseline denominator. The
runner now forwards the pending-item subset, with regression coverage, but the
recorded pilot predates that correction.

## Interpretation

The task set had a complete ceiling in both arms. It demonstrates that the
formal tool is reachable, that the model can use it, and that Kiln can retain
candidate-bound verifier evidence. It does not demonstrate a correctness
improvement. The apparent treatment latency and token reductions are not an
efficiency claim: the sample is small, retry timing is confounded, and the
provider route reported subscription rather than comparable metered cost.

The pilot therefore supports selective capability, not requiredness. A larger
run would spend quota without resolving the current measurement problem.

## Required Amendments Before Expansion

1. Replace ceiling tasks with calibrated cases where control performance is
   neither near zero nor near one, while keeping hidden tests and formal
   obligations aligned.
2. Add a paired analysis that reports within-pair effects and treats any
   account failover asymmetry as a broken pair.
3. Re-run the small pilot after the pending-item retry fix and require an
   invalid-trial rate at or below 10% before estimating an effect.
4. Keep correctness, proof adherence, operational reliability, latency, token
   use, and economic evidence as separate claims.

## Complexity Disposition

The invariant is an honest comparison in which tool availability is the only
intended arm difference and successful proof evidence is bound to the final
candidate. Comparing final prose or self-reported success was insufficient
because it could not establish behavior or proof provenance.

The bounded permanent surface is one internal profile, one versioned paired
dataset, four synthetic fixtures, two deterministic scorers, account-assignment
evidence, and preserved tool-result metadata. No new product lifecycle or
policy default was added. The remaining accidental complexity is paired retry
and failover analysis; it should be solved before, not during, an expanded run.
