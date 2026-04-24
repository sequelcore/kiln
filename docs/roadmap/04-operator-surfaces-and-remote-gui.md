# Operator Surfaces and Remote GUI Strategy

**Status:** Product architecture track  
**Owner:** Kiln runtime / GUI / operator surfaces  
**Depends on:** `docs/adr/ADR-006-gui-stack-and-binding-contract.md`, `docs/roadmap/01-gui-phase-1-parity-checklist.md`, `docs/roadmap/03-shared-tool-surface-unification.md`  
**Related:** `STRATEGY.md`, `docs/roadmap/README.md`

## Purpose

Define Kiln's long-term human operator surface strategy without coupling the
runtime to one UI shell.

The category signal is clear: serious AI coding products are not converging on
one interface. They are converging on one runtime/session/tool substrate with
multiple human-facing surfaces:

- terminal and CLI for power-user control, automation, SSH, and worktrees
- IDE/editor surfaces for review, navigation, inline diffs, and high-context
  coding loops
- local web or desktop surfaces for monitoring, approvals, session management,
  and multi-agent supervision
- cloud/background surfaces for long-running or parallel work
- mobile or lightweight review surfaces for remote approvals and progress
  checks

Kiln should follow that architecture: one governed runtime, multiple replaceable
operator surfaces.

## Product Decision

Kiln remains runtime/headless first.

The local GUI stays web-first and gateway-backed. It is not a temporary mistake
to replace with a monolithic desktop app. It is the correct first operator
surface because it preserves:

- one runtime contract
- fast local iteration
- browser accessibility
- straightforward remote deployment later
- a thin path to Tauri without changing core/runtime semantics

Desktop is deferred, not rejected. If native lifecycle, tray/background mode,
notifications, packaged installation, or multi-window OS integration become
important enough, Kiln should add a thin Tauri wrapper over the same GUI and
gateway contract.

Electron remains rejected unless future evidence changes the product category
materially. Kiln is a governed control plane, not an editor fork. Cursor and
Windsurf justify desktop depth because they own the editor surface; that does
not imply Kiln should fork its runtime into a desktop shell.

## Boundary

This roadmap covers where humans operate Kiln work.

It does not redefine how tools execute. Tool execution, provider integration,
and MCP convergence are tracked in
`docs/roadmap/03-shared-tool-surface-unification.md`.

Correct separation:

- `03`: how agents/providers/wrappers access governed Kiln tools
- `04`: how humans supervise sessions, approvals, diffs, telemetry, and replay
  across surfaces

## Target Surface Model

```text
Kiln core/runtime
  -> canonical provider-agnostic sessions, events, tools, policy, audit, replay
  -> gateway HTTP/WS internal operator contract
  -> MCP external tool contract
  -> operator surfaces:
       local web GUI
       CLI / TUI
       IDE extension
       future Tauri wrapper
       future remote/cloud dashboard
```

No surface owns control-plane logic. If a behavior affects session semantics,
tool authority, provider identity, cost, memory, replay, or audit, it belongs in
core/runtime and is projected through stable contracts.

Session identity is also shared infrastructure. A Kiln session is not owned by
the selected provider; provider/model selection is next-turn routing state, and
provider-native thread IDs are nested provider-thread metadata. See
`docs/architecture/session-model.md`.

For operator surfaces, session selection means activation, not preview. When a
surface selects a prior Kiln session, that session's transcript should become
the visible conversation and the next user turn should continue that same
canonical runtime session. Separate "preview" or "set resume target" concepts
are only acceptable if a future surface explicitly needs a read-only browser
mode.

## Current Agent Invocation Status

Kiln does not yet have a first-class managed agent invocation model in the
operator surface contract.

Current support:

- `kiln run --agent <name>` can select an agent profile and append its
  instructions/model preference to a CLI run.
- `kiln run --workers N` can launch parallel isolated workers for the same
  task.
