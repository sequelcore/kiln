# Concise Communication Default 2026

Date: 2026-08-20
Scope: global Sequel operator communication
Evaluation type: operator-reported deficiency plus deterministic resolution and
projection evidence; no cross-model prose-quality claim

## Baseline

The global `operator-communication` profile requested concise output, but the
resolved global communication intent had no `responseDetail`. The profile also
repeated its frontmatter rules in a long body, increasing prompt cost without
adding distinct behavior. The operator reported that responses remained too
large.

## Decision

Keep communication separate from engineering doctrine because presentation and
work-product correctness have independent sources of change. Set the durable
operator choice as `communication.responseDetail: concise` in global config and
reduce the profile body to nonduplicative precedence guidance. The engineering
profile references the boundary but does not copy communication rules.
Unsupported native detail translation uses `omit`, so a presentation preference
cannot make an otherwise valid harness route unavailable.

Existing communication-governance contracts preserve required findings,
warnings, failures, verification, and residual risks at concise detail. Native
harness projection remains capability-bound. Claude Code 2.1.237 adds a
built-in `Concise` output style, so Kiln now projects the canonical global intent
to user-scoped `outputStyle` and to SDK inline settings. OpenCode and unsupported
Claude detail values remain omitted rather than receiving an invented universal
mapping. The concise global instruction profile remains the provider-neutral
behavioral projection where no native control is admitted.

The Claude projection preserves unrelated settings, records ownership of only
`outputStyle`, blocks unmanaged conflict or managed drift, and reports canonical
intent changes as stale. Output style is loaded after `/clear` or a new session
and does not govern Claude subagents.

## Follow-up measure

The next live comparison should replay representative short answers, reviews,
and implementation handoffs across admitted Codex, Claude Code, and OpenCode
routes. Compare baseline and concise candidate for useful information retained,
time to first useful result, unnecessary words, omitted obligations, and token
cost. Do not claim prose-quality improvement from deterministic projection tests
alone.
