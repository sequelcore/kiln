# Tool Authority Progress

**Status:** in progress  
**Updated:** 2026-04-18  
**Branch:** `main`

## Purpose

This document records the current stop-point for the tool-authority work that
turns Kiln from a multi-provider chat surface into a harness that can govern
tool execution.

This is not a finished ADR. It is the implementation-progress companion for the
accepted direction:

- Kiln owns tool authority
- Kiln owns tool execution
- providers are tool-call proposers, not final permission authorities
- MCP is an exposure surface, not the security boundary

## Architectural Decision Snapshot

The current implementation follows these rules:

- one canonical authority contract for tool execution
- fail-closed on malformed request authority
- no parallel permission DSL added beside the existing authorizer path
- runtime routes must forward authority explicitly instead of re-deriving it ad hoc
- provider-native runtimes are not assumed to be authoritative just because they can call tools

Related docs:

- [tool-execution.md](/C:/Proyectos/Sequel/kiln/docs/architecture/tool-execution.md)
- [subsystems.md](/C:/Proyectos/Sequel/kiln/docs/architecture/subsystems.md)
- [gui-phase-1-parity-checklist.md](/C:/Proyectos/Sequel/kiln/docs/roadmap/gui-phase-1-parity-checklist.md)

## What Landed

### Slice 1: canonical authority contract

Core and runtime now have a request-level authority path for tool execution.

Implemented:

- canonical `AuthorityDescriptor`
- canonical `ToolExecutionRequest`
- authority resolution order:
  1. request-level authority
  2. existing `ToolAuthorizer`
  3. legacy audited default behavior
- malformed authority descriptors deny execution fail-closed
- `tenant-tool-factory` derives `toolAuthority`
- `ModeBOrchestrator` can consume `perCallConfig.toolAuthority`

Primary files:

- [tool-execution.ts](/C:/Proyectos/Sequel/kiln/packages/core/src/engine/domain/tool-execution.ts)
- [tool-executor.ts](/C:/Proyectos/Sequel/kiln/packages/core/src/tools/tool-executor.ts)
- [orchestrator-dev-tool-support.ts](/C:/Proyectos/Sequel/kiln/packages/core/src/orchestrator/orchestrator-dev-tool-support.ts)
- [tenant-tool-factory.ts](/C:/Proyectos/Sequel/kiln/packages/runtime/src/gateway/tenant-tool-factory.ts)
- [mode-b-orchestrator.ts](/C:/Proyectos/Sequel/kiln/packages/runtime/src/session/mode-b-orchestrator.ts)

### Slice 2: tenant ingress route wiring

Real tenant ingress routes now forward `tenantToolCtx.toolAuthority` into
`perCallConfig.toolAuthority` before invoking `ModeBOrchestrator`.

Wired routes:

- [ws-tenant-routes.ts](/C:/Proyectos/Sequel/kiln/packages/runtime/src/gateway/ws-tenant-routes.ts)
- [email-webhook-routes.ts](/C:/Proyectos/Sequel/kiln/packages/runtime/src/gateway/email-webhook-routes.ts)
- [instagram-webhook-routes.ts](/C:/Proyectos/Sequel/kiln/packages/runtime/src/gateway/instagram-webhook-routes.ts)
- [messenger-webhook-routes.ts](/C:/Proyectos/Sequel/kiln/packages/runtime/src/gateway/messenger-webhook-routes.ts)
- [whatsapp-webhook-routes.ts](/C:/Proyectos/Sequel/kiln/packages/runtime/src/gateway/whatsapp-webhook-routes.ts)

The route tests assert that forwarding explicitly.

## What Is True Right Now

### Implemented and real

- Kiln has a canonical authority model in core/runtime.
- Tool execution can honor request-level authority.
- Tenant ingress routes now carry authority into the tool loop.
- The behavior is covered by targeted core/runtime tests.

### Not yet fully true

- Not every runtime entrypoint is wired yet.
- Not every GUI/provider path is governed by this authority model.
- Provider-native runtimes such as Claude Code, Codex surfaces, and OpenCode still
  retain their own approval or runtime semantics.
- This work improves the foundation for GUI-driven development, but it does not
  by itself add a user-facing authority control panel or make every direct-provider
  GUI flow fully authoritative.

## What You Can Use Today

This work is currently usable in the real tenant-backed ingress flows listed
above. It is not yet a complete guarantee that "direct providers in the GUI use
tools properly" in every surface.

The honest state is:

