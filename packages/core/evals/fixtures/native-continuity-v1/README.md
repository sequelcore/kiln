# Native Continuity v1

This fixture evaluates the model-plus-harness effect of Kiln's minimal global
instruction baseline without treating prompt presence as outcome proof.

The fixed task set lives in
`../../benchmark/kiln-native-continuity-v1.jsonl`. The response schema lives in
`../../schemas/native-continuity-response-v1.json`. Expected decisions are
host-side metadata and must not be added to model prompts.

The four cohorts are:

1. `none`: clean native harness home with no projected Kiln guidance or skills;
2. `native-baseline`: the same home plus the current signed global instruction
   projection;
3. `native-baseline-plus-skill`: the same baseline plus one explicitly invoked,
   portability-admitted skill; and
4. `runtime-attached`: the same task through an admitted Kiln Runtime session.

Freeze harness version, model, reasoning setting, response schema, task bytes,
sandbox, tools, network posture, and retry policy. Use at least three repeats per
task. Preserve invalid trials and use no automatic retry in v1. Raw transcripts,
usage, route identity, configuration identity, instruction/skill digests, and
scorer output belong in operator-private benchmark evidence, not this fixture.

The deterministic scorer compares the declared decision and invariant fields.
It does not grade prose style. Promotion requires all four cohorts, no per-trial
regression from `none` to `native-baseline`, no authority or unrelated-change
failure, and no primary-metric inferiority. A partial pilot is diagnostic only.

The explicitly selected skill must declare
`kiln.harnessPortability: agnostic` and
`kiln.disconnectedExecution: supported`. Capability-dependent and
Kiln-Runtime-required skills belong in separate capability fixtures and cannot
stand in for disconnected continuity.
