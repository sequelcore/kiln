# Agent Tasks and Agent Runs

## Purpose

An Agent Task is Kiln's durable, governed request for bounded work. An Agent
Run is its one committed execution attempt. They give native harnesses and
operator surfaces a shared lifecycle, authority record, and result boundary
without taking ownership of a harness's agent loop, tools, or subagents.

This is an execution-governance boundary, not a new orchestration framework.
Codex, Claude Code, OpenCode, and application runtimes retain their native
execution model. Kiln admits work, resolves the configured execution route,
records the evidence needed to start it, and projects a safe result afterward.

## Ownership and boundaries

- Core owns pure admission, route, data-policy, budget, and economic contracts.
- Runtime owns Agent Task persistence, the single Agent Run, dispatch fencing,
  recovery, and result/replay projections.
- CLI owns trusted project composition and native-harness configuration
  projection.
- GUI, TUI, CLI, SDK, and MCP consume Runtime projections. They never create a
  parallel task registry or reconstruct lifecycle from a transcript.
- A native harness owns its loop, tool calls, child workers, local permissions,
  and native session behavior. Kiln does not proxy those operations through MCP.

`packages/runtime/src/agent-tasks` is the persistent application boundary. The
[Execution Kernel](../core/execution-kernel.md) supplies common sequencing,
action-fence, and observation mechanics; Agent Tasks retain their task store,
recovery, result, and settlement semantics. The kernel does not become a
second provider, harness, or task abstraction.

## Canonical record

The supported persisted schema is v14. An `AgentTaskRecord` contains the
trusted project and caller identities, configured agent profile, exact admitted
route, governance/admission evidence, idempotency fingerprint, lifecycle,
write-approval receipt, data-policy proof, and the single `AgentRun`.

An Agent Run has deterministic identity `agent-run:<taskId>`. It is not a retry
history: v14 has exactly one run per task. Its state is one of
`awaiting_approval`, `queued`, `running`, `succeeded`, `failed`, `timed_out`,
`interrupted`, or `cancelled`. Terminal records and successful handoffs are
immutable.

Submission accepts only bounded objective text, a configured agent profile,
an idempotency key, and trusted caller context supplied by composition. It
cannot choose a provider, model, account, route, authority, path, credential,
raw config, timeout, or provider payload. A configured profile identifies a
governed child role and route hint; it is not ambient authority.

Runtime persists only safe evidence. It does not persist credentials,
environment values, storage paths, prompts, raw provider payloads, stack
traces, hidden reasoning, or unbounded child output. Result handoffs are
explicitly untrusted child output and are bounded before persistence and again
before projection.

An attended trusted-execution lease is not Agent Task authority and is never
stored in an Agent Task, Agent Run, admission bundle, or recovery checkpoint.
It applies only to its exact foreground operator-session invocation tree and
does not transfer to a native harness, managed child, background task, or
recovered run.

## Admission and dispatch

Before an external effect, Runtime requires fresh authoritative governance,
the exact configured profile and route, valid authority/permission/tool scope,
data-policy evidence, and any required write approval. Missing, stale,
contradictory, or unsupported evidence fails closed.

Economic routes adopt and commit one immutable route/account decision before
dispatch. That resource commitment is not by itself the action fence. During
convergence, the SQLite economic owner becomes the one canonical action claim
and Agent Task JSON retains only its projection/reference rather than a second
economic fence authority.

Native-harness routes are credentialless: Runtime stores the exact route
acknowledgement and one action fence for the SDK invocation or process launch,
but never selects an account or creates economic evidence for that branch. The
claim binds the admitted child authority and stops at the external-harness
boundary; it makes no claim about hidden model calls, tools, subagents, retries,
or permission enforcement.

Session pre-turn token limits are separate from Agent Tasks. They use persisted
input plus output token observation and stop a session turn when usage is
unknown; they neither select an Agent Task route nor replace economic
commitment.

## Native harnesses and the Model Gateway

A harness can query canonical route/model configuration and then use an
admitted Kiln Model Gateway virtual model through its own official SDK or
native protocol. It may also create its own native subagents or workers. The
harness reports route, usage, and permission evidence through the Runtime
boundary; Kiln validates and retains only the allowed evidence.

