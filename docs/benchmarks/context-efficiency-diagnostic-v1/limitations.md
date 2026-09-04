# Context Efficiency Diagnostic v1 Limitations

- The replacement manifest is not yet independently reproducible: its source
  digest covers the current uncommitted working tree over the declared starting
  commit. The source list now includes the transitive request-path owners, but a
  clean checkout cannot recreate the cohort until those changes are committed.
- This is a completed but post-review-limited diagnostic collection, not a controlled comparison or
  performance benchmark. It retained 33 valid rows, zero invalid rows, all 11
  cells at three samples, 155 physical-request observations, and 22 valid
  failure rows. The evidence is useful for diagnosis but cannot support a
  quality or deployment claim.
- The first collection attempt produced no valid rows and no physical model
  transports because canonical execution-target price evidence was stale.
- A post-refresh attempt also produced 44 invalid rows and zero physical model
  transports. Target evidence and route/account availability passed separate
  preflight, but that attempt predates content-free pre-dispatch substage
  classification; its exact failure stage is therefore unresolved.
- The approved one-trial pre-dispatch probe also produced one invalid row and
  zero physical model transports. It retained an unclassified pre-dispatch code
  before the collector could distinguish a structured run failure from an
  unstructured CLI command failure. A further attempt requires new bounded
  approval.
- Local lease inspection subsequently identified live ownership of both fixed
  `managed-direct-*` action-claim stores while the probe ran. The CLI-run owner
  now uses session-scoped private stores, but that diagnosis is not a valid
  baseline. A bounded post-fix probe confirmed that CLI dispatch proceeds.
- The first probe after action-claim isolation completed one model round but
  produced a collector-invalid row because ordinary CLI JSON output discarded
  Runtime request evidence. The output now shares the internal benchmark's
  content-free physical-attempt projection; the next bounded probe validated
  that projection with one complete request row.
- The next bounded probe produced a valid collected row with a successful task
  oracle and one completed physical request. Its hard authority gate failed
  because the evaluator conflated requested and admitted authority and rejected
  the canonical no-tool `fail_closed` result. That evaluator and the two no-tool
  task expectations are corrected, but the one-row probe is not the Slice 2
  baseline.
- The first full collection retained 42 rows, including nine valid rows and 30
  physical requests, but 33 rows were infrastructure-invalid. Tool-bearing
  canonical runs had no bound host sandbox, and failed finite CLI processes
  exited before releasing their per-session action-claim owners. The ordinary
  CLI and internal benchmark now bind host-tool enforcement to the exact
  permission policy and configuration revision, and failure cleanup settles
  those owners before exit. The retained report is diagnostic failure evidence,
  not the Slice 2 baseline.
- The next full collection retained 41 rows, again with nine valid no-tool rows
  and 30 physical requests, but every tool-bearing cell remained invalid. The
  bounded follow-up diagnostics consumed the remainder of that run's approved
  44-attempt ceiling and identified three independent projection defects: final
  capability candidates were omitted from authority-count reconciliation,
  managed delegation's read-only exception retained a destructive descriptor,
  and the canonical managed-coding profile was classified as read-only by the
  command even though the profile declares approved-write access. These paths
  now share canonical predicates and have focused regression coverage. Another
  complete collection requires renewed provider authority.
- The latest full collection retained 39 rows: 18 valid and 21 invalid, with 63
  physical requests represented in valid rows. Failed Runtime sessions still
  discarded provider-request evidence at the CLI boundary, and the managed-child
  fixture requested an optional skill absent from the governed catalog. Runtime
  now projects observed requests on terminal failure and the fixture no longer
  requests that skill; the retained report is still not a complete baseline.
- Five final one-row managed-child probes consumed the remaining authorization
  and produced 12 physical requests. They showed that the frozen Luna target had
  no read-only economic intent: only the approved-write `luna-worker` intent
  covered that route, while direct invocation was correctly denied for its
  policy-bound capacity. The executable configuration now provides a read-only
  `luna-scout` intent and the fixture requests it. That correction is verified
  offline only and requires fresh provider authority for live validation.
