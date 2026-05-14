# ADR-006: GUI stack, boundaries, and binding contract

**Status:** Accepted (2026-04-17)
**Date:** 2026-04-17
**Author:** Ricardo Armenta
**Scope:** new `packages/gui/`, `packages/runtime/src/gateway/`, `packages/cli/` (new `kiln gui` command), `STRATEGY.md` Phase G (Operator Surfaces)
**Supersedes:** none
**Follows:** ADR-005 (Freeze TUI, Prioritize GUI)

**2026-05-14 amendment:** This ADR remains authoritative for the web GUI stack
and gateway binding contract. Its Electron rejection applies to using Electron
as the general GUI substrate. Electron is accepted only for the first-class
native operator surface implemented in `@kilnai/native` and for the proven
Electron `WebContentsView` embedded browser-host capability. Stable native
doctrine lives in
`docs/architecture/operator-surfaces.md` and
`docs/architecture/runtime-surfaces.md`; active browser product work remains in
`docs/roadmap/04-embedded-browser-operator-surface.md`.

---

## Context

ADR-005 accepted a freeze on `@kilnai/tui` and committed to a new GUI surface as the primary operator interface in Phase G of the roadmap. It explicitly deferred the stack, boundaries, and binding contract to this follow-up ADR. ADR-005 established three hard constraints this ADR must honor:

1. The GUI binds to the same `@kilnai/core` + `@kilnai/runtime` APIs as CLI and TUI. No parallel control plane.
2. The GUI becomes the primary operator surface in Phase G.
3. The GUI must reach functional parity with the current TUI scope so product focus can move to the GUI while TUI remains frozen maintenance.

Additional context that shapes the decision:

- **Existing binding precedent.** `packages/runtime/src/gateway/tui-gateway.ts` already exposes runtime capabilities over Hono HTTP + WebSocket to the TUI. The gateway pattern is proven, in use, and is the natural reuse target. Re-inventing a GUI-only binding would violate ADR-005 §Decision #1.
- **Sequel stack standards.** Ricardo's global standards pin the frontend stack: React 19, TypeScript 5.6+, Bun, Vite 7+, TanStack family, Tailwind v4, shadcn/ui, Vitest. A GUI package must not deviate without cause.
- **Headless-core invariant.** `docs/architecture/invariants.md` requires surfaces to be replaceable over stable core contracts. Any binding pattern that couples core internals to a specific GUI rendering tree would break this invariant.
- **Operator scope today.** Single operator (Ricardo). No multi-user, no remote operation, no authentication story is needed in Phase 1. ADR-005 §Honest caveats explicitly does not ask for any of these yet.
- **Accessibility tailwind.** ADR-005 §Context cited WCAG conformance as a justification for choosing GUI over TUI. Failing to bake WCAG 2.1 AA in from day one would undercut the stated rationale.

The decisions below resolve seven questions left open by ADR-005: runtime substrate, framework stack, binding contract, package identity, Phase 1 scope, accessibility baseline, and build/dev integration.

---

## Decision

### 1. Runtime substrate: web-first, served by a gateway-backed operator path

The GUI ships as a **Vite-built single-page web application**, served by a Kiln gateway-backed process on `http://localhost:<port>/gui/`. In local developer mode, `kiln gui` starts an Operator Gateway that owns the operator session bridge. When operating deployable YAML apps, the GUI attaches to the App Gateway started from `gateway.yaml` instead of creating a second app control plane. The operator opens the GUI in their existing browser. This is the primary and only supported substrate in Phase 1.

Native desktop surfaces are **deferred from Phase 1**, not rejected. Phase 1 keeps the web GUI as the primary gateway-backed surface. Later native work must be a first-class operator surface over the same gateway contracts, not a direct runtime import path or a private control plane.

**Rationale.** Web-first gives us the broadest reach with one build, the fastest inner loop (Vite HMR), zero install friction for a single-operator setup, and a trivial path to remote operation later via SSH port-forward or a future authenticated daemon. The gateway contract preserves the path to future native surfaces without changing runtime semantics.

### 2. Framework stack: React 19 + TanStack + Tailwind v4 + shadcn/ui

Locked to Sequel standards, no deviation:

