# Execution Surfaces Strategy Diagnosis

Date: 2026-06-25

Status: accepted research basis. The product/architecture direction has been
promoted into `docs/architecture/execution-surfaces.md`,
`docs/architecture/operator-workspace.md`,
`docs/architecture/app-gateway-runtime.md`, and
`docs/roadmap/03-execution-surfaces.md`. Implementation proceeds in small
contract-first slices.

## Thesis

Kiln's long-term execution-surface strategy should be:

1. Kiln owns the governed work runtime, evidence plane, operator workflow, and
   gateway protocol.
2. Codex, Claude Code, OpenCode, ACP-style runtimes, IDEs, MCP clients, and
   shell harnesses remain providers, adapters, import sources, or fallback
   execution routes.
3. The primary user promise should not be "Kiln makes other harnesses nicer."
   It should be "open Kiln to supervise and complete governed work" and "run a
   Kiln Gateway to power AI features in your own apps."

The current codebase already contains many of the right contracts for that
future. The diagnosis is not that Kiln lacks architecture. The risk is that
Kiln may keep promoting harness compatibility, adapter wrapper commands, and
surface-specific projections faster than it promotes one coherent operator
workspace and one coherent app runtime.

## Research Inputs

Kiln project evidence:

- `CLAUDE.md`
- `AGENTS.md`
- `docs/architecture/README.md`
- `docs/architecture/runtime-surfaces.md`
- `docs/architecture/operator-surfaces.md`
- `docs/architecture/inspectable-agent-work.md`
- `docs/architecture/managed-agents.md`
- `docs/architecture/native-operator-surface.md`
- Relevant code in `packages/core`, `packages/runtime`, `packages/gateway-contracts`,
  `packages/cli`, `packages/tui`, `packages/gui`, and `packages/native`.

Private context used but not treated as public evidence:

- `private cross-harness governance memo, 2026-06-24`

Comparative source checkouts:

- `codex`
- `claude-code`
- `opencode`
- `hermes-agent`
- `openclaw`
- `opentui`

Public sources:

- OpenAI Codex CLI reference and Codex app-server protocol:
  <https://developers.openai.com/codex/cli/reference>,
  <https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md>
- Claude Code official docs for subagents, hooks, settings, MCP, SDK:
  <https://docs.anthropic.com/en/docs/claude-code/sub-agents>,
  <https://docs.anthropic.com/en/docs/claude-code/hooks>,
  <https://docs.anthropic.com/en/docs/claude-code/settings>,
  <https://docs.anthropic.com/en/docs/claude-code/mcp>,
  <https://docs.anthropic.com/en/docs/claude-code/sdk>
- OpenCode docs for agents and permissions:
  <https://opencode.ai/docs/agents/>,
  <https://opencode.ai/docs/permissions/>
- MCP tools, authorization, security, and tasks:
  <https://modelcontextprotocol.io/specification/2025-06-18/server/tools>,
  <https://modelcontextprotocol.io/docs/tutorials/security/authorization>,
  <https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices>,
  <https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks>
- VS Code AI extension APIs:
  <https://code.visualstudio.com/api/extension-guides/ai/ai-extensibility-overview>,
  <https://code.visualstudio.com/api/extension-guides/ai/tools>,
  <https://code.visualstudio.com/api/extension-guides/ai/chat>
- Human-AI interaction and governance:
  <https://www.microsoft.com/en-us/research/blog/guidelines-for-human-ai-interaction-design/>,
  <https://dl.acm.org/doi/fullHtml/10.1145/3290605.3300233>,
  <https://www.nist.gov/itl/ai-risk-management-framework>,
  <https://airc.nist.gov/airmf-resources/playbook/govern/>

Community signals used as non-authoritative pain evidence:

- Reddit thread on Codex MCP permission concerns:
  <https://www.reddit.com/r/OpenAI/comments/1np4jp9/can_we_configure_codex_cli_mcp_permissions/>
