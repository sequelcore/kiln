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
- `docs/architecture/agent-context.md` for operator identity, instruction
  profiles, agent profiles, skills, managed child context, precedence, and
  surface parity.
- `docs/architecture/config-projection.md`,
  `docs/architecture/harness-integration-capabilities.md`, and
  `docs/guides/global-config.md` for canonical global config, harness
  integration capabilities, native harness projection, install-state,
  drift-aware sync/uninstall/import-native behavior, managed-agent route
  projection, and governed config mutation.
- `docs/architecture/managed-agents.md` for managed invocation, child authority,
  write evidence, live adapter proofs, and replay invariants.
- `docs/architecture/tool-execution.md`,
  `docs/architecture/developer-tools.md`,
  `docs/architecture/provider-credential-pools.md`,
  `docs/architecture/shared-tooling-intelligence.md`, and
  `docs/architecture/provider-model-discovery.md` for provider, tool, MCP, and
  model-discovery work.
- `docs/architecture/operator-surfaces.md`, `docs/guides/gui-parity.md`, and
  `docs/guides/tui-maintenance.md` for GUI, TUI, CLI, IDE, desktop, and remote
  operator surfaces, including presentation-intent doctrine.
## Roadmap Layers

There are no active implementation roadmaps at this layer. Remaining files are
deferred validation or experiment tracks.

## Active Roadmaps

- None.

## Deferred Roadmaps

- `01-external-benchmark-validation.md`
  Deferred public benchmark and governed external-validation milestone after
  the product surface stabilizes.

- `02-native-operator-surface-experiment.md`
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
- Managed agent invocation, write authority, and live adapter hardening
  completed on 2026-05-06. Stable doctrine lives in
  `docs/architecture/managed-agents.md`.
- Config projection unification completed on 2026-05-06. Stable doctrine lives
  in `docs/architecture/config-projection.md`; operator usage lives in
  `docs/guides/global-config.md`.
- Harness integration capability model completed on 2026-05-07. Stable
  doctrine lives in `docs/architecture/harness-integration-capabilities.md`;
  operator usage lives in `docs/guides/global-config.md`, and `kiln sync`
  prints runtime injection, native projection, native import, MCP, and hook
  capability diagnostics.
- Agent context capability model completed on 2026-05-07. Stable doctrine lives
  in `docs/architecture/agent-context.md`; operator usage lives in
  `docs/guides/global-config.md`; implementation covers governed operator
  identity, instruction profiles, agent profiles, skills, managed child context
  admission, and native harness projection references.
- Presentation intent contract completed on 2026-05-07. Stable doctrine lives
  in `docs/architecture/session-model.md`,
  `docs/architecture/operator-surfaces.md`,
  `docs/architecture/developer-tools.md`, and
  `packages/gateway-contracts/README.md`; implementation covers the closed
  `PresentationIntent` union, validation, tool-result projection, GUI native
  rendering, CLI/TUI text fallback, and managed invocation route evidence.
- Governed config mutation tools completed on 2026-05-08. Stable doctrine
  lives in `docs/architecture/config-projection.md`; operator usage lives in
  `docs/guides/global-config.md`; implementation covers `kiln_config.read`,
  structured `skill.upsert`, `agent.upsert`, and `agent.attach_skills`
  proposals, approval-gated apply, canonical `.kiln/agents` and
  `.kiln/skills` writes only, native projection effects, config mutation
  session events, and operator presentation across surfaces.
- Managed-agent platform productization completed on 2026-05-08. Stable
  doctrine lives in `docs/architecture/managed-agents.md`,
  `docs/architecture/agent-context.md`,
  `docs/architecture/provider-model-discovery.md`,
  `docs/architecture/operator-surfaces.md`, and
  `docs/guides/global-config.md`; implementation covers immutable capability
  snapshots, cross-surface invocation evidence, natural child selection,
  first-party agent defaults, route/model task-suitability evidence with live
  proof and evaluated skill recommendations, write-capable managed profiles,
  repo-shim projection, setup read models, and simplified GUI operator chrome.
- Kiln core built-in skills completed on 2026-05-08. Stable doctrine lives in
  `docs/architecture/agent-context.md`; operator usage lives in
  `docs/guides/skills.md` and `docs/guides/global-config.md`; implementation
  covers neutral removable core skill defaults, explicit `skills.builtin`
  activation policy, project/user override precedence, managed-agent skill
  catalogs, skill listing, and native harness projection through `kiln sync`.

## Execution Priority

1. Keep `02-native-operator-surface-experiment.md` deferred until managed
   agents create real high-density workloads and config projection makes
   local/cloud/team/CI instance boundaries explicit.
2. Keep `01-external-benchmark-validation.md` deferred until the evaluated
   product surface is stable.

## Rules

- Do not add roadmap files for completed doctrine.
- Do not keep completed implementation plans as roadmap history.
- Do not split one concern across multiple near-duplicate plan files.
- Delete superseded roadmap docs once their stable doctrine is absorbed into
  canonical architecture or guide documentation.
