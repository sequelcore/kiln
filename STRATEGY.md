# Kiln Strategy
> Living long-term roadmap aligned to the canonical architecture.
> Last updated: 2026-04-18

## 1. Executive Thesis

Kiln's long-term position is now explicit:

- Kiln is a biocybernetic control plane for governed AI work
- Kiln is not an orchestration engine as its primary identity
- Kiln is not a biological system made literal
- Kiln is not constrained by backward-compatibility promises to its earlier framing

The system should be judged by how well it regulates work under uncertainty:

- what enters the system
- what context is exposed
- what safety posture is active
- how tasks are allocated and coordinated
- how failures are contained and recovered
- how adaptation happens without uncontrolled drift

Everything in this roadmap serves that doctrine.

## 2. Product Identity

### What Kiln is

Kiln is the regulatory layer that governs AI work across local tools, execution surfaces, memory, coordination, safety, and adaptation.

### What Kiln is not

- not a generic "multi-agent framework"
- not a wrapper that merely forwards prompts to providers
- not a collection of unrelated productivity features
- not a consumer app with architecture inherited accidentally from examples

### Product promise

Kiln should let an operator trust that the system can:

- admit only work it can govern
- expose only the context required for the current task
- coordinate multiple workers without losing control
- fail safely when uncertainty or risk rises
- recover statefully instead of starting from scratch
- improve by measured adaptation instead of ad hoc hacks

## 3. Strategic Laws

These are long-term constraints, not preferences.

1. No dead code.
2. No legacy compatibility layers kept only out of sentiment.
3. No redundant abstractions without active pressure from real use.
4. No cross-context leakage that weakens bounded contexts.
5. No silent fail-open behavior in safety-critical paths.
6. No undocumented control surface that outranks the canonical architecture.
7. No feature work that bypasses invariants for local convenience.
8. No roadmap item is complete until the old path is removed.

## 4. Architectural Horizon

Kiln should converge on these stable architectural pillars:

### 4.1 Control Admission

All work must enter through explicit admission control.

Target outcomes:

- `IngressGovernor` becomes the only legitimate entry regulator
- fast-path and slow-path handling are first-class
- unsafe or underspecified work is rejected or downgraded before execution begins

### 4.2 Context Governance

Context becomes a governed resource, not an accumulated transcript dump.

Target outcomes:

- `ContextGovernor` is responsible for sufficiency, cost, and safety of exposed context
- context slices are explicit, bounded, and revocable
- raw replay becomes an implementation detail, not the default operating model

### 4.3 Controlled Coordination

Coordination must be explicit, inspectable, and recoverable.

Target outcomes:

- `DemandAllocator`, `ChainGovernor`, and `TaskRegistry` become the canonical execution triad
- shared state moves through `CoordinationStore`, not implicit prompt inheritance
- parallel work is claimed, tracked, reconciled, and closed formally

### 4.4 Layered Memory

Memory must separate fast operational state from durable knowledge.

Target outcomes:

- working, episodic, and semantic layers are explicit
- reconsolidation requires provenance, confidence, and topic coherence
- mutation is revision-aware rather than append-only folklore

### 4.5 Safety as Kernel

Safety cannot remain an accessory subsystem.

Target outcomes:

- `SafetyKernel` is a hard gate, not a recommendation layer
- dangerous tool use is fail-closed by default
- policy, execution authority, and data boundaries converge into one regulatory model

### 4.6 Adaptive but Bounded Evolution

Kiln must improve from telemetry without becoming self-authoring chaos.

Target outcomes:

- `AdaptationEngine` only tunes within architectural law
- drift is detected via telemetry and invariants
- policy updates are reviewable and attributable

## 5. Scope Discipline

### Examples and consumers

Examples remain valid, but they are downstream expressions of the control plane. They do not define Kiln's identity.

That means:

- examples should consume the new control-plane concepts, not preserve obsolete ones
- examples are not a reason to keep old abstractions alive
- if an example depends on outdated framing, the example should be rewritten

### Internal versus external promises

There are effectively no external compatibility constraints strong enough to justify preserving obsolete architecture. Old structures can be removed once the canonical replacement exists.

## 6. Long-Term Roadmap

### Phase A - Documentation Reset

Objective:
Replace the old product narrative with a single coherent doctrine.

Required results:

