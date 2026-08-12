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

The original 2026-08-03 OpenCode 1.18.11 investigation found a provider-option
namespace mismatch. That finding is not a current blanket CLI limitation.
OpenCode 1.18.16 constructs OpenAI-compatible models with the provider id used
by its variant options, and captured upstream wire evidence shows declared
`high` and `max` variants reaching `reasoning_effort`. Unknown variants are
still silently omitted, however, and provider-specific toggle and budget
protocols do not share that transport.

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

Kiln therefore keeps direct `opencode-go` and `opencode-zen` deliberation
transport at `none`. DeepSeek, GLM, Kimi, Qwen, and MiniMax direct routes use
provider defaults until OpenCode publishes and serves a revisioned capability
contract whose protocol and supported levels work across every eligible
upstream for that route. Kiln does send the official bounded OpenCode request
identity headers, while account leasing and gateway affinity preserve the
supported continuity boundary. Admitting a level that works only on part of a
gateway pool is not support.

This is the terminal disposition of issue #47, not unfinished implementation.
The official Go and Zen documentation checked on 2026-08-12 publishes changing
model rosters, endpoints, and AI SDK protocol packages, but no revisioned
per-model effort contract across eligible upstreams. OpenCode's v2 model
configuration remains beta and explicitly cannot infer actual custom-server
limits. Kiln therefore has no honest capability value to implement for direct
Go/Zen deliberation. A future provider contract can open a new delivery issue;
it does not keep the current roadmap open.

Native OpenCode CLI is a separate, executable-scoped contract delivered by
issue #68. Kiln resolves the exact CLI and version, starts that executable's
loopback model service, and reads the authenticated `/api/model` catalog. Only
enabled exact provider/model entries with canonical variant IDs and matching
reasoning, thinking, toggle, or budget semantics become deliberation
capabilities. Their evidence revision binds the executable version and a safe
digest of those semantics. Core admission occurs before SDK client creation;
exact or clamped levels lower through `session.prompt.variant`, while defaulted
or omitted resolutions send no variant. Missing, mismatched, or changed
evidence fails closed. This does not authorize OpenCode's embedded Task agent
to inherit the parent variant. Managed native OpenCode deliberation remains an
accountless route: it revalidates and executes against the same ambient harness
configuration used for discovery and never substitutes a pooled credential
home after admission. The bound executable version is re-probed immediately
before the child process starts.

On 2026-08-10 the operator upgraded OpenCode CLI and `@opencode-ai/sdk` to
1.18.16. A bounded local discovery probe returned 366 enabled catalog models
and zero eligible deliberation variants for the active account. The discovery
and fail-closed path are proven without a provider call; live variant execution
remains unavailable until the active account exposes an eligible exact model.

OpenCode's official model documentation describes variants as provider-
specific request overlays and points to Models.dev for built-in metadata. Its
Go documentation identifies the OpenAI-compatible endpoint and models, while
the current `/models` response establishes availability without a revisioned
effort guarantee. Those documents do not override the failed executable proof:
https://opencode.ai/docs/models/
https://opencode.ai/docs/go/
https://opencode.ai/docs/zen/
https://opencode.ai/v2/docs
https://opencode.ai/v2/docs/models

Claude Code is a separate native-harness transport. Its authenticated Agent
SDK model catalog reports effort support and ordered effort levels per model,
and the SDK lowers an admitted level through `Options.effort`. Kiln does not
infer those levels from a Claude family name and does not use `thinking` or the
deprecated thinking-token budget as an effort substitute. Capability evidence
is bound to the discovered executable version; models that omit effort support
remain at provider default or fail closed according to the requested policy.
https://platform.claude.com/docs/en/build-with-claude/effort

## Limitations

Provider benchmarks use different harnesses, prompts, tools, sampling, and
reasoning settings. Community reports are useful for candidate selection but
do not authorize a route or level. Kiln must use local repeated profiles before
claiming that one model/effort pair is better for Sequel work.
