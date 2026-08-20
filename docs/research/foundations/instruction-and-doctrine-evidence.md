# Instruction and Doctrine Evidence

Evidence cutoff: 2026-08-02.

This foundation preserves the measured basis for how Kiln writes instruction
profiles. Current behavior belongs to the profiles themselves and to
[`agent-context.md`](../../architecture/context/agent-context.md).

It is the reason the doctrine schema separates two concerns — `principles`,
`workflow`, `qualityGates`, and `reviewPosture` govern the work product, while
`delegation` and `executionDiscipline` govern how a session runs.

## Content rules this evidence supports

Recorded so they are not silently reversed:

1. No instruction-file size cap is justified on adherence grounds. Brevity is
   defended as token cost and maintenance burden only.
2. Doctrine states only what tooling cannot enforce. Any rule a hook, lint,
   type, or test can carry belongs there instead.
3. Rare procedures leave always-loaded doctrine for admitted skills. The
   provisional-branch retirement rule moved to the `sequel-branch-retirement`
   skill under this rule.

## Evidence

Measured results are separated from inference throughout. Effect sizes are
reported as published; none were independently reproduced here.

### Instruction files improve efficiency

An A/B study over 10 repositories and 124 pull requests measured a 28.64%
lower median runtime and 16.58% lower output-token consumption when an
`AGENTS.md` was present, with comparable task completion. This is an efficiency
result and not a correctness result.

### File structure shows no detectable adherence effect

A factorial study of 1,650 Claude Code CLI sessions and 16,050 function-level
observations varied file size (25/100/250/500 lines), instruction position
(top through bottom), file architecture (single, paired, and nested
per-directory), and conflicting-instruction presence.

None of the four variables, and none of the three two-way interactions,
produced a detectable contrast after multiple-testing correction. The size and
conflict nulls carry affirmative-null Bayes factors (BF10 between 0.05 and
0.10). The position and architecture nulls are failures to reject without
Bayes-factor support and are correspondingly weaker.

The largest measured effect was within-session: approximately 5.6% lower odds
of instruction compliance per additional generated function, within the session
lengths tested.

This is the finding with the most direct consequence for Kiln doctrine, and it
had no home in the previous five-section schema.

### Configuration smells are near-universal

A catalogue of six smells found that 91% of popular `CLAUDE.md` and `AGENTS.md`
files carry at least one: Lint Leakage (62%), Context Bloat (42%), Skill
Leakage (35%), Conflicting Instructions, Init Fossilization, and Blind
References. The measured harm is wasted tokens and cost.

### Instruction files are widely violated

Synthesizing 46,316 executable checks from instruction files across 723
repositories and running them against their own authoring repositories found
81% with at least one violation. Prose doctrine without an executable
counterpart is aspirational.

### Guardrails are under-specified in practice

Across 2,303 context files from 1,925 repositories, implementation details
appear in 69.9%, architecture in 67.7%, and build/run commands in 62.3%, but
security and performance each in only 14.5%. The existing Sequel principle
requiring boundary validation and fail-closed authority decisions is ahead of
this baseline and was retained unchanged.

### Delegation contracts and coding work

Published orchestrator-worker results report a 90.2% improvement over a
single-agent baseline on an internal research evaluation at roughly 15x token
cost, with the explicit caveat that the pattern is less effective for tightly
interdependent tasks such as coding. Independent practitioner reporting reaches
the same conclusion for coding agents and prescribes sharing full agent traces
rather than isolated messages.

Four elements are named as required in a subagent contract: objective, output
format, tool and source guidance, and task boundaries.

Kiln's governed-evidence handoff already resembles the trace-sharing
prescription more than naive fan-out. The `delegation` section retains a
context-continuity requirement. Subsequent task-structure evidence changed the
work-governance default to `direct`; explicit operator triggers remain in
configuration because posture is operator-controlled policy rather than
doctrine.

### Convergent structure

A survey of 2,853 repositories reports standardization on `AGENTS.md` with
Skills and Subagents under-adopted. A separate case study of a 108,000-line
system across 283 sessions describes a "hot" always-loaded constitution plus
"cold" on-demand specification documents.

Both converge independently on the split Kiln already implements between
instruction profiles and admitted skills. No architectural change is warranted
on this evidence.

## Reconciling the position findings

Long-context research reports lost-in-the-middle degradation, with accuracy
falling by more than 30% for mid-context placement, observed across 18 frontier
models. The factorial study reports no position effect for instruction files.

These are not necessarily in conflict. The most plausible reconciliation is
that configuration files at realistic sizes are small relative to the context
window, so position does not bind, while whole-session context growth does.

That reconciliation is inference, not measurement. It is recorded as such, and
it is the reason session scoping — not file layout — is the lever the doctrine
pulls.

## Limits

- No finding here was independently reproduced against Kiln.
- The efficiency result (28.64% / 16.58%) comes from a single study at modest
  scale and should not be quoted as a Kiln performance claim.
- Published agent-benchmark leaderboards are predominantly self-reported; one
  survey notes 99 of 100 entries lacked independent verification. This
  reinforces the existing quality gate requiring verification before claiming
  completion, and it applies to any future Kiln benchmark claim.

## Sources

- Instruction adherence factorial study — arXiv:2605.10039
- AGENTS.md efficiency study — arXiv:2601.20404
- Configuration smells catalogue — arXiv:2606.15828
- Executable constraints from instruction files — arXiv:2603.00822
- Agent context file survey — arXiv:2511.12884
- Harness engineering survey — arXiv:2602.14690
- Codified context case study — arXiv:2602.20478
- Anthropic, effective context engineering for AI agents
- Anthropic, when to use multi-agent systems
- Cognition, "Don't Build Multi-Agents"

## Open Questions

1. Which measured task structures justify explicit delegation triggers beyond
   the direct baseline without increasing cost or reducing correctness.
2. Whether instruction-profile doctrine sections should eventually carry
   per-rule metadata (evidence reference, enforcement surface). The current
   schema stores flat strings only, which keeps projection simple but leaves
   the evidence trail in this document rather than in the profile.
