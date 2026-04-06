# Phase 7 Implementation Plan: Kiln TUI as Interface Adapter

> Generated: 2026-04-01. Updated: 2026-04-03.
> Sources: local Kiln architecture scout + Phase 7 roadmap decision + landed TUI changelog/ADR updates.

## Status Snapshot

As of `2026-04-03`, the original implementation plan is partially completed and
should now be read as an architectural boundary document plus remaining-scope
checklist, not as a "Phase 7 has barely started" snapshot.

Landed work:

- `packages/tui` exists as a dedicated package boundary
- root workspace wiring includes `@kilnai/tui`
- `packages/cli/src/commands/run.ts` has been thinned by extracting:
  - `packages/cli/src/application/session-report.ts`
  - `packages/cli/src/application/session-resume.ts`
  - `packages/cli/src/application/session-hooks.ts`
  - `packages/cli/src/application/run-session.ts`

- OpenTUI-based conversation shell shipped
- TUI gateway integration shipped through the in-process WebSocket gateway
- native session persistence, `/clear`, provider picker, themes, activity bar,
  routing labels, and budget panel shipped
- interactive `kiln` now launches the TUI by default
- session history browser in sidebar with keyboard navigation
- Enter key shows selected session details in command bar
- Enter again triggers resume of selected session via session manager
- **approval queue in sidebar with keyboard controls** — press 'a' to approve,
  'd' to reject; WebSocket frame flow end-to-end via event bus

Not landed yet:

- diff/change visibility panel
- OpenKiln-branded/channel-aware variant
- Phase 7 closeout and alignment of this plan's sub-phase names with the
  roadmap/changelog record

This document remains the implementation boundary spec for the remaining Phase 7
work and should be interpreted alongside `STRATEGY.md`, `docs/changelog.md`,
and `docs/adr/ADR-002-tui-gateway-architecture.md`.

## Objective

Phase 7 introduces Kiln TUI as the primary operator surface for Kiln without
creating a second application core. The TUI must be a terminal interface
adapter over existing Kiln application services, session contracts, and event
streams.

This phase must satisfy the following:

- Keep orchestration logic in existing `core`, `runtime`, and `cli` layers
- Treat the TUI as presentation + input dispatch only
- Reuse existing session, transcript, approval, and event contracts where possible
- Avoid duplicating runtime models inside a terminal-specific package
- Produce one coherent terminal product with visible routing, approvals, diffs,
  cost, and resume state

This plan assumes the stack decision remains:

- `Ink` + `@inkjs/ui` for terminal rendering
- `React` composition model
- reuse of `@kilnai/react` only where it is a clean fit

---

## 1. Scout Findings

### Existing contracts that the TUI should reuse

**Canonical session contract already exists**

- `packages/cli/src/wrapper/session.ts`
- `IKilnSession`
- `SessionEvent`
- `SessionCapabilities`
- `KilnPermissionPolicy`

This is already the correct abstraction boundary for backend sessions. The TUI
must not introduce a second session protocol.

**Application orchestration already exists**

- `packages/cli/src/commands/run.ts`
- `packages/cli/src/wrapper/session-manager.ts`
- `packages/cli/src/wrapper/session-registry.ts`

These files already own:

- provider selection
- permission translation
- session startup
- report generation
- transcript persistence
- verification handoff

The TUI must call into these capabilities or a refactored application layer
that contains them. It must not reimplement them.

**Session persistence already exists**

- `packages/cli/src/wrapper/session-store.ts`

This already provides:

- session list / last / lookup
- transcript storage
- persisted session metadata

The TUI should use this for session browsing and resume. Do not create a
separate TUI-only persistence format.

**Runtime session/event concepts already exist**

- `packages/runtime/src/session/session-registry.ts`
- `packages/core/src/events/event-bus.ts`
- `packages/sdk/src/types.ts`

These already define:

- session lifecycle
- approval events
- tool events
- cost events
- phase events

The TUI should subscribe to these concepts, not invent its own competing event
taxonomy.

**React-facing SDK already exists**

- `packages/sdk/src/index.ts`
- `packages/sdk/src/types.ts`

This provides:

- provider wiring
- event hooks
- chat hooks
- approval hook
- API/SSE clients

This is useful, but it must be applied selectively. The TUI should reuse stable
hooks and transport clients where they fit cleanly. It should not force terminal
concerns into browser-oriented abstractions.

### Architectural conclusion from the scout

Kiln already has enough application and persistence structure to support a TUI.
The main architectural risk is not missing infrastructure. The risk is letting
the TUI package accumulate runtime logic and become a parallel system.

---

## 2. Architectural Position

