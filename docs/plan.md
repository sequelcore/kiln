## Objective

Clean up the Rust/native-surface split so the repository no longer carries
throwaway Rust proof code. Rust remains a product and architecture decision, but
it belongs to its own optimization roadmap. The native operator surface roadmap
must stay focused on Electron/native UI, attach loops, and rendering evidence.

## Decision

Bun/TypeScript owns Kiln control-plane semantics, shared contracts, projection
truth, benchmark gates, and all current operator surfaces. Rust will own only
approved compute/native-helper modules after a dedicated module slice or ADR
defines the port, parity harness, transport, fallback behavior, build shape, and
verification evidence.

No generic Rust readiness command, proof harness, or placeholder API remains in
the monorepo. Future Rust work must enter as a real implementation slice, not as
prototype residue.

## Cleanup Scope

Files:

- `packages/gateway-contracts/src/index.ts`
- `packages/gateway-contracts/src/operator-cockpit-benchmark.ts`
- `packages/gateway-contracts/tests/operator-cockpit-benchmark.test.ts`
- `packages/native/src/shared/native-cockpit-contract.ts`
- `packages/native/tests/native-boundary.test.ts`
- `packages/cli/src/commands/benchmark.ts`
- `packages/cli/tests/commands/benchmark.test.ts`
- `packages/gateway-contracts/README.md`
- `packages/cli/README.md`
- `docs/guides/eval.md`
- `docs/architecture/native-operator-surface.md`
- `docs/roadmap/00.0.1-rust-module-optimization.md`

Deleted prototype files:

- the gateway Rust kernel proof module
- the gateway Rust readiness proof module
- dedicated Rust proof tests under `packages/gateway-contracts/tests/`

## Implementation Steps

1. Remove Rust prototype modules and gateway exports.
2. Remove Rust candidacy fields from the native-surface benchmark gate.
3. Remove native wrappers that reported Rust parity evidence.
4. Remove the temporary Rust readiness benchmark command and its CLI test.
5. Keep `docs/roadmap/00.0.1-rust-module-optimization.md` as the durable Rust
   ownership decision.
6. Keep `docs/roadmap/01-native-operator-surface.md` separate from Rust module
   optimization.
7. Update docs so they describe future Rust entry through a dedicated approved
   module slice, not current in-repo proof code.

## Verification

```bash
bun run --cwd packages/gateway-contracts test -- tests/operator-cockpit-benchmark.test.ts
bun run --cwd packages/native test -- tests/native-boundary.test.ts
bun run --cwd packages/cli test -- tests/commands/benchmark.test.ts
bun run --filter @kilnai/gateway-contracts typecheck
bun run --filter @kilnai/native typecheck
bun run --filter @kilnai/cli typecheck
git diff --check
```

## Residual Risk

- The 2026-05-17 benchmark artifact remains historical evidence only; it is not
  a maintained CLI/API surface.
- Future Rust work still needs a real module-specific parity harness and tests.
- Native operator surface promotion remains blocked until browser/native
  rendering evidence exists.
