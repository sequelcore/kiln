# Managed Agent Invocation

Managed agent invocation is Kiln's provider-neutral substrate for bounded child
work. It allows a parent session to request a child execution surface while
preserving explicit authority, governed context, credential routing, lifecycle
evidence, replay, and write boundaries.

This subsystem is part of Kiln's biocybernetic control plane. It is a regulated
execution boundary, not an orchestration-first abstraction and not a compatibility
layer for provider-specific agent terminology.

## Doctrine

Kiln owns the managed invocation contract. Providers, harnesses, and local tools
may expose concepts such as subagents, delegates, tasks, sessions, patch
approval, sandbox policies, or ACP runtimes, but those terms remain adapter
inputs. Canonical Kiln state is expressed through managed invocation requests,
admission decisions, invocation records, write evidence, session events, and
resource URIs.

A managed invocation is admissible only when the runtime can prove the requested
authority is complete and bounded. Missing provider route, adapter kind,
execution mode, permission profile, tool authority, working directory, timeout,
credential route, memory scope, or write authority causes admission to fail
closed.

The parent session never lends ambient authority to the child. Context,
credentials, memory access, tool access, filesystem access, timeout, transcript
persistence, and result handoff are explicitly admitted per invocation. Agent
profile selection, skill access, and child context mode follow
[`agent-context.md`](agent-context.md); they are requests that the runtime must
resolve, admit, and record before execution.

## Non-Boundaries

Managed invocation does not define conductor planning, fan-out/fan-in
scheduling, durable workflow execution, team topology mutation, or autonomous
multi-agent strategy. Those capabilities may use managed invocation later, but
they must not broaden this contract.

Managed invocation also does not make provider-native permission behavior
authoritative. Provider sandbox and approval claims are telemetry until Kiln
observes filesystem state, canonical events, and recorded evidence inside the
admitted boundary.

## Canonical Contracts

The core contract is defined in `@kilnai/core`:

- `ManagedAgentInvocationRequest`
  Describes the requested child work, parent lineage, provider route, execution
  surface, authority profile, and bounded input.
- `ManagedAgentAdmissionDecision`
  Records whether the request is admitted or denied and names the exact missing
  capabilities when denied.
- `ManagedAgentInvocationRecord`
  Records the terminal lifecycle state, provider route actually used, authority
  snapshot, child lineage, transcript pointer, diagnostics, usage, result
  handoff, and write evidence.
- `ManagedAgentAdapterDescriptor`
  Declares what an adapter can enforce: lifecycle, cancellation, timeout,
  transcript persistence, usage reporting, credential routing, memory context,
  cleanup, unsupported-field policy, and write authority.

Runtime execution is owned by `RuntimeManagedAgentInvocationService`. Adapters
must not be treated as authoritative when called outside the service. The service
re-evaluates admission immediately before execution, checks the adapter
descriptor, and validates the returned record against the admitted request.

## Authority Profiles

Kiln currently recognizes these managed invocation profiles:

| Profile | Purpose | Write authority |
| --- | --- | --- |
| `foundation-readonly-plan` | Read-only analysis, planning, review, and exploration. | Not present. Any non-denied write evidence is rejected. |
| `foundation-propose-writes` | Child may propose workspace, memory, or artifact changes but cannot apply them. | Required, proposal mode only. |
| `foundation-apply-approved-writes` | Child may apply a workspace write that has policy-approved evidence and bounded scope. | Required, `apply-approved` workspace mode. |
| `foundation-memory-write-proposals` | Child may propose governed memory mutations without directly mutating durable memory. | Required, memory proposal mode. |

Every authority profile includes:

- tool authority: allowed tool names, write flag, and network flag
- working directory: path and access mode
- timeout budget
- credential route: runtime-selected route ID or credentialless declaration
- memory scope: project/domain scope plus read-only or proposal access
- optional write authority: workspace, memory, artifact, and tool write scopes

## Write Authority

Write authority is Kiln-owned and provider-neutral. It has three responsibilities:

1. Scope the write before execution.
2. Record proposal, approval, attempt, denial, cleanup, and rollback evidence.
3. Preserve replayable references without embedding raw diffs or large payloads
   into session events.

Workspace writes are bounded by allowed and denied paths. Approved application
requires `foundation-apply-approved-writes`, `apply-approved` workspace scope,
policy-approved evidence, rollback evidence support, cleanup evidence support,
and adapter scope reduction.

Memory writes are proposals unless explicitly admitted through the memory write
profile. Artifact writes are represented through resource URIs. Large diffs,
provider transcripts, tool payloads, and generated artifacts are linked through
`kiln://` resources instead of being inlined into canonical events.

Canonical write evidence kinds include:

- `write-authority-denied`
- `write-proposal-created`
- `write-proposal-approved`
- `write-proposal-denied`
- `write-attempt-completed`
- `write-cleanup-pending`

Read-only invocations may record only `write-authority-denied` evidence. Any
accepted write proposal, approval, attempt, memory proposal, or retained
filesystem mutation in read-only mode is a boundary violation.

## Context And Credentials

Child context is admitted through the context governor. The child receives a
bounded context packet and audit evidence, not blind replay of the parent
conversation. Parent memory scope is not inherited implicitly.

Credential routing is explicit. A child invocation receives a credential route
identifier or a credentialless declaration. Secret values are not stored in
invocation records, session events, transcripts, diagnostics, or handoff
summaries.

## Runtime Adapters

Managed invocation is an adapter-neutral contract. Runtime routes may execute
through an external coding harness or through a Kiln-owned child runtime
session. Both route families reduce to the same managed invocation lifecycle,
authority decisions, evidence model, and parent session events.

The managed CLI harness adapter is the first runtime implementation. It creates
a provider session, streams provider-neutral CLI events, collects usage, records
terminal state, and converts write-related events into canonical evidence.

The adapter accepts live `file_changed` events, `write_decision` events, cost
updates, terminal events, and errors from CLI wrappers. It also supports a
filesystem boundary that snapshots tracked paths before execution and observes
retained changes afterward. If a read-only invocation modifies a tracked path,
Kiln restores the file when configured and records `write-authority-denied`
evidence.

Timeout and cancellation are terminal states, not evidence erasers. The adapter
keeps an in-progress evidence collector while a live session is running. If the
session times out after a bounded write event, the timeout record still includes
the observed write evidence and linked resource URIs. Provider errors containing
cancel or abort semantics map to the canonical `cancelled` lifecycle state.

The direct-provider adapter creates a child `RuntimeSessionOrchestrator` instead
of launching a CLI harness. It reuses the provider adapter contract, runtime
builtin tool execution, per-call tool allowlists, tool authority checks, context
admission, session accounting, and managed invocation record shape. It does not
reimplement file tools, memory tools, approval checks, or tool-call execution.
Direct-provider routes are eligible only when the provider supports model tool
calls and Kiln can enforce the configured authority through its own runtime tool
surface.

Direct-provider builtin tools execute with a request-scoped sandbox derived
from the admitted managed authority. Read-only routes can read only inside the
managed working directory or explicitly admitted write scope, cannot write, and
cannot use network tools unless the request authority admits network access.
Models may still hallucinate hidden or out-of-scope tool calls, but the runtime
allowlist and sandbox deny them before tool execution.

CLI configuration resolves direct-provider managed routes through the same
provider adapter factory used by native Kiln sessions. A direct route becomes
healthy only when the route names a direct provider, selects a tool-call-capable
model, the provider is available through the session registry, required
credentials can be resolved, and Kiln can attach the runtime builtin tool
surface for that operator surface. Harness routes and direct routes share the
same managed invocation admission and result contract; only their execution
adapter differs.

## Runtime Tool Surface

