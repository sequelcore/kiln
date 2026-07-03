# Interactive Full-Access Authority Integrity

Status: Complete
Updated: 2026-07-03

## Objective

Make Kiln GUI Full Access an explicit, enforceable authorization for an attended
operator turn in Kiln's own runtime, while preserving fail-closed authority for
managed, background, and unattended execution.

## Decisions

- Model execution use explicitly at the runtime authority boundary; do not infer
  it from provider, model output, tool name, or presence of a GUI.
- An attended operator's Full Access request may authorize Kiln-owned local
  mutation tools when session, tenant, and route bounds admit it.
- Managed or unattended destructive execution still requires goal and work-item
  authority envelopes and cannot inherit an interactive selector.
- Kiln's selector is not proof of a native harness sandbox and is never persisted
  as canonical provider permission evidence.

## Slices

1. Add failing authority and GUI regressions for attended Full Access and
   managed fail-closed behavior.
2. Introduce the minimum execution-use evidence in the runtime admission
   contract and project it from the attended GUI operator entry point.
3. Align attached runtime tool authority with the admitted turn snapshot.
4. Run focused runtime tests, runtime package tests, workspace typecheck/build,
   security and code review, then update canonical architecture documentation.

## Verification

- `bun test packages/runtime/tests/session/effective-turn-authority.test.ts`
- `bun test packages/runtime/tests/gateway/gui-gateway-authority.test.ts`
- `bun test packages/runtime/tests/gateway/attached-runtime-tool-surface.test.ts`
- `bun test packages/runtime/tests/session/runtime-session-orchestrator-tools.test.ts`
- `bun run --filter @kilnai/runtime test`
- `bun run typecheck`
- `bun run build`
- `git diff --check`

## Residual-Risk Gate

No native harness permission state may be claimed from this change. Background
children must remain blocked without their own fresh authority evidence.

## Completion Evidence

- Focused effective-authority tests: 5 passed.
- Focused GUI authority tests: 17 passed.
- Focused attached runtime surface tests: 36 passed.
- Focused runtime tool-orchestrator tests: 70 passed.
- Full `@kilnai/runtime` suite: 185 files and 2483 tests passed; 5 live
  proof files and 9 credentialed tests remained intentionally skipped.
- Workspace typecheck and production build passed.
- Security review confirmed incomplete interactive evidence fails closed and
  managed/unattended execution cannot inherit the GUI selector.
