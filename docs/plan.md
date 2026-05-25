# Slice 7D - Managed Invocation Diagnostic Resource Replay

## Objective

Continue Slice 7 by making managed invocation resource replay include terminal
diagnostic pointers from the canonical invocation record, even when those
diagnostics are not duplicated in handoff or lease resources.

## Decision

Keep the resource provider as a read-only projection over
`ManagedAgentRuntimeInvocationSnapshot`. Add diagnostic replay at the resource
provider boundary so CLI, gateway tools, and model-facing resource reads all
consume the same terminal evidence bundle.

## Non-Goals

- Do not change managed invocation lifecycle semantics.
- Do not mutate adapter handoff payloads to duplicate diagnostic URIs.
- Do not expose raw invocation records or admission decisions.
- Do not add surface-local diagnostic projection logic.

## Surface Map

- Runtime resource provider:
  - `packages/runtime/src/agents/managed-invocation/resource-provider.ts`
  - `packages/runtime/tests/managed-agent/resource-provider.test.ts`
- Roadmap:
  - `docs/roadmap/01-background-parallel-agent-surface.md`

## Expected Behavior

- Aggregate managed invocation resources include terminal diagnostic URI lists.
- Per-invocation detail includes sanitized diagnostic pointers from
  `record.diagnostics`.
- Per-invocation `/resources` bundles include diagnostic pointer URIs even when
  they are not present in transcript, handoff, or lease resource lists.
- Resource URI bundles remain de-duplicated and read-only.

## Verification

- Add failing resource-provider tests first.
- Run `bun run --cwd packages/runtime test -- tests/managed-agent/resource-provider.test.ts`.
- Run `bun run --cwd packages/runtime test -- tests/gateway/managed-invocation-tool.test.ts`.
- Run `bun run typecheck`.
- Run `bun run build`.
- Update the roadmap after code verification.
