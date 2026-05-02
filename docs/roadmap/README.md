# Roadmap

This directory contains active and deferred execution tracks only. Completed
programs are not archived here; their stable doctrine belongs in
`docs/architecture/` or `docs/guides/`.

## Canonical References

Read the relevant architecture or guide document before using a roadmap:

- `docs/architecture/memory.md` and `docs/guides/memory.md` for governed
  memory, Memory Lattice, lifecycle policy, recall, and memory resource
  projection.
- `docs/architecture/context-governance.md` for model-context admission,
  budgets, overflow, and audit.
- `docs/architecture/context-resource-plane.md` for read-only resource
  contracts.
- `docs/architecture/tool-execution.md`,
  `docs/architecture/developer-tools.md`,
  `docs/architecture/provider-credential-pools.md`,
  `docs/architecture/shared-tooling-intelligence.md`, and
  `docs/architecture/provider-model-discovery.md` for provider, tool, MCP, and
  model-discovery work.
- `docs/architecture/operator-surfaces.md`, `docs/guides/gui-parity.md`, and
  `docs/guides/tui-maintenance.md` for GUI, TUI, CLI, IDE, desktop, and remote
  operator surfaces.

## Active Roadmaps

- `01-managed-agents-cross-provider-subagents.md`
  Defines the managed-agent invocation substrate: cross-provider child agents,
  explicit invocation policy, permissions, memory admission, lifecycle events,
  parallelism, cancellation, and replay.

- `02-config-projection-unification.md`
  Makes `~/.kiln/config.yaml` the source of truth for harness configuration,
  projects managed Claude/Codex/OpenCode config, and adds drift-aware sync,
  uninstall, migrate, and engine-status workflows.

## Deferred Roadmaps

- `03-external-benchmark-validation.md`
  Deferred public benchmark and governed external-validation milestone after
  the product surface stabilizes.

- `04-native-operator-surface-experiment.md`
  Deferred native, GPU-accelerated operator-surface experiment for high-density
  managed-agent supervision, replay, timeline, graph, and multi-instance
  workloads.

## Completed Programs

- GUI Phase 1 parity is closed. Stable status lives in
  `docs/guides/gui-parity.md`.
- Shared developer tools completed on 2026-04-29. Stable doctrine lives in
  `docs/architecture/developer-tools.md`.
- Shared tooling intelligence completed on 2026-04-29. Stable doctrine lives in
  `docs/architecture/shared-tooling-intelligence.md`.
- Context resource plane completed on 2026-04-30. Stable doctrine lives in
  `docs/architecture/context-resource-plane.md`.
- Memory Lattice and governed memory completed on 2026-05-01. Stable doctrine
  lives in `docs/architecture/memory.md` and `docs/guides/memory.md`.
- Memory lifecycle policy completed on 2026-05-01. Stable doctrine lives in
  `docs/architecture/memory.md` and operator-facing resource usage lives in
  `docs/guides/memory.md`.
- Provider credential pooling completed on 2026-05-02. Stable doctrine lives
  in `docs/architecture/provider-credential-pools.md` and operator-facing
  credential usage lives in `docs/guides/provider-credentials.md`.

## Execution Priority

1. Execute `01-managed-agents-cross-provider-subagents.md` after provider
   credential pooling can route child invocations across accounts, wrappers,
   direct API-key providers, and local endpoints.
2. Execute `02-config-projection-unification.md` after managed agents and the
   provider credential pool clarify what global/project config must express.
3. Keep `04-native-operator-surface-experiment.md` deferred until managed
   agents create real high-density workloads and config projection makes
   local/cloud/team/CI instance boundaries explicit.
4. Keep `03-external-benchmark-validation.md` deferred until the evaluated
   product surface is stable.

## Rules

- Do not add roadmap files for completed doctrine.
- Do not keep completed implementation plans as roadmap history.
- Do not split one concern across multiple near-duplicate plan files.
- Delete superseded roadmap docs once their stable doctrine is absorbed into
  canonical architecture or guide documentation.
