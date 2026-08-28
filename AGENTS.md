# Kiln

Kiln is a local-first control plane for governed AI engineering work across
Codex, Claude Code, and OpenCode.

## Sources of truth

- Architecture and ownership: `docs/architecture/README.md`
- Kiln-specific engineering standards: `docs/architecture/core/engineering-standards.md`
- Current roadmap: `docs/roadmap/README.md`
- Research rationale: `docs/research/README.md` (informative, not authoritative)

## Project invariants

- Kiln has no external consumers. Replace changed contracts outright and remove
  the old path in the same change; do not add compatibility shims by default.
- Mutable project state belongs under the operator-private
  `~/.kiln/projects/<project-id>/` namespace. Never recreate repository-local
  `.kiln` state.
- Keep one canonical owner per concept. Generated native harness files and
  private workflow snapshots are projections, never authority.
- `AGENTS.md` is project-owned guidance. `CLAUDE.md` may import it and contain
  only genuine Claude-specific deltas; Kiln must not regenerate either file.
- Provider, model, routing, credentials, permissions, sandboxing, approvals,
  and orchestration limits belong to executable configuration and enforcement,
  not instruction Markdown.
- Preserve dependency direction and the package boundaries documented under
  `docs/architecture/`; update shared contracts and every affected surface
  together.

## Development

- Use Bun 1.4 and the workspace scripts in the root `package.json`.
- Start with the owning package's focused test or typecheck. Use `bun run
  typecheck` and `bun run test` only when the affected boundary warrants the
  broader gates.
- Run `bun run docs:check` when canonical documentation or cross-references
  change.

## Verification

Prove changed behavior with the smallest relevant automated checks, then widen
verification for shared contracts, runtime authority, generated projections,
or cross-surface changes. Report any gate that could not run.

## Specialized procedures

Load an admitted skill when a task needs a long or repeatable procedure. Keep
those procedures out of this always-loaded file.
