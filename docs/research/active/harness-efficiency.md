# Harness Cache And End-To-End Efficiency

Status: incomplete

Evidence cutoff: 2026-08-25.

Owners:

- [Roadmap 06 - Prompt Governance Plane](../../roadmap/06-prompt-governance-plane.md)
  for prompt composition, cache topology, provider projection, and progressive
  disclosure;
- [Roadmap 06.5 - End-To-End Harness Efficiency](../../roadmap/06.5-end-to-end-harness-efficiency.md)
  for latency attribution, benchmark comparability, and optimization promotion.

Promotion targets: canonical provider-request cache architecture, the Runtime
benchmark/evaluation surface, and operator-facing performance diagnostics.

Exit condition: provider-specific cache topology is live-validated, the
end-to-end benchmark reports attributable cold and warm results without quality
or authority regression, reusable results move to `docs/evaluations/`, and the
remaining stable contracts are promoted to architecture before this note is
deleted.

## Decision Question

How should Kiln reduce repeated provider input, time to first token, total task
latency, and cost without weakening task outcome, safety, authority, privacy,
or replay evidence?

The decision separates two related but non-equivalent outcomes:

1. **Prompt-cache efficiency** asks whether an admitted provider can reuse the
   intended stable request prefix without unsafe cross-partition reuse.
2. **End-to-end efficiency** asks how long and how much work a complete task
   takes, including provider queueing and prefill, output generation, transport,
   tool execution, retries, compaction, and the number of model turns.

A cache hit may improve input cost and time to first token while total task
latency regresses because the agent emits more tokens, invokes slower tools, or
needs more turns. Neither metric is a proxy for correctness or task success.

## Definitions And Measurement Boundary

Kiln must keep three caches distinct:

- **Provider prompt/KV cache** reuses an exact provider-recognized prefix of
  tools, system instructions, and conversation history. It is route-specific
  and may have minimum token, TTL, affinity, and retention constraints.
- **Tool-result cache** reuses a deterministic tool result under Kiln-owned
  key, policy, and TTL semantics. It avoids tool work but does not imply a
  provider prompt-cache hit.
- **Local artifact cache** reuses discovery, projection, or prepared context.
  It can reduce local startup or assembly work without reducing provider
  prefill.

The benchmark therefore reports at least:

- cache read, write, and uncached input tokens in absolute terms and as ratios;
- time to first token and total provider-call latency;
- tool queue and execution latency by tool identity;
- model calls, agent turns, retries, compactions, output tokens, and total task
  wall time;
- provider charges or a versioned price estimate when exact charges are not
  observable;
- task outcome, correctness, required-content preservation, authority, safety,
  and tool-trajectory scores;
- cold, warm, and long-session conditions, with p50, p95, sample count, failures,
  and the exact provider, model, route, harness revision, config, and manifest
  identity.

Bundle size, installed size, process startup, and code maintainability are
separate properties. They may be measured, but no one of them establishes
cache efficiency, total latency, task performance, or "clean code."

## Method And Limits

This is decision-oriented research, not a systematic review or a harness
ranking. It combines current first-party provider documentation, revision-pinned
Pi source, direct Kiln repository traces, a workload preprint, and adverse or
contradictory practitioner benchmarks. Community results are discovery and
boundary evidence; they are not promotion evidence for Kiln.

The search stopped after provider cache ordering, retention, minimum-size and
latency guidance were covered; Pi's relevant implementation was pinned; Kiln's
current request and telemetry paths were traced; and adverse evidence showed
that cache-hit rate, token footprint, cost, task success, and latency can rank
harnesses differently.

No inspected source provides a controlled, same-version, same-model,
same-tool-surface comparison of current Kiln, Pi, Claude Code, Codex, OpenCode,
and Gemini CLI. The social claim that Pi has the highest cache-hit rate, lowest
latency, highest performance, smallest bundle, and cleanest code did not include
a reproducible dataset or method. Kiln has not yet produced the live paired
provider evidence required below.

