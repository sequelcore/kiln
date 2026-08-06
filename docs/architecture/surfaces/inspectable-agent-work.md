# Inspectable Agent Work

Inspectable agent work is the operator contract that explains what an agent is
doing, why it is allowed to do it, what evidence it has produced, and what
remains unresolved. It is a cross-surface and cross-harness contract. GUI, TUI,
CLI, native, SDK/widget, IDE, remote surfaces, Claude Code, Codex, OpenCode, and
direct-provider routes may render or collect the data differently, but they must
not invent their own source of truth.

The inspectability source of truth is the Kiln session evidence plane:

- canonical `session_event` history
- governed work-item state and execution attempts
- managed invocation lifecycle records
- shared operator-event presentation
- resource-plane links for transcripts, diagnostics, diffs, handoffs, and large
  artifacts
- replayable operator cockpit projections

Final assistant text is not inspectability. Raw transcripts are not enough
either. A surface is inspectable only when it can project bounded, structured
work state from canonical evidence and link to deeper resources when the
operator needs detail.

## Required Projection

Every inspectable work projection must preserve these facts when the active
harness can provide them:

- work identity: session id, turn id, work item id, managed invocation id, and
  parent/child lineage
- actor identity: agent profile, route id, provider/model proof, authority
  profile, and harness or adapter kind
- lifecycle: requested, admitted, running, paused, completed, failed,
  cancelled, recovered, or blocked
- intent: objective, phase, expected evidence, required result fields, and done
  criteria
- authority: admitted tools, write scope, approval state, resource lease, and
  route capability snapshot
- evidence: provided evidence labels, verification gate results, changed
  resources, transcript links, handoff resources, diagnostic resources, and
  residual-risk notes
- attention state: missing evidence, failed checks, skipped gates, stale
  heartbeat, timeout, dirty-worktree review, worktree conflict, denied context,
  or missing capability
- next operator action: approve, deny, inspect resource, join, cancel, retry,
  continue locally, update work item, finish execution, or mark blocked

If a harness cannot supply one of these facts, the projection must say that the
fact is unavailable and explain the missing capability. It must not silently
replace the fact with prompt text, surface-local state, or a guessed provider
configuration.

## Work Items

Governed work items are the durable unit of planned work. Their inspectability
comes from `work_item.update`, `work_item.complete`,
`work_item.execution.start`, `work_item.execution.finish`, canonical
`work_item_*` session events, and `kiln://session/work-items` resources.

Surfaces may show work items as rows, sidebars, badges, transcript events, or
resource reads. Those renderings are projections only. The authoritative state
is the typed work-item evidence recorded in the session evidence plane.

An open work item is not complete because an assistant described progress.
Completion requires recorded expected evidence, verification gate results, and
residual-risk closeout when gates were skipped or failed.

## Managed Invocations

Managed child invocations are inspectable through admitted managed invocation
requests, capability snapshots, lifecycle events, bounded handoffs, transcript
resources, diagnostics, write evidence, resource leases, and cockpit
projections.

A child completion is not task completion by itself. When the child satisfies a
governed work item, the parent must record the child result through the
work-item tools so evidence remains connected to the parent work item. Printing
the handoff or a suggested `work_item.update` payload in assistant text does not
create governed state.

Managed invocation resources live under
`kiln://managed-agents/invocations/{invocationId}` and must remain readable
through the shared resource plane. Surfaces must link to these resources instead
of inlining large transcripts, diffs, or diagnostic payloads.

## Surface Rules

Operator surfaces consume shared contracts:

- `@kilnai/gateway-contracts` owns event presentation and cockpit projection
  shapes.
- GUI, native, TUI, CLI, SDK/widget, IDE, and remote surfaces render from those
  projections or deterministic degraded text.
- Raw payloads remain audit evidence for inspectors and replay, not the normal
  operator UI.
- Local checklists, terminal lines, panels, progress bars, and badges are never
  authority.

The same rule applies to harness shims. Claude Code hooks, Codex config,
OpenCode config, shell wrappers, MCP servers, provider tracing, and adapter
logs can feed evidence into Kiln, but they are not the canonical contract.

## Long-Running Work

Long-running or background agent work must remain inspectable while it is
running, not only after a final message. A valid long-running projection exposes:

- a stable work or invocation id before expensive execution starts
- current phase and latest canonical event
- heartbeat or staleness evidence when available
- admitted route and authority snapshot
- bounded live summary
- links to transcript, diagnostics, and produced resources
- cancellation/join/retry availability through governed control paths
- blocking evidence when the work cannot continue

If a process exits cleanly but the latest governed turn still lacks required
evidence, the session lifecycle may be completed while the work outcome remains
failed or blocked. Operator surfaces must preserve that distinction.

## External Observability

External tracing and observability systems are useful adapter inputs. They do
not replace Kiln's evidence plane. OpenAI Agents tracing, Claude Code hooks,
LangSmith traces, provider logs, and future telemetry integrations may provide
tool calls, handoffs, lifecycle hooks, cost, latency, and debug spans. Kiln must
normalize that evidence into session events, resource links, and cockpit
projections before it counts as cross-surface inspectability.

## Invariants

- Do not treat final assistant text as work evidence.
- Do not treat a raw transcript as the operator projection.
- Do not hide failed, skipped, missing, or unavailable evidence.
- Do not let one surface own private task, child, approval, or replay state.
- Do not infer completed child capability from current mutable config; use the
  admission-time snapshot.
- Do not inline large artifacts where a `kiln://` resource link is required.
- Do not mark work complete until expected evidence, checks, and residual-risk
  closeout are recorded in governed state.
