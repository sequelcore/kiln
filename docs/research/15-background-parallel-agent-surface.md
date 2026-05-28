# Background and Parallel Agent Surface

Date: 2026-05-20

## Finding

Background or parallel agents are not just "longer timeouts." The common
pattern across current agent systems is a separate child lifecycle with an
explicit identity, isolated context, bounded authority, observable status, and a
parent handoff contract.

## External Evidence

- Claude Code documents foreground subagents as blocking and background
  subagents as concurrent. Background children inherit already-granted
  permissions and auto-deny tool calls that would prompt.
  Source: <https://code.claude.com/docs/en/sub-agents>
- Claude Agent SDK frames subagents as separate instances for context
  isolation, parallelization, specialized instructions, and tool restrictions.
  Source: <https://code.claude.com/docs/en/agent-sdk/subagents>
- OpenCode separates primary agents from subagents. Primary agents own the main
  conversation, while subagents create child sessions that the operator can
  navigate from the parent session.
  Source: <https://dev.opencode.ai/docs/agents/>
- Codex positions parallel agent work around built-in worktrees and cloud
  environments, so concurrent edits are isolated instead of multiplexed through
  one mutable workspace.
  Source: <https://openai.com/codex/>
- Recent Claude Code systems research identifies permission policy,
  compaction, extensibility, subagent delegation, worktree isolation, and
  append-oriented session storage as the surrounding machinery that makes the
  agent loop reliable.
  Source: <https://arxiv.org/abs/2604.14228>

## Local Repository Evidence

- `C:\Proyectos\Sequel\claude-code` contains background-task and worktree
  state, including subagent-created team cleanup, background intervals, and
  project-root stability around worktrees.
- `C:\Proyectos\Sequel\opencode` documents primary agents and subagents, with
  child-session navigation as the operator model.
- `C:\Proyectos\Sequel\hermes-agent\AGENTS.md` documents `delegate_tool.py`
  for isolated subagents, batch parallel execution, `terminal(background=True)`
  notifications, a cron hard interrupt, and a Kanban multi-agent work queue.
- `C:\Proyectos\Sequel\t1code` is structured around a desktop multi-agent
  surface and worktree-oriented parallel coding workflows.

## Kiln Implication

Kiln's current `managed_agent.invoke` direct-provider path is a foreground
child call: the parent tool call blocks until completion, failure, cancellation,
or timeout. That is correct for a governed phase gate, but it is not a full
background-agent primitive.

The long-term background/parallel design should add a nonblocking managed
invocation lifecycle:

- `managed_agent.start` records the admitted request and returns an invocation
  id immediately.
- `managed_agent.status` returns lifecycle, heartbeat, transcript, diagnostics,
  and partial handoff evidence.
- `managed_agent.cancel` records operator or parent cancellation.
- `managed_agent.join` blocks only when the parent explicitly needs the child
  result.
- Runtime finalization records the terminal session event independently of
  `join`, so a background child that finishes naturally remains replayable even
  when the parent never observes it again in the same turn.
- Write-capable children must run in an isolated workspace or approved write
  scope; parallel write children should prefer worktree isolation.

Until that exists, timeouts remain terminal child outcomes. For intermediate
work-governance phases, timeout recovery must be explicit: the runtime returns
`managedInvocationRecovery`, and the parent may recover only by recording real
phase evidence through `work_item.update`.

2026-05-20 live-test follow-up: a completed foreground child still needs an
explicit same-work-item handoff. Returning only "managed invocation completed"
is not enough because the parent may not know which artifact to inspect or
which governed tool should record the phase. Successful intermediate children
therefore need the same lifecycle shape as failures: status, child identity,
readable result resources, next governed tool, update template, and follow-up
phase start.

2026-05-20 live-test follow-up 2: the parent can still misuse a correct
handoff by printing the `work_item.update` payload as assistant text instead of
calling the tool. That is not a UI rendering problem; it is an unresolved
governed phase. Kiln must fail the turn until the update is materialized and
must strip leaked update payloads at the assistant egress boundary so internal
contracts do not become user-facing chat content.

