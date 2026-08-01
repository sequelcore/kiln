# Hybrid Model Team Reassessment

Date: 2026-08-01

> The candidate topology remains useful research context. Managed write-route
> admission is superseded by `27-write-and-render-route-admission-2026.md`.

## Decision

Kiln should use a heterogeneous team, but it should not promote a universal
"best model" or copy a community roster directly. The defensible unit of
selection is:

`provider + exact model + harness + role + authority + effort + task profile`.

The evidence supports this candidate operating shape:

- Codex OAuth remains the implementation backbone. Use `gpt-5.6-luna` for
  bounded high-volume work, `gpt-5.6-terra` as the currently proven balanced
  integrator, and `gpt-5.6-sol` for the hardest coding and verification work.
- Claude Code supplies independent reasoning and review. Exact
  `claude-opus-5`, `claude-sonnet-5`, and `claude-haiku-4-5-20251001` routes
  are live-proven and remain read-only. `claude-fable-5` is not configured
  because Kiln cannot yet enforce an operator-only exceptional route.
- OpenCode Go remains the specialist and economic challenger pool. Quarantine
  `deepseek-v4-flash` from private work because the current Go data matrix says
  it may be used for training and offers no retention agreement. Evaluate
  `hy3` and `mimo-v2.5` as privacy-safe scout challengers, keep `glm-5.2` as the provisional backend
  worker, `kimi-k2.7-code` as the provisional frontend implementer, `kimi-k3`
  as a read-only visual/knowledge-work candidate, and `qwen3.7-max` as a
  research candidate. None earns broader authority from public benchmarks.
- A direct DeepSeek API pilot is economically justified now. It is pay-as-you-go,
  not a coding subscription. A Kimi subscription can also be worthwhile for
  personal interactive coding, but its subscription terms are not a clean
  basis for unattended Kiln execution; use Kimi's programmatic platform or get
  written confirmation before treating membership credentials as a direct
  managed provider.

This is the evidence-backed candidate roster, not final readiness. Current
Kiln profile-v2 results have a known execution-integrity defect. Configuration
changes therefore require profile-v3 route evaluations or exact live harness
proof. Opus 5, Sonnet 5, and Haiku 4.5 are admitted only under the read-only
plan boundary.

## Question and Scope

This reassessment asks which current Claude Code, Codex OAuth, and OpenCode Go
models should fill Kiln roles, which execution modes are useful, and what
evidence is required before promotion. It covers the catalogs and product
behavior visible on 2026-08-01. It does not treat native CLI permissions as
Kiln runtime authority, and it does not infer access from a lab announcement.

## Evidence Standard

Sources are weighted in this order:

1. live local discovery and replayable Kiln route evidence;
2. official model, harness, pricing, and system-card documentation;
3. independent or transparent benchmark results with identifiable harnesses;
4. peer-reviewed or inspectable papers with stated datasets and limitations;
5. experienced practitioner reports;
6. community anecdotes, used only to generate hypotheses.

A public score is not route proof. Model, harness, prompt, tool interface,
reasoning setting, context policy, sampling, retries, and scorer can all change
the result. Vendor benchmarks are priors. Practitioner and community reports
are qualitative signals. Kiln promotion requires its normal runtime contract
and terminal evidence.

## Live Local Catalog and Admission State

The following was observed by read-only discovery on 2026-08-01. The tools
were Claude Code 2.1.220, Codex CLI 0.146.0, OpenCode 1.18.6, and the local Kiln
3.0.0-beta.1 build. Discovery proves availability to the authenticated local
account at that moment; it does not grant managed authority.

| Surface | Live discovered values relevant to this decision | Kiln admission |
| --- | --- | --- |
| Claude Code | `default`, `claude-sonnet-5`, `sonnet`, `claude-fable-5[1m]`, `claude-fable-5`, `opus`, `claude-opus-5`, `haiku`, `claude-haiku-4-5-20251001` | Exact Opus 5, Sonnet 5, and Haiku 4.5 IDs; read-only plan only. Aliases and Fable closed. |
| Codex | `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini` | Codex OAuth Terra and `codex-auto-review` are read-only managed routes; write evaluation is pending virtual-model benchmark leasing |
| OpenCode Go | `deepseek-v4-flash`, `deepseek-v4-pro`, `glm-5.1`, `glm-5.2`, `gpt-5.6-luna`, `grok-4.5`, `hy3`, `kimi-k2.6`, `kimi-k2.7-code`, `kimi-k3`, `mimo-v2.5`, `mimo-v2.5-pro`, `minimax-m2.7`, `minimax-m3`, `qwen3.6-plus`, `qwen3.7-max`, `qwen3.7-plus` | Selected read-only routes plus GLM 5.2 as the sole approved-write model; discovery alone admits none |