## Current Kiln Evidence

### Existing strengths

Kiln already owns several prerequisites that must be retained:

- `packages/core/src/context/effective-prompt-manifest.ts` records ordered
  `static`, `dynamic`, and `deferred` components, exact final-prompt identity,
  estimated tokens, and content-free replay evidence.
- `packages/runtime/src/session/runtime-session-orchestrator-telemetry.ts`
  records logical request regions, hashes, stable-prefix evidence, cache
  partitions, and provider-reported cache reads and writes.
- Anthropic and OpenAI-family adapters parse provider cache usage where the
  upstream response exposes it.
- `packages/core/src/eval/benchmark-scorers.ts` and
  `experiment-comparator.ts` already define invalid-reuse and cache-gain gates
  that do not permit cache gains to hide outcome, authority, or tool-trajectory
  regressions.
- `packages/core/src/agents/tool-cache.ts` and Runtime's
  `tool_cache_hit` event provide a distinct tool-result cache and observable
  hit evidence.
- `scripts/profile-startup.ts` provides a local startup profiling surface, but
  it is not a provider-call or cross-harness latency benchmark.

These contracts make optimization attributable. They do not themselves create
a provider cache hit or prove an end-to-end improvement.

### Cache-topology gaps

The current provider request does not preserve the manifest's static/dynamic
distinction end to end:

- CLI inserts `__KILN_PROMPT_DYNAMIC_BOUNDARY__` between sections in
  `packages/cli/src/wrapper/preamble-builder.ts`, but no provider adapter
  consumes that text as a real cache breakpoint. Task and governed context
  remain inside the system prompt.
- Runtime appends an exact per-turn `Observed at (UTC)` value as a dynamic
  system component in
  `packages/runtime/src/session/support/context/runtime-turn-system-prompt.ts`.
  Changing it prevents reuse of the system and following message prefix on
  providers whose cache hierarchy includes the system before messages.
- Anthropic projects the entire system as one cacheable block and marks the
  final tool and a prior user block as ephemeral. It has no Kiln-owned
  `none`/short/long retention decision or current one-hour projection.
- Codex OAuth and the OpenAI-compatible adapter read cached-token usage but do
  not project a Kiln-owned affinity key, retention choice, or stable-prefix
  breakpoint.
- Runtime cache telemetry currently labels the entire serialized system region
  `stable` even when the effective manifest contains dynamic components. The
  changing hash can reveal a miss, but the classification overstates the
  reusable prefix.
- Searches for `cacheInvalidReuseProbes` and `cacheGainComparisons` find
  benchmark contracts and synthetic tests, not a committed live provider
  evaluation proving gain and partition safety.

Decision consequence: Roadmap 06 must turn component scope into a real
provider-specific cache topology. A literal marker or post-hoc hash is not a
cache boundary.

### Latency gaps

Kiln does not yet have one task-level timeline that attributes total wall time
across request preparation, provider queue/prefill/generation, tools, retries,
compaction, and inter-turn orchestration. Startup profiling and provider token
usage cover useful portions, but they cannot answer which component dominates
a real task or whether a cache change improved the complete outcome.

Decision consequence: Roadmap 06.5 owns the benchmark and attribution plane.
It consumes Roadmap 06 cache evidence but does not own prompt composition or
provider cache semantics.

## External Evidence

### Provider guidance converges on stable prefixes, with different contracts

OpenAI documents automatic prefix caching, cached-token reporting, stable
prefix placement, cache affinity and retention controls, and recommends placing
static reusable content before dynamic content. Its latency guidance separates
input reduction from output-token reduction, request parallelism, and avoiding
unnecessary model calls. This supports provider-specific projection and a
multi-component latency model; it does not establish that caching alone
minimizes total task latency.