- The 2026-09-01 collection retained 37 attempts, 22 valid rows, 15 invalid
  rows, and 67 physical requests. Four cells remained incomplete because the
  CLI's early terminal-failure JSON omitted Runtime-retained request evidence;
  paired warm trials consequently had no completed cold-session identity. The
  same run proved that a configured managed intent is not itself an executable
  agent definition and exposed an authorizer defect that ignored explicit tool
  allow rules. All three paths are corrected offline, but the resulting source
  and protocol identities require renewed collection authority.
- Two subsequent Plus-only attempts retained 12/40 and 18/38 valid rows. Their
  warm cells were invalid because the cache partition included ephemeral route
  evidence and the live Operator Runtime still loaded an older compiled build.
  They remain separate adverse evidence and are not pooled into the replacement
  cohort.
- The historical 2026-09-01 cohort is frozen by private artifact digest
  `sha256:089c60d310733efeb7ad8e38a2406a21ff3fba7b126bb872d2ff6b48c43ea8c6`.
  Earlier failed cohorts and probes remain separate adverse evidence and are not
  pooled into its cell summaries.
- The 2026-09-04 replacement cohort is retained by private artifact digest
  `sha256:e3368f37dcedbd3ca08a846d4772c7f9e8cc07e6183bf063262e38f0008c4e4d`.
  It retained 15/15 matching top-level cold/warm cache partitions and 844,800
  provider-reported cache-read tokens. Its collector preferred top-level
  observations whenever they existed, so it did not validate managed-child
  partition lineage. The artifact does not retain that lineage and cannot
  repair the missing proof retrospectively.
- The initial route is one local subscription-backed Codex OAuth target; its
  findings do not generalize to other providers, models, machines, or dates.
- Global MCP configuration changed after the validation probe and later
  returned to the original frozen revision. The diagnostic CLI explicitly
  disables MCP loading and admission, so no MCP server participates in the
  baseline regardless of that ambient configuration.
- Three repetitions expose gross bottlenecks but do not support population or
  tail-latency inference.
- Provider usage semantics may not equal Kiln's regional estimator. The report
  must retain both and keep any discrepancy unresolved.
- Cold and warm state are provider-contract observations, not operating-system
  cache claims. The replacement run proved equal opaque cache/account
  partitions only for the top-level requests in all 15 scheduled pairs. The
  repaired collector now also rejects missing or unequal managed-child lineage,
  but that stronger gate has not been exercised in a live replacement run.
- The retained replacement artifact does not contain managed-child lineage, so
  it cannot support a child-cache claim. Runtime now retains content-free child
  observations with invocation/session/turn lineage even when execution fails,
  is cancelled, or times out after an observed request; this repair is covered
  offline but was made after the retained collection.
- Live collection is Plus-only and fails closed unless fresh evidence names the
  allowed registered Plus accounts and the target policy excludes all other
  accounts. The replacement cohort used fresh evidence for `codex-04dc1471`
  and `codex-1720ceb0`; retained bindings selected `codex-04dc1471`, and no Free
  or ProLite account appears.
- Post-review, the Plus-only preflight now resolves every allowed account
  against the canonical account-usage inspection owner instead of trusting the
  manifest's plan label. The retained bindings independently identify only the
  registered Plus account `codex-04dc1471`, but the stronger preflight was added
  after this collection.
- The pre-fix baseline intentionally includes known managed projection drift.
  It is not the control for later promotion decisions.
- The committed fixtures, deterministic verifier, and ordinary-path collector
  are present. Canonical execution-target evidence was renewed through the
  approved account-usage refresh owner. The Slice 2 collection authority was
  consumed by the replacement report; any new provider execution requires
  separate explicit authority and produces a separate cohort.
