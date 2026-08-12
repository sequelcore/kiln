# Context Semantics Cross-Surface Smoke, 2026-08-08

## Status

This note records an exploratory, read-only `n=1` diagnostic. It is not a
benchmark, does not establish comparative model quality, and is not suitable
for public performance claims.

The experiment tested two separate questions:

1. Does a surface expose the governed context classes selected for the turn?
2. Can the surface complete a small repository-inspection task with objective
   answers and no writes?

The distinction matters. A context marker smoke can pass while tool admission
prevents the model from doing useful repository work.

## Evaluation Basis

OpenAI recommends task-specific evaluations that reflect real use, automated
scoring where possible, complete logging, and human calibration rather than
generic or vibe-based judgments:
<https://developers.openai.com/api/docs/guides/evaluation-best-practices>.

Anthropic similarly recommends specific, measurable, multidimensional success
criteria, real-task and edge-case coverage, and code-based grading where the
answer can be checked deterministically:
<https://platform.claude.com/docs/en/test-and-evaluate/develop-tests>.

Kiln's canonical benchmark contract remains
[`../architecture/quality/benchmark-validation.md`](../architecture/quality/benchmark-validation.md).
This smoke does not satisfy that contract because it has one item, one valid
run per executable native arm, no repetitions, no frozen result artifacts, and
no confidence analysis.

## Frozen Task

- Repository baseline: `569a576ee36353fe807cb19b96f2598ff7e449ce`.
- Kiln: `3.0.0-beta.1`.
- Codex CLI: `0.147.0`.
- Claude Code: `2.1.226`.
- Authority: read-only or native plan mode.
- Requested output: one compact JSON object with repository-relative,
  one-based `file:line` citations.
- Prohibited effect: any file write.

The task asked each arm to inspect the pinned repository and identify:

1. the Core function that rejects rendered context not exactly admitted by the
   governor;
2. the relationships, metadata, and content identity it verifies;
3. the model-facing semantics assigned by `skillConfigToContextCandidate`; and
4. the three Runtime governed-context section headings.

The prompt also asked whether the exact `context-directives`,
`context-guidance`, and `context-evidence` markers were visible before tool
use. Marker presence is conditional on the context classes selected for that
turn; absence of a guidance marker is not a defect when no guidance block was
admitted.

## Deterministic Answer Key

- Validator: `validateAdmittedContextBlocks`.
- Set relationships: selected audit IDs equal admitted audit IDs; rendered IDs
  equal admitted IDs; every rendered ID is selected and admitted.
- Duplicate rejection: rendered IDs, selected IDs, and admitted audit IDs.
- Exact per-block metadata: `kind`, `source`, `modelFacingSemantics`,
  `required`, `estimatedTokens`, `memoryRecordId`, and `segmentId`.
- Content identity: `sha256ContentIdentity(renderedBlock.content)` equals the
  admitted `contentHash`.
- Skill semantics: `guidance`.
- Runtime headings: `--- Governed Context Directives ---`,
  `--- Governed Context Guidance ---`, and
  `--- Governed Context Evidence ---`.
- Required effect evidence: `writesPerformed: false`.

For completed real-task arms, a deterministic rubric awarded 12
factual/safety points and two contract points: JSON-only output and exact
single-line citation syntax. A blocked arm was not scored.

## Results

### Real Repository Task

| Surface | Exact model | Terminal result | Facts and safety | Output contract | Wall time | Diagnostic |
| --- | --- | --- | ---: | ---: | ---: | --- |
| Native Codex CLI | `gpt-5.6-terra` | completed | 12/12 | 2/2 | 61.1 s | Correct JSON-only answer, exact citations, zero writes. |
| Native Claude CLI | `claude-sonnet-5` | completed | 12/12 | 0/2 | 89.4 s | Correct facts and zero writes, but wrapped JSON in Markdown, added prose, and used two citation ranges. |
| Kiln -> Codex CLI | `gpt-5.6-terra` | blocked | not scored | not scored | 62.7 s | Model attempted repository inspection; Kiln denied harness tool `bash` by policy. |
| Kiln -> Claude CLI | `claude-sonnet-5` | blocked | not scored | not scored | 57.3 s | Model attempted repository inspection; Kiln denied harness tool `Bash` by policy. |
| Kiln direct Codex OAuth | `gpt-5.6-terra` | blocked before dispatch | not scored | not scored | 8.2 s | Multiple executable OAuth credentials require an explicit virtual-model account binding. No provider request occurred. |