The Model Gateway is a Runtime model-ingress component. It is not a separate
package, generic agent proxy, or owner of a harness's tools and subagent
transport. Available-model discovery is a secret-free capability projection;
it never grants execution authority. Creating an execution route remains an
explicit canonical mutation that supplies policy, data classification and
evidence, account selection, and economics.

For ordinary Codex automation, the official Codex SDK is the integration
adapter. The isolated CLI adapter exists only where its unavailable SDK
semantics are required: ephemeral execution, profile selection, or local
provider selection. It is not a generic compatibility fallback.

## MCP projection

MCP is an optional consultation, configuration, and bounded control-plane
surface. It is not the transport for native subagents. The project-local bridge
exposes exactly these Agent Task operations:

- `kiln_agent_task_submit`
- `kiln_agent_task_status`
- `kiln_agent_task_result`
- `kiln_agent_task_cancel`
- `kiln_agent_task_replay`

The bridge derives trusted caller, harness, and project identity. It accepts no
route, provider, model, path, credential, permission, timeout, or raw
configuration fields. A task identifier alone never authorizes an operation.
It returns only bounded lifecycle, route/provenance, result, approval,
data-policy, and replay evidence.

## Remote agents and external harnesses

Managed Agent Tasks may target a configured remote harness adapter. Runtime
admits the exact child route, persists authority, data-policy, and economic
evidence, and fences the Kiln-owned adapter invocation. The remote harness
remains opaque: Runtime does not claim hidden model calls, tools, subagents,
retries, cancellation, or remote terminal truth.

Remote execution is distinct from native Agent Tasks and from MCP. It may
provide a bounded external result, but it does not grant route, authority, or
write capability beyond the admitted child contract.

## Recovery and schema

Recovery is conservative. An unfenced economic run may be redispatched from
its immutable commitment. A dispatch-fenced economic run with no task
projection becomes `interrupted` with `result_pending` evidence and cannot be
redispatched. Every native-harness run likewise becomes `interrupted` after
restart: Runtime never silently resumes an external harness process.

Process restart also ends every attended trusted-execution lease. Recovery may
project retained admission and terminal evidence, but it cannot recreate the
process-local principal or authorize a new effect from the former lease.

Only the current Agent Task schema is admitted. Obsolete or malformed local
state is rejected without mutation; Runtime has no legacy reader, writer,
migration, archive, or compatibility alias.

## Invariants

- one Runtime owner for Agent Task and Agent Run lifecycle;
- one deterministic run per v14 task;
- one explicit route and policy decision before dispatch;
- native harnesses retain native loops, tools, and subagents;
- attended trusted-execution leases are process-local, non-persistent, and
  never inherited by Agent Tasks or recovered runs;
- available models never imply an executable route;
- data-policy and session-turn-budget denials occur before their protected
  external effect;
- post-fence uncertainty remains capacity-consuming until authoritative
  settlement or reconciliation;
- replay reports stored evidence only and never manufactures history;
- MCP is a bounded control plane, never a required subagent protocol;
- obsolete schema names and migration paths are absent.

## Delivered issue boundaries

The following issue scopes are represented by the current contracts; this is a
documentation closure note, not a claim of live operator validation.

- [#79](https://github.com/sequelcore/kiln/issues/79): composite Codex ingress
  applies pre-body, path-class FIFO backpressure and records only sanitized
  local 503 evidence.
- [#73](https://github.com/sequelcore/kiln/issues/73): Available Models is a
  discovery projection, separate from the execution picker and its route
  authority; its target wizard accepts minimal operator intent, previews one
  admitted normalized proposal, and revalidates current evidence before the
  governed create mutation.
- [#69](https://github.com/sequelcore/kiln/issues/69): execution routes require
  classification and expiring data-policy evidence, and protected effects are
  denied before dispatch when proof is missing or invalid.
- [#35](https://github.com/sequelcore/kiln/issues/35): session pre-turn token
  observation is session-wide, includes input and output usage, and stops on
  unknown usage without becoming route authority.
- [#52](https://github.com/sequelcore/kiln/issues/52): harness permission
  observations are Runtime-owned receipts with explicit capability limitations;
  native declarations alone do not prove effective authority.

## Related

- [Coordination](coordination.md)
- [Managed account leases](managed-account-leases.md)
- [Model Gateway](../providers/model-gateway.md)
- [Harness integration capabilities](../surfaces/harness-integration-capabilities.md)
- [Canonical MCP](../../guides/channels/mcp.md)