Four states must remain distinct:

- **discovered**: the authenticated provider reported the model;
- **configured**: the operator placed it in routing config;
- **admitted**: an exact managed route and authority contract allow it;
- **proven**: live execution returned the required identity and terminal
  evidence under that contract.

Claude Opus 5, Sonnet 5, and Haiku 4.5 are discovered, configured, admitted,
and live-proven for the read-only plan contract. Their active profiles are
advisor, independent reviewer, and repository scout respectively. Fable 5 is
only discovered and is deliberately unconfigured.

## Claude Code: Models, Modes, and Useful Roles

### Exact models

Anthropic's current model guidance describes:

| Model | Official positioning | Kiln interpretation |
| --- | --- | --- |
| `claude-fable-5` | Highest widely released capability; long-running agents; 1M context; 128k output; $10/$50 per million input/output tokens | Rare, quality-first escalation candidate. Cost, latency, usage-credit rules, and classifier/fallback behavior make it unsuitable as the default worker. |
| `claude-opus-5` | Complex agentic coding, systems engineering, enterprise work, advanced research, vision-heavy work; 1M/128k; $5/$25 | Best next candidate for read-only architecture advice and independent review. Evaluate `high` first, then `xhigh` only where measured. |
| `claude-sonnet-5` | Fast frontier coding, agents, vision, and knowledge work; 1M/128k; $3/$15 after the introductory period | Current Claude workhorse candidate. Keep the proven read-only route; evaluate write authority separately. |
| `claude-haiku-4-5-20251001` | Fastest, high-volume and subagent work; 200k/64k; $1/$5 | Optional scout candidate only if it beats Luna and the privacy-safe OpenCode challengers on local cost, latency, and reliability. It does not fill a current evidence gap by default. |

The dateless IDs introduced with Claude 4.6 are still pinned model IDs. This
must not be confused with Claude Code convenience aliases. `sonnet`, `opus`,
`haiku`, `default`, and `opusplan` can resolve according to account and product
policy, so Kiln should keep exact IDs in executable configuration and record
the primary observed ID.

### Permission and execution modes

Claude Code currently documents `default`, `acceptEdits`, `plan`, `auto`,
`dontAsk`, and `bypassPermissions`. These are native harness behaviors, not
substitutes for Kiln authority.

- `plan` is the correct current Claude boundary: read-only exploration and a
  structured handoff, with zero accepted writes.
- `dontAsk` is the strongest future non-interactive write candidate because
  unapproved tools fail closed. It still requires a Kiln-side exact allowlist,
  write ledger, isolated fixture, and live proof.
- `acceptEdits` is useful for an interactive human reviewing changes, but does
  not by itself provide a deterministic unattended managed boundary.
- `default` may prompt and is therefore unsuitable for an unattended route
  unless prompt handling is an explicit lifecycle state.
- `auto` depends on a native classifier and account eligibility. It is not an
  acceptable hidden authority decision for Kiln.
- `bypassPermissions` removes the relevant safety layer and is excluded from
  host execution. It is only defensible inside an independently isolated,
  disposable environment, and still offers no prompt-injection protection.

Claude Code also documents `opusplan`, which uses the moving `opus` alias in
plan mode and `sonnet` during execution. The composition is a useful product
hypothesis, but its aliases and implicit model switch violate Kiln's exact
identity requirement. Kiln should reproduce the topology explicitly with two
admitted routes if local evaluation supports it.

Anthropic's API advisor tool is stronger evidence for an Opus-advisor plus
Sonnet-executor pattern: Anthropic reports that Sonnet at medium effort with an
Opus advisor can approach default Sonnet intelligence at lower cost. That tool
belongs to the Claude Platform API beta. It does not prove that Kiln's Claude
Code Agent SDK route exposes the same contract.

## Codex OAuth: Models and Effort