2026-05-20 live-test follow-up 3: a foreground managed-agent timeout must
cancel the child provider call, not only return a timeout record to the parent.
OpenCode, Claude Code, Zed, Codex, and Hermes all model long-running or
parallel work as owned child lifecycles with explicit status/cancel/join-style
semantics, not as hidden work left running behind a completed parent turn. In
Kiln, `managed_agent.invoke` remains a blocking phase gate; background and
parallel agents require a separate nonblocking lifecycle before they can safely
continue after the parent response.

2026-05-20 live-test follow-up 4: a child lifecycle status of `completed` is
not the same as a completed governed phase. The handoff must be substantive for
the phase evidence contract. For visual-reference research, "completed" without
running-product UI capture evidence or code-backed frontend implementation
evidence is a no-handoff result and must project as recovery, not as
`phase_completed_by_child`.

2026-05-27 timeout research follow-up: long-running child-agent work should not
be modeled as a synchronous request with a short hidden timeout. OpenAI's
Responses background mode documents long-running reasoning as asynchronous work
with polling, terminal status, cancellation, and resumable streaming cursors.
OpenAI's Agents SDK documents explicit run limits and tool timeout errors.
Anthropic's official SDKs use bounded timeouts and recommend or require
streaming for long non-streaming requests that may exceed roughly ten minutes.
LangGraph's durable execution and interrupt model requires checkpointed state
before suspension/resume. SWE-agent and later software-agent efficiency work
show that repository-level software agents consume meaningful time and tokens,
and that failures can be expensive when the scaffold lacks resource budgeting.
Kiln's implication is not "disable timeouts"; it is to keep managed children
as asynchronous lifecycle records with explicit timeout budgets, replayable
terminal evidence, accepted cancellation controls, and model-visible route
timeout budgets so broad review work is either routed to a sufficient budget or
split into smaller child invocations.

2026-05-27 distributed-systems timeout follow-up: the big-lab resilience
literature points to the same design. Google's Tail at Scale frames
large fan-out as tail-latency amplification, so a parent waiting on parallel
children must expect at least one slow child and needs terminal child evidence
instead of a hidden parent timeout. AWS Builders Library guidance treats
timeouts as mandatory boundaries on remote/process calls, selected from
downstream latency percentiles plus padding, with retries limited to a single
owned layer and protected by backoff, jitter, and local budgets. Google SRE
guidance warns that retries can destabilize overloaded systems and recommends
randomized exponential backoff, retry budgets, and cancellation propagation up
the call tree. Microsoft Azure guidance makes the same operational point:
timeouts, retry counts, and retry delays must fit the end-to-end latency
objective; endless or overly aggressive retries are an antipattern. Kiln's
runtime consequence is explicit timeout source diagnostics, persisted parent
turn lineage for child requests, terminal join evidence for cancelled/timed-out
children, and no local shim that overrides an operator's configured route
timeout. Microsoft Research's 2024 retry-bug study adds the maintenance risk:
large systems routinely misclassify retryable versus permanent errors as APIs
evolve, so Kiln treats timeout, cancellation, and failure as typed terminal
states with replay evidence instead of free-form retry prose.

2026-05-28 timeout and provenance follow-up: the durable fix is to separate
deadline ownership from route provenance. AWS Builders Library guidance treats
timeouts as mandatory remote/process-call boundaries but warns that short
timeouts and unbounded retries can amplify load; Google SRE guidance similarly
requires bounded deadlines, retry limits, randomized backoff, budgets, and
cancellation propagation. Dean and Barroso's Tail at Scale shows that broad
fan-out turns small tail probabilities into ordinary user-visible latency, so
Kiln should not hide slow children behind a parent-local timeout. OpenAI Agents
SDK tool guidance keeps tool timeouts explicit and model-visible or exception
visible, while its runner guidance exposes max-turn and timeout exceptions as
typed run outcomes. Microsoft Azure transient-fault guidance reinforces that
timeouts, retry intervals, and retry counts must fit the end-to-end objective
and stay finite. Together, these sources keep timeout budgets on the owning
execution plane with terminal evidence, not on an unrecorded caller-side shim.

