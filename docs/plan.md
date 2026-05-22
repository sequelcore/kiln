# Plan: Slice 3 Product Wiring for Managed Worktree Leases

## Objective

Continue Slice 3 by wiring managed-agent route configuration into the runtime
managed invocation surface so write-capable children can request
`isolated-worktree` execution through a git-backed worktree lease manager.

## Scope

- Add typed `managedAgents.worktreeLease` configuration for git-backed managed
  child worktrees.
- Allow managed-agent routes to opt into `workingDirectory: isolated-worktree`.
- Project isolated routes into runtime `ManagedInvocationToolOptions` with a
  shared invocation service backed by `ManagedGitWorktreeLeaseManager`.
- Resolve each isolated child working directory to a deterministic
  invocation-scoped path before admission.
- Keep lifecycle/status/join/cancel tools on the same configured invocation
  service across CLI, TUI, GUI, and attached runtime surfaces.

## Out Of Scope

- Sandbox, artifact-directory, environment-variable, credential-route, and
  dev-server port provisioning.
- Stale lease sweeps and dirty-worktree recovery beyond the existing
  per-invocation release boundary.
- CLI wrapper worktree manager reuse or migration.
- Native/Rust helpers.

## Affected Files

- `packages/runtime/src/agents/managed-invocation/runtime-tool.ts`
- `packages/cli/src/kiln-yaml-types.ts`
- `packages/cli/src/config/global-config.ts`
- `packages/cli/src/config/managed-agent-routes.ts`
- `packages/runtime/tests/gateway/managed-invocation-tool.test.ts`
- `packages/cli/src/config/global-config.test.ts`
- `packages/cli/src/config/managed-agent-route-catalog.test.ts`
- `docs/roadmap/01-background-parallel-agent-surface.md`
- `docs/roadmap/README.md`

## TDD Targets

1. Config parser accepts `managedAgents.worktreeLease` and
   `workingDirectory: isolated-worktree`, and rejects malformed lease config.
2. Route projection marks isolated routes with an invocation service and
   worktree lease root.
3. Runtime managed invocation tool materializes an invocation-scoped isolated
   worktree path and calls the configured lease manager before adapter
   execution.

## Verification

```bash
bun run --filter @kilnai/cli test -- src/config/global-config.test.ts src/config/managed-agent-route-catalog.test.ts
bun run --cwd packages/runtime test -- tests/gateway/managed-invocation-tool.test.ts tests/managed-agent/invocation-service.test.ts
bun run typecheck
git diff --check
```

## Risks

- Route projection must fail closed if an isolated-worktree route is configured
  without a git worktree lease root.
- The worktree path must be generated after invocation id creation; static
  route-level worktree paths would collide under parallel children.
- The service instance must be shared by lifecycle tools, otherwise `start`,
  `status`, `join`, and `cancel` would observe different registries.