OpenAI positions Sol for frontier capability, Terra for balance, and Luna for
cost-sensitive volume. All three expose a roughly 1.05M context window, 128k
maximum output, and efforts `none`, `low`, `medium`, `high`, `xhigh`, and
`max`. OpenAI also exposes Pro mode through the Responses API and `ultra` in
Codex. Kiln must advertise and prove an effort or mode before routing it; it
must not turn a product label into an unsupported parameter.

The public and local evidence point in slightly different directions:

- OpenAI and Artificial Analysis place Sol first for difficult coding.
- Artificial Analysis reports Luna and Sol on its cost/capability frontier and
  Terra externally dominated for that benchmark mix.
- Kiln's profile-v2 diagnostic pilot had 10/10 terminal success for all three,
  with Luna fastest and Terra already serving as the operational integrator.

Therefore no immediate default switch is justified. Luna should challenge
Terra on routine bounded work under profile v3. Sol should be the quality-first
escalation and critical verifier. Terra remains the stable integrator until
local quality, latency, and token evidence show that Luna can replace it for a
specific profile.

## OpenCode Go: Specialist Pool

OpenCode Go is a curated subscription catalog with different retention and
quota properties across models. Its value to Kiln is specialization and
provider diversity, not the assumption that every catalog entry is cheaper or
more reliable than a first-party route.

| Candidate | Evidence | Position now |
| --- | --- | --- |
| `deepseek-v4-flash` | Live catalog, but the Go data matrix permits training and offers no retention agreement | Quarantine from private Sequel work. Do not use the existing scout or write routes. |
| `glm-5.2` | Vendor coding results; 20/20 read-only roster and later 5/5 hidden-test write result | Sole admitted OpenCode backend/service writer. |
| `deepseek-v4-pro` | Vendor claims plus an independent CAISI evaluation that found weaker held-out agent, reasoning, and cyber results than the vendor report | Retain as a challenger, not the preferred backend route. |
| `kimi-k2.7-code` | Strong read-only roster result; later frontend smoke made no change and backend write reached only 4/5 | Read-only frontend/backend challenger; no write route. |
| `kimi-k3` | Strong vendor and Artificial Analysis knowledge-work results; strong public frontend signal; local k=5 run ended 0/10 terminally from rate limits | Read-only visual/knowledge-work candidate only. Public capability does not overcome route reliability failure. |
| `qwen3.7-max` | Live catalog and configured research route; little exact-model independent evidence found | Research challenger. Do not transfer evidence from a differently named Qwen coder model. |
| `minimax-m3` | Removed from general routing after a clean but dominated smoke and no admitted consumer | No active role; visual/multimodal capability remains a separate unevaluated question. |

Kimi K3's public benchmark strength is real enough to test, but the measured
route failure is decisive for current promotion. GLM-5.2's 9/10 and Kimi
K2.7's 2/2 are not readiness results. Exact-model evidence for Qwen3.7 Max is
too weak to assign it a privileged research role without local comparison.

## Direct Kimi and DeepSeek Economics

The direct-provider question has two different answers because the products
use different commercial models.

### DeepSeek direct

DeepSeek's official API is pay-as-you-go. It currently exposes
`deepseek-v4-flash` and `deepseek-v4-pro` through OpenAI- and
Anthropic-compatible endpoints, with thinking/non-thinking modes, tool calls,
JSON output, 1M context, and up to 384k output. Published prices per million
tokens are:

| Model | Cache-hit input | Cache-miss input | Output |
| --- | ---: | ---: | ---: |
| V4 Flash | $0.0028 | $0.14 | $0.28 |
| V4 Pro | $0.003625 | $0.435 | $0.87 |

At those prices, a small funded pilot is justified even if OpenCode Go remains
available. Direct access would give Kiln explicit model/mode selection,
provider-native errors, usage, and quota evidence without an aggregator in the
identity chain. As a purely illustrative calculation, applying Flash's
cache-miss rates to the v2 Terra pilot's reported 458,176 input and 8,790
output tokens would cost about $0.067; Pro would cost about $0.207. This is not
a forecast because models and harnesses can consume different tokens.

