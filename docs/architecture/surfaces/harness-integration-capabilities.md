# Harness Integration Capabilities

Kiln is the canonical control plane for local agent harness integration. Claude
Code, Codex, and OpenCode do not share a universal bootstrap configuration
backend today, so Kiln must integrate through each harness capability instead
of pretending one projection mechanism is enough.

This document owns the doctrine for harness integration strategy. Config file
shape, sync, install-state, and drift behavior remain owned by
`config-projection.md`.

## Capability Model

Capability is evidence for one operation, not a product label. The four
authority tiers below are the canonical interpretation used by bounded-work
admission:

| Tier | Meaning | Authority consequence |
| --- | --- | --- |
| **Authoritative** | Attached Kiln Runtime can enforce the operation, observe its result, and provide canonical evidence and terminal truth. | May satisfy the relevant contract when other gates pass. |
| **Partial** | Some dimensions are enforceable or observable, while another required dimension is missing or lossy. | Admit only with a narrowed contract or record a capability pause. |
| **Advisory** | A recommendation, signal, or self-report without enforcement or completion proof. | Cannot satisfy an authority or acceptance gate by itself. |
| **Unsupported** | No trustworthy action or observation is available for the requested operation. | Fail closed or use an explicitly admitted alternate; never infer support from provider/model identity. |

These tiers are separate from the integration statuses used elsewhere in this
document (`native-supported`, `adapter-supported`, and `unsupported`). An
integration status says that a transport or mechanism exists; an authority tier
says what that mechanism can prove and enforce for a specific contract.

| Surface or route | Default bounded-work capability | What it can and cannot establish |
| --- | --- | --- |
| Project-scoped Kiln Core + Runtime | **Authoritative** when the session is attached to the project Runtime. | Canonical policy, admission, CAS reservation/settlement, evidence, lifecycle, and terminal truth. Projection still cannot be treated as authority. |
| Codex native harness | **Partial** and operation-specific. | Process-scoped injection and some permission evidence may be observed; standalone native policy is not the Kiln authority. `codex-oauth` is authoritative only through the attached Runtime route. |
| OpenCode native harness | **Partial** and operation-specific. | Process-scoped injection and adapter observations may be available; an approval setting is not proof of a filesystem sandbox or bounded-work settlement. |
| Claude native harness | **Partial**, **advisory**, or **unsupported** by operation. | Exact plan-artifact capability may be evidenced for a pinned version; generic Runtime injection and permission/authority parity are not assumed. |
| CLI, GUI, TUI, SDK, MCP, replay, and native adapters | **Partial** for their explicitly supported projection/report operations. | They may narrow a request and return source-attributed evidence; they cannot widen scope, reset a ceiling, fabricate a candidate receipt, or own terminal truth. |

CLI `run`, GUI, TUI, and repository benchmark sessions compose the same
project-scoped bounded-work authority. Standalone native harness execution does
not. A bounded managed child cannot drop its runtime-owned execution scope to
create an unaccounted descendant: nested delegation is denied until the child
surface receives descendant authority and depth explicitly.

The capability tier is evaluated at admission from source, observation time,
harness/route identity, and operation-specific evidence. Stale, missing, or
lossy evidence is not silently upgraded. If a required dimension is unknown,
the work item records a capability pause or uses a separately admitted
alternate. See [`bounded-work-authority.md`](../core/bounded-work-authority.md)
for the contract, and the
[bounded-work benchmark](../../research/active/bounded-work-benchmark.md)
for its benchmark limitations.

There is no claim of parity between native harnesses and Kiln Runtime, direct
provider routes and native processes, route availability and usage evidence,
approval mode and sandbox authority, candidate completion and acceptance, or
the two comparative clones and Kiln. A capability label never implies those
claims.

## Cross-Harness Authority Vocabulary

The cross-harness control-plane contract establishes these terms. They are
deliberately separate so transport and projection cannot become a second
authority owner.

- **Native harness**: an operator-facing product such as Codex App, Codex CLI,
  Claude Code, or OpenCode. Its local permission and installation state applies
  only while that harness executes its own route.
- **Direct provider**: a Kiln runtime route backed by a provider mechanism that
  Kiln can govern directly. `codex-oauth`, `opencode-go`, and `opencode-zen`
  are direct providers, not Codex or OpenCode native-harness routes.
