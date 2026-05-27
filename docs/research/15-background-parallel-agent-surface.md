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