- Reddit thread on OpenCode arbitrary-code-execution concerns:
  <https://www.reddit.com/r/LocalLLaMA/comments/1r8oehn/opencode_arbitrary_code_execution_major_security/>

## Current State

Kiln already defines the desired surface doctrine clearly. The architecture says
Kiln is "runtime/headless first" and human interfaces are replaceable projections
of one control plane (`docs/architecture/operator-surfaces.md:14`).
The runtime taxonomy names App Gateway as the deployable runtime owner and
Operator Gateway as the local human-operator bridge
(`docs/architecture/runtime-surfaces.md:17`,
`docs/architecture/runtime-surfaces.md:29`).

In code, that doctrine is partially real:

- `@kilnai/gateway-contracts` owns shared cockpit projection contracts, including
  `OperatorCockpitReadOnlyProjection`
  (`packages/gateway-contracts/src/operator-cockpit-projection.ts:325`)
  and `projectOperatorCockpitReadOnlyView`
  (`packages/gateway-contracts/src/operator-cockpit-projection.ts:437`).
- `@kilnai/core` owns managed invocation request/state contracts
  (`packages/core/src/agents/managed-invocation/index.ts:161`)
  and governed work items through `WorkItemStore`
  (`packages/core/src/work-governance/work-item.ts:338`).
- `@kilnai/runtime` owns direct-provider execution through
  `ManagedDirectProviderRuntimeAdapter`
  (`packages/runtime/src/agents/managed-invocation/direct-runtime-adapter.ts:70`)
  and external CLI harness execution through `ManagedCliHarnessAdapter`
  (`packages/runtime/src/agents/managed-invocation/cli-harness-adapter.ts:85`).
- `@kilnai/runtime` exposes the local GUI/operator gateway via `startGuiGateway`
  (`packages/runtime/src/gateway/gui-gateway.ts:393`).
- GUI, TUI, native, and CLI all consume shared contracts for parts of the
  operator surface instead of defining wholly independent managed-agent models:
  GUI materializes work items from canonical event payloads
  (`packages/gui/src/lib/session-store.ts:398`),
  TUI maps canonical session events
  (`packages/tui/src/gateway-session.ts:97`),
  native selects work items from operator events
  (`packages/native/src/renderer/native-gateway-cockpit.ts:86`),
  and CLI loads managed-agent cockpit projection from transcripts
  (`packages/cli/src/commands/managed-agent.ts:330`).

The shape is right: Kiln has a runtime, gateway contracts, governed work items,
managed child invocation, resource URIs, operator event projections, provider
model discovery, config projection, native surface experiments, and app/YAML
gateway surfaces.

The strategic gap is product coherence. A user can see many entry points:
`kiln run`, `kiln gui`, `kiln tui`, `kiln managed-agent`, `kiln goal`, `kiln
doctor`, `kiln gateway`, YAML apps, MCP endpoints, GUI panels, native package,
SDK/widget, and harness projections. That is a rich platform, but not yet a
single obvious place where work happens.

## What Kiln Owns Well

Kiln already owns the right durable concepts:

- Provider-neutral managed invocation. The core contract separates direct
  adapters from harness adapters and captures authority, route, execution mode,
  capability snapshot, child identity, result handoff, transcript pointers,
  diagnostics, usage, write evidence, and resource leases.
- Work governance. Work items model expected evidence, verification gates,
  pause requirements, execution attempts, managed orchestration adoption, and
  residual risk. This is more durable than a surface todo list.
- Resource-plane thinking. `kiln://` resources give large artifacts,
  transcripts, diagnostics, work items, source resources, and result evidence a
  durable cross-surface reference model.
- Operator projection contracts. Gateway contracts already expose cockpit,
  event presentation, provider status, identity, theme, memory lattice, browser
  session state, and command shapes.
- Direct-provider path. The direct runtime adapter is strategically important:
  it proves Kiln can execute child work through its own tool authority instead
  of always depending on Codex/OpenCode/Claude Code as the execution substrate.
- Harnesses as adapters. CLI harness routes are normalized into Kiln evidence
  rather than treated as truth. That is the correct long-term boundary.