Recommendation: fund a tightly capped DeepSeek API evaluation balance rather
than buy a nonexistent coding subscription. Start with V4 Flash for mechanical
and scout work, then V4 Pro only on fixtures where Flash loses materially.
Require a first-class direct-provider adapter, exact identity, mode evidence,
usage accounting, and the same approved-write boundary as every other route.
Do not send sensitive or regulated repository material until the operator
accepts the provider's data-location and retention terms; the published
privacy policy states that collected information is stored on servers in
mainland China and that some network logs may be retained for legal periods.
That publicly linked policy is old, so current terms and any available data
processing agreement must be rechecked at account creation.

### Kimi direct

Kimi has both a personal coding membership and a separate programmatic
platform. Current membership tiers are Moderato $19/month, Allegretto $39,
Allegro $99, and Vivace $199. Moderato unlocks K3 with 256k context. Allegretto
adds the high-speed coding endpoint and K3 up to 1M context. Kimi describes
HighSpeed as the same coding model at roughly 5-6 times the output speed. Plans
have rolling five-hour, weekly, and shared monthly-credit constraints; unused
weekly credits do not carry over.

The subscription is attractive for an operator's interactive work, especially
at $19 to test K3/K2.7 or $39 when speed and 1M context are demonstrated needs.
It is not automatically suitable for Kiln managed jobs. Kimi's own guidance
says the membership is for personal interactive use and prohibits
non-interactive automation; one support page lists only selected supported
tools while the current community guidelines also name OpenCode. That
documentation tension should be resolved with written provider confirmation
before a Kiln direct route uses subscription credentials.

Recommendation:

- do not buy Kimi solely because public benchmarks are strong;
- first run the existing OpenCode Go Kimi routes under profile v3 to measure
  the actual reliability gap;
- if the user also wants interactive Kimi Code, Moderato is the lowest-cost
  valid trial and Allegretto is the first tier that tests HighSpeed and 1M;
- for repeatable unattended Kiln work, prefer the Kimi Open Platform's
  pay-as-you-go contract unless Moonshot confirms that Kiln's invocation model
  is allowed under membership;
- implement `kimi-direct` as its own provider identity if promoted. Do not
  disguise it as Anthropic merely because the endpoint is protocol-compatible.

No purchase is required to decide architecture. The correct sequence is terms
check, capped account, direct adapter, read-only live proof, profile-v3 pilot,
then a bounded write-route decision.

## What Benchmarks and Community Evidence Actually Support

Artificial Analysis' current coding-agent index combines DeepSWE,
Terminal-Bench, and SWE-Atlas-QnA. It reports Sol ahead of the current field,
with Terra and Luna offering strong cost/performance. Its broader index places
Opus 5 and Fable 5 at or near the analytical frontier. These are useful
external priors because the methodology and cost/latency dimensions are
visible, but the harness is not Kiln and Anthropic supported the Opus 5
pre-release evaluation. That relationship must be disclosed rather than
presenting the result as fully independent.

The cross-model code-review study on 116 LiveCodeBench tasks found a material
asymmetry: Claude reviewing Codex improved the reported result from 71.6% to
89.7%, while Codex reviewing Claude reduced it from 91.4% to 82.8%. This makes
Claude-on-Codex review a credible candidate topology, not a universal law. The
reviewer could not execute tests, the task set was narrow, and the evaluated
model versions and harness differ from Kiln.

Anthropic's analysis of roughly 400,000 Claude Code sessions reports more than
twice the success for expert-directed sessions than novice sessions and shows
that people usually decide what to do while the agent decides how. This
supports parent-owned scope, acceptance criteria, and final integration; it
does not rank models.

Experienced practitioner Simon Willison reports Fable 5 as highly capable,
slow, expensive, and unusually proactive, and notes that token price alone is
misleading because reasoning-token use differs sharply. His Kimi K3 tests
confirm strong vision and public frontend standing but also very high reasoning
use for a simple task. These are valuable workload hypotheses, not controlled
benchmarks.

Community workflows repeatedly pair Claude and Codex for cross-review and
report that different models find different bugs. Other reports emphasize
quota exhaustion, behavioral drift, and reviewer disagreement. The durable
lesson is to preserve a ground-truth rubric and sticky regression fixtures,
not to encode a social-media roster. Community evidence does not grant write
authority or settle reviewer direction.

## Recommended Kiln Team Topology

