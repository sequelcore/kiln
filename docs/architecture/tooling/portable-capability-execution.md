# Portable Capability Execution

Kiln executes an admitted capability through one Runtime-owned portable
invocation contract. The contract keeps capability selection, execution
transport, producer evidence, and terminal settlement distinct. A transport
adapter cannot choose a capability, widen its authority, or reinterpret a
producer observation as Assurance.

## Ownership

Core owns capability descriptors, exact normalized input and output schemas,
schema digests, effects, limits, idempotency, and the schema compiler used at
the execution boundary. Runtime owns immutable invocation bindings, execution
ports, replay posture, terminal settlement, and persistence into canonical
session events. Surface adapters bind host-side implementations only after an
exact Runtime generation has been admitted.

Provider configuration, executable paths, credentials, and environment values
remain host-side. They never enter capability discovery, model context,
portable settlements, or producer metadata.

## Invocation Binding

One invocation is bound to all of the following before dispatch:

- generation, catalog, capability, revision, and descriptor identity;
- exact implementation and input/output schema digests;
- tool-call scope and tool-call identity;
- the canonical input digest;
- time, output, and other admitted capability limits; and
- idempotency, replay posture, and an explicit idempotency key when required.

Runtime compiles and applies the exact Core schemas. It validates the candidate
input before dispatch and the producer result before returning it. Schema or
identity drift fails closed; an adapter-local permissive validator is not an
alternative execution path.

The binding retains trusted process-local values only. Its settlement carries
digests and bounded observations, never executable callbacks, authorization
objects, credentials, schemas, or the original input.

## Ports

The provider-neutral port vocabulary admits `cli`, `local-function`, `mcp`,
`openapi`, `graphql`, `approved-service`, and `code-mode`. Slice 4 implements
the two ports required by the first executable vertical: CLI and trusted local
function. The other kinds reserve stable transport identities; they do not
create empty adapters, guessed authority, or a compatibility fallback.

A concrete MCP, OpenAPI, GraphQL, approved-service, or code-mode port is added
only with its real transport authority, credential boundary, cancellation
semantics, limits, and conformance fixtures. Discovery evidence for one of
those protocols is not execution authority.

Runtime brands every concrete port instance. Capability materialization
rejects an object that merely imitates the port shape, so an unowned callback
cannot receive trusted execution context.

### CLI

The CLI port requires an absolute executable path, a canonical working
directory, argv arrays, `shell: false`, and an explicit environment allowlist.
It bounds stdout and stderr, validates parsed structured output, and maps exit,
signal, timeout, cancellation, unavailable-process, and output-overflow states
to one terminal settlement. Credentials are forbidden in argv and are supplied
only through explicitly admitted host environment names.

Runtime owns child termination. Cancellation, timeout, or overflow first sends
TERM and then escalates to KILL after a bounded grace period on platforms with
process-group signals. Windows process trees use the native forced tree
termination path immediately because that platform adapter has no equivalent
graceful tree signal. The Windows helper resolves from the explicit system
root to `System32/taskkill.exe`; it never searches ambient `PATH`.
Failure to observe a final child exit remains `outcome-unknown`; it is never
reported as known-not-dispatched.

### Trusted local function

The local-function port invokes only a Runtime-attached trusted handler. It
uses the same binding, schema, timeout, cancellation, output, and settlement
contract as other ports. A timed-out or cancelled function may still be
running when JavaScript cannot preempt it, so the dispatch disposition remains
conservative. The producer must also observe the supplied cancellation signal
at its safe boundaries.

Runtime may use this trusted attachment to preserve the semantics of a
producer whose actual execution is already governed behind a typed adapter.
Declaring that attachment as CLI does not expose the command to the model or
replace the producer's own candidate and evidence contract.

### Agent-backed execution

Agent-backed capabilities use the same immutable binding, exact schema
validation, bounds, settlement, and replay rules as direct portable tools.
Their Runtime-owned port records whether the existing lifecycle owner is an
`agent-task` or `managed-invocation`, plus the exact child and executor
identities. A callback that only imitates this port is rejected during
materialization.

The agent port does not own another child lifecycle. A local implementation
uses the existing Agent Task application and its durable AgentTask/AgentRun
record. A managed implementation accepts the already-attached
`managed_agent.invoke` executor closure, so the configured invocation service,
owner, route admission, cancellation, and terminal observation remain
canonical. The exact parent authority bundle reaches that owner through
trusted process-local context; it is neither reconstructed from tool input nor
serialized as child output.

Canonical direct runs materialize the local port only when project evidence
selects one eligible non-economic vision profile. The run creates one Agent
Task composition for its lifetime, lends it the run-owned authority-evidence
and exact-once action-claim stores, drains it before those owners close, and
passes its binding to ProviderSession. Zero or multiple eligible profiles leave
the local implementation unavailable. Operator Runtime, CLI, and native MCP
submission preserve the same typed capability request at their public boundary.