- Surface parity direction. GUI/TUI/native/CLI share enough projection
  vocabulary that the product can converge without re-architecting every
  surface.

## What Kiln Still Delegates Too Much

Kiln still delegates too much in four areas.

First, harness UX remains too central as a lived workflow. `ManagedCliHarnessAdapter`
is correctly bounded as adapter infrastructure, but the overall product still
leans on harness installation health, external route readiness, native config
projection, and wrapper-specific troubleshooting. Those are necessary for
adapters, but they should not define Kiln's primary user experience.

Second, operator surfaces still duplicate reduction and presentation glue. GUI,
TUI, native, and CLI all consume shared contracts, but each still parses,
merges, formats, or selects session/work-item facts locally. That is acceptable
for v1 surfaces, but it becomes a long-term maintenance risk if the product
keeps adding stateful panels before promoting more shared view-state contracts.

Third, CLI inspection still has legacy gravity. `kiln managed-agent` can read
transcripts and then use the live gateway for control. That is useful for
automation, but the primary inspection model should become "ask the gateway for
canonical resources and projections," not "replay local transcript files and
then attach for mutations."

Fourth, app runtime and operator workspace are not yet emotionally or
ergonomically unified. The architecture distinguishes App Gateway from Operator
Gateway correctly. The product still needs a clearer answer to: when I open
Kiln, what am I looking at, what work can I start, what is running, what needs
attention, and which apps/gateways am I operating?

## Desired Product Shape

### Kiln As Primary Operator Workspace

The primary operator surface should feel like an operations workspace for AI
work, not a wrapper console.

Minimum first-class objects:

- Work: goals, work items, phases, expected evidence, execution attempts,
  verification gates, pause requirements, and residual risk.
- Sessions: active conversations, historical transcripts, cost, provider/model
  routes, mode transitions, approvals, tool calls, files changed, browser state,
  and replay.
- Managed agents: active/background children, route/capability snapshots,
  source resources, leases, worktree state, prompts, joins, cancellations, and
  adoption gates.
- Resources: transcripts, diffs, diagnostics, artifacts, source bundles,
  feedback bundles, memory graph resources, and external evidence.
- Gateways: local Operator Gateway, deployable App Gateways, tenants/apps,
  health, auth, MCP exposure, channels, and runtime policies.
- Config health: provider credentials, model discovery, harness adapters,
  native projections, drift, and missing capability evidence.

The core interaction should be:

1. Open Kiln.
2. Pick or create a workspace/gateway target.
3. Start or resume governed work.
4. Watch structured work state, not only chat text.
5. Approve, deny, steer, join, cancel, inspect, or adopt from one place.
6. Export/share/replay evidence when useful.

Chat remains important, but chat should not be the source of truth. The visible
workspace should answer "what is happening and why is it allowed?" before the
operator has to read a transcript.

### Kiln Gateway As App AI Runtime

Kiln Gateway should be the runtime developers embed or deploy when they want
governed agents inside their own products.

It should own:

- app/tenant/session identity
- provider/model routing
- tool and MCP admission
- app/channel contracts
- memory and context policy
- authorization, approvals, and audit
- event stream and replay
- resource plane
- managed-agent lifecycle
- observability export

It should not be a GUI server with app features bolted on. The App Gateway is
the app runtime. Operator surfaces attach to it.

## Comparative Analysis

Codex has converged on a rich app-server protocol. The source checkout documents
`codex app-server` as the interface for rich clients, using JSON-RPC-like
bidirectional communication (`codex/codex-rs/app-server/README.md:1`,
`codex/codex-rs/app-server/README.md:22`).
It exposes threads, turns, items, approval flows, sandbox/permission settings,
MCP server status, commands, realtime, remote control, and schema generation.
The lesson is not "copy Codex app-server." The lesson is that serious agent
products need a typed live protocol for rich clients. Kiln already has this
direction through gateway contracts, but should continue making the gateway
contract the product center.

