# Setup Workflow Redesign Plan

## Objective

Turn Setup from a passive status dump into an action-first configuration health
workflow shared through gateway contracts. GUI should render the rich workflow,
runtime should expose the operator HTTP action boundary, and CLI should own the
actual setup mutations.

## Non-Goals

- Do not let GUI import CLI, runtime internals, filesystem helpers, or projection
  writers directly.
- Do not add destructive force-sync behavior from the GUI.
- Do not make review-only drift actions mutate files.
- Do not add new visual dependencies beyond existing shadcn/Base UI components.

## Slices

1. Shared contract
   - Add setup action request/result schemas to `@kilnai/gateway-contracts`.
   - Keep setup snapshots as the read model and return a fresh snapshot after
     action execution.

2. CLI-owned mutations
   - Add an application service that executes safe setup actions:
     project-context adoption, repo-shim sync, and native projection sync.
   - Return blocked/no-op results for review-only or already-current actions.

3. Runtime gateway adapter
   - Add `POST /gui/api/config/setup/actions`.
   - Validate request payload through gateway-contract schemas.
   - Delegate execution through `StartGuiGatewayOptions` callback.

4. GUI projection
   - Add client method and mutation wiring.
   - Redesign `SetupPanel` around health, prioritized action rows, and compact
     source detail tables.
   - Keep setup actions distinct from app-level controls and details.

5. Documentation and verification
   - Update config-projection/global-config docs from read-only setup to governed
     action workflow.
   - Run focused tests for contracts, runtime gateway, CLI action service, GUI
     client/component, then relevant typechecks.

## Verification

- `bun run --cwd packages/gateway-contracts test`
- `bun run --cwd packages/runtime test -- tests/gateway/gui-gateway.test.ts`
- `bun run --cwd packages/cli test -- tests/application/config-setup-actions.test.ts`
- `bun run --cwd packages/gui test:run -- tests/client.test.ts tests/setup-panel.test.tsx`
- `bun run --cwd packages/gui test:run -- tests/app-shell-sidebar-modes.test.tsx`
- `bun run --cwd packages/gateway-contracts build`
- `bun run --cwd packages/runtime build`
- `bun run --cwd packages/gateway-contracts typecheck`
- `bun run --cwd packages/gui typecheck`
- `bun run --cwd packages/cli typecheck`
- `bun run --cwd packages/runtime typecheck`

## Residual Risk

Native projection sync touches operator-native files. GUI execution must remain
non-force only, and drift/review actions must guide the operator to review rather
than overwriting managed native state.