| Work profile | Primary | Independent/advisor | Authority and rule |
| --- | --- | --- | --- |
| Scout, inventory, mechanical diagnosis | Luna today; Hy3 and MiMo V2.5 challengers | None by default | Read-only; require data-policy eligibility, then select by measured quality, latency, and reliability |
| Routine bounded implementation | Terra today; Luna challenger | Claude Sonnet 5 only when review value warrants it | Approved write for implementer; reviewer read-only and cannot repair its own findings |
| Critical implementation or difficult debugging | Sol at measured `high`/`xhigh`; `max` only when it wins evals | Opus 5 candidate | Writer and reviewer must have distinct provider/model identities; tests remain authoritative |
| Architecture and migration planning | Opus 5 candidate or Sol | The other family | Read-only plan; parent owns the decision and records rejected advice |
| Backend/service implementation | Terra or provisional GLM-5.2 | Sonnet 5 now; Opus 5 candidate for high risk | Bounded approved-write route; Spring/DDD/security evidence gates remain independent of model opinion |
| Frontend design and implementation | Kimi K3 read-only design challenger; K2.7 or Codex implementer | Sonnet 5/Opus 5 visual and code review candidate | Visual references, accessibility, tests, typecheck, and rendered evidence required; K3 cannot write today |
| Research synthesis | Qwen3.7 Max challenger or a frontier read-only route | Cross-provider source audit | Read-only browsing; primary sources and claim-level citations required |
| Security-sensitive work | Sol or Opus 5 candidate | Cross-provider adversarial review | Read-only unless a separately approved write task exists; no auto/bypass authority |
| Long-horizon exceptional work | Fable 5 candidate | Sol or Opus 5 verifier | Explicit budget and stop conditions; isolated environment; never an implicit fallback |

The team is sequential or independently reviewed by default. The current
project limit is `parallelWorkers: 1`, so a diagram with many simultaneous
workers would misrepresent executable capacity. Parallelism should increase
only after lifecycle, quota, and evidence behavior are evaluated under actual
contention.

## Promotion Matrix

Before a route changes the default team, record:

- benchmark profile id and version;
- immutable dataset version and fixture hashes;
- exact provider, model, harness/SDK version, route, authority, effort, context
  policy, configuration hash, and repository commit;
- at least five repetitions per item for route reliability, with more where
  variance can change the decision;
- execution-integrity, task correctness, scope compliance, test/typecheck,
  write-ledger, identity, handoff, and privacy scorers;
- terminal provider failures as failures, never partial credit;
- latency, input/output/reasoning tokens, estimated cost, retries, and quota
  failures;
- raw portable artifacts and a reproducible summary;
- paired individual-agent baselines before claiming a multi-model composition
  gain.

The immediate evaluation queue is:

1. Sonnet 5 read-only review of Codex Terra/Luna/Sol patches versus Codex
   self-review and `codex-auto-review` on past Sequel defects.
2. Opus 5 read-only architecture/review at `high`, then `xhigh` only if the
   first comparison shows headroom.
3. Terra versus Luna for routine bounded implementation under profile v3.
4. Sol `high`, `xhigh`, and `max` on the hardest verified fixtures.
5. GLM-5.2 versus Terra on backend/service fixtures.
6. Kimi K2.7 versus Terra/Luna on frontend implementation, with Kimi K3 as a
   separately scored read-only design handoff.
7. Hy3 and MiMo V2.5 versus Luna, and optionally Haiku 4.5, for scouting.
8. Fable 5 only after the normal roster leaves a demonstrated long-horizon gap.
9. Direct DeepSeek Flash/Pro against the corresponding OpenCode Go routes,
   including provider-error, token, cache, latency, privacy, and cost evidence.
10. Direct Kimi only after confirming the intended invocation pattern is
    permitted by the selected commercial plan.

## Configuration Consequences

No model or authority promotion is made by this research document. A later
implementation should:

- keep the explicit Opus advisor, Sonnet reviewer, and Haiku scout roles
  read-only until separate write-authority evidence exists;
- add no Fable route until explicit-route-only selection and runtime-owned
  operator approval are enforceable;
- keep exact IDs and reject moving aliases;
- add `modelTaskSuitability` only from accepted profile-v3 evidence;
- remove or evaluate unused MiniMax M3 configuration rather than preserving a
  role-free candidate;
- resolve the documented selection mismatch: current code breaks equal
  suitability by configuration order even though the research baseline says a
  unique winner is required;
