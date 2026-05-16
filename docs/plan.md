# Provider Selection Persistence Plan

## Objective

Make the operator's last accepted GUI provider/model selection durable across GUI restarts and provider discovery refreshes. The GUI should reflect runtime state, while the CLI/runtime owns durable operator preference in global config.

## Non-Goals

- Do not change provider routing semantics for submitted turns.
- Do not accept provider-only switches for providers that require a model.
- Do not migrate or delete existing browser `localStorage` values in this slice.

## Slices

1. Global preference contract
   - Add `ui.providerSelection.provider` and optional `ui.providerSelection.model` to global config typing and validation.
   - Add helpers near existing operator theme preference helpers.
   - Tests: global config parse/write and helper persistence.

2. Runtime gateway integration
   - Load global provider preference before GUI gateway startup.
   - Seed `sessionManager` with the preferred provider/model when valid.
   - Persist provider/model after a successful `provider_changed` acknowledgement.
   - Tests: gateway/provider preference helper behavior via CLI application tests where practical.

3. GUI reconciliation
   - Keep `localStorage` as a browser-local fallback, but do not rely on it as the only durable state.
   - On `providers_refreshed`, retry stored selection restore when there is no active provider and the refreshed catalog now advertises the stored selection.
   - Tests: `session-store-provider.test.ts` for refresh-time restore.

## Verification

- `bun run --cwd packages/gui test:run -- tests/session-store-provider.test.ts tests/provider-picker.test.tsx tests/app-shell-sidebar-modes.test.tsx`
- `bun run --cwd packages/cli test -- global-config operator-provider-preferences`
- `bun run --cwd packages/gui typecheck`
- `bun run --cwd packages/cli typecheck`

## Residual Risk

If a stored provider/model is no longer advertised, startup must fail open to no active GUI provider and keep the preference for a later discovery refresh rather than silently choosing a different provider.
