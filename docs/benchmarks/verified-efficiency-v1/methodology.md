# Verified Efficiency Reference Methodology v1

This bundle exercises Kiln's publication gate; it is not a public performance
claim and it is not a harness leaderboard result.

The committed fixture contains five deterministic paired observations. Each
pair binds a task-definition hash, identical baseline/candidate input hashes,
and separate execution-envelope hashes for the two arms. The report copies the
complete manifest execution identity: harness, provider or route policy, model
or policy, effort, SDK/API, authority, tool catalog, configuration, and
environment. It also carries the canonical SHA-256 of the exact baseline array
that may be rendered beside a public claim; this internal-only reference binds
the empty baseline array because it authorizes no claim. The fixture exists to
prove evidence serialization, category
separation, paired comparison, failure disclosure, and cross-surface
reproduction without depending on a vendor model.

## Procedure

1. Read `manifest.json` and resolve every artifact from its repository-relative
   path.
2. Verify every artifact byte-for-byte against its declared SHA-256 digest.
3. For any claim-bearing bundle, verify every artifact resolves to the same
   bytes in the exact declared Git tree; working-tree-only or external files do
   not qualify.
4. Verify the strict paired report binds the methodology, fixture, limitations,
   dataset version, complete execution identity, and claim kind from the
   manifest. Cross-check each task-definition, input, and execution-envelope
   hash and the canonical baseline-array digest against the fixture. For a
   rendered public report, recompute that digest from the supplied baseline
   payload, then derive paired-input identity, category
   reconciliation, paired improvement, non-inferiority, hard invariants, and
   the supported lower bound from report content.
5. Run the Core publication-readiness test with the exact command declared in
   the manifest.
6. Confirm the result is `internal-evidence-only` and
   `publicClaimAllowed=false` because this deterministic bundle declares no
   public performance claim.

## Measurement rules

- Measured, estimated, cached, cache-written, unknown, and avoided tokens are
  distinct fields.
- Avoided tokens are admitted only from paired baseline/candidate evidence and
  are never subtracted from provider totals.
- Any saving must link an efficiency action to a passing verification result.
- Quality and verification non-inferiority are evaluated beside token changes.
- Cost comparisons require comparable metered economics. Subscription or
  unknown economics cannot support a cost-efficiency claim.
- Failed and omitted cases are explicit arrays, including when empty.

## Scope

This reference validates Kiln contracts and reproducibility mechanics only.
Provider quality, model capability, harness speed, and production savings are
outside its scope.