- tenant-backed route coverage: improved and real
- API-style harness-controlled provider paths: closer to correct
- provider-native attached runtimes: still partial-authority territory
- full GUI/provider unification: not done yet

## What Still Remains

These items remain before this can be considered closed at the ADR level.

1. Wire remaining runtime/operator entrypoints.
   Candidate files:
   - `packages/runtime/src/gateway/mode-b-routes.ts`
   - `packages/runtime/src/gateway/tenant-routes.ts`
   - `packages/runtime/src/gateway/gui-gateway.ts`
   - `packages/runtime/src/gateway/tui-gateway.ts`

2. Make authority decisions first-class in audit data.
   Execution behavior is now governed more consistently, but the authority
   decision lifecycle is not yet a first-class audit record.

3. Formalize provider authority levels in runtime configuration.
   The architecture distinguishes authoritative vs attached-runtime, but that
   provider-level classification is not yet encoded as a first-class runtime surface.

4. Collapse or subordinate remaining parallel permission behavior.
   Any route-specific or provider-specific permission behavior still has to be
   made explicitly subordinate to the canonical authority model.

5. Expose operator visibility later.
   Not required for enforcement, but the GUI should eventually surface:
   - effective authority
   - allow/deny/approval reason
   - whether the current integration is authoritative or partial

## Verification History

The following checks were run against this work.

### Canonical authority slice

Passed:

```bash
bun run typecheck
bun run --filter @kilnai/core test -- tests/tools/tool-executor.test.ts tests/orchestrator/tool-execution-integration.test.ts
bun run --filter @kilnai/runtime test -- tests/session/mode-b-orchestrator-tools.test.ts tests/gateway/tenant-tool-factory.test.ts
```

### Tenant ingress wiring slice

Passed:

```bash
bun run typecheck
bun run --cwd packages/runtime test -- tests/gateway/email-webhook-routes.test.ts tests/gateway/instagram-webhook-routes.test.ts tests/gateway/messenger-webhook-routes.test.ts tests/gateway/whatsapp-webhook-routes.test.ts tests/gateway/ws-tenant-routes.test.ts
```

Observed result:

- 5 route test files passed
- 72 tests passed in that targeted route run

## Modified Files In This Stop-Point

Authority work:

- `docs/architecture/subsystems.md`
- `docs/architecture/tool-execution.md`
- `packages/core/src/engine/domain/tool-execution.ts`
- `packages/core/src/engine/index.ts`
- `packages/core/src/index.ts`
- `packages/core/src/orchestrator/orchestrator-dev-tool-support.ts`
- `packages/core/src/tools/tool-executor.ts`
- `packages/core/tests/orchestrator/tool-execution-integration.test.ts`
- `packages/core/tests/tools/tool-executor.test.ts`
- `packages/runtime/src/gateway/email-webhook-routes.ts`
- `packages/runtime/src/gateway/instagram-webhook-routes.ts`
- `packages/runtime/src/gateway/messenger-webhook-routes.ts`
- `packages/runtime/src/gateway/tenant-tool-factory.ts`
- `packages/runtime/src/gateway/whatsapp-webhook-routes.ts`
- `packages/runtime/src/gateway/ws-tenant-routes.ts`
- `packages/runtime/src/session/mode-b-orchestrator.ts`
- `packages/runtime/src/tenant/agent-resolver.ts`
- `packages/runtime/tests/gateway/email-webhook-routes.test.ts`
- `packages/runtime/tests/gateway/instagram-webhook-routes.test.ts`
- `packages/runtime/tests/gateway/messenger-webhook-routes.test.ts`
- `packages/runtime/tests/gateway/tenant-tool-factory.test.ts`
- `packages/runtime/tests/gateway/whatsapp-webhook-routes.test.ts`
- `packages/runtime/tests/gateway/ws-tenant-routes.test.ts`
- `packages/runtime/tests/session/mode-b-orchestrator-tools.test.ts`

Adjacent unrelated work still present in the working tree:

- `packages/cli/src/commands/gui.ts`
- `packages/cli/src/wrapper/debug.ts`
- `packages/gui/src/components/app-shell.tsx`

## Current Worktree Snapshot

Current branch at the time of this note:

- `main`

Uncommitted changes exist. This document is intended to preserve the exact
state before stopping work.

## Recommended Next Step

If work resumes, the best next slice is runtime propagation into the remaining
non-tenant and operator-facing routes so the authority model is not limited to
tenant ingress.

That should happen before claiming that GUI direct-provider flows are fully
governed by Kiln.