- **Harness adapter (or bridge)**: a thin transport translation between a
  native harness and Kiln application ports. It never owns route policy,
  permissions, credentials, or Agent Task lifecycle.
- **Kiln tool**: an admitted Kiln operation with a named application owner,
  declared read/write authority, stable result contract, and evidence.
- **Agent Task**: a durable request for bounded Kiln-governed work. Its one
  **Agent Run** is the committed attempt. It is not a native collaboration
  worker; the MCP bridge exposes only governed task submit, status, result,
  cancel, and replay operations.
- **Invocation route**: the requested provider or harness execution path;
  **resolved route** is the route Kiln admitted after policy and evidence
  checks.
- **Authority profile**: the bounded permissions and approval semantics
  effective for an admitted runtime action. It is never inferred from a model,
  prompt, plugin, or harness setting.
- **Work-governance policy**: the resolved Kiln configuration that defines
  orchestration posture, direct-execution limits, delegation triggers, and
  required evidence.
- **Capability availability**: an observed, source-attributed statement that a
  mechanism is usable for an operation; absence, staleness, or incomplete
  evidence is unavailable rather than a fallback invitation.
- **Admission**: Kiln's fail-closed decision that a requested operation has all
  required authority, route, capability, and evidence. **Delegation** is the
  later act of starting an admitted managed agent.
- **Evidence**: immutable, source-attributed observation data used to explain a
  decision. **Projection** is a harness or UI representation of canonical
  state; it is never authority.

Classification: Codex App, Codex CLI, Claude Code, and OpenCode are native
harnesses. `codex-oauth`, `opencode-go`, and `opencode-zen` are Kiln direct
providers. MCP and plugin integrations are harness adapters; shell CLI
processes are native-harness process adapters, never Kiln application
services. Native-harness permissions therefore do not apply to Kiln direct
provider routes. Direct-provider authority remains in Kiln runtime even when a
Codex App MCP adapter is the caller.

### Native Harness MCP Bridge

The admitted adapter is installed once per user under the reserved
`kiln-control-plane` identity for Codex, Claude Code, and OpenCode. Each native
harness owns discovery, trust, and the lifecycle of its short-lived stdio
bridge. The installed `kiln native-harness control-plane-mcp --harness
<harness>` command owns only protocol translation. It derives project identity
from the child process working directory, resolves the canonical adopted root,
and validates its `.kiln/kiln.yaml`; neither MCP tools nor command arguments may
select a project. The runtime maps no-argument read-only operations to the
CLI application's canonical status, resolved-governance, and harness
capability query owners. It also exposes Agent Task submit, status, result,
cancel, and replay operations through the canonical Runtime application owner.
It does not invoke `codex exec`, `opencode run`, or another native CLI process.
Native harnesses may keep their own loops, tools, and workers while using an
admitted Kiln Model Gateway route; MCP is not their subagent transport.

Native-harness MCP connections are session-owned, but Runtime authority is not.
Multiple Codex threads, Claude Code processes, and OpenCode instances may start
independent stdio bridges concurrently. They authenticate over exact-loopback
Streamable HTTP to one global Operator Runtime supervisor. That supervisor
lazily creates one isolated project Runtime per canonical project identity, so
sessions for the same project share Agent Task, economic-lease, recovery, and
provider-routing authority while different projects remain isolated. Stdio is
only the harness compatibility boundary; it never composes project Runtime
authority locally. If the supervisor or authenticated session is unavailable,
the bridge fails closed with sanitized diagnostics.

Global supervisor and session credential files rely on the operating system's
per-user profile protections and ACLs; POSIX mode bits alone do not establish
that boundary on Windows. The installation assumes the user's profile ACLs
exclude other unprivileged users and rejects unauthenticated loopback clients.
It does not attempt to defend against a malicious process already running as
the same OS user, because that process can read the user's files and native
harness state.

The adapter returns source, observation time, harness identity, request
identity, and the direct-provider/native-harness authority boundary. It removes
paths, effective configuration, errors, environment values, and credentials
from model-visible output. Unsupported or mutation requests return stable MCP
errors. Read acquisition failures return typed unresolved envelopes with one
operator action, so the three inspections remain diagnostically useful without
inventing authority. Configuration mutation remains outside this adapter.

