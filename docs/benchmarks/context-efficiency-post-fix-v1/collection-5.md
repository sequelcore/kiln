# Context Efficiency Control 5

Status: diagnostic-only; economic settlement completed by reviewed operator reconciliation.

The Plus-only codex-luna collection ran on 2026-09-05 using frozen source
`19bfc0946953db9ad7ae723b62192e2e83fbb66f`. It tested the revised bounded
implementation verifier, not the repository-analysis comparison arms.

| Task | Valid trials | Passed |
| --- | ---: | ---: |
| Exact response | 6 | 5 |
| Repository reading | 6 | 2 |
| Bounded implementation | 6 | 6 |
| Heavy tool results | 6 | 0 |
| Long conversation | 3 | 0 |
| Managed child | 0 | 0 |

There were 35 attempt records: 27 valid (13 passed, 14 failed) and eight
invalid records, including skipped warm trials. All six coding trials passed
the host-owned behavioral oracle. The managed-child attempts were invalid with
route-unavailable and recorded denials
`policy_bound_capacity_requires_economic_commitment` and
`economic_commitment_unavailable`; no child invocation was recorded.

The collection consumed 150 exactly accounted physical requests, with no new
unknown or reserved requests. Cumulative known consumption is 532; preserving
17 earlier reservations leaves 116 of the authorized 665 requests. This
accounting does not imply that economic capacity has settled.

Temporary file grants were rolled back through the owning CLI, with exact
global configuration restoration. Two leases in the canonical global economic
authority were initially held, with settlement-pending commitments and dispatch fences.
The empty project-local lease store is not evidence of global settlement.
Independent review identified a medium cleanup/authority defect.
The subsequent repair added explicit operator-attested `not-dispatched`
reconciliation. Source and denial evidence proved the named provider-dispatch
effect was unreachable in both attempts. Ordinary CLI reconciliation released
both reservations; a read-only global-store check confirmed zero unreleased
leases while preserving the original unknown observations and action fences.
Missing child-result metadata alone was not used as proof.

Private evidence is retained under the execution project's canonical benchmarks
namespace as `context-efficiency-control-5`. Frozen inputs and raw report remain
unchanged; the original terminal review records the residual leases, and the later
`reconciliation/repair-review.json` binds the completed settlement, final global
ledger verification, and identical receipts replayed after restarting Runtime.

- Report digest: `sha256:fb2ba7d80fd78b08dd6dbac567dfa8089d7ba695dcb5e44e9aa47bc07964bf92`.
- Original terminal review digest: `sha256:389561d19d098933a666e0522a36699c4647c551462bbf112c84cf04a98f4dea`.

- Final repair review digest: `sha256:9f32b58875cfa3425f186d041cc675f195a3e4eb8d72bd159702ef7ebdaaa969`.

The launch repair now completes request admission before fencing dispatch,
without recursive fixed-route preparation or catalog rewriting. Recovery opens
the canonical global ledger independently of current route configuration.
Full workspace typechecking and the affected Runtime, CLI, Core, and Gateway
tests pass. No additional benchmark provider requests were made.

The coding repair worked in this cohort. A valid full control, live comparison
runner, solver isolation, and Criba disposition remain outstanding. See the
[comparison readiness](../../research/active/repository-analysis-task-comparison-readiness.md).
