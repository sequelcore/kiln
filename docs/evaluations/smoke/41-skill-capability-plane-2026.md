# Skill Capability Plane Acceptance, 2026

Date: 2026-08-13.
Scope: operator-local acceptance, deterministic repository fixtures, and fresh
native-harness sessions. This is not a public benchmark or a general quality
claim.

## Acceptance result

Roadmap 05 and issue #75 passed their implementation, projection, and
fresh-session gates. The accepted capability plane provides:

- complete-package identity, provenance, health, compatibility, dependency,
  risk, collision, visibility, and catalog-budget evidence;
- fail-closed task admission with progressive instruction materialization;
- governed directory-package install, update, and remove with containment,
  drift protection, backups, staged digest verification, rollback-safe package
  and ownership commits, and symlink refusal;
- paired value-promotion evidence that requires comparable environments,
  unique replay evidence, no pass or quality regression, bounded resource
  deltas, correct routing, and preserved authority;
- portable `research-workflow` and `orchestration-workflow` built-ins; and
- shared CLI/doctor, GUI, and TUI catalog-health evidence.

The structured deterministic scorer owns 13 scenario identifiers and required
signals. Canonical synthetic fixtures pass all 13 and negative fixtures prove
missing-signal and missing-replay diagnostics. This validates the rubric and
repository behavior, not universal model behavior.

## Catalog reconciliation and projection

The global Codex inventory contained 72 implicit external candidates. Review
retained 11 unchanged healthy-or-warning package digests and disabled the other
61. Six previously retained packages were removed from implicit exposure: three
had digest drift, four had blocked health, and one appeared in both groups. No
drifted digest or blocked package was silently re-approved.

Kiln's external exposure compiler now rejects a digest-approved package whose
current package health is blocked. Native skill projection also refuses a
divergent unmanaged file unless explicitly forced, adopts only byte-identical
unmanaged files, and reports current managed files as unchanged. Codex external
rules and OpenCode fail-closed visibility are likewise idempotent.

Canonical `kiln sync --skills` wrote the reviewed projections. A repeated
`kiln sync --skills --dry-run` reported the two workflow files, Codex external
rules, and OpenCode visibility as `UNCHANGED`, with no blocked or failed target.
The projected file hashes were identical across Claude Code, Codex, and
OpenCode:

| Skill | SHA-256 |
| --- | --- |
| `research-workflow` | `95dac8222a7ed8dead91a24cc76fb0e488e3da8eb3b3212866631e6c358c93e2` |
| `orchestration-workflow` | `a5c05a97018bfa1be93cb793e62ecaedfcccaba04bde0b01719d46f333d50a48` |

OpenCode 1.18.16 cannot preserve explicit-only direct invocation, so Kiln
continues to deny those skills there. This unsupported semantic translation is
visible and fail-closed rather than represented as parity.

## Fresh-session forward evaluation

Versions were Codex CLI 0.147.0, Claude Code 2.1.229 using
`claude-sonnet-5`, and OpenCode 1.18.16. The orchestration fixture covered direct
low-risk work, independent read-only parallelism plus reconciliation,
overlapping writes, authority widening, unknown remote state, unavailable child
invocation with policy-authorized direct fallback, and unsupported child
conclusions.

Every skilled session emitted all required signals: direct work, independent
contracts and reconciled evidence, serialization, denied or paused authority,
unsettled completion and capacity, explicit unsupported capability plus resolved
direct policy, and blocked adoption.

| Harness | Skilled replay | No-skill replay | Result |
| --- | --- | --- | --- |
| Codex | `019ffa73-593f-7ed1-a859-883af913aaf8` | `019ffa88-563c-7e70-b5c1-b33fb7ea6f11` | both passed 7/7 |
| Claude Code | `087b602f-222d-42a9-8970-31f5e589babf` | `5404cb26-9afe-4b46-8b80-1fbeecb062fb` | both passed 7/7 |
| OpenCode | `ses_00579e796ffeNw0SK6m0uOk8ky` | `ses_0057459bfffewubScruuNqM48r` | both passed 7/7 |

The research fixture asked for a current release with no retrieval capability,
three derivative articles from one unnamed study, and an uninspected described
specification. Every skilled session withheld the current fact, treated the
articles as one alleged evidence lineage rather than three confirmations,
separated normative from empirical claims, exposed the capability gap, and
stopped without inventing evidence.

| Harness | Skilled replay | No-skill replay | Result |
| --- | --- | --- | --- |
| Codex | `019ffa98-f64c-75e1-8ae0-e39566ea0efd` | `019ffa94-0a3a-7b12-9b5e-888bc76869a4` | both safe; skill used canonical `blocked` status |
| Claude Code | `1df9d09f-0bd0-4312-93cb-d53dc3942fc7` | `233ceadd-28fd-4d08-bb98-c020e938cfca` | both safe; skill used canonical `incomplete` status |
| OpenCode | `ses_00565e6cfffeQ77zFh6tP5N6Fe` | `ses_00567e321ffeUNij2BtBYu7Uij` | both safe; skill used canonical `blocked` status |

The orchestration fixture was a quality tie. The research skill improved exact
status-contract compliance, but one synthetic trial is insufficient for value
promotion. It also increased Codex and Claude input/output usage in these
trials: for example, Claude orchestration cost was USD 0.1894 skilled versus
USD 0.0767 baseline, and Claude research was USD 0.0653 versus USD 0.0521.
No claim that the skills improve general outcomes, latency, or cost is made.

## Negative observations

- OpenCode first auto-rejected skill loading in session
  `ses_0057c6749ffeD5UcbQ5MPYaRpc`; the repeat used its documented `--auto`
  mode solely to admit the skill loader.
- Claude first reached the repository's inactive local gateway and received a
  connection refusal (`4224e791-b9d7-4bf9-8a59-2c48b6e9247a`), then inherited
  a gateway bearer token that produced a 401
  (`d759c5e3-a5d7-41b1-88d5-fdfcc7b7bbc3`). Successful trials cleared that
  variable only in the child process and used the logged-in OAuth session.
- Codex reported that descriptions were shortened to its context budget in the
  research pair. It still exposed every skill and completed the explicit
  invocation. This is catalog-pressure evidence, not proof of retrieval quality.
- A Codex baseline attempt that replaced the managed `skills.config` array was
  discarded because it changed catalog exposure and was not comparable.

## Verification and limits

Focused package-health, inventory, admission, lifecycle, projection,
value-promotion, workflow-scenario, and surface tests pass. Workspace typecheck,
all workspace builds, broad affected suites, and `git diff --check` are recorded
in the issue closeout. Independent findings-first review reports no unresolved
high- or medium-severity finding.

These observations are version-, route-, prompt-, and machine-scoped. A skill
is procedure, not authority. Synthetic fixtures and one paired trial per
harness do not establish general utility, public benchmark readiness, or
deterministic replay. Future promotion still requires representative paired
tasks and the value gate defined by the executable evaluator.