Claude Code exposes a highly programmable harness: official docs describe
subagents with prompts, tool restrictions, permission modes, hooks, and skills;
hooks are lifecycle commands/endpoints/prompts; settings include project-scoped
permissions, hooks, MCP servers, and plugins; the SDK exposes built-in tools,
hooks, subagents, MCP, permissions, and sessions. The cloned code shows how
much session state, trust, cost, worktree, plugin, remote-control, and
permission state can accumulate inside a harness
(`claude-code/bootstrap/state.ts:100`,
`claude-code/bootstrap/state.ts:457`). The lesson:
Claude Code is a powerful adapter target, but if Kiln depends on that harness
as the primary work surface, Kiln inherits Claude Code's state model instead of
owning its own.

OpenCode is terminal-first and simple to explain. Its README says it includes
two built-in agents switchable with Tab: build and plan
(`opencode/README.md:102`). Its public docs
distinguish primary agents and subagents, and permissions control whether
actions run, prompt, or block. The source checkout has both app/server concepts
and detailed session UI strings around tasks, review, terminals, MCP, providers,
permissions, and sharing. The lesson: lightweight terminal affordances matter,
but Kiln should not define its worldview as "a better terminal coding agent."

OpenClaw positions the Gateway as a local-first control plane for sessions,
channels, tools, and events
(`openclaw/README.md:162`). It also states that the
Gateway alone should deliver a good experience and apps are optional extras
(`openclaw/README.md:198`). This is close to Kiln's
gateway thesis. OpenClaw also emphasizes onboarding, channel surfaces, security
runbooks, sandboxing, and remote exposure warnings. The lesson: Gateway-centric
products need setup, security posture, and daemon health to be first-class UX,
not hidden docs.

Hermes emphasizes a real TUI, messaging gateway, cross-platform conversation
continuity, learning loop, subagents, terminal backends, and self-improving
skills (`hermes-agent/README.md:20`,
`hermes-agent/README.md:105`). Its ACP adapter has
explicit edit approval plumbing
(`hermes-agent/acp_adapter/edit_approval.py:181`).
The lesson: strong product pull can come from continuity across surfaces and
ambient messaging channels. The caution: learning loops and broad automation
can become product sprawl unless governance and evidence stay central.

OpenTUI is relevant as an execution-surface substrate rather than an agent
architecture. It can inform future TUI rendering quality, but it should not
change Kiln's runtime ownership.

## Research-Backed UX Principles

1. Make system state visible. Microsoft/ACM Human-AI Interaction guidelines
   emphasize showing what the system can do, what it is doing now, uncertainty,
   failure, and recovery paths. For Kiln, that means visible phases, authority,
   evidence, missing gates, and next actions.

2. Separate authority from presentation. MCP exposes tools, but MCP
   authorization/security docs emphasize consent, audit, user-specific data,
   token handling, and access controls. Tool exposure is not enough. Kiln must
   own policy, approval, and audit over every surface.

3. Bind long-running work to identity and context. MCP task guidance notes that
   task IDs require access controls and should bind to authorization context.
   Kiln's managed invocation and work item IDs should remain scoped to session,
   gateway, tenant, and authority evidence.

4. Use IDE integration as a client surface, not the runtime. VS Code AI docs
   distinguish chat participants, language-model tools, MCP tools, and model
   APIs. Editor APIs are excellent for file navigation, inline diffs, code
   actions, and review. They should attach to Kiln Gateway/operator resources,
   not fork session truth.

5. Prefer structured inspectability over transcript-only transparency. Agent
   observability writing consistently frames useful observability as traces,
   tool interactions, reasoning/action visibility, auditability, and failure
   analysis. Kiln's session evidence plane is aligned with this, but surface UX
   must keep promoting it over raw chat.

6. Govern continuously. NIST AI RMF frames governance as roles, policies,
   monitoring, accountability, and lifecycle risk management. For Kiln, this
   means every execution surface must answer: who requested this, what authority
   was admitted, what evidence exists, what is missing, and who approved the
   next external effect.

## Architectural Boundaries

