# ADR-004: GUI Stack, Boundaries, and Binding Contract

## Status

Accepted

## Context

Kiln needs a rich web operator surface for supervised AI work: sessions,
provider/model control, transcript inspection, approvals, changed-file
evidence, memory visualization, setup diagnostics, and gateway health. That
surface must share runtime truth with TUI, CLI, and native rather than becoming
its own orchestration layer.

## Decision

`@kilnai/gui` is a Vite web application served as a local operator surface. It
uses the Operator Gateway HTTP/WebSocket contract for runtime state and command
submission. The GUI must not call provider adapters, memory repositories, or
runtime services directly.

The accepted stack is:

- React 19 and TypeScript
- Vite 7
- TanStack Router with committed generated route tree
- TanStack Query for gateway server state
- Zustand for local UI state
- Tailwind CSS v4 with shadcn/Base UI primitives
- Lucide icons
- Zod for boundary parsing
- Three.js for the Memory Lattice projection only

The GUI may import shared gateway contracts and type-level domain definitions
needed for presentation. Runtime truth crosses the boundary through gateway
requests, gateway frames, and typed operator events.

## Boundaries

- The GUI owns rendering, interaction state, command composition, and local
  view preferences.
- The Operator Gateway owns sessions, provider routing, tool authority,
  approvals, context governance, managed-agent invocation, and memory writes.
- The Memory Lattice scene is projection-only; graph state is loaded through
  gateway/resource contracts.
- Native desktop is a separate surface. The GUI must stay web-deployable inside
  the local operator gateway and embeddable by native when needed.
- Accessibility is part of the surface contract: keyboard use, visible focus,
  semantic controls, and readable contrast are required.

## Consequences

The GUI can become the high-density operator cockpit without fragmenting
runtime ownership. The main cost is discipline at the boundary: components
must treat gateway frames as the evidence source instead of introducing
parallel caches or direct runtime imports.

## Verification

Professional acceptance for this ADR requires tests that cover:

- route generation and GUI typecheck
- gateway health, session, transcript, approval, and setup projections
- no direct provider/runtime execution path from GUI components
- Memory Lattice rendering from gateway/resource data
- accessibility checks for interactive controls

Canonical architecture references:

- `docs/architecture/operator-surfaces.md`
- `docs/architecture/runtime-surfaces.md`