`managed_agent.invoke` is the runtime-owned model-callable entrypoint for parent
sessions that need a governed child invocation. It is not part of the core
developer-tool registry and is not exposed by default. Runtime operator surfaces
attach it only when the CLI provides a resolved managed invocation route
registry. That registry may come from explicit `managedAgents.routes`, from
eligible ordered `routing.routes`, or from the default read-only route
synthesized from enabled supported child engines. Direct-provider projections
must name a tool-call-capable model that can execute Kiln runtime tools; opaque
provider aliases that cannot be proven tool-capable remain unhealthy instead of
being exposed as child authority. For harness-backed child engines, route health
includes the session-start engine availability probe, the provider-advertised
model catalog, and model-specific live proof for the requested managed profile;
a configured child engine that is missing locally or names an unadvertised model
does not receive `managed_agent.invoke` authority.
Unhealthy configured routes are still carried as diagnostics so a failed tool
call can explain why the route is unavailable rather than pretending it was
never configured.
The shared attachment point is `createAttachedRuntimeBuiltinToolSurface`, so
GUI, TUI, operator gateway, and CLI direct-provider executable sessions use the
same tool definition, authority projection, executor, and route contract instead
of surface-specific implementations.
The attached tool definition is generated from the resolved route registry. It
lists healthy and unavailable route ids, constrains model-facing provider ids to
configured routes, and instructs parent agents to treat failed or unavailable
children as missing evidence during comparisons. Surfaces must not add
surface-local managed-agent prompt rules that diverge from this generated tool
contract.

The model supplies a bounded task, a configured provider route, a requested
managed invocation profile, and optionally a child agent profile, child skills,
resource URIs, and context mode. The runtime maps that input to a
`ManagedAgentInvocationRequest` using configured route defaults for adapter,
execution mode, credential route, memory scope, timeout, working directory, and
authority. Requested agent profiles and skills are resolved by the host context
resolver and recorded as admitted context before execution. The model does not
provide arbitrary authority directly.
When multiple routes share the same provider/profile, admission requires
`routeId` or an exact configured model match. Ambiguous provider-only selection
fails closed instead of silently picking the first route.

`agentProfile`, `skills`, and `contextMode: "fork"` fail closed when the active
surface has not configured a context resolver. `contextMode: "isolated"` is the
default. `contextMode: "resources"` admits only explicitly provided resources.
`contextMode: "fork"` is reserved for future policy-approved parent-context
forking and is rejected by the current CLI-owned resolver.

The tool is classified as approval-gated authority. A GUI/TUI/CLI parent turn
must pass the normal tool authority path before the child can be spawned. Once
approved, the tool calls `RuntimeManagedAgentInvocationService`, appends
`agent_invocation_requested`, `agent_invocation_started`, and terminal
`agent_invocation_*` events to the parent runtime session, streams those
canonical events through any configured `ManagedInvocationSessionEventSink`, and
returns only the bounded child result handoff plus resource pointers.

Plan mode excludes `managed_agent.invoke`; planning turns may inspect and submit
plans, but may not spawn managed child work.

## Live Adapter Evidence

Live adapter support is opt-in and must be proven per provider family and
profile. A provider is healthy for `foundation-readonly-plan` only after it can
produce a substantive read-only result handoff. Write denial and approved-write
fixture proofs prove write-evidence capture, but they do not by themselves prove
read-only analysis handoff quality.

Current status:

| Provider family | Status | Contract treatment |
| --- | --- | --- |
| OpenCode harness | Live-proven for write-denial and approved bounded-write evidence; read-only analysis handoff is admitted only for `opencode/minimax-m2.5-free`. | OpenCode permission and session diff events reduce to `write_decision` and `file_changed`. Other OpenCode models stay unhealthy for `foundation-readonly-plan` until that model has substantive result-handoff proof. |
| Codex harness | Live-proven for read-only no-accepted-write and approved bounded write. | Codex file-change and patch-approval output reduce to canonical write evidence. |
| Claude Code family | Scouted, not live-proven in Kiln. | Permission modes and tool names are adapter research only. |
| Hermes Agent | Scouted as ACP-style future adapter candidate. | `delegate_task`, ACP permission, and terminal concepts are adapter inputs only. |
| OpenClaw | Scouted as future harness or ACP adapter candidate. | Session, subagent, and tool-policy names are not Kiln contract fields. |
| OpenAI direct API | Opt-in live read-only proof exists for builtin `read`; approved-write proof remains separate. | Direct providers execute through Kiln builtin tool authority, working-directory sandbox, and evidence boundaries. |
| Other direct API providers | Child runtime-session adapter exists with deterministic builtin tool sandbox proof; provider-family live proof remains separate. | Direct providers execute through Kiln builtin tool authority, working-directory sandbox, and evidence boundaries. |