Core belongs to durable domain contracts and pure policy:

- work-governance entities
- managed invocation contracts
- provider route/capability value objects
- memory/context/tool/resource domain contracts
- safety and authority policy primitives
- event types and validation helpers

Runtime belongs to execution and policy application:

- App Gateway and Operator Gateway runtimes
- session orchestration
- managed invocation service
- direct-provider adapter
- harness adapter normalization
- tool execution and approval flows
- provider/model discovery
- credential pools
- resource providers
- replay serialization
- gateway HTTP/WS/MCP routes

Gateway contracts belong to surface-facing projection:

- frame schemas
- operator event presentation
- cockpit/read-only projections
- managed-agent view state
- resource summary shapes
- provider/status/theme/identity presentation contracts
- deterministic text fallback for non-rich surfaces

CLI belongs to automation and diagnostics:

- start/attach/run gateway commands
- validation, doctor, config sync/projection
- scriptable goal/work/session inspection
- JSON output for CI and automation
- emergency/local transcript replay when gateway is unavailable

CLI should not be the canonical owner of session state, managed child state, or
app runtime semantics.

TUI belongs to terminal supervision:

- keyboard-first live session operation
- low-bandwidth/SSH workflows
- approval/control commands
- compact work/managed-agent projections
- shared deterministic event presentation

TUI should not own private work item or managed-child semantics.

GUI belongs to rich operator workspace:

- primary local operator UX
- work dashboard
- sessions and replay
- managed-agent cockpit
- resources and inspector
- approvals and config health
- gateway/app/tenant target selection
- memory/observability visualization

GUI should not import core/runtime implementation modules directly or speak to
providers directly.

Native belongs to desktop-only capabilities:

- packaged shell
- embedded isolated browser host
- native window/tray/notification affordances
- multi-window or high-density supervision if benchmarked
- OS credential/device-management integration later

Native must stay a client of gateway contracts. It must not become the runtime.

Gateway belongs to app/runtime ownership:

- deployable app sessions
- tenants
- channels
- tool gates
- MCP endpoint
- app auth
- events
- memory
- managed children
- resource plane

SDK/widget belong to product embedding:

- app-facing chat/channel/resource contracts
- typed client APIs
- embeddable UI primitives

They should not expose hidden operator authority or bypass gateway policy.

## Bounded Contexts

Execution Surfaces touches these bounded contexts:

- Operator Surface: GUI, TUI, CLI, native, IDE, remote, and their view state.
- Runtime Surface: App Gateway, Operator Gateway, Studio Dev Server, SDK/widget,
  MCP.
- Session: session identity, turn lifecycle, replay, transcript persistence,
  cost, provider route evidence.
- Work Governance: goals, work items, execution attempts, evidence gates,
  pause requirements, closeout.
- Managed Invocation: child route admission, authority profile, lifecycle,
  leases, handoff, cancellation, join, recovery.
- Tool Execution: builtin tools, MCP tools, browser/computer use, approvals,
  command safety.
- Config Projection: global config, native harness projections, drift, install
  health, route catalogs.
- Memory/Context Governance: memory scope, resource context, context budgets,
  durable app/user/project state.
- Gateway/App Runtime: app.yaml/gateway.yaml, tenants, channels, auth, MCP.
- Observability/Feedback: event streams, resource links, traces, diagnostics,
  feedback bundles, repair work.

The key DDD rule: no bounded context should smuggle its state through a surface
component. If a GUI panel needs a new fact, the fact should usually be promoted
to core/runtime/gateway-contracts first.

## Strategic Risks

Overbuilding risk:

- Building multiple rich surfaces before the shared view-state contract is
  complete will create parallel models.
- Building an IDE extension too early may duplicate the GUI workspace before
  the operator resource protocol is stable.
- Building native high-density UI before real benchmark evidence may lock Kiln
  into Electron complexity without product proof.

Copying harnesses blindly:

- Codex app-server, Claude Code hooks/subagents, and OpenCode permissions are
  useful evidence, not templates. Kiln should not mirror every command,
  approval mode, hook, plugin, or agent roster.