- provider selection routes the next turn through a provider/model.

Those capabilities are not the same as an invokable agent substrate. The GUI,
TUI, gateway contracts, and session replay model do not yet expose canonical
agent definitions, agent lifecycle events, agent queues, delegated-task
records, child-session relationships, or agent-to-agent handoff semantics.

Future agent invocation must be built on the same session event/replay
backbone as tools, approvals, diffs, and provider telemetry. It must not be
implemented as GUI-only state, wrapper-specific folklore, or a provider-owned
session namespace.

## Market / User Signals

Recent product and user research supports this direction:

- Claude Code, Cursor, VS Code/Copilot, Devin, OpenCode, Continue, Cline, Roo,
  and Zed are all moving toward multiple surfaces over shared agent/session
  substrates.
- Power users still rely heavily on terminal and worktree workflows.
- The editor remains the highest-density review and navigation surface for
  coding changes.
- Cloud/background agents are gaining traction for async, long-running, or
  parallelizable tasks.
- Desktop shells add value through lifecycle, notifications, multi-window
  review, and OS integration, but are not the core architectural value.
- Users complain most about hidden execution, runaway loops, unclear tool logs,
  poor diffs, bad rollback, confusing provider identity, and weak session
  visibility.

Implication:

Kiln's competitive advantage is governed multi-surface supervision, not a
single prettier shell.

## Strategic Priorities

### 1. Stabilize the local web GUI as the first operator surface

The GUI remains the primary Phase 1 parity target and TUI deletion gate.

Required focus:

- session transcript fidelity
- provider-agnostic session history and resume
- selected-session runtime routing, so sidebar/history selection changes the
  active canonical conversation rather than only provider-native continuity
- shared shadcn/Base UI component baseline mapped onto Kiln semantic tokens,
  so GUI polish happens through one design system instead of ad hoc styling
- dense operator-console session rail with grouped canonical sessions, compact
  provider glyphs, stable cost/date display, and subtle continuation state
- provider/model identity
- cost and token telemetry
- tool-call timeline
- changed-file visibility
- approval queue clarity
- runtime continuity and resume visibility
- keyboard-first operation

Current local GUI shell contract:

- left rail: operator mode navigation and collapse state
- mode panel: the active mode's list, with Sessions implemented first
- chat top bar: session title/state, turns, tokens, cost, provider/model route,
  connection, and primary session actions
- inspector: deeper continuity, field, changed-file, and future diagnostic
  details; no duplicate cost/turn/provider summary
- composer: compact framed input with slash command and file affordances

Native browser-window lifecycle bugs on Windows are product annoyances, not
architecture blockers. They should be handled safely, but they should not
consume roadmap priority once the GUI can be closed through documented
fallbacks such as terminal interrupt, `--no-open`, or a future Tauri wrapper.

### 2. Make supervision a first-class product model

Kiln should show work as a governed timeline, not only as chat text.

Required operator evidence:

- tool call start/result events
- tool input/output display
- approval requested/approved/rejected transitions
- changed files linked to the relevant turn
- diffs where available
- provider/model/billing identity per turn
- provider-thread metadata where native resume exists
- cost and token deltas
- errors and retry/fallback decisions
- replayable session events

This evidence should be emitted by runtime/session contracts and consumed by
every surface. The GUI is only the first projection.

### 2a. Grow the left rail into real supervision modes

The local GUI shell now uses a left rail for operator modes. `Sessions`,
`Changed files`, `Approvals`, and a metadata-first `Workspace` panel are now
implemented from governed gateway/session data. Repository tree navigation
inside `Workspace` remains gated until a canonical workspace-tree contract
exists.

Target modes:

- `Sessions`: canonical Kiln session history, transcript loading, and active
  continuation state.
- `Workspace`: repository tree and file navigation for the active working
  directory.
- `Changed files`: session-scoped file changes, diff entrypoints, and review
  state.