The native Codex process reported 48,858 tokens. Claude Code reported 12 turns,
782 input tokens, 4,321 output tokens, 345,095 cache-read tokens, 68,458
cache-creation tokens, and USD 0.5814. These accounting classes are not
comparable: the Codex total includes harness-visible context accounting, while
Claude's USD value is a native estimate and is not proof of the operator's
subscription charge. No efficiency ranking is made.

### Marker Smoke

| Surface | Directives | Guidance | Evidence | Interpretation |
| --- | ---: | ---: | ---: | --- |
| Native Codex CLI | false | false | false | Native harness did not receive Kiln section markers. |
| Native Claude CLI | false | false | false | Native harness did not receive Kiln section markers. |
| Kiln -> Codex CLI | true | true | true | The sampled turn admitted all three context classes. |
| Kiln -> Claude CLI | true | false | true | The sampled turn admitted directives and evidence, but no guidance block. |
| Kiln direct Codex OAuth | not observed | not observed | not observed | Admission failed before model dispatch. |

The marker result proves only that the sampled model could identify the
selected class delimiters. It does not prove adherence, resistance to hostile
evidence, or better task quality.

## Findings

1. The #61 semantic split is visible through both sampled Kiln CLI harnesses.
   The Codex turn exposed all three selected classes; the Claude turn correctly
   omitted an unselected guidance class.
2. Both native harnesses answered the objective repository question correctly
   and performed no writes.
3. The governed CLI harness paths are not ready for this ordinary read-only
   repository task. Both reached the same cross-harness contract mismatch:
   their native shell tool was present to the model but denied by Kiln policy.
