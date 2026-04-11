# Kiln 1.0.0

Kiln `1.0.0` is the first release aligned to the new product thesis:
Kiln is a cybernetic control plane for governed AI work.

## Highlights

- Reframed Kiln around the control-plane model instead of the old
  orchestration-engine and swarm-era identity.
- Rewrote the architectural and research documentation so the new doctrine is
  the source of truth.
- Refactored the orchestrator boundary into clearer support modules for
  checkpointing, interrupts, developer tools, memory sync, and verification.
- Removed legacy swarm-era surfaces from the active product boundary.
- Renamed the active coordination primitives to:
  - `DemandAllocator`
  - `ChainGovernor`
  - `TaskRegistry`
- Bumped workspace packages to `1.0.0`.

## Compatibility note

`1.0.0` establishes the new baseline, but more breaking changes are expected in
future releases as the remaining bounded contexts are aligned to the same
architecture.

That continuation is paused for now while focus moves temporarily to a
different project built on top of this cleaner base.

## Verification

- `bun run typecheck`
- `bun run test`
- `bun run build`
