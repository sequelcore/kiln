# Provider-Neutral Communication Governance (2026)

Owner: Roadmap 06 / [issue #95](https://github.com/sequelcore/kiln/issues/95)
Historical delivery: [issue #77](https://github.com/sequelcore/kiln/issues/77)
Evidence cutoff: 2026-08-20
Promotion targets: ADR-013, communication-governance architecture, global
configuration guide, and communication evaluations
Exit condition: each admitted prompt fallback or promoted default has a
model/route-specific baseline, candidate, and removal ablation; unsupported
harness projections remain explicit.

## Question

Which response-detail and interaction controls can Kiln represent portably,
which are provider-specific translations, and which require an evaluated
prompt component or an unsupported result?

## Method

The scout compared current official provider documentation with pinned local
source for the native harnesses and the existing Kiln prompt/config ownership
paths. Facts below are limited to documented or source-observed behavior.
Architecture choices are identified separately.

Pinned source:

- Codex clone `32329b289d05eb6a3f8e35c267ceb25ba46716a2`
  (observed 2026-07-24);
- OpenCode clone `3016830e253492ef41b6cc00dbed623e5989279b`
  (observed 2026-08-03);
- the local Claude Code source lacks Git metadata and is not used as
  revision-verifiable capability evidence.

## Findings

### OpenAI and Codex

OpenAI exposes response `text.verbosity` with low, medium, and high values and
recommends task instructions for required length or structure. This supports a
native default-detail translation, not removal of task-required facts. Current
Codex source keeps `model_verbosity` and `personality` as separate config axes.
Codex agent TOML is a complete config projection, so Kiln must write only its
owned agent file and preserve the surrounding operator config.

### Claude Code

Claude output styles alter the system prompt, persist in settings, and take
effect for a new session. A custom style can retain coding instructions only
when configured to do so. Subagents have their own system prompt and do not
automatically inherit the main session's output style. An output style is
therefore not an exact per-turn detail or interaction control. Automatic
replacement of an operator-selected style would violate ownership and
precedence.

### OpenCode

OpenCode agents accept prompts and additional options that are forwarded to
the selected provider. Current source merges model, agent, and variant options
and has provider/model conditions around `textVerbosity`. The same option name
is therefore route-specific evidence, not a universal OpenCode capability.
An owned projected agent file can carry the option; mutating a persistent
agent to serve a single invocation would not be an invocation-scoped control.

## Decision Supported by the Evidence

Kiln keeps response detail, interaction behavior, locale, required content,
artifact contracts, skills, reasoning effort, model, budget, and permissions
as separate axes. It resolves the neutral intent after selecting a route.

Native controls require revisioned provider/model evidence. Prompt fallback
requires a named representative evaluation and final-prompt attribution.
Unknown translations are denied or explicitly omitted. Locale and preservation
obligations use an explicit Runtime-owned prompt component because they are
task-output constraints rather than native detail labels.

No communication default is promoted by this work. The only native catalog
entry added is the existing GPT-5 verbosity mechanism; standalone personality
translation reports semantic loss. Claude output-style mutation and OpenCode
per-turn agent mutation remain unsupported.

## Writing-Quality Evaluation Gap

The v1 evaluation proves deterministic precedence, transport, attribution,
unsupported behavior, and projection lifecycle. It used no authenticated live
model run to establish writing quality, comprehension, latency, or cost and
therefore promoted no default.

An operator instruction profile can provide an immediate, removable preference
across native harness shims. That is valid operator state, not evidence that
Codex, Claude Code, and OpenCode interpret the same prose equivalently. Native
verbosity controls can reduce detail where supported, but they do not by
themselves remove repetitive conclusions, ceremonial framing, excessive
headings, generic praise, routine process narration, or unnecessary next-action
sections.

Issue #95 evaluates these axes separately:

- provider or harness default;
- operator communication profile;
- profile plus native detail control where supported;
- incremental `action-first-communication` and `clear-writing` admission;
- removal ablations for every candidate considered for promotion.

Primary measures are required-content recall, correctness, unsupported claims,
exact-format compliance, and human comprehension/actionability. Output tokens,
time to first useful information, repetition, and formulaic-writing patterns are
secondary. A shorter answer that loses evidence or changes tool behavior is a
regression. The pattern rubric must be revisioned and calibrated; phrase counts
alone cannot establish prose quality.

## Contradictions and Uncertainty

- OpenAI documents API verbosity, while availability still depends on the
  selected model and transport. Kiln therefore gates by the maintained exact
  provider/model catalog rather than the presence of an OpenAI-compatible URL.
- Claude output styles are useful writing mechanisms but do not meet Kiln's
  exact per-turn and child-inheritance semantics.
- OpenCode accepts arbitrary provider options, but acceptance is not proof that
  an upstream model implements the option with stable semantics.
- The current implementation has no admitted prompt-fallback interaction
  profile. A future candidate must supply an evaluation id before execution.
- The same instruction profile may produce materially different writing across
  model and harness revisions. Aggregate improvement cannot hide a material
  route-specific regression.

## Sources

- <https://developers.openai.com/api/docs/guides/latest-model>
- <https://code.claude.com/docs/en/output-styles>
- <https://code.claude.com/docs/en/sub-agents>
- <https://opencode.ai/docs/agents/>
- <https://opencode.ai/docs/models/>
- [Issue #95 evaluation contract](https://github.com/sequelcore/kiln/issues/95)
