# Token Pressure Diagnosis And Repair Plan

Status: Slices 1-5 complete; bounded live pilot recorded
Updated: 2026-07-02
Roadmap owner: `docs/roadmap/04-verified-efficiency-control-plane.md`, Slice 0

## Objective

Make Kiln's tool-agent execution proportional to task complexity without
weakening authority, tool correctness, evidence, or provider neutrality. The
immediate target is to explain and reduce the 419,972-940,391 cumulative input
tokens observed in the authorized two-item `kiln-tool-agent` pilot before any
`k >= 5` route comparison.

## Non-Goals

- Do not hide provider-reported usage or redefine cumulative tokens downward.
- Do not optimize one provider through a benchmark-only prompt or tool path.
- Do not rank models from the current `k=1` samples.
- Do not weaken read-only authority or expose tools the active authority cannot
  execute.
- Do not add a second context, tool-catalog, routing, or usage owner.
- Do not start Roadmap 04 learning or adaptive-routing slices early.

## Diagnosis

### 1. The pressure is primarily real cumulative provider input

`RuntimeSessionOrchestrator` sends the complete conversation history and the
effective tool definitions on every tool round. Runtime telemetry adds each
provider response's usage into session totals. The benchmark projects those
totals without suppressing them.

The post-repair pilot recorded:

| Route | Read item | Search item | Total input | Tool calls |
| --- | ---: | ---: | ---: | ---: |
| Codex GPT-5.5 | 152,192 | 272,534 | 424,726 | 9 |
| Kimi K2.7 Code | 168,408 | 251,564 | 419,972 | 28 |
| GLM 5.2 | 670,823 | 269,568 | 940,391 | 27 |
| DeepSeek V4 Pro | 244,812 | 614,981 | 859,793 | 32 |

The artifact does not retain per-round usage, so exact round-level attribution
is not currently reproducible. There is no evidence that the item totals are a
simple double-counting defect.

### 2. Read-only benchmark authority does not constrain the advertised tools

The benchmark sets `{ approval: "never", sandbox: "read-only" }`, but does not
set `requestedAuthority: "read_only"` on the session. The direct-provider
session therefore takes the `auto` branch and does not create a read-only tool
allowlist. Runtime execution still denies forbidden effects, but the model sees
schemas for tools it cannot use.

The default built-in surface contains 47 tools and serializes to 79,290 bytes
before benchmark-specific config, governance, or managed-agent tools are
added. The existing deferred projection contains eight discovery/read tools
and serializes to 12,500 bytes, an 84% schema-byte reduction. This is diagnostic
evidence, not yet a promotion decision.

### 3. Every tool round resends stable and growing request regions

Each provider request receives:

- the provider system prompt and Kiln executable guidance;
- all effective tool schemas;
- the complete conversation history;
- prior tool calls and raw tool results.

The tool surface is stable but is not currently evidenced as a cache-aligned
prefix. Tool outputs and history grow each round. `read_many` permits up to
60,000 bytes in the observed GPT-5.5 search trajectory, while other routes
repeated `read` and `resource_read` calls. These costs compound rather than
remaining one-time inputs.

### 4. The execution envelope is too broad for this task class

The benchmark grants up to 32 tool rounds to two bounded read-only questions.
Observed routes used 3-27 tool calls per item. The envelope prevents an
unbounded loop, but it does not express a task-class budget, diminishing-return
gate, or evidence-completeness stop condition.

### 5. The current quality failure is partly a benchmark-contract defect

`tool-read-file` declares one expected `read` call and no allowed extra tools.
The scorer treats every additional `read`, `grep`, or `resource_read` as a
precision error and requires every scorer to equal 1.0 for the item to pass.
GPT-5.5 returned the requested authority profiles correctly but scored 0.5 for
the trajectory `read, grep, read`.