Kiln consequence: managed-agent route projection now records required
`routeSource` evidence independently from `timeoutSource`. Valid route sources
are `ordered-routing`, `explicit-managed-route`, `managed-default-route`, and
`enabled-engine-fallback`. Valid timeout sources remain `default` and
`explicit-route`; request-local timeout provenance is intentionally invalid.
This keeps GUI, TUI, CLI, replay, transcript resources, and model-facing
managed tools able to answer two different questions: where the route came
from, and where its timeout budget came from.

2026-05-28 async timeout implementation follow-up: current first-party model
and cloud guidance continues to separate long-running work from synchronous
request lifetimes. OpenAI background mode models long reasoning as stored async
responses with polling, terminal status, cancellation, and resumable stream
cursors. Anthropic Message Batches uses async processing, independent per-item
results, polling, and streamed result retrieval for large or non-immediate
work. AWS recommends selecting timeouts from downstream latency percentiles and
warns that both too-short timeouts and retry amplification can create outages.
Google Cloud retries are tied to retryable errors, idempotency, total deadlines,
and exponential backoff with jitter; Google Research's Tail at Scale explains
why broad fan-out makes slow children normal rather than exceptional. Kiln's
implementation consequence is durable managed invocation state with
store-owned transcript sequencing, replayable child lineage, explicit route
timeout evidence, and deterministic timeout tests. The runtime must not replace
that with request-local timeout extensions or hidden caller-side replay shims.

2026-05-28 background terminal persistence follow-up: asynchronous child work
needs terminal persistence at the execution lifecycle boundary, not only at a
parent wait point. `managed_agent.start` therefore registers a runtime terminal
observer that appends the terminal `agent_invocation_*` event and publishes it
through the managed invocation session-event sink as soon as finalization
completes. `managed_agent.join` remains an observation tool and returns the
existing terminal event id when the observer already persisted the terminal
state. Startup failures that terminalize after runtime-owned side effects, such
as lease acquisition, follow the same recorded lifecycle so cleanup evidence is
replayable. This matches the external guidance above: long work is stored,
pollable, cancellable, and replayable; it is not a hidden synchronous wait
extension.

Sources:

- OpenAI API background mode: <https://platform.openai.com/docs/guides/background>
- OpenAI Responses API cancel endpoint:
  <https://platform.openai.com/docs/api-reference/responses/retrieve>
- OpenAI Agents SDK running agents:
  <https://openai.github.io/openai-agents-python/running_agents/>
- Anthropic Java SDK long requests and timeouts:
  <https://github.com/anthropics/anthropic-sdk-java#long-requests>
- LangGraph interrupts and checkpointing:
  <https://docs.langchain.com/oss/python/langgraph/interrupts>
- SWE-agent paper: <https://arxiv.org/abs/2405.15793>
- SWE-Effi resource-constrained software-agent evaluation:
  <https://arxiv.org/abs/2509.09853>
- Google Research, "The Tail at Scale":
  <https://research.google/pubs/the-tail-at-scale/>
- AWS Builders Library, "Timeouts, retries, and backoff with jitter":
  <https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/>
- Anthropic Message Batches:
  <https://docs.anthropic.com/en/docs/build-with-claude/batch-processing>
- Google Cloud Storage retry strategy:
  <https://cloud.google.com/storage/docs/retry-strategy>
- Google SRE, "Addressing Cascading Failures":
  <https://sre.google/sre-book/addressing-cascading-failures/>
- Dean and Barroso, "The Tail at Scale":
  <https://www.barroso.org/publications/TheTailAtScale.pdf>
- OpenAI Agents SDK, "Tools":
  <https://openai.github.io/openai-agents-python/tools/>
- OpenAI Agents SDK, "Running agents":
  <https://openai.github.io/openai-agents-python/running_agents/>
- Microsoft Azure Architecture Center, "Best practices for transient fault
  handling":
  <https://learn.microsoft.com/en-us/azure/architecture/best-practices/transient-faults>
- Microsoft Research, "If At First You Don't Succeed, Try, Try, Again...?":
  <https://www.microsoft.com/en-us/research/uploads/prod/2024/08/SOSP_2024__Detecting_Retry_Bugs_in_Software_Systems-1.pdf>