- modular architecture docs become canonical
- research is synthesized at `docs/research/`
- root docs stop presenting Kiln as a meta-orchestrator
- obsolete architecture narrative is removed or reduced to temporary entrypoint scaffolding

Completion standard:

- no primary root doc contradicts the new identity
- research and architecture are navigable without legacy subtree dependency

### Phase B - Taxonomy and Boundary Cleanup

Objective:
Make names, modules, and responsibilities match the new doctrine.

Required results:

- canonical terminology used across code and docs
- obsolete names removed from active surfaces
- bounded contexts clarified
- overlapping modules identified for consolidation or deletion

Completion standard:

- one concept has one name
- one responsibility has one owner

### Phase C - Core Control-Plane Refactor

Objective:
Make the runtime conform to the architectural model instead of merely describing it.

Required results:

- explicit implementation paths for `IngressGovernor`, `ContextGovernor`, `DemandAllocator`, `ChainGovernor`, and `TaskRegistry`
- mode handling aligned to `NORMAL`, `SUPERVISED`, `DEGRADED`, `LOCKED`, and `RECOVERING`
- admission, execution, and recovery flows made explicit

Completion standard:

- canonical flows from the architecture docs map directly to runtime modules
- execution is explainable in terms of governors and controllers, not accidental call graphs

### Phase D - Safety and Authority Unification

Objective:
Collapse fragmented authority, policy, and risk handling into one coherent kernel.

Required results:

- dangerous command detection, tool authority handling, and data boundaries share one policy model
- safety decisions are observable and attributable
- runtime defaults are fail-closed where risk is ambiguous

Completion standard:

- no parallel authority model competes with the kernel
- no important execution path bypasses safety accounting

Current status (2026-04-18):

- functionally complete for the tool-authority foundation in runtime execution
  paths
- canonical authority semantics are in place and carried through tool execution,
  approval handling, and operator visibility projections
- canonical architectural reference: `docs/architecture/tool-execution.md`

### Phase E - Memory and Context Refactor

Objective:
Separate operational context from durable memory and make mutation disciplined.

Required results:

- memory layers are explicit in code
- topic-based reconsolidation becomes canonical
- context assembly is driven by policy, not transcript accumulation

Completion standard:

- retrieval, mutation, and exposure each have distinct responsibilities
- memory writes are revision-aware and auditable

### Phase F - Coordination Substrate

Objective:
Move multi-worker behavior from prompt convention to controlled shared-state coordination.

Required results:

- claims, latches, quorum signals, and handoffs live in `CoordinationStore`
- task lifecycle is explicit
- parallel work is bounded by budget and policy

Completion standard:

- coordination behavior can be inspected from shared state alone
- recovery does not depend on hidden prompt history

### Phase G - Operator Surfaces

Objective:
Make CLI and GUI behave as operator interfaces to the control plane. Per
ADR-005 (2026-04-17), the TUI is frozen and scheduled for deletion in
Phase I; GUI is the primary operator surface.

Required results:

- CLI and GUI expose system state, mode, safety posture, and task lifecycle clearly
- tooling stops pretending to be the product core
- user interaction maps cleanly to control-plane concepts
- TUI receives no feature work; critical bug fixes only
- a follow-up ADR defines the GUI stack, boundaries, and binding contract

Completion standard:

- the interface explains what the system is regulating, not just what command was run
- GUI reaches parity with former TUI scope, unblocking TUI deletion in Phase I

Progress (as of 2026-04-17):