Live tests are disabled by default. They require
`KILN_LIVE_MANAGED_AGENT_TESTS=1` plus provider-specific flags such as
`KILN_LIVE_OPENCODE_TESTS=1`, `KILN_LIVE_CODEX_TESTS=1`, or
`KILN_LIVE_OPENAI_DIRECT_TESTS=1`. OpenAI direct live proof uses
`KILN_LIVE_OPENAI_DIRECT_MODEL` when set and otherwise defaults to
`gpt-4o-mini`. Live tests must use isolated fixture workspaces, bounded tracked
paths, read-only denial cases, approved-write positive cases, cleanup, and
replay assertions.

## Session Events And Replay

Managed invocation state projects into canonical session events:

- `agent_invocation_requested`
- `agent_invocation_started`
- `agent_invocation_completed`
- `agent_invocation_failed`
- `agent_invocation_cancelled`

Every managed invocation event carries the same visible invocation identity:
`invocationId`, `agentId`, `profile`, effective `providerRoute`, `adapterKind`,
`executionMode`, `authorityProfileId`, parent session lineage, requester, and
request source when known. `providerRoute.model` is the effective child model
after configured route defaults and runtime execution-profile resolution, not
only a model override supplied by the parent assistant. Operator surfaces must
render that identity as structured evidence, for example
`foundation-readonly-plan via codex-oauth/gpt-5.4-mini`, rather than only
showing the tool name.

Terminal events additionally carry managed invocation evidence: child lineage,
transcript pointer, diagnostics, usage, result handoff, write authority, and
write evidence. GUI, TUI, CLI, SDK, and future operator surfaces must derive
managed invocation state from these canonical events rather than maintaining
local managed-agent state.

Replay must reconstruct terminal state, authority, result handoff, and write
evidence after session serialization. Transcript and result handoff URIs emitted
by managed invocation records must be readable through the shared `resource_read`
tool. Runtime may back those URIs with session-scoped artifacts, but it must not
announce resource links that the active resource plane cannot resolve.
Artifact-linked diff evidence must survive reload through resource URIs. Raw
provider diffs, full transcripts, and provider-native event payloads are not
session-event state.

## Result Handoff

The child returns a bounded summary and resource pointers. The parent receives
stable handoff references, not raw child context, raw tool logs, or unbounded
diffs. Child memory writes become proposals unless a profile explicitly admits
memory proposal authority.

A terminal `completed` state requires a substantive result handoff. For
read-only harness invocations, a provider process that exits successfully
without non-thinking text is a failed managed invocation, not a successful empty
review. Write-capable profiles may complete without text only when canonical
write evidence provides the substantive handoff. This keeps parent agents,
operators, replay, and future SDK surfaces from treating an empty child run as
usable work.

## Verification

The canonical deterministic verification set includes:

```bash
cmd.exe /d /s /c "cd /d C:\Proyectos\Sequel\kiln && bun run typecheck"
cmd.exe /d /s /c "cd /d C:\Proyectos\Sequel\kiln && bun run test"
```

Focused managed invocation checks live under:

- `packages/core/tests/managed-agent/`
- `packages/runtime/tests/managed-agent/`
- `packages/runtime/tests/session/managed-invocation-session-events.test.ts`
- `packages/runtime/tests/session/session-serializer.test.ts`
- `packages/cli/tests/wrapper/codex-session.test.ts`
- `packages/cli/tests/wrapper/opencode-session.test.ts`

Opt-in live checks use:

```bash
cmd.exe /d /s /c "cd /d C:\Proyectos\Sequel\kiln && bun run test:managed-agents:live"
```

Provider-specific live checks require the relevant environment flags and must
never run as part of normal deterministic CI.
