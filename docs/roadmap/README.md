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
  drift-aware sync/uninstall/import-native behavior, and managed-agent route
  projection.
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
  operator surfaces.
- `docs/roadmap/03-presentation-intent-contract.md` for the active
  presentation-intent track until its stable doctrine is promoted into
  architecture and guide documentation.
- `docs/roadmap/04-managed-agent-platform-productization.md` for the active
  managed-agent productization track that turns the governed runtime foundation
  into a coherent cross-surface product platform.
- `docs/roadmap/05-governed-config-mutation-tools.md` for the active governed
  config-mutation track that lets agents inspect, propose, and apply approved
  canonical Kiln configuration changes.

## Roadmap Layers

The managed-agent and setup work is split by architectural responsibility:

- `02-agent-context-capability-model.md` defines the canonical model: identity,
  instruction profiles, agent profiles, skills, context admission, precedence,
  and harness projection.
- `04-managed-agent-platform-productization.md` turns that model into product:
  first-party defaults, natural delegation, setup surfaces, presentation,
  write-capable managed child profiles, and operator workflow.
- `05-governed-config-mutation-tools.md` makes the setup governable by agents:
  config reads, structured proposals, approval-gated apply, sync/projection,
  and audit evidence.

## Active Roadmaps

- `01-harness-integration-capability-model.md`
  Active capability-driven integration track for Claude Code, Codex, and
  OpenCode. It replaces implicit native-projection assumptions with explicit
  runtime injection, native projection, plugin, MCP, and hook capabilities.

- `02-agent-context-capability-model.md`
  Active governed agent-context track for operator identity, instruction
  profiles, agent profiles, skills, and managed child context across all
  surfaces.

- `03-presentation-intent-contract.md`
  Active presentation contract track for validated agent/tool display intents
  across GUI, TUI, CLI, SDK/widget, and future operator surfaces.

- `04-managed-agent-platform-productization.md`
  Active productization track for Kiln's managed-agent differentiator:
  canonical config, direct providers and harnesses under one contract,
  governed child invocation, immutable evidence, reusable agent identity, and
  natural delegation across all surfaces.

- `05-governed-config-mutation-tools.md`
  Active governed configuration track for native tools that read effective
  config, propose bounded config changes, apply approved changes, emit audit
  events, and run sync/projection through canonical Kiln services.

## Deferred Roadmaps

- `06-external-benchmark-validation.md`
  Deferred public benchmark and governed external-validation milestone after
  the product surface stabilizes.

- `07-native-operator-surface-experiment.md`
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

## Execution Priority

1. Keep `07-native-operator-surface-experiment.md` deferred until managed
   agents create real high-density workloads and config projection makes
   local/cloud/team/CI instance boundaries explicit.
2. Keep `06-external-benchmark-validation.md` deferred until the evaluated
   product surface is stable.

## Rules

- Do not add roadmap files for completed doctrine.
- Do not keep completed implementation plans as roadmap history.
- Do not split one concern across multiple near-duplicate plan files.
- Delete superseded roadmap docs once their stable doctrine is absorbed into
  canonical architecture or guide documentation.