- ADR-005 accepted — TUI frozen
- ADR-006 accepted — GUI stack decided
- `docs/roadmap/06-gui-phase-1-parity-checklist.md` accepted
- `packages/gui/` scaffold landed at commit `54d1d53` (React 19 + TanStack Router/Query + Zustand + Tailwind v4 + Vitest + ESLint 9); pre-spec UI archived under `.reference/`
- Runtime `gui-gateway` + `operator-gateway` and `kiln gui` CLI command in place
- `@kilnai/gateway-contracts` package extracted (commit `fbd18dc`); GUI and runtime now share neutral wire-format types; ESLint guard directs consumers there instead of `@kilnai/runtime`
- Playwright e2e harness added in `packages/gui/` (commit `ed6b59a`); one smoke test passing; fixture uses `node:http` mock gateway pending upgrade to real `gui-gateway`
- `d18a050` — `gui-gateway` statically mounts built GUI at `/gui/*` with SPA fallback; mount is skipped gracefully if `packages/gui/dist/` is absent.
- `defe8ad` — `kiln gui --dev|--prod` implemented with Vite child-process lifecycle, `--port/--gui-port/--open/--no-open` flags, and cross-platform browser opener.
- `cc105f9` — Playwright fixture upgraded to boot a real `gui-gateway` via Bun subprocess runner; Vite proxy reads `GUI_GATEWAY_PORT` env var.
- `6a4043d` — Pre-existing mock regression for `startOperatorGateway` rename fixed in CLI tests.
- ADR-006 scaffold follow-ups are complete. Only remaining work before TUI deletion is porting the 51 parity-checklist rows.
- `637b279` — Slice F (theming pipeline, parity §5 partial): three-theme system (`kiln-dark` default, `kiln-light`, system-follow), accessible radiogroup switcher on landing route, Zustand persist + pre-render guard, 20 semantic tokens wired through Tailwind v4 `@theme`, body-text contrast AAA both themes, Playwright verifies persistence. Rows 5.1, 5.1a, 5.1b, 5.2 ✅.
- `7903fb3` — Slice G (gateway transport, parity §6 in-scope): `GuiWsClient` with 30s heartbeat, 60s pong watchdog, exponential backoff (1s→30s ±20% jitter), bounded outbound queue, Zod-validated frames via `@kilnai/gateway-contracts`. `waitForGateway`, `stable-user-id` (localStorage), `useGuiWs` hook. Runtime gets pong response. Rows 6.1–6.6 ✅.
- `919ac91` — test(gui): transport parity coverage (unit + e2e).
- `bf00904` — fix(gui): e2e fixture port contention; per-worker fixture scope, runner binds port 0 and reports actual port, runtime `startGuiGateway` returns bound port, minimal `/gui/ws` welcome handler. 4/4 e2e green.
- `3f15b12` — feat(gateway): `GET /gui-api/sessions` + lifecycle frames (text_delta forwarding, clear removes runtime state, welcome/provider_changed payload extension, exec_confirmed, WS connection-count health aliases).
- `77399e9` — feat(gui): session-lifecycle Zustand store + WS state wiring.
- `e2ee165` — feat(gui): app shell, transcript, composer, session list, connection status, error banner; adds `react-markdown` + `remark-gfm`.
- `d21bca7` — test(gui): session-store + composer + transcript unit/component coverage.
- `070798b` — test(gui): e2e parity flows for rows 1.1–1.6.
- `c6c7d10` — docs(roadmap): flip rows to ✅. Rows landed: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 4.1, 4.4, 5.3, 5.5. Row 5.4 stayed ☐ (no syntax highlighting / progressive-markdown proof). Verified: typecheck, unit, lint, build, e2e 9/9 green.
- `0a7ace8` — feat(gateway): welcome frame carries grouped `GuiProviderDescriptor[]` metadata; `provider_changed` ack includes selected model.
- `3d7e599` — feat(gui): session store `switchProvider` + route mode (`user|auto|responding`) transitions.
- `b730d09` — feat(gui): provider picker (category-grouped, free badge, keyboard nav) + status pill + Ctrl/Cmd+P shortcut.
- `0bddfb0` — feat(gui): assistant message header shows routed provider · model from `done` frame.
- `28cc1d7` — test(gui): provider picker + session-store unit/component coverage.
- `0819e84` — test(gui): e2e flows for rows 2.1–2.5.
- `d6e0bba` — docs(roadmap): flip rows 2.1–2.5 to ✅. Verified: typecheck, unit, lint (warnings only), build, e2e 2× green. No new deps.
- Parity status: 29/51 rows ✅

Sequencing decision (2026-04-17):

The work ahead is ordered to maximize daily leverage and let real usage
inform architectural calls before those calls get locked in.

