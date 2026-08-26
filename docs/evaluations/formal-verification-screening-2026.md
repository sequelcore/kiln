# Formal Verification Screening Retrospective 2026

## Decision

Formal verification remains selectively available and off by default. The
completed C0/T screening found a ceiling in both arms, so it supports route and
evidence mechanics but no comparative correctness claim.

The 32/32 valid trials formed 16/16 complete matched blocks. The hidden
exhaustive oracle passed every trial, control had no access to `lemma_check`,
and treatment produced host-owned observations bound to the final candidate
and expected toolchain. Control pass-at-1 was `1.0`, outside the preregistered
`0.20-0.80` sensitivity range; treatment pass-at-1 was also `1.0`. There were
no discordant pairs from which to estimate benefit.

The preserved result is therefore `diagnostic-only`, not evidence that formal
feedback has no effect.

## Frozen evidence

- Branch: `dev`
- Final route-fix revision: `411f7490`
- Config digest: `sha256:979765fb796dfa3938eb0e109b772130ad09f21c2326d9c38bdc07606c37d657`
- Comparison digest: `sha256:7e898bff5e41207a1eedcb88f1a4706367a11138f4cdfe6ac560f08c4cd49923`
- Valid/invalid trials: `32/0`
- Complete valid blocks: `16/16`
- Passed gates: block completeness, invalid rate, exhaustive oracle, control
  isolation, treatment mechanics, and reconciliation
- Failed gate: control sensitivity

Raw operator-local artifacts remain private and must not be promoted as public
benchmark evidence. Earlier artifacts with invalid trials are diagnostics and
must not be mixed into this result.

## Screening package v2

The follow-up development package produced eight isolated, package-bound pair
reports. Together they accepted 16/16 sealed references, killed 64/64 semantic
mutants with both the hidden oracle and Dafny, detected 24/24
contract-integrity mutations, and recorded no infrastructure failure. A later
full-package run under concurrent CLI load retained four Dafny timeouts: one in
Pair 1 and three in Pair 4. That aggregate attempt remains `failed`; the
isolated reports share the same manifest, oracle, mutant, and toolchain hashes
but do not rewrite the failed run as clean.

Its manifest digest was
`sha256:847946d8dfd0e3f9d611544a259145af080f6f40bf0c663a9d460bbe7938ede0`.
The package also exposed real limits:

- sealed B references and hidden oracles were generated from the same source,
  so structural variation did not provide interpretation independence;
- visible postconditions often disclosed the answer table and could recreate
  a control ceiling;
- contract-text mutations tested text integrity, not absence of vacuity;
- Pair 7 passed behavioral oracles but failed Dafny because its interpolated
  template concatenated a character sequence with generated datatype `Delay`;
- Pairs 6 and 8 similarly demonstrated that behavioral correctness and
  admission to the current formal subset are distinct claims;
- Pair 2 and Pair 8 retained witness-label defects that must be corrected before
  any frozen target evaluation.

GPT, Grok, and DeepSeek development sessions were exposed to assigned material.
They do not form a zero-retention or confirmatory cohort. Claude was not
completed and is not silently substituted.

## Exit conditions for a new comparative study

1. Build independently sourced references and hidden oracles, reduce answer
   leakage in visible contracts, and correct witness metadata.
2. Add a genuinely non-correlated provider review and reconcile raw responses
   mechanically without manual adoption.
3. Freeze prompts, package, digests, timeout, toolchain, route, model, and
   account identity.
4. Recalibrate off-target until C0 falls inside `0.20-0.80` with acceptable
   invalid rate and explicit candidate/provider/infrastructure failure classes.
5. Only then fund a powered target comparison.

Until those conditions hold, `benchmarkReady` remains false and no result may
be presented as a winner, general benefit, product-level proof, or automatic
Assurance integration.
