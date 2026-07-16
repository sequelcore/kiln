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
- GPT-5.6 Sol: discovered and evaluated, but do not promote it until broader
  task-specific evidence justifies its measured latency tradeoff;
- `opencode-go/kimi-k2.7-code`: frontend implementation candidate with existing
  local `kiln-tool-agent` passing evidence;
- `opencode-go/qwen3.7-max`: read-only research and visual-reference route;
- `opencode-go/deepseek-v4-flash`: scout/mechanical candidate;
- GLM and DeepSeek Pro routes remain configured capabilities, but promotion to
  preferred tool-agent routing requires fresh task-specific benchmark evidence.

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
sequential, centralized, and independent review. Dependency-bearing and
high-risk graphs are serialized; independent graphs may run concurrently only
within the resolved project `parallelWorkers` limit. `managed_agent.orchestrate`
validates and topologically orders the explicit graph, then emits typed terminal
evidence plus a cross-surface timeline presentation intent.

This controller replaces the disconnected threshold allocator, chain-energy
governor, parallel task registry, and delegation-efficiency candidate. Learned
conductors and trajectory-aware escalation remain research candidates subject
to benchmark promotion; they are not hidden runtime behavior.

## Benchmark Interpretation

The 2026-07-16 profile-v2 `kiln-tool-agent` pilots passed at `k=1`:

| Route | pass@1 | Duration | Input tokens | Output tokens |
| --- | ---: | ---: | ---: | ---: |
| `codex-oauth/gpt-5.6-terra` | 1.0 | 22,870 ms | 33,706 | 552 |
| `codex-oauth/gpt-5.6-luna` | 1.0 | 28,041 ms | 49,315 | 587 |
| `codex-oauth/gpt-5.6-sol` | 1.0 | 74,478 ms | not reported | not reported |

Both scored `1` for tool-calling accuracy and trajectory. Terra used fewer
tokens and completed faster in this single sample, supporting it as the current
default but not proving general superiority. Sol passed the same tool behavior
after reauthentication, but took materially longer and did not report comparable
token usage, so it remains evaluated rather than promoted. `k=1` remains below
the release readiness minimum of five runs.

Profile v2 deliberately separates tool-agent success from cache-policy
promotion. The v1 scorer required invalid-reuse and paired cache-gain probes
that the ordinary model runner does not execute, which produced `pass@1=0`
despite correct tool behavior. Cache topology remains an evidence artifact and
cache promotion still requires those probes; they are no longer fabricated or
treated as model capability.

Earlier Kimi samples passed, while GLM and DeepSeek Pro samples were mixed on
search behavior. All samples are route-local evidence, not general model
rankings. Any release recommendation must report profile/version, sample count,
tool surface, provider/model id, date, failures, token use, and latency.
