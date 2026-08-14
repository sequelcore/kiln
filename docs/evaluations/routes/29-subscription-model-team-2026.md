# Subscription Model Team Reassessment

Date: 2026-08-14
Evidence cutoff: 2026-08-14

## Decision

Kiln uses the authenticated Codex OAuth, OpenCode Go, and Claude Code
subscriptions as a deliberately asymmetric team. Model reputation selects
candidates; only route-specific evidence grants write promotion.

| Function | Selected route | Authority |
| --- | --- | --- |
| Default integration and planning | GPT-5.6 Terra | Read-only managed planning |
| High-stakes architecture | GPT-5.6 Sol with Claude Opus 5 `[1m]` challenge | Independent read-only advisors |
| Defect and regression review | Codex Auto Review with Claude Sonnet 5 | Read-only |
| Backend implementation | OpenCode Go GLM 5.3 | Apply-approved writes; human approval and review remain mandatory |
| Frontend implementation | No promoted writer | Kimi K3 and GLM 5.3 remain read-only challengers for this surface |
| Fast bounded scouting | GPT-5.6 Luna or DeepSeek V4 Flash | Read-only |
| Source-grounded research | Qwen3.7 Max | Read-only; network limited to the research route |

Native Codex is authenticated and exposes the same current GPT-5.6 family, but
the roster uses Codex OAuth direct routes so execution receives canonical
account leasing, credential fencing, and settlement. Duplicating the same model
through the standalone Codex harness would add a second route without an
independent team role.

## Benchmark repair

The former write gate was not trustworthy. It mixed semantic failure with
provider/route failure, admitted a requested provider/model while executing the
default route, used one sample per case, allowed diagnostic scorers to influence
admission, and contained hidden contract details not stated to the candidate.
One interrupted process could also leave operator-session capacity held because
the canonical factory claimed a new generation without invoking its existing
recovery operation.

Protocol v2 replaces the old path outright:

- eight behaviorally distinct cases per surface;
- five valid trials per case for promotion;
- separate pass^1, pass^5, Wilson 95% intervals, and invalid-trial rate;
- infrastructure failures retained but excluded from semantic failures;
- retries only for cases lacking valid coverage;
- correctness, diff, and execution as admission; tools, latency, and cost as
  diagnostics;
- explicit execution-route identity and the same lease/fence/settlement path as
  an operator run;
- fixed out-of-process Node tests for backend and a networkless, read-only,
  digest-pinned Playwright/axe container for frontend;
- explicit public task contracts for every hidden assertion.

The v1 datasets and fixtures were deleted. Results created before the final v2
contract hashes are harness diagnostics, not comparable model evidence.

## Direct results

Backend screening used eight valid trials per candidate:

| Route | pass^1 | Invalid | Verdict |
| --- | ---: | ---: | --- |
| GLM 5.3 | 7/8 before the final `rate-window` clarification | 0 | Shortlisted; the sole failure was contract-ambiguous and excluded from promotion evidence |
| Kimi K3 | 7/8 | 0 | Challenger; one valid trial exhausted output before writing |
| DeepSeek V4 Pro | 5/8 | 0 | Did not meet the 0.80 screening threshold |

GLM 5.3 then ran the final backend v2 contract at k=5: 40 valid trials,
4 route-unavailable invalid trials, pass^1 0.875 (Wilson 95% 0.739-0.945),
pass^5 0.75 (Wilson 95% 0.409-0.929), and invalid rate 0.0909. It meets every
promotion threshold. Six cases passed 5/5. `optimistic-revision` passed 3/5 and
`rate-window` passed 2/5, so concurrency and rate-control work require
particular reviewer attention; the promotion is not autonomous authority.

GLM 5.3 frontend ran 40 valid trials with no invalid trials and pass^1 0.925
(Wilson 95% 0.801-0.974), but pass^5 was 0.625 (Wilson 95% 0.306-0.863), below
the 0.75 gate. Disclosure, menu-button, and pagination each passed 4/5. No
frontend writer is promoted.

The local evidence artifacts are stored under
`.kiln/evaluations/model-team-v2/`. They are operator-local evidence and are
not committed as public benchmark claims.

## Current authenticated catalog and live checks

Discovery observed exact current models from all requested surfaces. Selected
direct routes are Codex OAuth `gpt-5.6-terra`, `gpt-5.6-sol`, `gpt-5.6-luna`,
and `codex-auto-review`; OpenCode Go `glm-5.3`, `kimi-k3`,
`deepseek-v4-flash`, and `qwen3.7-max`. Native Codex also observed Sol, Terra,
Luna, GPT-5.5, GPT-5.4, and GPT-5.4 Mini.

Claude discovery observed Fable 5, Opus 5 `[1m]`, Sonnet 5, and Haiku 4.5.
A live subscription probe found Fable 5 requires separate usage credits, so it
was not selected. Exact Opus 5 `[1m]` and Sonnet 5 probes succeeded. Claude's
native settings also contained obsolete permission rules and the parent process
injected an invalid `ANTHROPIC_AUTH_TOKEN`; the rules were corrected and native
Claude sessions now discard ambient Anthropic API credentials before applying
explicit per-session credentials. This preserves subscription identity without
preventing intentionally configured API-backed sessions.

## Research interpretation

OpenAI's official GPT-5.6 results position Sol as the strongest coding tier,
Terra as the balanced tier, and Luna as the fast/economic tier. That supports
their advisor/default/scout roles, not inferred write authority. Anthropic's
current releases support Sonnet for practical agentic coding and Opus/Fable for
frontier reasoning; the local subscription check selects the strongest exact
models actually executable without extra credits. The Kimi K3 paper and current
independent model comparisons justify retaining Kimi as a challenger. GLM's
official material supports long-horizon coding, while its own scaling report
also documents rare abnormal outputs; the local repeated route evidence is
therefore decisive for write scope.

Community and public benchmark results were used to nominate candidates, not
to grade local authority. Different prompts, harnesses, tool schemas, context,
effort, and provider endpoints prevent direct equivalence claims.

## Applied configuration

- GLM 5.2, Kimi K2.7 Code, DeepSeek V4 Pro, MiniMax M3, the unavailable Fable
  route, and redundant managed routes were removed from the active roster.
- One GLM 5.3 backend apply-approved route replaces the two duplicate GLM 5.2
  write routes.
- No managed frontend write route exists.
- Sol, Auto Review, Opus 5 `[1m]`, Sonnet 5, Terra, Luna, DeepSeek Flash, Kimi
  K3, and Qwen3.7 Max have explicit read-only roles.
- Project capacity remains depth 3 and three parallel workers. Provider account
  capacity still governs actual concurrency; OpenCode Go currently admits one.

## Sources

- [OpenAI GPT-5.6 launch and pricing](https://openai.com/index/gpt-5-6/)
- [Anthropic Claude Sonnet 5](https://www.anthropic.com/news/claude-sonnet-5)
- [Anthropic Fable 5 and Mythos 5](https://www.anthropic.com/news/claude-fable-5-mythos-5)
- [Anthropic Claude Code subscriptions](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan)
- [OpenCode Go catalog](https://dev.opencode.ai/go)
- [GLM 5.2 release](https://z.ai/blog/glm-5.2)
- [GLM scaling incident analysis](https://z.ai/blog/scaling-pain)
- [Kimi K3 technical report](https://arxiv.org/abs/2607.24653)
- [Artificial Analysis model index](https://artificialanalysis.ai/models)
- [Anthropic guidance on agent evaluations](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
