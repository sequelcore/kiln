# Communication Governance v1 Evaluation Record

Date: 2026-08-13
Owner: Roadmap 06 / issue 77
Candidate identity: `communication-governance-v1`
Base revision: `253d67b967f247b9cfef221781a446b327fae02a`
Candidate diff identity: `sha256:f133c06b562387432cc5e2b62eddab23984e4e9d954373013bae71e2ff0e2a21`
Promotion decision: no default promoted

The candidate digest covers the tracked and untracked issue-77 implementation
relative to the base revision. It excludes this self-referential evaluation
record and the operator-owned unrelated `docs/operations/model-gateway.md`
change.

Reproduce the candidate identity from the repository root with:

```text
bun scripts/candidate-diff-hash.ts --base 253d67b967f247b9cfef221781a446b327fae02a --exclude docs/evaluations/communication-governance-v1.md --exclude docs/operations/model-gateway.md
```

## Scope

This record distinguishes deterministic contract verification from live model
quality evaluation. It does not turn unit tests or snapshots into behavioral
claims.

| Route or harness | Baseline | Candidate | Removal ablation | Result |
|---|---|---|---|---|
| `codex-oauth/gpt-5*` native detail | provider default, no communication component | explicit `text.verbosity` plus content-free resolution evidence | omit explicit detail and retain all task obligations | transport/attribution contract verified; no new default promoted |
| standalone Codex GPT-5 | native config default | invocation-scoped `model_verbosity`; optional translated personality | remove both overrides | argument projection and semantic-loss evidence verified; no new default promoted |
| standalone Claude Code | operator-selected output style | none | unchanged operator state | unsupported non-default intent denies before SDK I/O |
| standalone OpenCode invocation | configured agent/provider defaults | none | unchanged operator state | unsupported non-default intent denies before SDK I/O |
| owned OpenCode GPT-5 agent file | existing agent without provider option | route-specific `textVerbosity` | omit owned field | owned-file projection, drift, backup, and rollback contracts verified |
| Runtime locale/required content | no communication component | identified `runtime-communication-contract` | remove the component | exact manifest/request attribution verified; quality promotion not claimed |

## Executed comparison evidence

These are executed deterministic transport comparisons, not live-model quality
scores. Each row names the exact assertion surface that exercised baseline,
candidate, and removal in one reproducible fixture.

| Run id | Route/harness | Baseline observation | Candidate observation | Removal observation | Executed evidence |
|---|---|---|---|---|---|
| `cg-core-20260813` | Core provider-neutral | provider default resolves with no prompt component | locale/content/contract/skills report exact effective value and mechanism | removing each optional axis returns `not-requested/none` | `communication-policy.test.ts`; Core suite 3,912/3,912 passed |
| `cg-codex-20260813` | Codex `gpt-5.4` fixture | no `model_verbosity`, personality, or communication component | `model_verbosity="high"`, canonical `pragmatic@v1`, and attributed locale/content component | default-intent tests omit all three controls | Codex wrapper 59/59 passed |
| `cg-claude-20260813` | Claude Code fixture | preset system prompt is unchanged by communication policy | locale/content contract is appended and observed; unsupported native axes deny | absent communication intent produces no component | affected CLI wrapper suite passed |
| `cg-opencode-20260813` | OpenCode invocation fixture | no variant or communication component | locale/content is present in the exact final prompt observation | unsupported detail is denied before SDK transport; default tests omit it | OpenCode wrapper 62/62 passed |
| `cg-opencode-file-20260813` | owned OpenCode GPT-5 agent | owned file without `textVerbosity` | route-bound `textVerbosity` plus persisted resolution | removing the intent removes the owned field while lifecycle evidence remains | native projection 23/23 passed |
| `cg-runtime-20260813` | Runtime primary/fallback/tool retry | final request has no communication component under provider default | final actual request carries resolution identity and content-free component evidence | removing the component changes the manifest hash and component count | Runtime suite 3,238/3,238 passed, 5 skipped |

The harness availability smoke observed Codex CLI `0.147.0`, Claude Code
`2.1.229`, and OpenCode `1.18.16`; each executable returned its fresh command
help successfully. No authenticated live-model run was used to claim writing
quality, latency, or cost improvement.

## Scenario Coverage

The automated contract suite covers:

1. concise detail cannot remove required warning, failure, verification, or
   residual-risk obligations from the resolved contract;
2. a higher-authority user or artifact requirement wins deterministically;
3. findings-first remains an observable interaction behavior, separate from
   detail;
4. unsupported model/harness translation is denied before provider I/O under
   `deny`;
5. managed children resolve their own profile and invocation override;
6. final-request evidence selects the actual retry/fallback request and stores
   no raw prompt;
7. simple and complex commit/PR renderers accept only evidence-bound claims.

Exact JSON formatting, factual completeness, human comprehension,
time-to-first-useful-information, latency, cost, and model-specific regressions
remain live-model measures. No prompt-fallback interaction profile or global
detail default is admitted, so there is no candidate requiring promotion in
this delivery. Future candidates must add replayable baseline, candidate, and
component-removal runs keyed by model, route, manifest hash, and config
identity before changing defaults.

## Evidence Commands

The repository verification record for this delivery includes focused Core,
Runtime, Gateway, CLI, GUI, TUI, and SDK tests; the full affected suites;
workspace typecheck/build; native executable version smokes; and
`git diff --check`. Command results belong to the candidate revision and must
not be reused after the diff changes.

Executed against the candidate above:

- `bun run --cwd packages/core test` â€” 312 files / 3,912 tests passed;
- `bun run --cwd packages/gateway-contracts test` â€” 34 / 351 passed;
- `bun run --cwd packages/runtime test` â€” 244 files / 3,238 passed, 5 skipped,
  plus Bun SQLite durability/fencing/recovery gates;
- `bun run --cwd packages/sdk test` â€” 6 / 43 passed;
- affected CLI selection â€” 8 files and 321 relevant tests passed; the one
  unrelated pre-existing flat-registry skill convergence assertion remained
  red in the combined config-status file, while the communication-status test
  passed independently;
- `bun run --cwd packages/tui test` â€” 8 / 66 passed;
- `bun run --cwd packages/native test` â€” 4 / 49 passed;
- `bun run --cwd packages/widget test` â€” 4 / 67 passed;
- `bun run --cwd packages/gui test` â€” 59 / 520 passed;
- `bun run typecheck`, `bun run build`, and `bun run docs:check` â€” passed.
