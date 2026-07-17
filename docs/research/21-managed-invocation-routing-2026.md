# Managed Invocation Routing Reassessment

Date: 2026-07-16

## Question

Why could a governed Kiln work item request managed delegation and still be
executed locally by the parent, and what routing/model policy is defensible for
real work across GUI, TUI, CLI, and replay?

## Repository Finding

`work_item.execution.start` previously exposed an intermediate
`managedInvocationRequest` and relied on the parent model to call
`managed_agent.invoke`. A parent could ignore that sequencing hint, run local
tools, and later invent a `managedInvocationId`. Route hydration also required a
single compatible route; several capable routes left the request partially
owned. Agent profiles whose explicit route contradicted their provider, model,
or tools were silently projected with route-owned values.

A second operational failure was present in the Codex OAuth credential pool.
Provider `401 token_invalidated` and `token_revoked` outcomes were persisted as
`auth-failed`, but expiry-only status still labeled those credentials valid and
a rebuilt pool could select them again. Model discovery now records the exact
rejected credential, persisted authentication failure makes it non-executable,
status reports it as invalid, and relinking that credential is the only action
that clears the invalid state.

The correction is runtime ownership:

- resolve route, provider, model, authority, tools, context, and child identity
  before adapter invocation;
- filter by phase-required tools and select among multiple routes only when
  configured task suitability produces a unique winner;
- run intermediate children inside the attached runtime boundary and return a
  canonical invocation id plus bounded handoff to the parent;
- reject contradictory agent profiles instead of rewriting them;
- invalidate remotely rejected credentials across discovery, status, and pool
  selection instead of trusting an unexpired local timestamp;
- keep evidence recording and final integration with the parent work item.

## Local Harness Comparison

The local Codex clone resolves role, depth/capacity, model/reasoning, execution
policy, environment, and parent lineage before spawn in
`C:/Proyectos/Sequel/cloned/codex/codex-rs/core/src/tools/handlers/multi_agents/spawn.rs`
and `codex-rs/core/src/agent/control/spawn.rs`.

The local OpenCode clone resolves the target agent, derives child permissions,
creates a child session with `parentID`, resolves the explicit agent model or
inherits the parent model, and then prompts that exact session in
`C:/Proyectos/Sequel/cloned/opencode/packages/opencode/src/tool/task.ts` and
`agent/subagent-permissions.ts`.

Both support the same architectural conclusion: child identity and effective
execution policy belong to the runtime spawn boundary, not to a later model
instruction.

## External Evidence

- OpenAI describes GPT-5.6 Sol as the flagship, Terra as the balanced default,
  and Luna as the faster/lower-cost option. Availability must still be proven
  by Kiln discovery rather than inferred from the announcement:
  https://openai.com/index/gpt-5-6/
- OpenCode Go publishes its current curated model catalog and exposes `/models`
  as the live source of availability. Kiln should ingest that evidence rather
  than freeze a provider ranking in code: https://dev.opencode.ai/docs/go/
- Z.ai's GLM-5.2 release reports strong vendor results on SWE-Bench Pro and
  Terminal-Bench. These results justify a candidate pilot but remain
  vendor-authored evidence: https://huggingface.co/blog/zai-org/glm-52-blog
- Artificial Analysis reports Kimi K3 as a high-capability, high-context model
  in its independent composite evaluation. It does not provide the isolated
  React/TypeScript product fixture Kiln needs for a frontend write-route
  promotion: https://artificialanalysis.ai/models/kimi-k3/
- Agentless shows that localization, repair, and validation can compete with
  heavier orchestration, supporting selective delegation rather than mandatory
  fan-out: https://arxiv.org/abs/2407.01489
- SWE-agent shows that the agent-computer interface materially changes coding
  performance, supporting typed execution boundaries and tool feedback:
  https://arxiv.org/abs/2405.15793
- OmniCode broadens evaluation beyond Python bug repair and cautions against
  treating one benchmark as universal routing proof:
  https://arxiv.org/abs/2602.02262
- Software Delegation Contracts reports improved reviewability and evidence at
  additional token/time cost. Kiln therefore keeps contracts bounded and does
  not treat delegation itself as a correctness guarantee:
  https://arxiv.org/abs/2606.17099
- Anthropic's 2026 agentic-coding analysis emphasizes persistent value from
  human expertise and verification, consistent with parent-owned integration:
  https://www.anthropic.com/research/agentic-coding-and-persistent-returns-to-expertise

Community reports reinforce the failure modes without defining Kiln policy.
OpenCode users have reported child permission inheritance gaps and unbounded
recursive task risk; Codex users have reported ambiguous spawn-policy
precedence and parent/child wait failures. These are reasons to retain explicit
authority inheritance, depth limits, lifecycle identity, and fail-closed route
selection:

