# ADR-011: Provider-Neutral Deliberation Policy

## Status

Accepted

## Context

Kiln currently projects a closed `reasoningPolicy` effort enum across model
routing and operator surfaces. That representation conflates a portable
operator objective with provider-native controls. OpenAI exposes reasoning
effort, Anthropic effort also affects response and tool behavior, Gemini uses
model-dependent thinking levels or budgets, and DeepSeek may collapse several
requested values into one native mode.

The existing execution paths also lack one authority boundary. A router may
resolve an effort that Runtime later replaces with the raw request, managed
invocation accepts an arbitrary effort string, and economic commitment does not
identify the effective deliberation decision. Unsupported requests can
therefore be omitted, rejected, or forwarded depending on the entrypoint.

Research on adaptive test-time compute finds that the useful allocation depends
on task difficulty and budget. It supports bounded adaptive selection, not one
fixed effort for every task or an unbounded model-controlled escalation.

## Decision

Kiln owns one provider-neutral deliberation contract in Core. It separates:

- `DeliberationIntent`: operator-authorized mode, target, preferred native
  level, bounds, and unsupported behavior.
- `ModelDeliberationCapabilities`: ordered native levels, provider default,
  support semantics, and revisioned discovery evidence.
- `DeliberationResolution`: requested intent, selected native level, authority
  source, capability revision, exact resolution status, and reason.
- observed inference work: provider-reported reasoning/output tokens, latency,
  cost, tool calls, and cache effects when those observations exist.

The canonical global key is `deliberationPolicy`. The old `reasoningPolicy`
schema is removed rather than retained as an alias. Configuration can express a
project default, task policy, and exact route override. Resolution precedence is
explicit operator, work item, agent profile, route, task, project, then provider
default. Higher-authority input replaces lower-authority input; the orchestrator
may select only inside the resulting policy and economic envelope.

Provider and harness adapters translate only an admitted
`DeliberationResolution`, never a raw requested level. A provider-native level
is a validated, capability-gated identifier rather than a closed universal
enum. Known names such as `low`, `high`, or `max` are not treated as equivalent
across providers merely because their spelling matches.

Resolution uses the following observable statuses:

- `exact`: the selected native level is advertised and satisfies the intent.
- `clamped`: an explicitly admitted clamp selected a different advertised
  level.
- `defaulted`: Kiln sends no native override and records the provider default.
- `omitted`: policy permits execution without a deliberation override.
- `denied`: the route cannot preserve the authorized policy.

No mapping or downgrade is silent. Managed economic commitment binds the
resolution identity or a conservative deliberation envelope before provider
dispatch. A model may propose escalation, but cannot exceed operator bounds,
route capability, or economic authority.

Reasoning effort, provider mode, verbosity, service tier, model selection,
output budget, and tool budget remain separate axes. Provider cache/session
stickiness is capability evidence and may prevent a mid-session change.

## Consequences

Core becomes the only deliberation vocabulary and resolver. CLI owns durable
configuration and precedence. Runtime owns authoritative per-invocation
resolution and observations. Provider adapters own native translation. Gateway
and operator surfaces project the shared evidence without inventing defaults.

The replacement is intentionally breaking. Kiln has no external consumers, so
code, fixtures, examples, and project config replace the old surface in one
change. Durable operator config is migrated explicitly only after the new
binary validates the replacement; no dual reader remains.

## Verification

- Resolver tests cover precedence, bounds, exact, clamp, default, omission,
  denial, unknown/stale capability evidence, and deterministic selection.
- Every admitted adapter has contract tests from resolution to native request.
- Managed and non-managed paths prove that raw requests cannot bypass
  resolution or economic commitment.
- Gateway, GUI, TUI, and CLI preserve provider default until an operator makes
  an explicit selection and render the resulting status.
- Config validation rejects the removed `reasoningPolicy` key.
- Residual searches find no legacy config reader, arbitrary managed effort, or
  provider-specific experimental gate in neutral Core.

## Evidence

- OpenAI reasoning controls: <https://developers.openai.com/api/docs/guides/latest-model>
- Anthropic effort: <https://platform.claude.com/docs/en/build-with-claude/effort>
- Gemini thinking: <https://ai.google.dev/gemini-api/docs/thinking>
- DeepSeek thinking mode: <https://api-docs.deepseek.com/guides/thinking_mode>
- Adaptive test-time compute survey: <https://arxiv.org/abs/2507.02076>
- Optimal test-time compute: <https://arxiv.org/abs/2408.03314>
- RouteLLM: <https://arxiv.org/abs/2406.18665>
- Delivery issue: <https://github.com/sequelcore/kiln/issues/46>