Read-only diagnostic acquisition is deliberately not an authority decision. A
valid canonical status snapshot with stale or drifted harness projections is
returned as a **degraded** status result with target-scoped setup diagnostics.
Projection freshness and drift remain unresolved observations; they do not make
the canonical global/project configuration, resolved policy, or independently
observed capability disappear. Conversely, governance returns an
`authority: unresolved` envelope when canonical policy evidence is missing or
malformed, and capability inspection returns observed fields with
`availability: unresolved` when bridge or capability proof is incomplete.
Only authority-dependent decisions fail closed; diagnostics remain available to
explain how to repair the boundary. Agent Task operations validate bounded
inputs, caller ownership, governance, configured agent profile, route
eligibility, and persisted lifecycle evidence before acting.

The stdio bridge publishes a compact Core-owned MCP `instructions` component
shared with the `kiln-control-plane-workflow` skill. This is procedural context,
not authority: current tool discovery and Runtime admission remain required,
and the full skill must not become a second tool, lifecycle, or policy owner.

The native-harness status-projection boundary validates the canonical evidence
version, full status shape, and observation time before projecting it. Missing,
malformed, future, stale, or unsupported evidence is unresolved; a resolved
governance policy is additionally validated as a complete policy contract
before it can be authoritative. The bridge resolves the harness-supplied
working directory through the trusted-workspace boundary before opening a
short-lived authenticated session; MCP arguments never choose project identity.