1. **Dogfood slice** ✅ (2026-04-17) — rows 3.7 (approval queue), 5.4 (markdown + syntax highlighting), 3.8 (tool call log), 3.9 (activity phase indicator). Shipped: `ApprovalQueue`, `ToolCallLog`, `ActivityPhaseIndicator` components; `tool_call_start`/`tool_call_result`/`activity_phase` frames added to contracts; gateway emits new frames; `react-syntax-highlighter` wired into ReactMarkdown code blocks; `activityPhase` derived from frame stream and replaces binary "thinking…" in Composer. Parity: 29/51 ✅. Bar 1 reached.
2. **Orchestrator refactor Slice O4** — decide and delete fate of Sequential/Supervisor/Swarm strategies. Deliberately sequenced after dogfood so the architectural call is informed by a week of using the tool we're designing around. Doctrine debt; must close before the GUI grows orchestrator surfaces.
3. **Finish GUI parity** (~3 more days) — remaining rows of §3 telemetry, §4 input polish, §5 remainder, §7 CLI flags. Unblocks TUI deletion.
4. **Config + Registries Surface ADR** — unify providers, credentials, MCP servers, skills, tools, models, domain packages, UI prefs behind one configuration story with one precedence model and one credential abstraction. Phase I work. See "Configuration scope" below.
5. **GUI orchestrator surfaces** — spawn teams, route across providers, inspect parallel agents. Net-new feature on top of O4. Bar 2 ("proper multi-provider dev team from the GUI").

Bar 1 ≠ Bar 2. "Develop Kiln from the GUI" (single agent) lands after step 1. "Run a proper multi-provider dev team from the GUI" requires steps 2, 4, 5 and is weeks of feature work beyond parity.

Configuration scope (to be captured in its own ADR before implementation):

- Providers + credentials (9 flows today: OAuth, subscription subprocess, API key, local URL) behind one credential store with per-provider adapters.
- MCP servers (endpoints, auth, enabled/disabled, per-context).
- Skills (registry source, capture toggles, generation policy).
- Tools (registry + enable/disable, approval policy per tool).
- Models (capability + pricing overrides).
- Domain packages (`kiln.yaml` loading, overrides, precedence).
- UI prefs (theme, plan-mode default) — migrates `tui.*` → neutral.
- Precedence explicitly documented: global `~/.config/kiln/` → workspace `.kiln/` → session overrides. Not three overlapping layers that drift.
- Registries collapsed: provider-registry, model-capability-registry, model-pricing, tool-registry consumed via one surface by runtime, CLI, and GUI. GUI's current `provider-metadata.ts` fork becomes obsolete.

### Phase H - Example and Consumer Realignment

Objective:
Rewrite examples and downstream consumers to express the new Kiln power.

Required results:

- examples use the control-plane vocabulary and flow model
- outdated demo patterns are deleted
- downstream apps inherit regulation, memory, safety, and coordination capabilities intentionally

Completion standard:

- examples teach the new system rather than memorializing the old one

### Phase I - Ruthless Cleanup

Objective:
Remove obsolete modules, duplicate paths, stale ADR assumptions, and dead documentation.

Required results:

- legacy abstractions deleted
- dead docs removed
- old names eradicated from primary paths

Completion standard:

- the repository reads like one architecture, not three generations stacked together

## 7. Execution Principles

Every implementation step should follow these rules:

1. Refactor by bounded context, not by scattered edits.
2. Prefer replacement over shims.
3. Delete obsolete paths in the same phase that replaces them.
4. Keep abstractions concrete until at least three real uses justify extraction.
5. Preserve a short causal chain from doctrine to module to runtime behavior.
6. If a module cannot be explained in the canonical vocabulary, it is suspect.

## 8. Success Criteria

Kiln reaches strategic coherence when:

- the repository describes one identity consistently
- architecture docs and runtime structure correspond directly
- consumers inherit the new doctrine naturally
- safety, context, coordination, and adaptation operate as one system
- obsolete code and obsolete narrative are both gone

## 9. Immediate Execution Priority

This section is a delivery queue, not a restatement of the long-term phase
order above.

1. Finish the remaining orchestrator cleanup after the O4 strategy cuts so
   export and ownership residue do not leak into the GUI surface.
2. Finish the remaining GUI parity checklist rows and reach GUI parity with the
   frozen TUI scope.
3. Delete the TUI in Phase I once GUI parity is complete and verified.
4. Write and accept the config and registries surface ADR before broader
   provider, MCP, skill, tool, and model-management surfaces are implemented.
5. Build GUI orchestrator surfaces only after the remaining orchestrator
   cleanup and the config ADR land.

This document is the strategic source of truth for long-term direction. Detailed execution belongs in the roadmap documents under `docs/roadmap/` and the modular architecture under `docs/architecture/`.