- Harness-local permission prompts do not equal governed authority. Community
  complaints about MCP and code-execution permissions show why Kiln needs its
  own policy layer.

Duplicated surfaces:

- GUI Work panel, TUI sidebar, CLI `goal inspect`, native work panel, IDE tree
  view, and SDK resource reads can become five products unless they share
  gateway view-state projections.
- Transcript replay and live gateway state can drift if CLI commands keep
  reconstructing state from local files without a clear offline-mode boundary.

Gateway confusion:

- App Gateway and Operator Gateway are different products with different
  security requirements. Remote GUI should not expose a local operator gateway
  as if it were a hardened app runtime.

Workspace pollution:

- The private memo records a resolved storage-location issue. The general
  lesson remains strategic: runtime state must not surprise users by writing
  invisible databases into arbitrary workspaces. Project-local artifacts should
  be explicit project-owned configuration, not incidental app state.
- Public-facing docs should never expose machine-local filesystem routes.
  Evidence references should use repo-relative paths, canonical product URIs,
  or stable public source links.

## Roadmap

### Short-Term Foundations

1. Name the product center explicitly.
   Create a canonical architecture/product note that states: Kiln Operator
   Workspace is the primary human work surface; Kiln Gateway is the app AI
   runtime; harnesses are adapters.

2. Promote shared operator view-state contracts.
   Move more of GUI/TUI/native/CLI work-item, managed-agent, resource, approval,
   and session summary reduction into `@kilnai/gateway-contracts`. Surface code
   should format and interact, not infer.
   Current progress: `OperatorWorkspaceHomeProjection` carries gateway targets,
   sessions, governed work/goals, managed-agent attention, approvals, route
   health, provider/model readiness, gateway/app health, linked resources, and
   shared attention across runtime, CLI, GUI, TUI, and native producers.
   Config health is part of the contract; local GUI setup diagnostics feed it,
   and producers without setup/doctor evidence project `unknown`.

3. Define gateway target identity.
   Make App Gateway, Operator Gateway, local simulated target, remote target,
   and tenant/app target visible in one shared target contract. Every operator
   action should carry explicit gateway/app/session/work target identity.

4. Clarify offline CLI replay.
   Keep transcript replay as a deliberate offline inspection mode with explicit
   stale/unavailable indicators. Prefer live gateway resource/projection reads
   when a gateway is available.

5. Harden "what needs attention" as a shared contract.
   Standardize attention reasons across work items, managed invocations,
   approvals, browser takeover, config health, route health, and missing
   capability pauses.

6. Keep direct-provider routes strategically prioritized.
   Harness routes remain valuable, but the "Kiln owns execution" proof depends
   on direct-provider runtime routes passing the same authority/evidence tests
   as harness routes.

### Medium-Term Execution Surface Upgrades

1. Build a unified Operator Workspace home.
   First screen should show active work, active sessions, managed children,
   gateways, config health, and attention queue. It should not be a marketing
   page or a raw chat transcript.
   Current progress: the shared home contract has active work/goals, sessions,
   managed children, approvals, gateways, route health, provider/model
   readiness, gateway/app health, resources, config health, and attention.
   Remaining work is to extend actionable setup/doctor diagnostics coverage
   beyond the local GUI producer.

2. Make work the organizing object.
   Sessions, children, resources, diffs, approvals, and diagnostics should be
   navigable from work items/goals and also from session timelines.

3. Add a resource inspector.
   Operators need a first-party way to open `kiln://` resources: transcript
   pages, diff artifacts, diagnostic bundles, source resources, work items,
   memory graph nodes, feedback bundles, and managed invocation resources.

4. Add gateway/app target switcher.
   Users should be able to attach to local Operator Gateway, local App Gateway,
   remote App Gateway, and simulated targets with clear trust/security labels.

5. Turn `kiln doctor` evidence into UI, not just CLI output.
   Provider credential health, model readiness, harness install health, config
   drift, MCP status, and route proof should be visible in the operator
   workspace.

