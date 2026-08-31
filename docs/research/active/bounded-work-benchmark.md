# Bounded-Work Authority Benchmark

Status: incomplete
Owner: [issue #19](https://github.com/sequelcore/kiln/issues/19)
Evidence cutoff: 2026-08-20
Promotion target: [`benchmark-validation.md`](../../architecture/quality/benchmark-validation.md)
Exit condition: the paired control-versus-bounded-authority experiment below is
run to its reporting gate, or the experiment is abandoned and this note deleted.

## Question

Does bounding an agent's authority change scope fidelity and overengineering,
and by how much?

The contract itself is settled and canonical in
[`bounded-work-authority.md`](../../architecture/core/bounded-work-authority.md).
What remains unmeasured is whether it helps. No default, efficiency, or quality
claim is accepted until the design below has been run.

## Implementation status

The contract has shipped: immutable content-digested revisions, SQLite CAS
reservation and accounting, Git, artifact, and external-state candidate capture,
candidate-bound evidence and acceptance, managed write-scope narrowing, and
operator projection. Deterministic tests cover replay, route-independent
cumulative accounting, real two-process final-slot contention, candidate
capture, stale-revision denial, unavailable-metric fail-closed behavior, and
candidate-bound closeout.

That is implementation evidence. It is not a benchmark result.

## Design

The benchmark must use the existing [benchmark validation
contract](../../architecture/quality/benchmark-validation.md) and a paired
design.

This benchmark composes with the adaptive coordination investigation in
[`adaptive-work-governance.md`](adaptive-work-governance.md) and
[issue #94](https://github.com/sequelcore/kiln/issues/94). Issue #94 decides
which execution topology is justified; issue #19 decides whether the admitted
scope and resource envelope changes scope fidelity and semantic
overengineering. Neither result may be inferred from the other.

### Paired design

Compare a control arm with the bounded-work-authority arm while freezing:

- task definitions, repository/project snapshot, target and acceptance tests;
- provider/model, reasoning setting, route policy, harness and adapter commits;
- access level, tool catalog, context/memory inputs, and configuration
  hash;
- contract revision, scope envelope, ceiling policy, tripwire policy, scorer
  versions, and operator intervention protocol.

Randomize item and arm order where practical. Use repeated runs and the existing
pass^k reporting gate; report the full distribution and failed/omitted cases,
not only the best run or a single median.

### Measurements

Quality and safety are primary. Record, per task and arm:

- behavioral correctness and target verification;
- semantic in-scope/out-of-scope effects and non-goals touched;
- review findings, escaped defects, residual risk, and required intervention;
- input/output/cache token classes, with each unavailable class recorded as
  `unknown`;
- wall-clock duration, tool calls, attempts, child count/concurrency/depth,
  review and correction rounds;
- gross, accepted, discarded, and superseded candidate churn;
- stop/continuation reason, settlement state, and all omitted or failed runs.

Overengineering is a semantic review question against the declared scope and
acceptance contract. LOC, changed-file count, and diff size are structural
observations or tripwires, not the outcome. Deterministic structural scorers
are primary. Expert adjudication or a calibrated secondary LLM judge may score
semantic overengineering only with disclosed rubric, agreement, and limits; a
hidden judge cannot be the primary authority.

The semantic rubric must distinguish at least:

- behavior, surfaces, effects, dependencies, or abstractions without an
  acceptance-traceable need;
- unrelated refactoring and compatibility paths without a real consumer;
- duplicate implementation paths or tests that merely mirror the candidate;
- additional agents, reviews, retries, or remediation rounds that produce no
  new required evidence;
- continued mutation after all required acceptance evidence exists.

Task size and overengineering remain separate. A large migration can be the
smallest complete change, while a small speculative abstraction can be
overengineered.

### Reporting and unsupported inference

The report must bind each result to exact candidate bytes, target identity,
revision digest, evidence artifacts, and configuration. Provider subscription
cost, unknown token classes, synthetic fixtures, and unverified self-reports are
not comparable efficiency evidence. A result may say that a bounded contract
changed observed behavior under this fixture; it may not generalize to model
quality, provider economics, or native-harness parity without a separately
admitted design and evidence.

## This note does not claim

- that bounded-work authority improves cost, speed, token use, quality, or
  safety;
- that any external product's published reductions transfer to Kiln;
- that Codex, OpenCode, Claude, direct providers, native adapters, or Kiln
  surfaces have feature or authority parity;
- that route availability proves usage visibility, that approval proves
  sandboxing, that candidate completion proves acceptance, or that an unknown
  value is zero;
- that fixed LOC, file, or line thresholds detect overengineering.

## Residual risks

Provider usage normalization, authoritative tool-call and active-duration
metering, descendant managed delegation, capability evidence drift, and a
calibrated semantic overengineering rubric all remain open. Hard limits for
unavailable meters pause rather than guessing, nested delegation pauses rather
than resetting, and semantic judgments remain advisory until benchmarked.
