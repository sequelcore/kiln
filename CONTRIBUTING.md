# Contributing to Kiln

## Getting Started

```bash
git clone https://github.com/sequelcore/kiln.git
cd kiln
bun install
bun run typecheck
bun run test
```

## Project Structure

Kiln is a Bun monorepo with five packages:

| Package | npm name | Description |
|---------|----------|-------------|
| `packages/core` | `@kilnai/core` | Engine primitives (7), composites (3), memory, orchestrator, agents, security, safety, eval, knowledge, domain, skill, package bounded contexts. No dependency on runtime. |
| `packages/runtime` | `@kilnai/runtime` | Gateway server, Mode B sessions, tenant management, channel adapters (CLI, Web, WhatsApp, Slack, API, Voice), trigger runtime, A2A protocol. Depends on `@kilnai/core`. |
| `packages/cli` | `@kilnai/cli` | CLI commands (`init`, `run`, `dev`, `gateway`, `skill`, `domain`), init wizard, dev mode with hot-reload, MCP server. Depends on `@kilnai/core` and `@kilnai/runtime`. |
| `packages/sdk` | `@kilnai/react` | React hooks library for frontend integration. Imports **types only** from `@kilnai/core`. Peer dependency on React 19+. |
| `packages/studio` | `@kilnai/studio` (private) | Dev UI SPA served at `/studio` in dev mode. Not published to npm. Depends on `@kilnai/react`. The runtime serves its compiled `dist/` as static files — runtime never imports Studio code. |

## Commands

| Command | Description |
|---------|-------------|
| `bun run typecheck` | Type-check all packages via `tsc -b` (project references) |
| `bun run test` | Run all tests via Vitest |
| `bun run build` | Build all packages |

**IMPORTANT: Always use `bun run test`, never `bun test`.**

`bun test` (without `run`) invokes Bun's built-in test runner, which does not use the Vitest configuration. It runs all `.test.ts` files in a single process without isolation, causing hundreds of false failures from mock leakage between test files. `bun run test` invokes the `test` script defined in `package.json`, which runs Vitest with the correct configuration.

The monorepo uses `tsc -b` (project references) for type-checking because workspace packages resolve types via `dist/index.d.ts`. Each package has `composite: true` in its `tsconfig.json`. The build order is: `core` -> `runtime` -> `cli`.

## Bounded Context Rules

### Creating a New Bounded Context

1. Create a directory under the appropriate package: `packages/core/src/{context}/` or `packages/runtime/src/{context}/`.
2. Define the context's public types in a `types.ts` file.
3. Export only the public surface via an `index.ts` barrel file.
4. Import from other contexts only through their barrel exports — never import directly from another context's internal files.
5. If the new context introduces engine-level interfaces (zero-dependency primitives), place them in `packages/core/src/engine/domain/`.

### Dependency Rules Summary

- Engine primitives (`packages/core/src/engine/domain/`) have zero npm dependencies.
- Application layer (orchestrator, tree, phase machine) depends on engine interfaces only.
- Infrastructure (SQLite, provider adapters, Hono) implements engine interfaces.
- No cross-context imports — use barrel exports.
- Provider SDKs only in `packages/core/src/agents/infrastructure/`.
- Channel adapters only in `packages/runtime/src/channels/`.
- `@kilnai/runtime` depends on `@kilnai/core` only, never the reverse.
- `@kilnai/react` imports only types from `@kilnai/core`, never implementations.
- `@kilnai/studio` depends on `@kilnai/react` only; runtime serves its `dist/` as static files.

## Code Standards

- **No dead code or backwards-compatibility hacks.** Remove unused code rather than leaving it for potential future use.
- **Explicit imports only.** No wildcard imports (`import * as foo`).
- **Validate at boundaries.** Inputs from external sources (YAML, HTTP, user input) must be validated before use. Trust is not extended to internal code that has already validated.
- **Fail fast.** Errors that would cause incorrect behavior should be thrown immediately, not deferred or silently swallowed.
- **Tests required for new functionality.** Every new bounded context, capability, or configuration option must have corresponding tests.
- **No premature abstractions.** Introduce an abstraction when there is a second concrete use case, not in anticipation of one.

## Commit Format

```
type(scope): description
```

**Types:** `feat`, `fix`, `refactor`, `chore`, `docs`, `test`

**Scopes:** `core`, `engine`, `orchestrator`, `agents`, `domain`, `package`, `skill`, `memory`, `tree`, `events`, `cost`, `sandbox`, `verification`, `security`, `safety`, `knowledge`, `eval`, `a2a`, `runtime`, `gateway`, `trigger`, `session`, `tenant`, `channel`, `cli`, `docs`

Examples:
```
feat(eval): add composite scorer with weighted averaging
fix(memory): prevent cross-tenant query in SQLite FTS5 store
refactor(agents): extract circuit breaker into shared utility
```

## Pull Request Checklist

Before opening a PR, verify:

- `bun run typecheck` passes with zero errors.
- `bun run test` passes with all tests green.
- New functionality has tests with meaningful coverage.
- No cross-context imports have been introduced.
- No `@temper` references (`grep -r "@temper" packages/` returns zero results).
- The PR description explains the change and links to any relevant issues.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