Native trust remains outside Kiln's authority and must be established by the
operator when the harness requires it. Governed MCP sync installs the global
user-scoped declaration for each harness and records owned fields and drift
state under Kiln's global runtime directory. Each harness starts its own stdio
bridge; that bridge ensures the global Operator Runtime independently of the
HTTP Model Gateway process. Legacy project-local declarations are migration
input only and are removed only when Kiln can prove ownership. Generated native
MCP files are projection state and are not committed as doctrine. Codex App's MCP lifecycle and
tool calls are documented by the [Codex app-server protocol](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md).
The [MCP stdio transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
and [tool error contract](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
govern lifecycle and error mapping.

Each harness integration declares explicit support for:

- runtime config injection
- native projection
- native config import
- MCP runtime tools
- hooks
- cross-harness managed invocation adapters

The exact Codex, Claude, and OpenCode V2 tool/plugin compatibility baseline is
recorded in `docs/research/fixtures/capability-fabric/v1/`. It is research
evidence for Capability Fabric discovery work, not a second production
capability table or policy authority. Experimental OpenCode tool-list endpoints
remain explicitly ineligible there. SDK package identity and native executable
identity are separate evidence: version equality is never inferred. Every
enabled live proof requires an explicit catalog model; wrappers do not invent
provider fallback models.

The CLI source of truth is
`packages/cli/src/config/harness-integration-capabilities.ts`. Other CLI config
modules may consume that model, but they must not recreate harness capability
tables locally.

Cross-harness managed invocation support is a runtime contract owned by
`@kilnai/core` managed invocation capabilities and consumed by CLI status,
native projection decisions, and runtime admission. Harness integration code may
project that shared matrix into operator-facing setup/status views, but it must
not maintain a second provider-support list.

## Runtime Config Injection

Runtime config injection is preferred when Kiln launches the child process and
the harness exposes a documented startup mechanism that can carry resolved
Kiln configuration into that process.

Runtime injection is scoped to Kiln-launched processes. It does not configure a
developer's standalone shell invocation unless the harness itself reads the
same injected source.

Current status:

| Harness | Status | Mechanism |
|---------|--------|-----------|
| Claude Code | Runtime injection not proven | Kiln-launched managed sessions isolate native config with `CLAUDE_CONFIG_DIR`; standalone Model Gateway routing uses governed native settings projection instead of a generic runtime-config backend |
| Codex | Supported | `CODEX_HOME` plus CLI config overrides for Kiln-launched processes |
| OpenCode | Supported | `OPENCODE_CONFIG_CONTENT` for Kiln-launched processes |

For OpenCode, Kiln injects process-scoped config before `opencode serve`
starts. The wrapper also reconciles permission, MCP, batch-tool, and model
settings through the OpenCode SDK after startup, so startup config and live
runtime config converge on the same Kiln-owned values.

For Codex, live proof on 2026-05-07 verified that `CODEX_HOME` changes the
runtime home used by `codex debug prompt-input`, and `CodexSession` already
passes process-scoped startup overrides for model, approval, sandbox, and
related execution flags. This is not a claim that standalone Codex reads Kiln
global config directly. The SDK-backed session executes the CLI bundled by the
exact pinned SDK and does not replace it with an operator-local executable.

Claude's admitted read-only plan route has one narrower version-bound
capability, `claude-code-private-plan-artifacts-v1`, proven for the exact
Claude Code versions `2.1.220` and `2.1.226`. Its relative location is `plans`
beneath the selected pooled `CLAUDE_CONFIG_DIR`; the route does not infer a
generic Claude home or copy authentication state. Kiln snapshots and restores
only that location around a plan run, then emits redacted counts, digest, and
cleanup status as ephemeral harness evidence. A different or unknown
executable version leaves the route unavailable; the admitted versions are an
explicit list, not a range. This capability is not workspace write authority
and does not enter canonical `writeEvidence`. The wrapper serializes snapshot,
execution, and cleanup with a keyed process-local lease plus an exclusive durable
`.kiln-claude-private-plan-artifacts.lock` created with `wx` inside the
canonical selected home; its mode is `0600` and its document contains only
`schema`, `pid`, and `token`. Different homes do not block, and independent
Kiln processes sharing a selected home fail closed while that lock exists.
Orphan locks are not stolen because no durable snapshot exists; the typed
unavailable result includes the operator repair action. The owner token and
lock identity are verified before unlink. The selected config directory and
`plans` root must remain physical, canonical, non-symlink directories; identity
replacement or unsafe descendants fail cleanup closed, and restoration uses
same-directory temporary files plus rename without recursive deletion of an
unknown root.

Codex runtime output can include non-fatal `error` items that are not turn
failures. The wrapper discards those items from terminal failure mapping and
uses only top-level `error` and `turn.failed` events as fatal evidence, matching
the exact SDK contract. The canonical session stream remains focused on real
failures, completed work, cost, file changes, and tool evidence.

## Native Projection

Native projection remains valid, but it is an artifact strategy, not the
architecture. Kiln uses native projection when:

- the harness requires persistent native files for standalone usage
- the integration surface is a native agent, skill, hook, MCP, or settings file
- runtime injection is unsupported or insufficient for the selected surface

Native projection must remain governed by install-state, drift detection,
append-only backups, and explicit uninstall behavior.

Native default route projection is supported for Codex, OpenCode, and the
Claude Messages gateway only when the canonical Kiln provider/model can be
encoded in that harness's native syntax. It is not a fallback picker and does
not import stale ambient defaults. Each config writer composes permissions,
supported settings, and the route default before one managed write, preserving
unmanaged native defaults until install-state proves Kiln owns the field.
Claude projection owns only the granular gateway environment fields and the
`model` field when exactly one canonical virtual model is available; ambiguous
model sets produce no invented default. This does not make Claude native config
import supported or turn a Claude subscription into Anthropic API access.

Native agent projection uses the same capability model. An agent selects a
global `targetId` and `authorityProfileId`. A harness target may project to its
matching native harness only when
`packages/cli/src/config/harness-integration-capabilities.ts` explicitly
declares the provider/model encoding for that harness. A direct target that
depends on Runtime account or economic authority is not projected as a
standalone native agent because that would bypass Kiln admission.

Native projection and invocation availability are deliberately separate:

- `native-supported` means Kiln can project a valid harness-native agent model.
- `adapter-supported` means Kiln can invoke the route through an explicit
  managed-invocation adapter, but must not project it into that harness's native
  agent files.
- `unsupported` means neither native encoding nor adapter capability is proven.

If a target is adapter-supported but not native-supported, Kiln omits the
native agent with `adapter-required` and reconciles any previously managed
native file through install-state, backup, and drift checks. Cross-harness
adapter support is declared by provider id in the capability table; Kiln must
not infer support from provider prefixes or model id strings.

Operator-facing behavior follows three distinct paths:

- Native projection writes a standalone harness artifact only when the selected
  provider/model can be encoded for that harness.
- Managed invocation runs a governed Kiln child through the runtime service and
  records route, authority, transcript, resource, and outcome evidence.
- Cross-harness adapter invocation is a managed invocation whose caller identity
  is an explicit external harness and whose provider route is admitted by the
  shared adapter capability matrix.

Current cross-harness managed invocation status:

| Parent harness | Adapter | Supported child provider ids |
|----------------|---------|------------------------------|
| Claude Code | `kiln-managed-invocation` | `codex-oauth`, `opencode-go`, `opencode-zen`, `openrouter` |
| Codex | `kiln-managed-invocation` | `opencode-go`, `opencode-zen`, `openrouter` |
| OpenCode | `kiln-managed-invocation` | `codex-oauth` |

This status is an invocation capability, not a native projection capability. It
is applied to managed route admission only when the caller supplies an explicit
external parent harness identity. Kiln runtime callers such as GUI, TUI, CLI
run, and benchmark attach `kiln-runtime` identity and are governed by native
managed invocation admission rather than this cross-harness matrix. Kiln must
not infer the parent harness from provider prefixes, model ids, config
filenames, selected provider, or the current UI surface. Execution still has to
pass managed route admission, provider/model readiness, authority policy, and
tool policy before a child run starts.

## Permission Capability Semantics

Codex, Claude Code, and OpenCode expose different native permission concepts.
Kiln must translate those concepts into provider-neutral evidence without
renaming one harness's mode into another harness's guarantee.

Current permission capability treatment:

| Harness | Native concepts | Kiln treatment |
| --- | --- | --- |
| Codex | Approval policy, sandbox mode, permission profiles, desktop Full Access selectors, session overrides, resumed sessions, automations, and subagents. | Codex can express strong approval and filesystem sandbox evidence when runtime proof is available. Desktop Full Access selection is recorded as session evidence, not proof by itself and not persistent canonical policy. |
| Claude Code | Modes such as `auto`, `dontAsk`, and `bypassPermissions`, plus native tool and subagent configuration. | Claude Code modes are translated as lossy permission evidence until Kiln can prove exact approval, filesystem, and network enforcement for the active run. `bypassPermissions` is a dangerous authority signal, not a provider-neutral sandbox guarantee. |
| OpenCode | `allow`, `ask`, and `deny` permission resolution. | OpenCode permission rules describe approval behavior but do not prove a Codex-equivalent filesystem sandbox. Kiln records approval evidence separately from filesystem and network enforcement strength. |

Every adapter reports desired, persisted, session, and effective permission
evidence separately when available. Unsupported or lossy translations remain
visible in `TrustedExecutionIntegrity.semanticLoss` and classification. A
harness-specific broadening requires explicit operator-local authorization and
approval-bound remediation; repository configuration and model output cannot
authorize trusted/full-access execution.

Child execution never inherits the parent harness permission profile by
assumption. Managed invocation records requested, projected, and observed child
authority separately, and background/unattended execution fails closed when the
required child authority cannot be proven.

## Managed Usage Evidence

Managed invocation adapters must declare usage evidence capability separately
from route availability. A supported invocation route is not automatically a
complete lifecycle-attribution route.

Each adapter descriptor declares:

- token classes it can report: input, output, cache read, cache write;
- semantic source granularity: provider-reported, estimated, or unknown;
- evidence basis: provider, runtime, adapter, or unknown.

Provider-reported semantic granularity is valid only when the evidence basis is
provider usage. Runtime and adapter-derived values remain estimates or unknowns
and must reconcile through the canonical lifecycle ledger instead of being
presented as provider truth.

Current managed-route usage evidence:

| Route family | Token classes | Semantic granularity | Evidence basis |
|--------------|---------------|----------------------|----------------|
| Direct runtime adapter | input, output, cache read, cache write | estimated | runtime |
| CLI harness adapter | input, output, cache read | unknown | adapter |
| Remote harness adapter | input, output | unknown | adapter |

Cross-route comparisons must either show equivalent lifecycle attribution
evidence or surface these explicit gaps. No operator surface may fill a missing
harness usage class by inference from provider prefixes, transcript text, or
local cost heuristics.

## Native Config Import

Native config import is narrower than native projection. It is allowed only when
Kiln can represent the native setting in canonical global config without
guessing or preserving provider-specific baggage.

Current status:

| Harness | Status | Reason |
|---------|--------|--------|
| Claude Code | Unsupported | Settings shape is broader than Kiln's current canonical import contract |
| Codex | Supported | Provider, model, approval, and sandbox map cleanly |
| OpenCode | Supported | Provider, model, and default permission map cleanly |

## Native Route Proof And Diagnostics

Native route proof is evidence, not repair. The smallest supported proof should
be non-destructive and bounded. When a harness exposes a stable bare-invocation
or status mechanism that reveals the selected provider/model, Kiln records that
selected runtime route and compares it with the canonical route and explicit
probe route. When proof is unsupported, Kiln records `bareProofSupported:
false` and keeps the static native-config evidence separate from live proof.

Credential-safe probes always use an explicit provider and validated model.
They record only credential source class, probe status, catalog status, and
route identity. They must not print, hash into user-visible output, persist, or
otherwise expose secret material. Probe timeouts, retries, output length, and
provider spend must be bounded.

Diagnostics distinguish:

- authentication failure
- authorization failure
- unknown model
- unavailable route
- stale catalog
- projection drift
- ambient fallback mismatch
- missing canonical default
- unsupported bare proof
- transient timeout or availability failure

The OpenCode incident on 2026-06-30 is the canonical regression: an explicit
`opencode-go/deepseek-v4-flash` route probe succeeded while bare `opencode run`
selected obsolete `opencode-go/deepseek-v4-flash-free` and reported `Invalid
API key`. Kiln must classify that state as credential-valid with a native
default or ambient fallback mismatch, never as an invalid credential.

## External Harness Evidence

Local harness repositories were used as supporting evidence for route
integrity. They inform Kiln capability boundaries but are not architecture to
copy.

| Repo inspected | Relevant evidence | Stability | Kiln impact |
| --- | --- | --- | --- |
| Codex research checkout | App-server config/read and external-agent import APIs, setup/status notifications, account auth state, MCP status, model/provider capabilities, native config defaults and fallback internals. | App-server protocol and CLI config are stronger evidence; fallback internals are version-sensitive implementation detail. | Use stable config/status surfaces when available; fail closed around unsupported fallback behavior. |
| OpenCode research checkout | JSON/JSONC config, `OPENCODE_CONFIG*`, `provider`, `model`, `small_model`, auth commands, `models --refresh`, provider/model route ids, startup config, plugins, MCP, and permissions. | Public config/docs and CLI behavior are stronger evidence; internal default-to-latest selection is not Kiln doctrine. | Project OpenCode defaults as `provider/model`; do not copy ambient fallback selection into Kiln. |
| Claude Code research checkout | Doctor/login/logout/status command registry, model priority comments, native subagent/MCP/permission config, model validation classes. | Mostly internal/reference evidence; subscription and app behavior can vary. | Mark native default proof unsupported until a stable public contract is available. |

## Harness Doctor

Harness doctor is the read-only installation health view for local harnesses.
It reports evidence; it does not repair PATH, install packages, uninstall
aliases, rewrite native files, or select hidden fallback binaries.

Harness health is a shared product capability, not a wrapper-local fallback.
Each executable surface has one resolved identity, and admission evidence must
show the command path, version, auth or discovery state, config projection
state, and model readiness when the selected provider requires explicit model
proof. Competing aliases are diagnostics unless they change the resolved
command.

The canonical report includes:

- resolved executable path and version for Kiln, Codex, and OpenCode;
- all matching executable entries discovered on PATH;
- competing executable warnings when command resolution may drift;
- auth state, discovery status, and model evidence from shared provider model
  discovery;
- zero automatic repair actions.

Global `kiln` drift is expected during local development. The global command
may point at the last installed release while source runs use the working tree.
Doctor should report that as release/install evidence, not mutate the
developer environment. The global command updates only when a new release is
installed.

## MCP And Hooks

MCP and hooks are complementary integration mechanisms.

- MCP exposes runtime tools after the harness has started. It does not replace
  bootstrap configuration unless a harness explicitly reads startup config
  through MCP, which Claude Code, Codex, and OpenCode do not currently do as a
  shared standard.
- Hooks are native harness extension points and must be projected according to
  the harness capability table.

## Invariants

- Kiln config remains canonical; native files are derived artifacts.
- A harness capability must be proven before code or docs claim support.
- Runtime injection must be process-scoped unless the harness documents a
  standalone config backend.
- Native projection is not a quick fix. It is allowed only as a governed
  projection strategy with ownership, drift detection, and removal semantics.
- GUI, TUI, CLI, MCP, and runtime surfaces consume resolved integration
  capabilities; they do not infer harness behavior independently.
- No wrapper may silently fall back to another executable after admission.
- Provider and model readiness must come from shared discovery/status
  contracts, not surface-local readiness logic.
- Doctor never mutates PATH, installs or uninstalls packages, rewrites native
  config, or chooses app-vs-CLI preference outside the health contract.
