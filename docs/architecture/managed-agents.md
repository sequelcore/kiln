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
persistence, and result handoff are explicitly admitted per invocation.

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

## Live Adapter Evidence

Live adapter support is opt-in and must be proven per provider family. A provider
is live-proven only after both read-only denial and approved-write fixture proofs
pass through managed invocation.

Current status:

| Provider family | Status | Contract treatment |
| --- | --- | --- |
| OpenCode harness | Live-proven for read-only denial and approved bounded write. | OpenCode permission and session diff events reduce to `write_decision` and `file_changed`. |
| Codex harness | Live-proven for read-only no-accepted-write and approved bounded write. | Codex file-change and patch-approval output reduce to canonical write evidence. |
| Claude Code family | Scouted, not live-proven in Kiln. | Permission modes and tool names are adapter research only. |
| Hermes Agent | Scouted as ACP-style future adapter candidate. | `delegate_task`, ACP permission, and terminal concepts are adapter inputs only. |
| OpenClaw | Scouted as future harness or ACP adapter candidate. | Session, subagent, and tool-policy names are not Kiln contract fields. |
| Direct API providers | Deterministic tool-result reduction exists; live proof remains separate. | Direct providers must execute through Kiln tool authority and evidence boundaries. |

Live tests are disabled by default. They require
`KILN_LIVE_MANAGED_AGENT_TESTS=1` plus provider-specific flags such as
`KILN_LIVE_OPENCODE_TESTS=1` or `KILN_LIVE_CODEX_TESTS=1`. Live tests must use
isolated fixture workspaces, bounded tracked paths, read-only denial cases,
approved-write positive cases, cleanup, and replay assertions.

## Session Events And Replay

Managed invocation state projects into canonical session events:

- `agent_invocation_requested`
- `agent_invocation_started`
- `agent_invocation_completed`
- `agent_invocation_failed`
- `agent_invocation_cancelled`

Terminal events carry managed invocation evidence: child lineage, transcript
pointer, diagnostics, usage, result handoff, write authority, and write
evidence. GUI, TUI, CLI, SDK, and future operator surfaces must derive managed
invocation state from these canonical events rather than maintaining local
managed-agent state.

Replay must reconstruct terminal state, authority, result handoff, and write
evidence after session serialization. Artifact-linked diff evidence must survive
reload through resource URIs. Raw provider diffs, full transcripts, and
provider-native event payloads are not session-event state.

## Result Handoff

The child returns a bounded summary and resource pointers. The parent receives
stable handoff references, not raw child context, raw tool logs, or unbounded
diffs. Child memory writes become proposals unless a profile explicitly admits
memory proposal authority.

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