- `Approvals`: pending approval requests, policy context, approve/deny actions,
  and links back to the originating turn/tool call.

Rules:

- rail modes are projections of core/runtime events and gateway contracts, not
  independent GUI state models.
- collapse/expand behavior belongs to the operator shell and should be
  preserved across future mode panels.
- disabled rail buttons are acceptable placeholders only while an underlying
  panel lacks real data.
- no panel may invent provider routing, tool authority, approval state, file
  changes, or session identity locally.

### 2b. Command and input model

The GUI needs two command surfaces with different jobs:

- global command palette: opened by `Ctrl+K` or `Cmd+K`; used for navigation,
  mode switching, and operator actions that are not tied to a draft message
- composer command surface: opened by `/` in an empty composer or by the
  composer `/command` affordance; anchored near the composer and used for
  message-scoped commands

Rules:

- slash command handling belongs to the composer flow, not to a detached modal
  that obscures the transcript.
- command items should execute through the same action contracts regardless of
  whether they are launched globally or from the composer.
- the composer should stay compact and padded, with controls in a bottom rail
  rather than scattered across competing headers.
- message composition must not duplicate session summary telemetry already
  owned by the chat top bar.

### 3. Prioritize IDE extension before native desktop shell

An IDE extension is more urgent than Tauri if the goal is adoption by serious
coding users.

Rationale:

- code review and navigation happen in editors
- users need inline diffs and file context
- the editor is the natural surface for approving or rejecting code changes
- IDE integration can consume the same gateway/session contracts without
  owning runtime logic

The extension should not become a separate runtime. It should operate as a
client of the Kiln gateway and/or MCP surfaces.

### 4. Preserve CLI / TUI semantics for power users

Even if the old TUI is deleted after GUI parity, Kiln still needs a strong
terminal story.

Required properties:

- scriptable entrypoints
- clear logs
- headless execution
- worktree-friendly operation
- provider selection
- session resume/handoff
- test/build automation

The terminal surface should be treated as a durable operator mode, not as a
legacy artifact.

### 5. Add Tauri only as a thin shell

Tauri becomes appropriate when there is demonstrated product value in:

- native window lifecycle
- tray/background daemon behavior
- native notifications
- packaged install/update flow
- multi-window desktop review
- OS credential integration
- enterprise device-management expectations

Rules:

- Tauri must wrap the existing GUI and gateway contract
- no in-process GUI imports from runtime/core
- no second session state model
- no desktop-only execution policy

Completion standard:

- the Tauri app can be removed without changing core/runtime semantics

### 6. Remote GUI and cloud dashboard are security-hardening tracks

The web-first gateway model makes remote GUI possible, but the current local
GUI is not safe to expose directly to the internet.

A remote/cloud GUI requires:

- HTTPS/TLS
- authentication for GUI HTTP routes and WebSocket
- session/user isolation
- origin and CSRF protection
- provider credential isolation
- rate limits and abuse protection
- remote-safe tool authority profiles
- audit logs and replay
- explicit deployer warnings for shell/filesystem tools

Remote GUI should reuse the same gateway/operator contract. It should not
introduce a separate cloud runtime unless a future ADR explicitly accepts that
tradeoff.

## Implementation Phases

### Phase 1. Local GUI parity closeout

Objective:
Finish the operational GUI parity gate without expanding scope.

Required results:

- manual GUI walkthrough recorded
- managed-window limitations documented if they remain
- TUI deletion gate reassessed from real parity evidence

Completion standard:

- GUI parity is validated as an operator surface, not just as passing tests

### Phase 2. Governed event timeline

Objective:
Make session supervision consistent across surfaces.

Required results:

- runtime emits stable event shapes for tool calls, approvals, diffs/file
  changes, provider identity, token/cost deltas, and errors
- GUI renders those events as a coherent timeline
- GUI left rail modes for changed files and approvals are backed by those
  events rather than by local-only UI state
- event records are suitable for replay and future IDE/cloud projection

