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
- `docs/architecture/multimodal-transport.md` and
  `docs/adr/ADR-010-multimodal-transport-and-capability-delegation.md` for
  governed multimodal artifact transport, capability-aware route admission,
  transforms, managed capability delegation, provider constraints,
  cross-surface projection, and replay evidence.
- `docs/architecture/agent-qa-showcase-recorder.md` for governed recorder
  capture manifests, browser/computer capture evidence, auto-edit tracks,
  voice/audio tracks, external-editor handoff, and recorder security
  invariants.
- `docs/architecture/tool-execution.md`,
  `docs/architecture/developer-tools.md`,
  `docs/architecture/controlled-web-research.md`,
  `docs/architecture/provider-credential-pools.md`,
  `docs/architecture/shared-tooling-intelligence.md`, and
  `docs/architecture/provider-model-discovery.md` for provider, tool, MCP, and
  model-discovery work.
- `docs/architecture/developer-tools.md` and `docs/guides/tool-use.md` for
  browser operator foundations, snapshot monitoring, frame-stream fallback,
  takeover/release, brokered browser input, and durable browser evidence.
- `docs/architecture/operator-surfaces.md`, `docs/guides/gui-parity.md`, and
  `docs/guides/tui-maintenance.md` for GUI, TUI, CLI, IDE, desktop, and remote
  operator surfaces, including presentation-intent doctrine.
- `docs/guides/plan-mode.md`, `docs/architecture/work-governance.md`, and
  `docs/architecture/coordination.md` for plan mode, goal/work-item execution,
  orchestration preference, workflow profiles, evidence closeout, and
  cross-surface coordination.
- `docs/architecture/benchmark-validation.md` and `docs/guides/eval.md` for
  benchmark-facing profiles, internal baseline readiness, benchmark adapters,
  public report evidence, and operator benchmark commands.

## Roadmap Layers

Active roadmap files describe implementation tracks that have not yet been
absorbed into stable architecture or guide documentation. Deferred tracks remain
explicitly parked until their prerequisite product surface exists.

## Active Roadmaps

- `02-native-operator-surface-foundation.md`
  Active native operator surface foundation. Current slice establishes shared
  surface capability contracts before any Electron package or embedded browser
  host implementation.

## Deferred Roadmaps

- `03-embedded-browser-host-capability.md`
  Focused native browser-host capability decision. Blocked on `02`; owns the
  Electron `WebContentsView` proof, host security baseline, control protocol,
  evidence model, and ADR update.

- `04-embedded-browser-operator-surface.md`
  Real embedded browser operator-surface track. Blocked on `02` and `03`; owns
  the product capability where the operator interacts with an actual browser
  view inside Kiln.

- `05-native-operator-cockpit-and-projection-performance.md`
  Deferred native cockpit and projection-performance experiment for
  high-density managed-agent supervision, replay, timeline, graph,
  multi-instance workloads, and optional Rust/WASM/sidecar acceleration.

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
- Multimodal transport and capability delegation completed on 2026-05-13.
  Stable doctrine lives in `docs/architecture/multimodal-transport.md` and the
  accepted decision record lives in
  `docs/adr/ADR-010-multimodal-transport-and-capability-delegation.md`.
  Implementation covers canonical multimodal artifacts, provider/model
  capability projection, runtime route admission, fail-closed provider
  adapters, managed capability delegation, governed OCR/document/audio/image
  transforms, `multimodal_routed` evidence, cross-surface artifact
  normalization, and replayable resource URIs.
- Agent QA showcase recorder completed on 2026-05-14. Stable doctrine lives in
  `docs/architecture/agent-qa-showcase-recorder.md`. Implementation covers
  capture manifests, governed browser raw-capture proof, transcript screenshot
  galleries, browser WebM rendering with captions and click zooms, governed
  Windows computer capture proof, local timeline adjustments, voice input, TTS
  narration, microphone capture, voiceover tracks, and neutral external-editor
  handoff artifacts for SRT, VTT, marker JSON, and editor-project metadata.
- External benchmark validation platform completed on 2026-05-08. Stable
  doctrine lives in `docs/architecture/benchmark-validation.md`; operator usage
  lives in `docs/guides/eval.md`. Implementation covers benchmark-facing
  profiles, baseline readiness gates, internal seed datasets, baseline runner,
  structural scorers, BFCL/AgentDojo/tau projection adapters, benchmark CLI
  commands, public report generation, and the blocked coding-benchmark decision
  for SWE-bench-style tracks.
- Browser operator foundations and snapshot monitor completed on 2026-05-14.
  Stable doctrine lives in `docs/architecture/developer-tools.md`; operator
  usage lives in `docs/guides/tool-use.md`. Implementation covers governed
  browser session state, artifact-backed observations, transcript screenshot
  galleries, Browser tab snapshot and frame-stream projection,
  takeover/release ownership, brokered pointer/wheel/text/key input,
  provider-side mutation blocking while the operator owns the session, fresh
  post-release observations, sanitized browser operator evidence, and explicit
  transport labels for `snapshot-polling` and `cdp-screencast`.

## Execution Priority

1. Keep the late native/browser sequence ordered as: `02` native operator
   surface foundation, `03` embedded browser host capability, `04` embedded
   browser operator surface, then `05` native cockpit and projection
   performance.
2. Treat performance architecture as part of `02` from the start: shared
   projections, batching, resource links, virtualization, and metrics are not
   late cleanup.
3. Keep `05-native-operator-cockpit-and-projection-performance.md` deferred
   until managed agents create real high-density workloads and config
   projection makes local/cloud/team/CI instance boundaries explicit.

## Deferred Candidates

The following ideas were removed from the retired plan/goal workflow-control
roadmap as active phases because they are not required to close the implemented
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
than extending a retired roadmap.

## Rules

- Do not add roadmap files for completed doctrine.
- Do not keep completed implementation plans as roadmap history.
- Do not split one concern across multiple near-duplicate plan files.
- Delete superseded roadmap docs once their stable doctrine is absorbed into
  canonical architecture or guide documentation.
