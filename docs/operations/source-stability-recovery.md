# Validate source-stability recovery

This runbook separates Kiln's credential-free recovery gate from its
operator-authorized live provider proofs. Neither command is release-readiness
evidence. A supported source decision still requires the remaining Roadmap 00
promotion gates and the release runbook.

## Deterministic gate

Run the portable gate after changing recovery, replay, cancellation,
settlement, configuration revision, or managed-invocation startup behavior:

```bash
bun run test:source-stability-recovery
```

The command reads the canonical scenario manifest, runs its Runtime and CLI
test files without credentials, and requires every deterministic locator to
match exactly one passing assertion. Missing, duplicate, failed, skipped,
pending, or unsupported-package evidence fails the gate.

The root `test` script includes this gate. Its focused Vitest children have a
fixed 15-minute deadline, a 16 MiB combined output limit, bounded process-tree
termination, and a bounded post-termination close wait.

The canonical matrix is
[`scripts/fixtures/source-stability-recovery.manifest.json`](../../scripts/fixtures/source-stability-recovery.manifest.json).
It owns each scenario, bounded-context owner, expected state, cleanup contract,
deterministic locator, live classification, and admitted live proof.

## Live authority

Live validation is manual and opt-in. Executable, credential, account, or
configuration discovery never grants authority. Set the master flag and at
least one exact provider flag to `1`; unset and `0` are not authority.

| Proof route | Required provider authority | Required exact configuration |
| --- | --- | --- |
| Codex CLI read and approved write | `KILN_LIVE_CODEX_TESTS=1` | `KILN_LIVE_CODEX_MODEL` |
| Claude CLI plan-mode read | `KILN_LIVE_CLAUDE_TESTS=1` | `KILN_LIVE_CLAUDE_MODEL` with an exact catalog model ID |
| OpenCode CLI cancellation | `KILN_LIVE_OPENCODE_TESTS=1` | `KILN_LIVE_OPENCODE_MODEL` |
| OpenCode CLI read boundary and approved write | Both `KILN_LIVE_OPENCODE_TESTS=1` and `KILN_LIVE_OPENCODE_WRITE_PROOF_TESTS=1` | `KILN_LIVE_OPENCODE_MODEL` |
| OpenCode Go managed write and replay | `KILN_LIVE_OPENCODE_GO_DIRECT_WRITE_TESTS=1` | `KILN_LIVE_OPENCODE_GO_DIRECT_WRITE_ROUTE` |
| OpenAI direct read | `KILN_LIVE_OPENAI_DIRECT_TESTS=1` | `KILN_LIVE_OPENAI_DIRECT_MODEL` |
| Codex OAuth direct read | `KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS=1` | `KILN_LIVE_CODEX_OAUTH_DIRECT_MODEL` |
| Codex OAuth direct approved write | `KILN_LIVE_CODEX_OAUTH_DIRECT_WRITE_TESTS=1` | `KILN_LIVE_CODEX_OAUTH_DIRECT_MODEL` |
| Codex OAuth managed-account fail-closed proof | `KILN_LIVE_CODEX_OAUTH_MANAGED_ACCOUNT_TESTS=1` | `KILN_LIVE_CODEX_OAUTH_MANAGED_ACCOUNT_ROUTE` |

Every live invocation also requires:

```powershell
$env:KILN_LIVE_MANAGED_AGENT_TESTS = "1"
```

Set only the provider flags and exact model or route values approved for the
current run, then execute:

```bash
bun run test:managed-agents:live
```

The Claude path removes API-key, alternate-base-URL, Bedrock, Foundry, and
Vertex overrides from its child environment so the proof stays on the
operator's native Claude entitlement. Authority for one provider does not
authorize another provider or a write subproof.

The runner has a fixed 45-minute deadline, a 12 MiB combined output limit, and
bounded process-tree termination. A timeout, interrupt, output-limit breach,
spawn failure, malformed result, nonzero test process, or unverified cleanup
fails the command. The report retains the exact model and enabled flag names as
provenance. It does not retain raw provider output, credentials, account or
subscription identifiers, or route values.

Remove the temporary authority and configuration variables from the shell
after the run. Do not reuse an old shell as evidence of a newly authorized
scope.

## Report

Each invocation attempts to replace one operator-private report:

```text
$KILN_HOME/projects/<krp_sha256>/evidence/source-stability-recovery/latest.json
```

The default Kiln home is `~/.kiln`. The project ID is derived from the
canonical project root. There is no report history or repository copy; retain
an external snapshot only under a separately approved evidence-retention
procedure.

Before using the report, verify:

- `candidate.commit` is the intended commit and `candidate.dirty` is `false`;
- `enabledAuthorityFlags`, executor versions, models, and harnesses match the
  approved run;
- `liveRun.status` is `completed` and `liveProofOutcome` is `passed` for the
  authorized proof set;
- every authorized `liveProofs` entry is `executed` with verified cleanup;
- `terminalOutcome`, `cleanupOutcome`, and `residualRisks` are interpreted as
  matrix-wide results, including omitted and partial cases;
- `releaseReadiness` remains `not-evidence`.

`failed` means an attempted proof produced a failing or invalid result.
`skipped` means an authorized locator was selected but Vitest did not execute
it. `omitted` includes proofs outside the selected authority and planned proofs
that have no admitted implementation. A `passed` live proof outcome does not
turn partial live observations into exact recovery-case evidence.

Transport disconnect, credential expiry, and capacity exhaustion remain
planned omissions in manifest v1. Their residual risks must remain visible;
another provider proof cannot stand in for them.

## Cadence

Run the deterministic gate for every affected change and before candidate
promotion. Re-run the live command only with fresh operator authority when a
candidate is being evaluated after changes to a provider, harness, model or
route, live proof, recovery boundary, cleanup behavior, or report contract.

Do not add the live command to ordinary CI. A scheduled environment may invoke
it only when that environment has an explicit, reviewed authority owner,
bounded credentials and quota, cleanup responsibility, and private report
retention.