Anthropic documents the cache hierarchy as tools, then system, then messages;
up to four explicit breakpoints; a default five-minute lifetime; and an
optional one-hour lifetime with different economics. Tool or system changes can
invalidate downstream reuse. This makes Kiln's per-turn timestamp inside the
system a material topology problem on that route.

Google documents both implicit and explicit Gemini caching, model-specific
minimum cacheable input sizes, and placement of common prefix content first.
The minimum means that a very small prompt may remain cheap while recording no
cache hit, so hit rate cannot be interpreted without absolute token counts.

Longer retention is also a data-governance decision. OpenAI's data-control
documentation describes extended prompt caching as application state with
Zero Data Retention implications. Kiln therefore cannot silently maximize TTL
across every route.

Decision consequence: Core may own a provider-neutral desired retention and
partition contract, but each adapter owns honest capability projection. An
unsupported breakpoint, TTL, or affinity control is reported as unsupported,
not approximated with prompt text.

### Pi is a useful implementation reference, not universal benchmark proof

Revision `8fa7eebd235355522c8104166b4f1f959b4e2f10` of Pi defaults to a small
tool surface (`read`, `bash`, `edit`, and `write`) and a comparatively compact
system prompt. Its OpenAI Responses adapter projects a session-derived
`prompt_cache_key`, optional long retention, and explicit cache disablement.
Its Anthropic adapter supports no, short, and long retention, projects a
one-hour TTL when supported, and places cache controls on the system, tool, and
conversation prefix.

That source supports three transferable mechanisms: minimize unnecessary
stable material, preserve a stable session prefix, and translate cache policy
through provider capabilities. Pi can still grow through context files,
skills, extensions, and tool changes, and its architecture does not prove
lowest total latency or best task outcome for every workload.

### Measured workloads contradict a single harness leaderboard

TraceLab reports roughly 4,300 day-to-day Claude Code and Codex sessions with
about 350,000 model steps and 430,000 tool calls. The trace shows long contexts,
short outputs, heavy-tailed tool calls, and high but imperfect prefix-cache hit
rates. This supports measuring tool latency and multi-turn behavior alongside
provider prefill rather than treating cache as the whole harness.

A single cold Bedrock/Haiku 4.5 practitioner probe reported Pi below the
provider's 4,096-token cache minimum, so it recorded zero cache use while
remaining much smaller and cheaper on the first trivial request. Under the
author's modeled repeated-prefix condition, OpenCode became cheaper per turn
than Pi. The one request, model, gateway, and synthetic task prevent broader
inference, but the result demonstrates why cache-hit percentage alone is
misleading.

A Composio comparison over 30 tool tasks reported Pi with 21 successes versus
19 for OpenCode and lower spend, while Pi's median task time was 362.9 seconds
versus 280.6 seconds for OpenCode and 181.8 seconds for Claude Code. Its vendor
workload, tool environment, and model selection limit generalization, but the
result directly contradicts the assumption that low prompt overhead implies
lowest end-to-end latency.

Requesty's April 2026 observational report placed Claude Code around 92% and
OpenCode at 89% cache-hit rate but omitted Pi and did not expose enough sampling
and workload detail for a universal ranking. It is a community signal that
stable prefixes matter, not a promotion-quality harness comparison.

Decision consequence: Kiln must report a vector of outcome, latency, cache,
work, and cost metrics. It will not collapse them into one "performance" score
or claim a cross-harness winner from non-comparable studies.

## Evidence-Backed Decisions

1. Keep prompt-cache implementation in Roadmap 06 because component order,
   dynamic boundaries, tool-schema disclosure, and provider prompt projection
   are one ownership path.
2. Keep end-to-end latency in Roadmap 06.5 because provider cache is only one
   contributor; the track must also attribute generation, tools, transport,
   retries, compaction, turns, and startup.
3. Use one shared fixture identity and result schema so the two tracks can be
   analyzed together without sharing promotion criteria.
4. Compare baseline and candidate on the same task set, provider, model,
   tools, route, machine class, harness revision, and repetition policy.