6. Make approvals auditable and replayable.
   Approval requests should include action, authority, source work/session,
   target resource, diff/command preview, policy reason, approver, and result.

7. Prepare IDE as a client, not a fork.
   Design IDE extension contracts around resource links, diffs, diagnostics,
   session/work trees, and gateway control actions. Do not create IDE-local work
   state.

### Long-Term: Kiln As The Place Where Work Happens

1. Operator Workspace becomes the default daily work environment.
   Users open Kiln to start tasks, run agents, inspect progress, approve
   external effects, review diffs, run verification, and close work with
   evidence.

2. Gateway becomes the app AI runtime.
   Developers run Kiln Gateway to power governed agents in their own apps,
   expose MCP/tools safely, manage tenants/channels, and audit AI work.

3. Harnesses become optional execution routes.
   Codex/Claude/OpenCode can still run as child routes, import sources,
   fallback providers, or remote adapters. They should not be required to get a
   good Kiln operator experience.

4. Native becomes justified only by desktop-specific value.
   Embedded browser takeover, OS notifications, tray/background operation,
   packaged installation, and high-density supervision can justify native. The
   native surface still consumes the same gateway contracts.

5. External observability becomes an export/import layer.
   LangSmith/OpenTelemetry/provider traces/hooks can feed evidence into Kiln
   and receive normalized events out. They should not replace Kiln's evidence
   plane.

## Open Questions For Ricardo

1. What should be the named primary product: "Kiln Operator Workspace",
   "Kiln Workbench", "Kiln Console", or something else?
2. Should GUI become the default `kiln` launch experience for humans, with CLI
   remaining automation-first?
3. How much should Kiln optimize for coding-agent workflows versus general
   governed-agent workflows in the first public story?
4. Should direct-provider execution be required before promoting any major
   managed-agent workflow as first-class?
5. What is the earliest acceptable IDE surface: read-only resource/diff
   explorer, approval panel, or full chat/work control?
6. Which app-runtime target is the public flagship: local developer Gateway,
   deployable YAML app Gateway, or embedded SDK/widget?
7. What is the security bar before exposing remote operator workspace features?
8. Should harness import/migration be a product feature or stay diagnostic/admin
   tooling?

## Docs Promotion Status

- `docs/architecture/execution-surfaces.md`
  Created. Canonical product/architecture contract for Kiln Operator Workspace
  and Kiln Gateway ownership.
- `docs/architecture/operator-workspace.md`
  Created. GUI/TUI/native/CLI/IDE view-state ownership, attention model,
  gateway target switcher, and resource inspector boundary.
- `docs/architecture/app-gateway-runtime.md`
  Created. App Gateway as app AI runtime, with tenant/app/session/tool/MCP
  ownership.
- `docs/roadmap/03-execution-surfaces.md`
  Created. Active implementation roadmap for shared home expansion, target
  switcher, resource inspector, and documentation closeout.
- `docs/guides/operator-workspace.md`
  Created. User-facing workflow guide: open Kiln, attach target, start work,
  supervise, approve, inspect, close out.
- `docs/guides/gateway-app-runtime.md`
  Created before this closeout and remains the developer guide for powering
  apps with governed agents through Kiln Gateway.
- Update `docs/research/README.md` to include this document after Ricardo
  Completed.

## Recommendation

Adopt the thesis now, but implement in small evidence-backed slices.

The next implementation work should not be "build more UI" in general. It
should be:

1. promote shared attention/work/resource view-state contracts;
2. create one coherent Operator Workspace home over those contracts;
3. make Gateway target identity explicit everywhere;
4. keep direct-provider managed execution on equal footing with harness
   adapters;
5. treat Codex/Claude/OpenCode as valuable adapters, never as Kiln's product
   center.

The long-term product should make the user feel: "Kiln is where my AI work is
understood, supervised, and finished." The long-term platform should make a
developer feel: "Kiln Gateway is the governed runtime I can trust inside my own
AI app."