- retain Codex OAuth and OpenCode Go as direct providers under Kiln runtime
  authority, distinct from their standalone native CLI policies.

## Residual Risks

- Catalogs, quotas, subscription entitlements, and model behavior can change;
  live discovery is a time-bounded fact.
- Public benchmarks use different harnesses and may include lab support or
  vendor-authored prompts.
- Profile-v2 local results are diagnostic because the scorer could award
  partial trajectory credit after terminal failure.
- Claude write authority, Fable 5, and several OpenCode candidates lack exact
  Kiln live proof. Fable additionally lacks a safe exception-only selector.
- Stable configuration-order tie-breaking can hide ambiguous suitability.
- Provider diversity improves failure independence only when identities,
  quotas, prompts, and verification are genuinely independent.

## Sources

### Official labs and product documentation

- Anthropic model selection and current specifications:
  https://platform.claude.com/docs/en/about-claude/models/choosing-a-model
- Anthropic model IDs and versioning:
  https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions
- Claude Code model configuration:
  https://code.claude.com/docs/en/model-config
- Claude Code permission modes:
  https://code.claude.com/docs/en/permission-modes
- Claude Agent SDK permission behavior:
  https://code.claude.com/docs/en/agent-sdk/permissions
- Anthropic advisor tool:
  https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool
- OpenAI GPT-5.6 launch and evaluations:
  https://openai.com/index/gpt-5-6/
- OpenAI GPT-5.6 model guidance:
  https://developers.openai.com/api/docs/guides/latest-model
- OpenCode Go catalog, quotas, pricing, and retention:
  https://dev.opencode.ai/docs/go/
- Moonshot Kimi K3 model and report:
  https://github.com/MoonshotAI/Kimi-K3
- Z.ai GLM-5.2 model card:
  https://huggingface.co/zai-org/GLM-5.2
- DeepSeek V4 Pro release:
  https://api-docs.deepseek.com/news/news260424/
- DeepSeek API pricing and limits:
  https://api-docs.deepseek.com/quick_start/pricing/
- DeepSeek API rate limits:
  https://api-docs.deepseek.com/quick_start/rate_limit
- DeepSeek privacy policy:
  https://platform.deepseek.com/downloads/DeepSeek%20Privacy%20Policy.pdf
- Kimi Code plans and pricing:
  https://www.kimi.com/resources/kimi-k2-7-code-pricing
- Kimi Code membership behavior and supported integrations:
  https://www.kimi.com/help/kimi-code/benefits
- Kimi Code usage rules:
  https://www.kimi.com/code/docs/en/kimi-code/community-guidelines.html

### Independent evaluation, papers, and practice

- Artificial Analysis GPT-5.6 evaluation:
  https://artificialanalysis.ai/articles/gpt-5-6-has-landed
- Artificial Analysis Opus 5 evaluation:
  https://artificialanalysis.ai/articles/opus-5
- Artificial Analysis Kimi K3 knowledge-work evaluation:
  https://artificialanalysis.ai/articles/kimi-k3-agentic-knowledge-benchmark
- NIST CAISI DeepSeek V4 Pro evaluation:
  https://www.nist.gov/news-events/news/2026/05/caisi-evaluation-deepseek-v4-pro
- Cross-Model LLM Code Review:
  https://arxiv.org/abs/2607.21656
- Software Delegation Contracts:
  https://arxiv.org/abs/2606.17099
- SWE-agent, on harness effects:
  https://arxiv.org/abs/2405.15793
- OmniCode, on cross-language evaluation:
  https://arxiv.org/abs/2602.02262
- Anthropic Claude Code expertise study:
  https://www.anthropic.com/research/claude-code-expertise
- Anthropic agent autonomy study:
  https://www.anthropic.com/research/measuring-agent-autonomy
- Simon Willison on GPT-5.6:
  https://simonwillison.net/2026/Jul/9/gpt-5-6/
- Simon Willison on Kimi K3:
  https://simonwillison.net/2026/Jul/16/kimi-k3/
- Simon Willison's initial Fable 5 evaluation:
  https://simonwillison.net/2026/Jun/9/claude-fable-5/

Community threads were used only to identify cross-review, quota, drift, and
disagreement hypotheses. They are intentionally not cited as promotion
evidence because their configurations, fixtures, and outcomes are generally
not reproducible.