Completion standard:

- a user can answer "what happened, why, through which provider, and what
  changed?" from the session record

Scout-backed sequencing rule:

Do not build real `Workspace`, `Changed files`, `Approvals`, or future
invokable-agent panels before the canonical session event/replay backbone
exists. Without that backbone, each surface would infer state from partial
stores such as transcript JSONL, event-bus history, approval memory, session
metadata, exact-artifact breadcrumbs, or GUI-local state. That would create
drift and violate the control-plane boundary.

The correct sequence is:

1. define the canonical session event envelope
2. persist the event stream as durable replay data
3. emit structured runtime slices from orchestration/tool/approval paths
4. project those slices through gateway contracts
5. consume the projection in GUI/TUI/IDE surfaces
6. add workspace, changed-files, approvals, diffs, and agent panels only when
   backed by canonical events

### Phase 3. IDE extension design

Objective:
Design the editor surface as a client of Kiln contracts.

Required results:

- choose the first IDE target
- define gateway/MCP usage boundaries
- map session timeline, approvals, diffs, and provider identity into editor UI
- avoid editor-owned runtime state

Completion standard:

- IDE integration has a concrete implementation plan without duplicating
  control-plane logic

### Phase 4. Remote GUI hardening design

Objective:
Turn "deployable gateway GUI" from an architectural possibility into a safe
product mode.

Required results:

- authentication model
- authorization and tool-authority profile for remote operation
- user/session isolation model
- deployment guidance
- threat model for remote shell/filesystem tools

Completion standard:

- Kiln can document when remote GUI is safe, unsafe, and unsupported

### Phase 5. Tauri wrapper decision gate

Objective:
Decide whether native desktop packaging is justified by real user evidence.

Inputs:

- user interviews
- telemetry around GUI launch/close pain
- demand for notifications/background/tray
- IDE extension adoption and gaps
- remote GUI adoption and gaps

Completion standard:

- Tauri is either accepted as a thin wrapper phase or explicitly deferred with
  documented evidence

## Concrete Code / Product Slices

### Slice A. Surface strategy documentation

Primary files:

- `docs/roadmap/04-operator-surfaces-and-remote-gui.md`
- `docs/roadmap/README.md`
- `docs/adr/ADR-006-gui-stack-and-binding-contract.md`

Deliverables:

- accepted roadmap split between tool execution and operator surfaces
- clear guidance that web-first remains the primary local GUI strategy
- Tauri and remote GUI documented as later gates

### Slice B. Session timeline contract

Primary files:

- `packages/core/src/events/`
- `packages/gateway-contracts/src/frames.ts`
- `packages/runtime/src/session/`
- `packages/runtime/src/gateway/gui-gateway.ts`
- `packages/cli/src/wrapper/session-store.ts`
- `packages/gui/src/lib/session-store.ts`

Deliverables:

- canonical session event envelope with replay-safe IDs
- durable session event stream persisted with transcript metadata
- stable event types for turns, assistant text, tool calls, tool results,
  approvals, file changes, provider/model/billing identity, token/cost deltas,
  continuity decisions, errors, and replay metadata
- gateway projection of the canonical event stream without local inference
- GUI timeline rendering model that consumes the projection
- event-backed left rail projections for changed files and approvals
- inspector diagnostics derived from canonical timeline entries rather than
  parallel GUI-only caches
- tests for event projection

Non-goals:

- no workspace tree contract in this slice
- no structured diff rendering in this slice
- no real approvals panel in this slice
- no invokable-agent UI in this slice

### Slice B2. Left rail mode panels

Primary files:

- `packages/gui/src/components/app-shell.tsx`
- future panel components under `packages/gui/src/components/`
- `packages/gateway-contracts/src/`
- runtime session/event projection modules

Deliverables:

- workspace panel reads active working directory/file tree through a governed
  gateway contract