4. Direct Codex OAuth could not be evaluated. The multi-account pool fails
   closed unless execution is bound through an explicit virtual model. Open
   issue [#34](https://github.com/sequelcore/kiln/issues/34) is the closest
   current tracker for virtual-model economic route binding, but this smoke
   does not establish that #34 owns the normal `kiln run` readiness gap.
5. One correct response per native model is insufficient to infer model or
   surface superiority. The Claude formatting miss is a useful fixture, not a
   stable rate.

## Excluded Attempts

- One Claude native startup attempt was excluded because PowerShell failed to
  provide the prompt argument. No model request was made.
- Earlier marker-only runs were not scored as repository-task quality evidence.
- Blocked Kiln arms were retained as readiness evidence but excluded from the
  correctness denominator.

## Next Evaluation

A promotion-quality evaluation should freeze a versioned dataset with at least
three task families:

1. deterministic repository fact extraction with code-graded answers and
   citation validation;
2. adversarial context classification proving evidence cannot become a
   directive; and
3. a bounded code-review task with a calibrated human rubric for finding
   validity and severity.

Run at least `k=5` per provider/model/surface cell, randomize arm order, retain
sanitized transcripts and tool evidence, record config hashes and exact
versions, and report pass rate, pass^k, latency distributions, tool denials,
token classes, unknown cost fields, and human agreement separately. Pair
native versus Kiln arms only within the same exact provider/model. Cross-model
results remain descriptive unless model capability is explicitly the variable
under test.

Before repeating this task, resolve or explicitly admit the harness shell-tool
policy mismatch and configure a virtual-model binding for the direct Codex
OAuth route. A rerun before those readiness gates would only reproduce known
pre-dispatch failures.

## Follow-Up: Readiness Gate Resolution (2026-08-08)

### Shell-tool policy mismatch (short-term, closed)

Root cause: `packages/cli/src/commands/run.ts` `PLAN_POLICY` never granted the
`bash`/`Bash` tool at all, so `evaluateTool` fell through to the
`untrusted`-approval default (deny) before the per-invocation command-pattern
layer (`evaluateCommand`, `packages/cli/src/application/run-session.ts:277-307`)
ever ran. Codex CLI has no dedicated read-only tool surface separate from its
shell (`cloned/codex`), so this denied 100% of its plan-mode capability, not
just write effects.

Comparative research across `cloned/claude-code`, `cloned/codex`,
`cloned/opencode`, and `cloned/pi` found that none of these harnesses gate
read-only mode by omitting the shell tool; each gates by command/action shape
(Claude Code's per-invocation `BashPermissionRequest`, Codex's
`AskForApproval` + `FileSystemSandboxPolicy` computed from actual filesystem
effect, opencode's `evaluate(action, resource, ruleset)` defaulting to `ask`).
Kiln already has the equivalent mechanism — `KilnCommandPermissionRule`
pattern matching, previously used only by `SAFE_DEFAULTS_COMMAND_RULES` — so
the fix was to use it for `PLAN_POLICY` rather than to invent new
architecture: `bash`/`Bash` is now tool-level `allow`, and a `commands`
allowlist restricts invocations to read-only shapes (`git status/diff/log/
show/blame`, `cat`, `ls`, `head`, `tail`, `wc`, `pwd`), with explicit
higher-priority deny rules for chaining/redirection operators (`&&`, `;`,
`|`, backtick and `$(...)` substitution, `>`, `<`) so a read-only prefix
cannot be used to smuggle a write past the allowlist. Unmatched commands keep
falling through to the untrusted-approval default (deny). Covered by
`packages/cli/tests/commands/run-plan-policy.test.ts`.

This closes the `kiln run` plan-mode readiness gap for both Codex CLI and
Claude Code. It does not change the general `permission-evaluator.ts`
default-action semantics (still deny-by-tool-name outside `untrusted`
policies), and the glob-based command matcher's chaining risk is mitigated
only by explicit deny patterns, not by a real shell parse — a targeted
mitigation, not the general fix.

**Deferred, not scheduled:** migrating `permission-evaluator.ts` from
per-tool default-deny to command-shape/effect-based gating as the general
mechanism (matching Codex's sandbox-computed-from-effect model) is a larger
semantic change than this readiness gate warranted. Revisit only if further
plan-mode or safe-defaults gaps recur that a broader allowlist can't
reasonably absorb; no roadmap track currently owns this and none should be
opened speculatively ahead of that evidence.

### Superseded direct-model-binding proposal (2026-08-11)

Confirmed not owned by issue #34: `packages/runtime/src/agents/credential-pool/codex-oauth-credential-pool.ts`
(`createPooledAdapter`) refuses ambiguous auto-selection among multiple
executable OAuth credentials by design, a different subsystem from #34's
`managed_agent_invoke` economic-dispatch path (`docs/roadmap/02-managed-invocation-routing.md`).
Comparative research found no surveyed harness performs implicit
rotation/round-robin across multiple credentials for the same provider
(`cloned/pi` represents one account per provider key structurally; Claude
Code and Codex both assume one explicit active credential, switched via
login/logout) — confirming Kiln's ambiguity refusal is the correct default,
not a gap to remove.

Operator friction demonstrated that the prior Model Gateway reuse was the
wrong boundary, not merely a missing convenience command. The first proposal
was an independent `directModels` catalog plus `kiln model bind/list` and
`kiln run --model`. That proposal was implemented provisionally, then
superseded before adoption because it exposed credential-level selection as a
surface concept and duplicated the route catalog now described below.

The useful persistence work survived: global config mutation is consolidated
behind validation, revision conflicts, an interprocess lock, and
same-directory atomic replacement. No binding command or `directModels`
reader remains.

### Execution catalog resolution (2026-08-11)

The proposal above is historical evidence, not current guidance. The V2
execution catalog owns `accounts`, `accountPolicies`, and operator-facing
`routes`; `executionRouting.defaultRouteId` selects the default. Surfaces
select a route and may request an eligible account override, never a
credential. Runtime gates safety, health, quota, and live capacity, then orders
automatic candidates by economics and pressure, fences capacity, and verifies
credential ID and revision before dispatch. Exact selection never falls back.

Model Gateway virtual models and managed direct routes reference
`executionRouteId`; neither duplicates catalog authority. `kiln run` uses the
default route or `--route`; `directModels`, `kiln model bind/list`, and
provider/model/API-key execution overrides are retired and rejected.

## Follow-Up: Live Re-Proof, Claude Arm Only (2026-08-08)

Codex OAuth quota was exhausted at re-proof time, so only the "Kiln -> Claude
CLI" arm was re-run against the fix, same frozen task, same repository
(post-fix HEAD `8636123b`): `kiln run --plan --provider claude --model
claude-sonnet-5 "<frozen task>"`.

Terminal result: `completed` (previously `blocked`). The session used `Grep`
and `Read` freely, produced the exact expected JSON answer with correct
`file:line` citations for all four required facts, reported marker
visibility consistent with the deterministic answer key
(`context-directives: true`, `context-guidance: false`, `context-evidence:
true`), and left the working tree clean (`git status` empty after the run).
Cost $0.51, 77.4s. This is re-proof for the Claude arm only; the Codex arm
(the one with no dedicated read-only tool surface, and therefore the more
load-bearing proof of the `commands` allowlist fix) remains unverified live
and should be re-run once Codex quota is available.

Two CLI rough edges surfaced during re-proof, initially deferred
(document-only) per operator decision, then closed the same day once the
operator asked for the full fix:

- `kiln run --plan --output json` was rejected ("--output answer/json is not
  supported with interactive plan mode"). The restriction conflated two
  different things: an interactive stdin approval prompt (real, and
  incompatible with non-human output) that only fires when the model calls
  `submit_plan`, versus a plan-mode turn that never proposes a plan at all
  (this task's shape, and any read-only inspection turn). Fixed by removing
  the blanket pre-flight rejection in `packages/cli/src/commands/run.ts`,
  threading a submitted plan through the JSON envelope as
  `resources.proposedPlan` (`packages/cli/src/application/run-output.ts`)
  instead of printing it to stdout and blocking on stdin, and skipping the
  interactive prompt entirely for non-human output modes -- the caller
  reads the plan from structured output and re-invokes without `--plan` to
  execute it; Kiln never guesses that a missing interactive answer means
  approved or denied. Live-verified: `kiln run --plan --output json
  --provider claude --model claude-sonnet-5 "..."` now completes and
  emits a valid `kiln.run.output.v1` envelope where it previously exited 1
  before dispatch. Covered by `packages/cli/tests/application/run-output.test.ts`.
- `kiln run --provider claude` without `--model` failed with "There's an
  issue with the selected model (gpt-5.6-terra)" -- `resolveCandidateModel`
  fell back to `models.default` even though that default is only a matched
  pair with `resolveGlobalDefaultProvider()`, not a provider-agnostic
  value. Fixed in `packages/cli/src/config/provider-route-candidates.ts`:
  the `models.default` fallback now applies only when the resolved
  provider equals the configured default provider; otherwise the model is
  left unresolved so the native harness (here, Claude Code) applies its
  own default instead of receiving a foreign model id. Covered by two new
  cases in `packages/cli/src/config/provider-route-candidates.test.ts`.

Both fixes shipped in commit `cf555249`, full workspace typecheck and the
`@kilnai/cli` suite green (1829/1831; the one pre-existing unrelated
failure noted above is untouched by this change).
