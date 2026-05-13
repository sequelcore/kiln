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
- `docs/architecture/work-governance.md` for operator-work posture,
  orchestration preference, direct-execution envelopes, delegated work, and
  evidence closeout.
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
  `docs/architecture/controlled-web-research.md`,
  `docs/architecture/provider-credential-pools.md`,
  `docs/architecture/shared-tooling-intelligence.md`, and
  `docs/architecture/provider-model-discovery.md` for provider, tool, MCP, and
  model-discovery work.
- `docs/architecture/operator-surfaces.md`, `docs/guides/gui-parity.md`, and
  `docs/guides/tui-maintenance.md` for GUI, TUI, CLI, IDE, desktop, and remote
  operator surfaces, including presentation-intent doctrine.
- `docs/guides/plan-mode.md`, `docs/architecture/work-governance.md`, and
  `docs/architecture/coordination.md` for plan mode, goal/work-item execution,
  orchestration preference, workflow profiles, evidence closeout, and
  cross-surface coordination.

## Roadmap Layers

Active roadmap files describe implementation tracks that have not yet been
absorbed into stable architecture or guide documentation. Deferred tracks remain
explicitly parked until their prerequisite product surface exists.

## Active Roadmaps

- None.

## Deferred Roadmaps

- `00.06-live-browser-operator-surface.md`
  Deferred research track for a live browser operator surface. Kiln currently
  has governed browser automation and artifact-backed Browser tab snapshots;
  this track covers the future live viewport/streaming experience.

- `00.07-multimodal-transport-and-capability-delegation.md`
  Deferred foundation track for governed multimodal transport, artifact-backed
  image/document/audio evidence, capability-aware provider routing, auxiliary
  managed-agent delegation, and explicit OCR/transform degradation across
  CLI, TUI, GUI, webhooks, SDK, and replay.

- `00.08-agent-qa-showcase-recorder.md`
  Deferred product track for turning governed agent runs into real QA and
  showcase videos. The track combines raw browser/desktop capture with Kiln's
  structured action timeline for auto-zoom, captions, voiceover, redaction,
  replay, and export.

- `01-external-benchmark-validation.md`
  Deferred public benchmark and governed external-validation milestone after
  the product surface stabilizes.

- `02-native-operator-surface-experiment.md`
  Deferred native, GPU-accelerated operator-surface experiment for high-density
  managed-agent supervision, replay, timeline, graph, and multi-instance
  workloads.

- OS-pack packaging for web extraction/browser helpers.
  Deferred until controlled web primitives and research capability need
  platform-specific helper binaries or dependencies. Stable boundaries live in
  `docs/architecture/controlled-web-research.md`.

- Binary/PDF source artifacts for controlled web research.
  Deferred until the research capability needs reliable PDF text extraction or
  OCR. Stable authority boundaries live in
  `docs/architecture/controlled-web-research.md`.

## Completed Programs

- GUI Phase 1 parity is closed. Stable status lives in
  `docs/guides/gui-parity.md`.
- Shared developer tools completed on 2026-04-29. Stable doctrine lives in
  `docs/architecture/developer-tools.md`.
- Shared tooling intelligence completed on 2026-04-29. Stable doctrine lives in
  `docs/architecture/shared-tooling-intelligence.md`.
- Interactive browser and computer use completed on 2026-05-08. Stable
  doctrine lives in `docs/architecture/developer-tools.md`,
  `docs/architecture/tool-execution.md`, `docs/architecture/session-model.md`,
  `docs/guides/tool-use.md`, `docs/guides/gui.md`, and `docs/guides/tui.md`.
  Implementation covers core contracts, project config projection, Playwright
  browser automation, artifact-backed browser evidence, GUI Browser snapshot
  projection, optional low-level Windows computer control, Kiln-owned Microsoft
  UI Automation semantic control, explicit browser/computer environment policy,
  application aliases, and cross-surface resume/projection semantics.
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
- Controlled web search/extract diagnostics and provider adapters completed on
  2026-05-08. Stable doctrine lives in
  `docs/architecture/controlled-web-research.md` and
  `docs/architecture/developer-tools.md`; operator usage lives in
  `docs/guides/tool-use.md`; implementation covers typed web error metadata,
  `kiln status` diagnostics, `http`, `searxng`, `brave`, `tavily`, and `exa`
  search-provider adapters, and `http`, `tavily`, and `firecrawl`
  extraction-provider adapters.
- Work-governance posture and orchestration preference completed on
  2026-05-08. Stable doctrine lives in
  `docs/architecture/work-governance.md`, `docs/architecture/flows.md`,
  `docs/architecture/coordination.md`, and
  `docs/architecture/agent-context.md`; operator usage lives in
  `docs/guides/global-config.md`; implementation covers canonical
  `workGovernance` config, CLI/GUI/TUI/benchmark required context projection,
  repo-shim projection, direct-execution envelope, delegation triggers,
  workflow profiles, session work items, `work_item_updated` canonical events,
  `kiln://session/work-items` resources, GUI/TUI work-item projections,
  evidence-gated closeout, and managed-child handoff contract fields.
- Plan/goal workflow control completed on 2026-05-13. Stable
  doctrine has been absorbed through
  `docs/guides/plan-mode.md`, `docs/architecture/work-governance.md`,
  `docs/architecture/managed-agents.md`,
  `docs/architecture/agent-context.md`, `docs/architecture/flows.md`,
  `docs/architecture/tool-execution.md`,
  `docs/architecture/config-projection.md`,
  `docs/architecture/operator-surfaces.md`, and
  `docs/architecture/invariants.md`. Completed implementation covers structured
  specification events, clarification gates, structured plans, analysis and
  approval gates, effective turn authority, model routing rationale, goal runs,
  work-item materialization, execution attempts, managed-agent handoff, evidence
  and review gates, cross-surface operator UX, and native harness workflow
  snapshot projection. Closure certified slices 1 through 13 as complete before
  the implementation roadmap was retired from this directory.

## Execution Priority

1. Keep `02-native-operator-surface-experiment.md` deferred until managed
   agents create real high-density workloads and config projection makes
   local/cloud/team/CI instance boundaries explicit.
2. Keep `01-external-benchmark-validation.md` deferred until the evaluated
   product surface is stable.

## Deferred Candidates

The following ideas were removed from `00.5-plan-goal-workflow-control.md` as
active roadmap phases because they are not required to close the implemented
plan/goal workflow-control substrate:

- `OperationalMode`
- `AllostaticLoad`
- `KilnStateSnapshot`
- monolithic `GovernanceDecision`
- governance ML advisor
- ML-based routing
- dataset generation pipeline
- fine-tuning
- full external benchmark validation

These are candidate future tracks only. Do not turn them into active roadmap
phases until there is a concrete product/runtime trigger:

- shared state/control modeling needed by multiple runtime policies
- enough real workflow traces and eval data to justify learning-based routing
  or fine-tuning
- a stable product surface that can support external benchmark validation
- an ADR-worthy architecture decision that cannot be expressed by the current
  workflow, authority, routing, or evidence contracts

Until one of those triggers exists, keep them as deferred candidates rather
than extending `00.5`.

## Rules

- Do not add roadmap files for completed doctrine.
- Do not keep completed implementation plans as roadmap history.
- Do not split one concern across multiple near-duplicate plan files.
- Delete superseded roadmap docs once their stable doctrine is absorbed into
  canonical architecture or guide documentation.