Tool efficiency should be measured, but exact single-call conformance is not a
valid proxy for answer correctness when bounded supporting reads are allowed.
Outcome correctness, required-tool recall, prohibited effects, redundant
calls, and token efficiency need separate evidence.

### 6. Benchmark reproducibility evidence is incomplete

The config hash currently covers profile, dataset, provider, model, and scorer
names. It does not cover the effective system prompt, authority profile, tool
catalog/schema snapshot, execution envelope, instruction/context projection,
or runtime policy that materially determine token use.

Evidence URIs are created in an in-memory artifact store. The JSON records the
URIs and aggregate consistency results, but a later process cannot resolve the
referenced transcript, usage, route, cost, or diagnostics content. Per-round
usage and request-region attribution are also absent. Current artifacts are
diagnostic, not independently replayable or public-ready.

## Architectural Decisions

1. Provider-reported per-call usage remains authoritative; Kiln records both
   per-call deltas and cumulative session totals.
2. Advertised tools must be the intersection of canonical capability,
   effective authority, task admission, and provider support.
3. Execution denial is not a substitute for request-time tool projection.
4. Stable prompt/tool regions receive identities and hashes before cache or
   prefix optimization claims are made.
5. Raw tool evidence remains canonical outside model context; model-facing
   history may use typed lossless or explicit reversible projections only.
6. Tool efficiency and task correctness are separate benchmark dimensions.
7. Benchmark artifacts must survive the producing process and resolve from the
   emitted report.

## Slice 1 - Reproducible Per-Round Evidence

Owner: core benchmark contracts plus runtime telemetry projection.

Status: Complete.

- Record one row per provider request with provider/model, round, input,
  output, cache read/write, tool-schema identity, stable-prefix identity,
  conversation bytes, tool-result bytes, and stop reason.
- Persist benchmark artifacts in a durable local artifact store and prove every
  emitted URI resolves in a fresh process.
- Hash the effective authority profile, system prompt, instruction/context
  projection, tool catalog schemas, execution envelope, scorer configuration,
  and provider/model route.
- Keep aggregate totals as a reconciliation over per-round evidence.

Gate: failing tests first; artifact fresh-process resolution; per-round totals
reconcile exactly; core/runtime/CLI suites; typecheck; review.

## Slice 2 - Authority-Aligned Tool Projection

Owner: CLI benchmark session construction and existing core tool projection.

Status: Complete.

- Project the benchmark profile's canonical
  `foundation-readonly-plan` authority into `requestedAuthority: "read_only"`.
- Derive the effective tool surface from admitted authority instead of sending
  tools that execution policy will later deny.
- Reuse the canonical deferred tool-catalog mechanism; do not create a
  benchmark-only allowlist.
- Prove equivalent projection in normal CLI/runtime execution for the same
  authority and task evidence.

Gate: forbidden tools are absent from provider requests; required read/search
tools remain available; authority remains fail-closed; no provider-specific
branch; measured schema and token deltas are recorded.

## Slice 3 - Tool-Use Quality And Budget Contract

Owner: core eval dataset/scorers and runtime execution envelope policy.

Status: Complete.

- Split answer correctness, expected-tool recall, prohibited-tool use,
  redundant-call rate, and token/round efficiency into explicit scores.
- Permit bounded supporting reads where the fixture semantics allow them.
- Add task-class tool-round and tool-output budgets with explicit finalization
  behavior; do not hard-code one model's observed trajectory.
- Detect repeated equivalent reads and evidence-complete continuation before
  another provider round is admitted.

Gate: fixtures distinguish a correct supported answer from wasteful repetition;
prohibited effects still fail the item; the same scorer semantics apply across
providers.

## Slice 4 - Stable Prefix And Progressive Tool Loading

Owner: Roadmap 04 Slices 2 and 3 through existing context/tool owners.

Status: Complete.

- Make stable system, instruction, and tool-catalog regions byte-identical and
  cache-evidenced where the provider supports it.