| Concern | Choice | Why |
|---|---|---|
| UI library | React 19 | Sequel standard; matches `@kilnai/react` SDK |
| Language | TypeScript 5.6+ strict | Monorepo consistency |
| Build | Vite 7 | Sequel standard; Bun-compatible |
| Router | TanStack Router | Type-safe, file-based, integrates with Query |
| Server state | TanStack Query | Caches gateway responses, handles invalidation, pairs with WS invalidation events |
| Local state | Zustand | Small, unopinionated, no provider tree pollution; used only for ephemeral UI state (open panels, command palette state) |
| Styling | Tailwind v4 | Sequel standard |
| Components | shadcn/ui | Sequel standard; copy-in components preserve control |
| Icons | lucide-react | Pairs with shadcn default |
| Tests | Vitest + React Testing Library | Matches rest of monorepo |
| E2E | Playwright (later) | Deferred until Phase 1 scope stabilizes |

**Jotai and Redux are rejected.** Jotai overlaps Zustand with no material advantage here. Redux is overkill for single-operator ephemeral state; TanStack Query already owns the cache layer.

**No CSS-in-JS, no styled-components, no Emotion.** Tailwind v4 + shadcn is the full styling surface.

### 3. Binding contract: HTTP + WebSocket over the operator contract

The GUI talks to `@kilnai/core` and `@kilnai/runtime` **exclusively through Hono gateway routes in `packages/runtime/src/gateway/`**. It does not import from `@kilnai/core` or `@kilnai/runtime` directly. It does not speak to providers directly. It does not hold control-plane state.

There are two gateway-backed modes:

- **Attach mode:** GUI connects to an existing App Gateway such as `kiln-gateway` and operates loaded YAML apps.
- **Local operator mode:** GUI starts an Operator Gateway for local coding/dev sessions that are not a deployable app gateway.

The modes may use different ports, but only the App Gateway owns deployed app runtime semantics.

Concretely:

- **Transport.** HTTP for request/response (sessions, providers, config, cost snapshots, memory reads). WebSocket for streaming (session events, field telemetry, approval requests, cost deltas).
- **Contract source of truth.** TypeScript types exported from `@kilnai/runtime` gateway route modules. The GUI imports *types only* (`import type`) from runtime — never runtime code. This keeps the GUI bundle free of server-only dependencies and preserves one-way compile direction (runtime does not import GUI).
- **Route reuse.** The current `tui-gateway.ts` endpoints are renamed to a neutral `operator-gateway.ts` (or kept as-is under a stable path) and consumed by both surfaces. The gateway contract remains shared while GUI is primary and TUI is maintained.
- **Contract validation.** All gateway payloads are Zod-validated at the boundary on both ends. The GUI shares the schemas with runtime via a tiny `@kilnai/gateway-contracts` internal package (or a re-export from runtime) to avoid hand-maintained drift.
- **MCP boundary.** MCP is not the GUI-to-gateway protocol. MCP remains the external tool/host contract for agents, IDEs, wrappers, and model hosts.

**Options explicitly rejected.**

- *In-process (Tauri-only direct imports).* Rejected as the primary pattern. It ties the binding to one substrate, defeats the web-first decision, and creates a second binding shape to maintain when Tauri is later added. Tauri, when added, will still speak HTTP/WS to the embedded gateway — the same contract.
- *gRPC or tRPC.* Rejected. gRPC adds tooling weight with no gain for a local single-operator surface. tRPC is tempting but couples client and server build graphs tighter than we want; the Zod-schema + HTTP/WS pattern already gives us end-to-end type safety with looser coupling.
- *GraphQL.* Rejected. Massive overkill; none of our data is graph-shaped in a way that justifies the runtime and tooling cost.

**Rationale.** The gateway pattern is already in production for the TUI. Reusing it directly satisfies ADR-005's "same contracts" constraint *structurally*, not just nominally. It also makes the eventual remote-GUI story (deferred) a deployment concern, not a rewrite.

### 4. Package name and location: `@kilnai/gui` at `packages/gui/`

Accepted as proposed. Layout:

```
packages/gui/
  package.json            # @kilnai/gui, private: false, apache-2.0
  vite.config.ts          # react plugin, tailwind v4 plugin, path aliases
  tsconfig.json           # composite: true, references core + runtime (types only)
  index.html
  src/
    main.tsx              # router + query client + theme providers
    app.tsx               # shell, command palette, layout
    routes/               # TanStack Router file-based routes
      __root.tsx
      index.tsx           # dashboard
      sessions/
      providers/
      telemetry/
    api/                  # typed gateway client, WS subscription hooks
      client.ts
      hooks/
    features/             # feature-sliced UI (chat, provider-picker, field-sidebar)
    components/ui/        # shadcn-generated primitives
    styles/               # tailwind entry
    lib/                  # small utilities, no business logic
  tests/
```

Rules:

- `packages/gui/src/` must not contain any logic that mirrors `@kilnai/core` or `@kilnai/runtime` behavior. If a piece of logic feels like "control plane", it belongs in core/runtime and is exposed via a gateway route.
- `packages/gui/` depends on `@kilnai/runtime` for types only (`"peerDependencies"` or `import type` plus a workspace dev dep for type resolution). No runtime imports.
- `@kilnai/react` (SDK) is not a dependency of `@kilnai/gui`. The SDK targets third-party embedders; the GUI is a first-party operator surface and uses the gateway directly. Forcing the GUI through the SDK would either bloat the SDK or constrain the GUI unnecessarily.

### 5. Phase 1 scope: match current TUI capability, nothing more

Phase 1 GUI ships the minimum set of views required to make the GUI the primary operator surface under ADR-005 §Decision #6:

**In scope (Phase 1):**

1. **Session view** — chat-style transcript, streaming tokens, tool-call rendering, approval prompts inline, input with provider/model selector.
2. **Provider picker** — list of configured providers, active/idle state, credential status indicator (not credentials themselves), per-session override.
3. **Cost display** — session-level and global cost counters, driven by the cost gateway routes and WS deltas.
4. **Field / telemetry sidebar** — read-only mirror of `getFieldStore().snapshot()` equivalent currently polled by the TUI, rendered as a compact panel.
5. **Command palette** — `Cmd/Ctrl+K`, keyboard-first navigation, action search. This is the explicit answer to ADR-005's "keyboard-native" caveat.
6. **Basic session list** — recent sessions, open/close, delete.

**Explicitly deferred (later ADRs or backlog):**

- Coordination graph visualizations
- Memory diff / revision views
- Full audit log UI
- Knowledge / RAG management UI
- Multi-tenant admin surfaces
- Remote operation over the internet
- Authentication, multi-user, RBAC
- Advanced theming beyond the default shadcn light/dark
- IDE embedding (VS Code, JetBrains)

Any capability outside this list that the TUI does *not* already provide does not block GUI parity and should be proposed in its own ADR.

### 6. Accessibility baseline: WCAG 2.1 AA from day one

Non-negotiable. Enforced by:

- shadcn/ui primitives (Radix underneath) for correct ARIA semantics on interactive components
- `eslint-plugin-jsx-a11y` with the `strict` config in the GUI package lint step
- Keyboard-only traversal test in the CI smoke suite (Playwright, once added)
- Color contrast checks in Storybook/visual regression when that pipeline lands
- No bespoke interactive widgets without an accessibility review

Any PR that introduces a custom interactive component without an a11y review is blocked at code review. This ADR makes that rule explicit so it cannot be renegotiated silently.

### 7. Build and dev integration

- **Dev server.** `bun run --cwd packages/gui dev` starts Vite on a fixed port (e.g. `5183`). The gateway serves a dev proxy so `http://localhost:<gateway>/gui` forwards to Vite in dev and serves the built bundle in prod.
- **Prod serve.** `bun run --cwd packages/gui build` emits to `packages/gui/dist/`. Runtime's gateway mounts that directory as static assets under `/gui/*` when present. No separate web server process.
- **CLI entrypoint.** `@kilnai/cli` provides a `kiln gui` command. In local operator mode it starts an Operator Gateway if one is not running, opens the default browser at `/gui`, and tails logs. In attach mode (`kiln gui --connect <url>`) it connects to an existing App Gateway URL and does not start another app runtime.
- **Monorepo wiring.** `packages/gui` added to workspace. TypeScript project references: `gui` → `runtime` (types) → `core` (types). Quality gates (`bun run typecheck`, `bun run test`) cover the new package from its first commit.
- **No separate build orchestrator.** Vite handles the GUI; `tsc -b` handles the rest. No Turbo, no Nx — Bun workspaces + Vite are sufficient at this size.

---

## Consequences

### Positive

- Single binding shape (gateway HTTP/WS) for every operator surface today and every future surface tomorrow. Zero parallel control planes, satisfying ADR-005 structurally.
- Stack matches Sequel-wide standards, so engineers moving between Kiln and other Sequel projects pay no context tax.
- WCAG 2.1 AA commitment from day one lets us truthfully keep the accessibility argument that justified ADR-005.
- Phase 1 scope is a closed, testable set. Parity with the TUI is a yes/no question, which gives GUI-primary status an unambiguous validation point.
- Tauri remains a one-package-addition away if and when OS integration becomes a need, without any binding rework.

### Negative / risks

