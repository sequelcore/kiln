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

The OpenCode checkout was fast-forwarded to current `dev` commit
`3016830e2534` and version 1.18.11 on 2026-08-03. It passes `--variant` into
the session and merges the selected variant into provider options. For
`@ai-sdk/openai-compatible`, the transform keys those options by provider id
(`opencode-go`), while the native OpenAI Chat lowering still reads the
`openai` namespace. Preparing the request with the current source proves the
result: `{ opencode-go: { reasoningEffort: "high" } }` omits
`reasoning_effort`, while the same option under `openai` emits it. A live
OpenCode CLI run accepted `--variant high` but reported zero reasoning tokens.

The Go gateway itself parses `reasoningEffort`, `reasoning_effort`, or
`reasoning.effort`, and its OpenAI-compatible path can preserve the wire field.
That is necessary but not sufficient provider/model capability evidence. Live
requests against the current service produced heterogeneous results for the
same advertised model and level: five fixed-session
`deepseek-v4-pro/high` probes returned two HTTP 200 responses with non-zero
reasoning tokens and three HTTP 500 responses. `deepseek-v4-flash`, `glm-5.2`,
and `kimi-k3` also returned HTTP 500 for their catalog-advertised levels.
OpenCode may select upstreams using session affinity, but affinity cannot turn
a partially supported upstream pool into a provider/model guarantee. The
official OpenCode client uses the OpenAI-compatible chat-completions protocol;
Kiln does not treat a client-specific session header as required provider
authority.

Kiln therefore keeps `opencode-go` and `opencode-zen` deliberation transport at
`none`. DeepSeek, GLM, Kimi, Qwen, and MiniMax routes use provider defaults until
OpenCode publishes and serves a direct, revisioned capability contract whose
supported levels work across every eligible upstream for that route. Kiln does
send `x-opencode-client` for attribution, while account leasing and the
gateway's own routing preserve the supported continuity boundary. Silently accepting a CLI variant that
does not reach the protocol, or admitting a level that works only on part of a
gateway pool, is not support.

OpenCode's official model documentation describes variants as provider-
specific request overlays and points to Models.dev for built-in metadata. Its
Go documentation identifies the OpenAI-compatible endpoint and models, while
the current `/models` response establishes availability without a revisioned
effort guarantee. Those documents do not override the failed executable proof:
https://opencode.ai/docs/models/
https://opencode.ai/docs/go/

## Limitations

Provider benchmarks use different harnesses, prompts, tools, sampling, and
reasoning settings. Community reports are useful for candidate selection but
do not authorize a route or level. Kiln must use local repeated profiles before
claiming that one model/effort pair is better for Sequel work.