- https://github.com/anomalyco/opencode/issues/20549
- https://github.com/anomalyco/opencode/issues/17721
- https://github.com/openai/codex/issues/16996
- https://github.com/openai/codex/issues/16900

## Current Routing Position

The operational baseline is evidence-driven, not a universal leaderboard:

- `codex-oauth/gpt-5.6-terra`: default coding, verification, and bounded
  architecture route while locally eligible;
- `codex-oauth/gpt-5.6-luna`: fast bounded work where its route is eligible;
- `codex-oauth/gpt-5.6-sol`: read-only advisor for high-stakes architecture and
  escalation; it is not the everyday worker;
- `opencode-go/kimi-k3`: read-only frontend visual producer for hierarchy,
  interaction states, and bounded design handoffs; public/community evidence is
  a prior, not proof of write-route reliability;
- `opencode-go/kimi-k2.7-code`: read-only implementation advisor after K3 and
  the current approved-write frontend specialist when a separately admitted
  write task is required;
- `opencode-go/qwen3.7-max`: read-only research and visual-reference route;
- `opencode-go/deepseek-v4-flash`: scout/mechanical candidate;
- `opencode-go/glm-5.2`: preferred OpenCode backend route based on better local
  terminal reliability and latency than DeepSeek V4 Pro;
- `opencode-go/deepseek-v4-pro`: retained backend challenger, not the preferred
  route.

The rejected Codex OAuth credentials remain invalid and non-executable. A new
operator login restored fresh provider discovery and all configured Codex OAuth
managed routes; Kiln did not substitute Codex CLI discovery or an OpenCode
catalog for the previously missing direct-provider authentication evidence.

These assignments live in config `taskSuitability`, agent profiles, and live
provider discovery. Runtime code consumes that evidence and never embeds model
rankings.

## Adopted Coordination Controller

Kiln now selects coordination topology in Core through
`managed-agent-coordination-v1` and executes it through the shared Runtime
managed-invocation lifecycle. The production topologies are direct,
sequential, centralized, and independent review. Each work item resolves its
own admitted agent profile and route. Runtime executes dependency-ready waves,
propagates bounded handoffs and resource URIs, blocks failed dependency chains,
and requires distinct provider/model identities for independent review.
Concurrency remains bounded by the resolved project `parallelWorkers` limit.

This controller replaces the disconnected threshold allocator, chain-energy
governor, parallel task registry, and delegation-efficiency candidate. Learned
conductors and trajectory-aware escalation remain research candidates subject
to benchmark promotion; they are not hidden runtime behavior.

## Benchmark Interpretation

The 2026-07-16 roster experiment used the profile-v2 `kiln-tool-agent` dataset
with five repetitions per item. A later audit found that profile v2 could award
tool-call and trajectory credit after a terminal provider failure. Profile v3
therefore adds the required `execution-integrity` scorer. The v2 artifacts below
remain useful diagnostic route evidence because terminal state was inspected
directly, but they are not current readiness baselines.

| Route | Successful sessions | Total duration | Input / output tokens | Interpretation |
| --- | ---: | ---: | ---: | --- |
| `codex-oauth/gpt-5.6-terra` | 10/10 | 324,260 ms | 458,176 / 8,790 | Reliable balanced default. |
| `codex-oauth/gpt-5.6-sol` | 10/10 | 343,759 ms | 421,764 / 10,014 | Reliable, slightly slower advisor with fewer requests and input tokens. |
| `codex-oauth/gpt-5.6-luna` | 10/10 | 273,466 ms | 470,378 / 7,509 | Fastest valid Codex pilot for bounded work. |
| `opencode-go/glm-5.2` | 9/10 | 312,274 ms | 517,143 / 13,015 | Best OpenCode backend candidate in this pilot, below readiness. |
| `opencode-go/deepseek-v4-pro` | 8/10 | 395,034 ms | 717,767 / 18,442 | Slower, less reliable challenger in this pilot. |
| `opencode-go/kimi-k3` | 0/10 terminally | 134,692 ms at prior k=1 | 79,047 / 2,109 at prior k=1 | k=1 passed, then k=5 hit provider rate limits; no frontend promotion. |
| `opencode-go/kimi-k2.7-code` | 2/2 in smoke | 380,567 ms | 130,122 / 2,249 | Slower smoke; existing frontend route remains provisional. |

Official GPT-5.6 results separately support Sol as the highest-capability Codex
route, Terra as the balanced route, and Luna as the fast route. Those public
benchmarks are external priors, not substitutes for Kiln route evidence.
Likewise, public Kimi K3 and GLM-5.2 results justify evaluation, not an automatic
write-capable promotion. A frontend promotion requires an isolated React/
TypeScript fixture with visual, accessibility, typecheck, test, and diff
evidence under the managed-coding profile. The `kiln-managed-frontend-team`
profile separately measures K3-to-K2.7 handoff composition and independent
frontend review against paired individual-agent baselines; it does not promote
either model to write authority by itself.