- Start with the minimal authority/task-admitted tools plus catalog discovery;
  retrieve additional schemas only through governed selection.
- Keep `ContextGovernor` authoritative for model-facing context admission.
- Measure uncached input, cached input, latency, task success, and replay
  fidelity independently.

Gate: non-inferior task success; no authority or capability loss; provider
limitations remain explicit; cache and progressive-loading gains reconcile to
per-round evidence.

## Slice 5 - Bounded Live Validation

Owner: existing benchmark runner and operator routing example.

Status: Complete.

- Run local deterministic and fixture tests before any credentialed probe.
- With explicit operator authorization, run one sequential `k=1` pilot on the
  same four routes.
- Compare request regions, calls, tokens, cache evidence, latency, correctness,
  and redundant-call rate against the 2026-07-02 artifacts.
- Run `k >= 5` only when artifacts resolve, quality meets the profile gate, and
  the economics requested for comparison are comparable.

Gate: benchmark readiness passes for the bounded claim being made; no route or
personal config promotion from a single sample.

Pilot result, authorized on 2026-07-02:

| Route | passAtK | Input tokens | Previous input | Delta | Requests | Tool schema bytes/request |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Codex GPT-5.5 | 1.0 | 37,354 | 424,726 | -91.2% | 9 | 4,895 |
| Kimi K2.7 Code | 1.0 | 76,496 | 419,972 | -81.8% | 17 | 4,895 |
| GLM 5.2 | 0.5 | 19,023 | 940,391 | -98.0% | 5 | 4,895 |
| DeepSeek V4 Pro | 0.5 | 71,366 | 859,793 | -91.7% | 15 | 4,895 |

The pilot confirms the token-pressure repair: all four routes now send the
authority-admitted deferred tool surface instead of the broad built-in tool
surface. Only Codex GPT-5.5 and Kimi K2.7 Code met the two-item quality gate in
this `k=1` pilot. GLM 5.2 failed readiness on latency for the search item, and
DeepSeek V4 Pro failed the tool-trajectory score for the search item. These
samples are sufficient evidence for the bounded repair claim, not for global
model ranking or personal configuration promotion.

Viable-route `k=5` comparison, authorized on 2026-07-02:

| Route | passAtK | Input tokens | Output tokens | Requests | Duration |
| --- | ---: | ---: | ---: | ---: | ---: |
| Codex GPT-5.5 | 1.0 | 192,637 | 6,702 | 48 | 374,166 ms |
| Kimi K2.7 Code | 1.0 | 388,909 | 12,851 | 67 | 470,523 ms |

Both routes qualify as internal baselines for the `kiln-tool-agent` profile.
For this profile and workstation, Codex GPT-5.5 remains the primary route
because it matched Kimi's quality while using materially less input, output,
request, and latency budget. Kimi remains an eligible fallback/specialist route.
This is an internal routing decision, not a public model leaderboard claim.

## Verification And Commit Sequence

1. `feat(benchmark): persist per-round execution evidence`
2. `fix(authority): project admitted tools into provider requests`
3. `fix(eval): separate tool correctness from call efficiency`
4. `feat(efficiency): align stable prefixes and progressive tools`
5. Documentation/status commit after the bounded pilot.

Each production slice begins with intentional failing tests, changes one
authority owner, runs focused and package verification, receives review, and
commits only related files. Rollback reverts the slice commit; no compatibility
shim, shadow path, or legacy tool projection remains.

## Residual Risks

- Tokenization and cache semantics differ by provider, so byte measurements
  cannot be presented as provider-equivalent token counts.
- A smaller tool surface may reduce discovery quality unless deferred catalog
  retrieval is reliable and visible to the model.
- Tool-loop limits can truncate legitimate research or coding work if applied
  without task-class and evidence-completeness signals.
- Subscription routes remain economically non-comparable without metered or
  quota-value evidence even after token attribution improves.
