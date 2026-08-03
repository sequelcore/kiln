# Cross-Provider Deliberation Policy

Status: adopted on 2026-08-03.

## Decision

Kiln uses the provider default for unclassified work, fixed `high` effort for
architecture, implementation, frontend design, tests, and research, and fixed
`low` effort for mechanical edits. Maximum effort is not a global default; it
requires an explicit operator request or a provider/model whose own default is
maximum. Unsupported task levels are omitted rather than guessed.

The operator's Codex OAuth `gpt-5.6-luna` route is the one route-wide
exception: it is pinned to `max` and fails closed if that level disappears.
OpenAI positions Luna for cost-sensitive high-volume work, and the current
independent comparison publishes a distinct Luna-max result. This is an
economics-backed operator choice, not a claim that Luna-max beats every route
on Sequel work:
https://developers.openai.com/api/docs/models/gpt-5.6-luna
https://artificialanalysis.ai/models/gpt-5-6-luna

Exact-route policy remains exceptional because it takes precedence over task
policy. A permanent route override would otherwise force the same compute onto
both difficult and trivial work.

## Evidence

- Test-time compute can improve difficult reasoning, but the compute-optimal
  strategy varies with model and problem difficulty. Snell et al. report more
  than a fourfold efficiency gain over best-of-N from difficulty-aware
  allocation, not from one universal budget:
  https://arxiv.org/abs/2408.03314
- Adaptive selection can improve both efficiency and quality. AdaptThink
  reports 53% shorter average responses and 2.4% higher accuracy on its math
  evaluation:
  https://arxiv.org/abs/2505.13417
- OpenAI documents `max` for demanding GPT-5.6 work that needs additional
  exploration and verification, not as the routine setting:
  https://developers.openai.com/api/docs/guides/latest-model
- Aider's reproducible coding leaderboard uses `high` for its GPT-5 coding
  result. This supports `high` for difficult coding, but does not establish a
  cross-model optimum:
  https://aider.chat/docs/leaderboards/
- Qwen reports smooth gains as reasoning budget increases, while DeepSeek and
  Z.AI publish model-specific thinking controls. These are capability evidence,
  not proof that maximum compute is cost-optimal for every task:
  https://qwenlm.github.io/blog/qwen3/
  https://api-docs.deepseek.com/guides/thinking_mode
  https://docs.z.ai/guides/capabilities/thinking-mode
- Kimi K3 publishes `low`, `high`, and `max`, defaults to `max`, and reports its
  headline harness comparisons at maximum effort. Those publisher results are
  not directly comparable with Kiln's local profiles:
  https://github.com/MoonshotAI/Kimi-K3

## Executable Boundary

Codex OAuth advertises ordered levels and defaults through its authenticated
model catalog. OpenCode Go and Zen `/models` responses prove availability but
do not include effort metadata. `models.dev` names variants, but that alone is
not executable evidence for Kiln's direct provider.

The inspected OpenCode 1.18.6 checkout at `a85d8d23aa29` passes `--variant`
into the session and merges
the selected variant into provider options. For `@ai-sdk/openai-compatible`,
the transform keys those options by provider id (`opencode-go`), while the
OpenAI Chat lowering reads the `openai` namespace. A live
`opencode run --variant high` completed but reported zero reasoning tokens;
the equivalent direct gateway request with `reasoning_effort: high` repeatedly
returned HTTP 500, while the same request without the override succeeded.

Kiln therefore keeps `opencode-go` and `opencode-zen` deliberation transport at
`none`. DeepSeek, GLM, Kimi, Qwen, and MiniMax routes use provider defaults until
OpenCode publishes and serves a direct wire contract that passes a live proof.
Silently accepting a CLI variant that does not reach the protocol is not
support.

OpenCode's official model documentation describes variants as provider-
specific request overlays and points to Models.dev for built-in metadata. Its
Zen documentation exposes `/models` for model metadata, but neither document
overrides the failed executable proof:
https://opencode.ai/docs/models/
https://opencode.ai/docs/zen/

## Limitations

Provider benchmarks use different harnesses, prompts, tools, sampling, and
reasoning settings. Community reports are useful for candidate selection but
do not authorize a route or level. Kiln must use local repeated profiles before
claiming that one model/effort pair is better for Sequel work.