- changed-files panel renders session-scoped file changes and diff entrypoints
- approvals panel renders pending approvals with approve/deny actions tied to
  the originating tool call
- rail counts come from canonical state, not duplicated GUI counters
- collapse/expand behavior remains shell-owned and reusable across modes

Gate:

This slice starts only after Slice B exposes canonical event-backed
projections. Disabled placeholders are acceptable before then; fake panels with
local-only inferred state are not.

Current implementation status:

- `Changed files` now exists as a real left-rail mode backed by canonical
  timeline projections.
- canonical file-change events now preserve line deltas end to end, and the
  `Changed files` panel supports per-file review without inventing diff hunks
  that the runtime does not emit yet.
- `Approvals` now exists as a real left-rail mode backed by canonical
  approval-request/approval-resolved events, with explicit approve/deny
  actions.
- `Workspace` now exists as a real left-rail mode backed by governed gateway
  metadata (`workingDirectory`, `domainLabel`, and selected-session ledger
  fields). Repository tree browsing remains gated until a canonical workspace
  tree contract is added.

### Slice B3. Chat input and command polish

Primary files:

- `packages/gui/src/components/app-shell.tsx`
- `packages/gui/src/components/composer.tsx`
- `packages/gui/src/components/command-palette.tsx`
- GUI tests under `packages/gui/tests/`

Deliverables:

- global command palette and composer slash commands remain separate surfaces
  with one shared command model
- composer has stable padding, bottom action rail, keyboard behavior, and
  route visibility
- chat top bar owns summary metrics while inspector owns detailed diagnostics
- tests cover slash command opening, global command opening, and inspector
  summary de-duplication

### Slice B4. Future agent invocation model

Primary files:

- future contract modules under `packages/core/src/` and
  `packages/gateway-contracts/src/`
- future runtime/session modules under `packages/runtime/src/session/`
- future GUI/TUI/IDE projection components
- future architecture doc or ADR if the invocation semantics cross current
  bounded contexts

Deliverables:

- canonical agent definition and invocation request shape
- agent lifecycle events tied to the parent Kiln session
- delegated-task records and child-session or child-turn relationship rules
- queue/progress/error/cancel semantics
- provider/model/tool authority inherited through explicit policy, not hidden
  wrapper behavior
- GUI/TUI/IDE projections that consume the same event stream

Gate:

This is not active until the governed event/replay backbone exists. Agent
profile selection via `kiln run --agent` remains a CLI run configuration
feature, not a managed invokable-agent surface.

### Slice C. Remote GUI threat model

Primary files:

- future ADR under `docs/adr/`
- `docs/guides/`
- gateway auth/runtime policy modules

Deliverables:

- explicit security requirements before internet exposure
- deployer guidance
- remote-safe authority profile proposal

### Slice D. IDE extension planning

Primary files:

- future roadmap or ADR if accepted
- gateway contract docs
- MCP docs

Deliverables:

- first IDE target selection
- minimal feature map
- no-runtime-duplication rule

## Verification

This roadmap is product/architecture heavy. Verification is not only unit
tests.

Required evidence by phase:

- passing typecheck and focused tests for every contract change
- GUI manual walkthrough for local surface parity
- security review before remote exposure
- user validation before Tauri prioritization
- IDE prototype review before committing to broad editor support

## Rules

- No UI surface may import core/runtime implementation code directly.
- No surface may own provider routing, tool authority, cost semantics, memory,
  replay, or audit.
- No native desktop wrapper before a thin-shell design is accepted.
- No public remote GUI guidance without auth, isolation, and tool-authority
  warnings.
- No IDE extension runtime fork.

## Exit Criteria

This roadmap is complete when:

- local GUI is validated as the first operator surface
- session supervision events are stable and reusable
- IDE extension has an accepted plan or deliberate deferral
- remote GUI has a documented security model
- Tauri has an evidence-based decision gate
- Kiln's human surfaces are clients of one runtime, not competing runtimes