5. Require cold, warm, and long-session trials. Report absolute uncached input
   as well as hit ratio, because minimum cache sizes and prompt volume can
   reverse the apparent result.
6. Reject any cache or latency change that materially regresses outcome,
   required content, safety, authority, privacy, or tool trajectory.
7. Partition reusable state by tenant, route, model, policy, and effective
   authority. Invalid-reuse probes must fail before cost or latency gains are
   considered.
8. Treat retention as route configuration with privacy evidence, not doctrine
   and not a universal longest-TTL default.
9. Benchmark Kiln against itself first. Cross-harness comparisons are optional
   release evidence only after tool surfaces and workloads are comparable and
   every harness revision and limitation is recorded.
10. Measure bundle/install size and startup separately. Do not use either as a
    proxy for cache, total task latency, code quality, or product value.

## Highest-Value Missing Evidence

The next useful artifact is a replayable paired baseline over representative
Kiln tasks with:

- at least one admitted OpenAI-family route and one Anthropic route;
- cold, immediate warm, post-short-TTL, and long-session conditions;
- exact serialized request-region order and provider cache controls;
- cache read/write/uncached tokens, TTFT, provider completion latency, tool
  latency, turns, retries, compactions, total wall time, and total cost;
- task-outcome, safety, authority, required-content, and tool-trajectory gates;
- deliberate tenant, authority, policy, route, model, and tool-schema changes
  proving invalid reuse does not occur;
- enough repetitions to report p50, p95, failures, and uncertainty without
  presenting one local run as population evidence.

Only after this baseline should Kiln compare a stable/dynamic provider
projection candidate, progressive tool disclosure, or another harness.

## Sources

### Labs And Provider Documentation

- OpenAI, [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).
- OpenAI, [Latency optimization](https://developers.openai.com/api/docs/guides/latency-optimization).
- OpenAI, [Data controls by endpoint](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint).
- Anthropic, [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).
- Google, [Gemini context caching](https://ai.google.dev/gemini-api/docs/caching?hl=en).

### Revision-Pinned Harness Source

- Pi `8fa7eebd235355522c8104166b4f1f959b4e2f10`:
  [`system-prompt.ts`](https://github.com/earendil-works/pi/blob/8fa7eebd235355522c8104166b4f1f959b4e2f10/packages/coding-agent/src/core/system-prompt.ts),
  [`openai-responses.ts`](https://github.com/earendil-works/pi/blob/8fa7eebd235355522c8104166b4f1f959b4e2f10/packages/ai/src/api/openai-responses.ts), and
  [`anthropic-messages.ts`](https://github.com/earendil-works/pi/blob/8fa7eebd235355522c8104166b4f1f959b4e2f10/packages/ai/src/api/anthropic-messages.ts).

### Workload And Community Evidence

- Qiu et al., [TraceLab: Coding Agents in the Wild](https://arxiv.org/abs/2606.30560), preprint, 2026.
- C. Daniele, [Coding Harness Comparison](https://c-daniele.github.io/en/posts/2026-05-18-coding-harness-comparison/), single cold-request practitioner probe, 2026.
- Composio, [Pi vs OpenCode](https://composio.dev/content/pi-vs-opencode), vendor-run 30-task comparison, 2026.
- Requesty, [Coding Agent Cache Hit Rate, April 2026](https://www.requesty.ai/data/coding-agent-cache-hit-rate-apr-2026), observational provider report with incomplete public methodology.

## Non-Goals

- Do not promote a universal harness leaderboard.
- Do not make cache-hit ratio, prompt size, token count, bundle size, or one
  synthetic task a proxy for task performance.
- Do not place provider/model/TTL decisions in instruction doctrine.
- Do not retain raw prompts, cache material, secrets, or operator-specific
  incident payloads as benchmark authority.
- Do not choose Rust, WASM, N-API, a sidecar, or another implementation
  language before attribution identifies a hot path and Roadmap 09 admits the
  boundary.