- **Gateway becomes more load-bearing.** It is already the TUI's critical path; promoting it to the GUI's critical path too means any gateway regression hits every operator. Mitigation: expanded integration tests on gateway routes, Zod validation on every payload, explicit contract package.
- **Browser as the primary UI host** means the operator carries a browser dependency. Accepted: every target operator already has one, and it removes install friction entirely.
- **Type-only imports across package boundaries** require discipline. A single accidental value import from `@kilnai/runtime` into `@kilnai/gui` would bloat the client bundle with server code. Mitigation: a lint rule (`no-restricted-imports` with a value-import ban on runtime/core from within `packages/gui/src/`).
- **Deferred Tauri** means no desktop-grade integrations in Phase 1 (tray, native notifications). Accepted per ADR-005's single-operator scope.

### Follow-ups required

- [ ] Scaffold `packages/gui/` per the layout above (planner + codex-worker)
- [ ] Extract gateway route types into a reusable `@kilnai/gateway-contracts` surface (or re-export from runtime with a stable path)
- [ ] Rename/neutralize `tui-gateway.ts` to `operator-gateway.ts` before GUI lands, or document the shared path
- [ ] Add `kiln gui` command to `@kilnai/cli`
- [ ] Add `eslint-plugin-jsx-a11y` strict config to the GUI package
- [ ] Add a `no-restricted-imports` rule blocking value imports from `@kilnai/core` / `@kilnai/runtime` inside `packages/gui/src/`
- [ ] Update `STRATEGY.md` Phase G to cite this ADR
- [ ] Define the Phase 1 parity checklist (the exact TUI capability list that, once matched, validates GUI-primary status)

---

## Alternatives Considered

### A. Tauri-first with in-process TS imports

Rejected as the primary substrate. It would let the GUI skip the gateway and call `@kilnai/core` / `@kilnai/runtime` directly in-process, which is faster to prototype and gives richer OS integration. But:

- It couples the GUI to a single substrate, reintroducing the "one surface is load-bearing" failure mode ADR-005 just removed.
- It forks the binding shape: CLI/TUI speak gateway, GUI speaks in-process. ADR-005 §Decision #1 is then satisfied only nominally.
- When remote operation eventually matters, the Tauri GUI has to be rewritten against a gateway anyway.

Native desktop remains viable only through the same gateway contract, which is
the deferred path in §1.

### B. Electron

Rejected for the Phase 1 web GUI substrate. The 2026-05-14 amendment allows
Electron to be reconsidered for a first-class native operator surface and
embedded browser-host capability, while preserving the gateway boundary.

### C. tRPC instead of Hono + Zod

Rejected. tRPC's end-to-end type inference is attractive, but:

- It would require migrating the existing `tui-gateway.ts` away from Hono, which is a significant yak-shave for a benefit we get 80% of via shared Zod schemas.
- It tightens the client/server build graph in ways that complicate the future remote-GUI story (separate deployments).
- Hono + Zod is already in use and working.

### D. Build the GUI on top of `@kilnai/react` (SDK)

Rejected. The SDK targets third-party embedders and makes design trade-offs (minimal surface, no opinionated routing or styling) that a full operator UI would constantly fight. Forcing the GUI through the SDK would either bloat the SDK or constrain the GUI. The SDK and the GUI serve different audiences; keeping them separate is cleaner.

### E. Jotai or Redux for local state

Rejected. Zustand covers the ephemeral-UI-state need with less ceremony than Redux and less conceptual overhead than Jotai's atom graph, and TanStack Query owns the cache layer that would otherwise motivate Redux. No observed case in Phase 1 scope justifies either alternative.

### F. Ship without a WCAG commitment, add it later

Rejected. ADR-005 cited WCAG as a justification for the TUI freeze. Deferring it here would make that justification retroactively dishonest. The cost of baking it in at scaffold time is near-zero; the cost of retrofitting is high.

---

## References

- ADR-005 — Freeze TUI, Prioritize GUI (`docs/adr/ADR-005-freeze-tui-prioritize-gui.md`)
- `docs/architecture/invariants.md` — surface replaceability, headless core
- `docs/architecture/identity.md` — Kiln as a cybernetic control plane
- `packages/runtime/src/gateway/tui-gateway.ts` — existing binding pattern to reuse
- `STRATEGY.md` §1 Executive Thesis, Phase G (Operator Surfaces), Phase I (Ruthless Cleanup), Law 8
- Sequel global stack standards (React 19, TS 5.6+, Bun, Vite 7+, TanStack, Tailwind v4, shadcn/ui)