### What the TUI is

Kiln TUI is an **interface adapter**.

It is responsible for:

- rendering session state
- rendering event streams
- rendering approvals, routing state, cost, diffs, and history
- collecting user intent from keyboard input
- dispatching commands to existing application services

### What the TUI is not

Kiln TUI is **not**:

- a bounded context with its own business rules
- a second orchestrator
- a second session manager
- a second approval engine
- a second transcript/persistence layer
- a place for backend-specific permission translation

### Clean Architecture placement

```text
@kilnai/core      -> entities, domain interfaces, domain events
@kilnai/runtime   -> runtime use cases, event emission, session lifecycle
@kilnai/cli       -> subprocess orchestration, registry, persistence, reports
@kilnai/tui       -> terminal presentation and input adapter
```

The dependency direction must remain inward:

- `@kilnai/tui` may depend on `@kilnai/cli`, `@kilnai/runtime`, and `@kilnai/core`
- `@kilnai/core`, `@kilnai/runtime`, and `@kilnai/cli` must not depend on `@kilnai/tui`

---

## 3. Package Boundary Decision

### Recommended package

Create:

- `packages/tui` → `@kilnai/tui`

### Why a dedicated package is correct

- separates terminal concerns from browser Studio concerns
- avoids polluting `@kilnai/cli` with rendering logic
- keeps terminal rendering isolated from runtime orchestration
- allows independent testing of terminal UI composition

### Why Studio is not the implementation path

Studio is a browser dev UI:

- `packages/studio`

It is useful for diagnostics and dev tooling, but it is not the operator-facing
terminal surface. Do not build the TUI in Studio and later "port" it. That
would create redundancy and legacy code.

---

## 4. Allowed Responsibilities in `@kilnai/tui`

`@kilnai/tui` may contain:

- app shell and terminal layout
- presenter/view-model mapping
- keyboard shortcut routing
- focus management
- terminal rendering components
- event stream subscription and formatting
- session browser UI
- approval queue UI
- diff summary UI
- routing and budget UI

It may define:

- screen-local state
- focus state
- presentational formatting helpers
- terminal-only composition primitives

---

## 5. Forbidden Responsibilities in `@kilnai/tui`

`@kilnai/tui` must not contain:

- provider selection rules
- permission translation logic
- sandbox policy logic
- resume semantics
- transcript storage implementation
- approval decision policy
- safety pipeline logic
- orchestration state machine logic
- backend-specific command construction

If any of these are needed by the TUI, extract them into `cli` or `runtime`
first and consume them from there.

---

## 6. Required Shared Contracts

Before the TUI grows, it should rely on explicit contracts for the following:

### Session summary

Derived from existing persisted meta:

- session id
- provider/backend
- task
- timestamps
- tool count
- turn depth
- cost

Source today:

- `packages/cli/src/wrapper/session-store.ts`

### Transcript line

Derived from existing transcript store:

- sequence
- timestamp
- type
- payload

Source today:

- `packages/cli/src/wrapper/session-store.ts`

### Session live event

Use existing event concepts:

- phase changes
- tool calls/results
- approval requested/received
- cost updates
- errors

Source today:

- `packages/core/src/events/event-bus.ts`
- `packages/sdk/src/types.ts`
- `packages/cli/src/wrapper/session.ts`

### Backend health and routing state

Derived from:

- `packages/cli/src/wrapper/session-registry.ts`

This should be surfaced as a presentation contract instead of recomputed in the
TUI from raw provider data.

### Approval queue state

Derived from:

- `packages/core` event types
- runtime approval/session flow

The TUI must render approval state. It must not define approval semantics.

---

## 7. MVP Scope

Phase 7 MVP should ship only the shell needed to validate the product
direction.

### Required screens/panels

1. **Conversation panel**
   - user/assistant/system messages
   - current phase
   - active stream state

2. **Status bar**
   - active backend
   - sandbox mode
   - approval mode
   - cwd/project
   - session id

3. **Approval queue**
   - pending approvals
   - allow once
   - allow for session
   - deny

4. **Routing panel**
   - selected backend
   - fallback order
   - health/suppression state
   - routing rationale

5. **Diff/change panel**
   - changed files this turn
   - additions/deletions
   - risk markers

6. **Budget panel**
   - session cost
   - token usage
   - per-provider summary where available

7. **Session browser**
   - recent sessions
   - resume entry
   - persisted task summary

### Explicitly not in MVP

- swarm visualization beyond basic status
- split-pane charts
- full benchmark harness integration
- OpenKiln branding variant
- speculative plugin APIs
- terminal theming system beyond essentials

---

