# Slice 5 Closure Plan

## Objective

Close Slice 5 after the Slice 5P resource-plane parity cut. Managed child
cockpit projection, controls, drilldown, adoption-gate, governed worktree
review, and resource pointer parity are complete across CLI, TUI, GUI, native,
gateway, runtime, and model-facing resource reads.

## Decision

Do not add paginated transcript or artifact content reads in Slice 5. The
current resource contract supports paginated resource listing and exact
read-only content reads by URI; it does not define content read offsets,
limits, byte ranges, query parameters, or shared storage content boundaries.
Adding those now would create a new cross-surface API instead of closing the
existing Slice 5 cockpit/resource-plane work.

## Closure Scope

- Preserve pointer-only managed invocation resource-plane behavior.
- Preserve existing `resource_read` input shape and artifact URI templates.
- Defer transcript/artifact content pagination until storage exposes stable
  content boundaries and a shared gateway/resource contract is designed.
- Update roadmap wording so future cuts do not bolt pagination onto artifact
  URIs as a local compatibility surface.

## File Plan

- `docs/roadmap/01-background-parallel-agent-surface.md`
  - Mark Slice 5 closed in code after Slice 5P.
  - Replace the Slice 5 MCP/resource-plane deliverable with pointer/resource
    parity and explicit content-pagination deferral.
- `docs/roadmap/README.md`
  - Update the active roadmap summary so Slice 5 is no longer presented as
    open resource-plane work.

## Verification

- `bun run --cwd packages/runtime test -- tests/managed-agent/resource-provider.test.ts`
- `bun run typecheck`
- `bun run test`
- `git diff --check`

## Residual Risk

Transcript/artifact content pagination remains a future architecture slice.
It needs a stable storage content-boundary contract before any gateway,
resource tool, or artifact URI template changes are clean.
