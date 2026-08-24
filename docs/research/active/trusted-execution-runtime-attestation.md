# Trusted-Execution Runtime Attestation

Owner: Roadmap 00 Slice 4 / [issue #52](https://github.com/sequelcore/kiln/issues/52)
Evidence cutoff: 2026-08-24
Promotion targets: trusted-execution contracts, config-projection architecture,
harness-integration architecture, and the issue #52 verification surface
Exit condition: every supported adapter has an evidence-bound terminal result,
at least one hard-boundary adapter reaches `current-verified`, and this note's
unique evidence is promoted or deleted.

## Question

Which active provider or harness surfaces can prove approval, filesystem,
network, and tool authority at invocation time, rather than merely recording
Kiln's request or projected native configuration?

## Method

The investigation compared the pinned packages used by Kiln, current wrapper
code, revisioned local provider source, and official provider documentation.
No credentials, live provider invocation, or network effect was used as
verification. Synthetic fixtures can verify argument binding and protocol
parsing, but cannot establish an enforcement boundary that the protocol does
not report.

Pinned evidence:

- `@openai/codex-sdk` 0.147.0 and Codex source
  `32329b289d05eb6a3f8e35c267ceb25ba46716a2`;
- `@anthropic-ai/claude-agent-sdk` 0.3.237 and Agent SDK source
  `8716a39f83dd7506e6421199caface603d4941ab`;
- `@opencode-ai/sdk` 1.18.18 and OpenCode source
  `3016830e253492ef41b6cc00dbed623e5989279b`.

Primary documentation:

- OpenAI [developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli),
  [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference),
  and [app-server protocol](https://learn.chatgpt.com/docs/app-server);
- Anthropic [Agent SDK TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript),
  [settings](https://code.claude.com/docs/en/settings), and
  [sandboxing](https://code.claude.com/docs/en/sandboxing);
- OpenCode [permissions](https://opencode.ai/docs/permissions/),
  [server](https://opencode.ai/docs/server/), and
  [SDK](https://opencode.ai/docs/sdk/).

## Findings

### Aggregate proof is unsound

The current evidence type assigns one `proof` value to an aggregate runtime
profile. Provider protocols expose different subsets of that profile. Marking
the aggregate as proven after observing one subset would let an approval-mode
acknowledgement also claim filesystem or network enforcement. Runtime evidence
therefore needs component-scoped proof before any partial acknowledgement can
be promoted.

Configuration arguments, a successful child start, permission-rule readback,
and accepted limitations are not aggregate runtime proof. Missing components
remain unavailable or inferred, and `current-verified` remains unreachable
until every component required by that profile has exact current evidence.

### Codex

Kiln passes exact approval and sandbox values to the SDK and CLI wrappers. The
pinned SDK/CLI `thread.started` event reports only the thread identifier, so it
cannot acknowledge the active policy, sandbox, or network state. Newer Codex
app-server responses expose approval and sandbox settings and are the strongest
candidate for the first exact producer, but adopting them requires a versioned
adapter contract rather than relabeling the pinned event.

The observation must bind the exact executable revision and child lineage to
the returned session. A parent-spawned local process can use its process handle,
a parent nonce or session digest, a dedicated channel, and freshness. A reused
daemon needs a capability-bound session. Remote evidence needs authenticated
audience binding and replay protection.

### Claude Code

The Agent SDK initialization message reports `permissionMode`, session, cwd,
model, tools, and runtime version. This can acknowledge the approval-mode
component after exact request comparison and child-lineage binding. It does not
report active filesystem or network sandbox state. The tool list is a
capability catalogue, not proof of per-call authority. Permission callbacks can
prove individual decisions only at their own tool boundary.

### OpenCode

The OpenCode session model and update events can read back effective permission
rules, and permission events expose individual ask/reply outcomes. These can
support rules-only approval evidence. OpenCode has no filesystem or network
sandbox comparable to the Codex boundary; permission checks and external-path
handling do not create OS isolation. That limitation remains explicit and
cannot be converted into runtime proof by operator acceptance.

### Direct Runtime

Provider route, account, and credential binding do not prove permission,
filesystem, or network enforcement. Kiln may prove a Runtime-owned tool or
effect decision only at the actual per-call enforcement boundary. In-process
enforcement needs no child authentication, but still cannot claim provider
boundaries it does not own.

## Supported Decision

Issue #52 may use mixed honest outcomes. At least one supported hard-boundary
adapter must reach `current-verified`; Codex app-server is the preferred first
candidate. Claude and OpenCode may terminate as partial or evidence-bound
unsupported results without a recurring operator action. Accepted limitations
never weaken enforcement or satisfy missing proof.

`intentional-operator-override` has no production owner or producer and should
be removed unless a separately governed operator-owned policy lifecycle and a
demonstrated consumer are established.

The operator-approved authority lifetime is an attended, session-owned lease
for one invocation tree, ending at the earliest of tree completion, session
close, explicit revocation, composition revision change, or a one-hour cap.
It never auto-renews, and child authority is separately attenuated. Legacy
durable grant files under private Kiln state are retained byte-for-byte as
inactive history, but neither those files nor native projection install-state
snapshots can authorize execution. The former `kiln trust grant|revoke`
surface has been removed; `kiln trust` owns only semantic-limitation records.

The first enforcement path is now implemented for interactive CLI `run` plus
foreground `managed_agent.invoke` on the Runtime-controlled Codex OAuth
direct-provider route. CLI composition creates an opaque process-local
principal distinct from the operator session. Runtime owns the typed approval
request, constructs the exact lease, validates it before managed resources or
adapter dispatch, and re-evaluates it for every resolved child tool effect
before cache lookup or execution. Consequential actions receive a final
synchronous check after durable admission readback and before action-claim
consumption, while retry attempts check independently. Expiry is latched as a
terminal authority state so wall-clock rollback cannot resurrect it. The live
context is carried beside the canonical request and admission bundle; it is not
serialized into either one, recovery checkpoints, native projections, or
private grant files.

This closes attended issuance and Kiln-owned effect enforcement only. It does
not prove provider, operating-system, sandbox, filesystem, or network
enforcement, and it does not make `current-verified` reachable. Background,
nested, economic, GUI, TUI, non-Codex direct-provider, and native CLI-harness
destructive paths remain unsupported and fail closed.

## Current Checkpoint

The 2026-08-24 checkpoint completes the passive lease evidence, legacy
durable-authority cutoff, and first attended issuance/enforcement path. The
full Runtime lane passed 3,331 tests with five skipped; the full CLI lane passed
2,589 tests with one skipped. Root typecheck, documentation validation, and
diff checks passed. Independent Sol-high review reported no remaining findings
after rerunning the attended Runtime boundary (30/30) and CLI approval boundary
(41/41). No live provider call was authorized or executed.

The next bounded work is a versioned Codex app-server adapter spike that binds
the exact executable, child lineage, request, session, returned policy, and
freshness. It must produce component-scoped evidence, prove exact-match and
mismatch behavior with portable fixtures, and fail closed when any binding is
missing or stale. Only genuine hard-boundary evidence may make
`current-verified` reachable. Claude and OpenCode still need honest partial or
unsupported terminal results, followed by shared CLI, TUI, GUI, and doctor
projection of the same integrity result.

## Remaining Uncertainty

- The project has not adopted the newer Codex app-server protocol version, so
  its exact compatibility and failure semantics are not yet a Kiln contract.
- Provider self-report is not remote attestation. The required identity binding
  depends on whether the adapter owns a child process, reuses a daemon, or calls
  a remote runtime.
- No credential-free fixture can establish real OS enforcement. Such fixtures
  prove serialization, lineage binding, response parsing, mismatch handling,
  and fail-closed behavior only.