## 8. Internal Structure for `packages/tui`

Recommended initial structure:

```text
packages/tui/
  src/
    app/
      tui-app.tsx
      routes.ts
    components/
      conversation-pane.tsx
      status-bar.tsx
      approval-queue.tsx
      routing-panel.tsx
      diff-panel.tsx
      budget-panel.tsx
      session-browser.tsx
    presenters/
      session-presenter.ts
      event-presenter.ts
      transcript-presenter.ts
      routing-presenter.ts
    adapters/
      session-service.ts
      transcript-service.ts
      event-stream.ts
    state/
      tui-state.ts
      focus-state.ts
    index.ts
```

### Design rule

- `components/` render only presentation models
- `presenters/` convert application data into display-ready shapes
- `adapters/` call into existing `cli`/`runtime` capabilities
- `state/` owns local UI state only

Do not let components import raw subprocess/session internals directly.

---

## 9. Refactoring Needed Before or During Phase 7

The scout suggests some logic in `packages/cli/src/commands/run.ts` is too
command-centric to cleanly power both CLI and TUI.

### Recommended extraction targets

Extract from `run.ts` into reusable application services:

- run session orchestration
- live event forwarding
- transcript write lifecycle
- session report building
- resume lookup

### Extraction status on 2026-04-01

Completed:

- session report/eval formatting
- session resume lookup
- session hook orchestration
- provider execution/session runner

Pending:

- transcript/meta persistence lifecycle
- report assembly finalization if further thinning is desired

This should likely become a dedicated CLI application service, for example
under:

- `packages/cli/src/application/`

The goal is not abstraction for its own sake. The goal is to avoid duplicating
`run.ts` behavior in a TUI-specific codepath.

---

## 10. Rejected Approaches

### A. Build the TUI in Studio first

Rejected because:

- Studio is browser-only
- would create disposable code or porting work
- encourages duplicated presentation models

### B. Put TUI rendering directly into `@kilnai/cli`

Rejected because:

- mixes command orchestration with interface concerns
- increases coupling
- makes future testing and reuse harder

### C. Create a TUI-specific session model

Rejected because:

- duplicates existing session contracts
- creates drift between CLI and TUI behavior
- violates no-redundancy and clean-boundary goals

### D. Treat TUI as a new domain/bounded context

Rejected because:

- TUI is not business logic
- terminal rendering is an interface concern, not a domain concern

---

## 11. Ordered Implementation Plan

### 7a. Package scaffold and boundary extraction

**Goal:** create `packages/tui` and extract reusable session-run application
services from `packages/cli/src/commands/run.ts`.

**Files likely touched:**

- new `packages/tui/*`
- `packages/cli/src/commands/run.ts`
- new `packages/cli/src/application/*`

**Recommended order inside 7a:**

1. Extract report/eval formatting helpers from `run.ts`
2. Extract session history/resume helpers from `run.ts`
3. Extract session execution orchestration into a reusable runner service
4. Leave `run.ts` as a thin command adapter over application services

### 7b. Conversation shell

**Goal:** terminal app shell with conversation pane + status bar.

### 7c. Approval queue

**Goal:** render approval state and send approval commands through existing
application flow.

### 7d. Routing + budget visibility

**Goal:** show routing decisions, provider health, and cost state.

### 7e. Diff/change visibility

**Goal:** show files changed this turn/session using persisted transcript/meta
and session reporting contracts.

### 7f. Resume and session browser

**Goal:** browse and resume persisted sessions using `SessionStore` and
`TranscriptStore`.

### 7g. Full command integration

**Goal:** `kiln` launches the TUI by default when interactive, while preserving
scriptable CLI flows.

---

## 12. Verification Criteria

Phase 7 is done when:

- `@kilnai/tui` exists as a dedicated package
- no orchestration logic has been duplicated into the TUI package
- provider selection, resume logic, and permission translation remain outside
  the TUI
- TUI renders conversation, approvals, routing, diffs, budget, and sessions
- TUI can resume persisted work using the same session artifacts as CLI flows
- architecture review confirms TUI is an adapter, not a second runtime

---

## 13. Non-Negotiable Rules for Workers

- Do not move domain logic into the TUI package
- Do not add temporary browser mocks inside Studio as implementation artifacts
- Do not create a second transcript/session format
- Do not create backend-specific hacks in TUI components
- Do not duplicate existing event or session types under new names
- If TUI needs logic that currently lives in a command file, extract it into an
  application service first

---

*Phase 7 is successful when Kiln gains a first-class terminal product surface
without compromising DDD boundaries, Clean Architecture, or the no-redundancy
standard.*
