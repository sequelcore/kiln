# Kiln - Cybernetic Control Plane for Governed AI Work

Apache-2.0 licensed monorepo. Kiln is a control plane that regulates AI work across execution surfaces, memory layers, coordination patterns, and safety boundaries. It is not an orchestration-first product, not a biological system made literal, and not a legacy compatibility shell for old abstractions.

## Canonical References

- Architecture: [docs/architecture/README.md](docs/architecture/README.md)
- Research synthesis: [docs/research/README.md](docs/research/README.md)
- Roadmap: [docs/roadmap/README.md](docs/roadmap/README.md)
- Transitional entrypoint: [docs/architecture.md](docs/architecture.md)

Read the modular architecture docs first. They are the active source of truth.

## Package Layout

| Package | Scope | Purpose |
|---------|-------|---------|
| `packages/core` | `@kilnai/core` | Core control-plane contracts, state, policy, safety, memory, evaluation, and coordination primitives |
| `packages/runtime` | `@kilnai/runtime` | Runtime adapters, channel execution plumbing, registries, triggers, and operational surfaces |
| `packages/cli` | `@kilnai/cli` | Command-line control surface and local operator workflows |
| `packages/tui` | `@kilnai/tui` | Terminal control surface |
| `packages/sdk` | `@kilnai/react` | React integration surface |
| `packages/widget` | `@kilnai/widget` | Embeddable UI surface |
| `packages/studio` | `@kilnai/studio` | Development and inspection tooling |

## Architectural Rules

1. Kiln regulates work through governors, controllers, registries, and safety boundaries.
2. Context is budgeted and governed, never replayed blindly.
3. Safety defaults to fail-closed for dangerous or ambiguous work.
4. Coordination uses explicit shared state and controlled handoff, not folklore multi-agent magic.
5. Memory is layered and revision-aware; mutation requires provenance and coherence.
6. Adaptation is constrained by policy and telemetry; self-modification never outranks doctrine.
7. Biological metaphors may explain mechanisms, but they do not define the product identity.

## Commands

```bash
bun install
bun run typecheck
bun run test
```

Always use `bun run test`, not `bun test`.

## Quality Gates

- TypeScript: `bun run typecheck`
- Tests: `bun run test`
- Documentation changes must preserve the modular architecture and research hierarchy

## Current Direction

The repository is being aligned to a single doctrine:

- Kiln is a cybernetic control plane
- The modular architecture docs are canonical
- Research is synthesized at `docs/research/`, not buried under legacy subtrees
- Old identity language should be removed, not carried forward as compatibility narrative

## Backlog Reference

See [STRATEGY.md](STRATEGY.md) for the long-term roadmap aligned to the new doctrine.