`vision.analyze/v1` is the first agent-backed contract. Core contributes it
only when configuration resolves one unambiguous specialist with explicit
structured output, image modality, read-only access, an exact
attachment-capable route, and current route proof. Accountless routes declare
that capability invocation does not consume Kiln turn-budget authority;
economic routes are not admitted by this first resolver. An external-runtime
route carries its exact configured attachment identity into managed admission.

Both executors send only the bounded instruction and admitted resource URIs.
They accept only a terminal completed structured handoff, validate the result
against `VisionAnalysis`, and reject evidence outside the requested URI set.
Denied, failed, malformed, partial, cancelled, timed-out, and unobserved
outcomes cannot produce a successful capability result. The capability
adapter retains no separate request or result copy. A descriptor's
`data.retention: "none"` describes that capability-owned payload posture; it
does not suppress Agent Task or managed-invocation lifecycle, replay, or audit
records, which remain owned by those subsystems.

## Settlement And Replay

Every port invocation returns `kiln.portable-invocation-settlement/v1` with:

- the complete invocation identity and schema/input/output digests;
- the concrete port kind;
- terminal status and dispatch disposition;
- bounded sanitized stdout and stderr with byte counts;
- exit, signal, diagnostic, start, finish, and duration evidence; and
- the admitted limits and replay posture.

Terminal status is one of `completed`, `failed`, `timed_out`, `cancelled`,
`output_limit_exceeded`, `invalid_input`, `invalid_output`, or
`replay_conflict`. Dispatch is independently classified as
`known-not-dispatched`, `terminally-observed`, or `outcome-unknown`.

Settlement is invocation evidence, not the producer's domain observation and
not an action claim. Runtime persists it as a separate top-level field on the
tool result and canonical `tool_call_completed` event. Producer metadata stays
unchanged and continues to own facts such as candidate identity, verifier
version, findings, and evidence limitations.

Runtime replay memory is process-local and bounded. An idempotent invocation
may return an immutable prior terminal result. A conditionally idempotent
invocation additionally requires an explicit key and allowed replay posture.
Non-idempotent, denied, missing-key, or uncertain outcomes produce a replay
conflict instead of dispatching again. Durable replay authority is not claimed.

## Verification Vertical

The first executable vertical binds the configured verification producers to
the portable contract without flattening their meanings:

- Oxlint remains facts-only static analysis over immutable candidate bytes;
- Kiln Quality remains local static-quality analysis;
- Dafny remains a formal verification observation; and
- Gentle AI remains inferential review evidence.

Oxlint, Dafny, and Gentle AI use their hardened executable adapters; Kiln
Quality uses the trusted local-function port. All propagate the admitted
cancellation signal and retain their existing candidate mutation,
unavailability, version mismatch, malformed output, and evidence behavior.
Inline observations declare no artifact they did not actually produce.

The configured direct CLI surface resolves the exact implementation reference
named by the admitted verification tool schema. It never chooses the first
implementation in a list. The returned producer result must satisfy that
schema before the portable settlement is attached.

## Invariants

- Discovery and protocol compatibility evidence never dispatch work.
- One immutable generation and implementation identity govern the invocation.
- Input and output validation use Core's exact compiled schemas.
- Execution context and authority reach the selected producer unchanged.
- Host credentials and executable configuration never enter model-visible data.
- Producer evidence and invocation settlement remain separate.
- Cancellation, timeout, mutation, malformed output, and unknown outcomes fail
  closed without widening Assurance.
- A reserved port kind is not an implemented transport.

## Implementation

- Core schema compiler and verification contracts:
  `packages/core/src/capabilities/capability-json-schema-safety.ts` and
  `verification-capability-discovery.ts`
- Runtime binding and settlement:
  `packages/runtime/src/capabilities/portable-execution.ts`
- Runtime agent-backed port and vision executors:
  `packages/runtime/src/capabilities/agent-backed-execution.ts`,
  `managed-vision-analysis-execution.ts`, and
  `agent-task-vision-analysis-execution.ts`
- Durable local Agent Task contract and lifecycle:
  `packages/runtime/src/agent-tasks/`
- CLI and trusted local ports:
  `packages/runtime/src/capabilities/portable-cli.ts` and
  `portable-local-function.ts`
- Runtime generation and materialization:
  `packages/runtime/src/capabilities/runtime-capability-composition.ts`
- Canonical session settlement projection:
  `packages/runtime/src/session/runtime-session-orchestrator-tool-executor.ts`
  and `runtime-session-event-ledger.ts`
- Verification producer adapters:
  `packages/runtime/src/verification/`
