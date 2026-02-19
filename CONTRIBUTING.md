# Contributing to Kiln

Thanks for your interest in contributing to Kiln.

## Getting Started

```bash
git clone https://github.com/sequelcore/kiln.git
cd kiln
bun install
bun run typecheck
bun run test
```

## Development

- **Runtime:** Bun
- **Language:** TypeScript 5.6+ (strict mode)
- **Tests:** Vitest 4
- **Lint:** Biome

### Project Structure

```
packages/
  core/       @kilnai/core     Engine primitives, composites, memory, orchestrator
  runtime/    @kilnai/runtime   Gateway server, sessions, tenants, channels
```

### Commands

| Command | Description |
|---------|-------------|
| `bun run typecheck` | Type-check both packages |
| `bun run test` | Run all tests |
| `bun run build` | Build both packages |

## Pull Requests

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Ensure `bun run typecheck` and `bun run test` pass
4. Write tests for new functionality
5. Open a PR with a clear description

### Commit Format

```
type(scope): description
```

Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`

## Code Standards

- No dead code or backwards-compatibility hacks
- Explicit imports (no wildcards)
- Validate at boundaries, trust internal code
- Keep solutions simple -- no premature abstractions

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
