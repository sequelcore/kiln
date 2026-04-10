# Documentation Refactor Plan

## Objective
Refactor Kiln documentation into a modular, professional, and internally consistent system aligned with the new Kiln vision as a cybernetic control plane.

The goal is to remove the current overlap between doctrine, research, guides, and roadmap material, then re-express each concern in a single canonical location.

## Principles
- One source of truth per concern.
- No legacy framing kept alive in parallel.
- No backward-compatibility documentation.
- Research explains mechanisms; architecture defines Kiln; guides explain usage.
- Root docs must reflect the current identity of Kiln, not historical labels.
- Architecture content must be modular, not trapped in one monolith.
- Delete superseded docs once content is absorbed.

## Current State
The current doc tree is functional but mixed:
- Root docs still carry historical identity language.
- `docs/architecture.md` is a large canonical monolith.
- `docs/concepts.md` still reflects older terminology.
- `docs/guides/*` mixes usage, architecture, and product framing.
- `docs/research/biological-kiln/*` is a research workspace, not the final synthesis layer.
- `docs/adr/*` contains old naming and duplicate numbering.

## Target Information Architecture
### Root
- `README.md`
- `CLAUDE.md`
- `CONTRIBUTING.md`
- `STRATEGY.md`
- `HOTFIX.MD`

### Docs
- `docs/README.md`
- `docs/architecture/`
- `docs/research/`
- `docs/guides/`
- `docs/configuration/`
- `docs/sdk/`
- `docs/adr/`
- `docs/roadmap/`

### Target Doc Roles
- `docs/architecture/*`: canonical architecture doctrine, split by concern.
- `docs/research/*`: synthesized research and mechanism mapping, rooted at `docs/research`, not under `biological-kiln`.
- `docs/guides/*`: operational usage, setup, and practical workflows.
- `docs/roadmap/*`: planning, sequencing, and execution tracking.
- `docs/adr/*`: formal decisions only.

## Target Docs By Area
### Architecture
Create or split into:
- `docs/architecture/README.md`
- `docs/architecture/identity.md`
- `docs/architecture/control-model.md`
- `docs/architecture/subsystems.md`
- `docs/architecture/flows.md`
- `docs/architecture/memory.md`
- `docs/architecture/context-governance.md`
- `docs/architecture/safety.md`
- `docs/architecture/coordination.md`
- `docs/architecture/tool-execution.md`
- `docs/architecture/adaptation.md`
- `docs/architecture/invariants.md`

### Research
Create or consolidate into:
- `docs/research/README.md`
- `docs/research/kiln-research-synthesis.md`
- `docs/research/cybernetic-foundations.md`
- `docs/research/biological-mechanisms.md`
- `docs/research/current-state-mapping.md`

### Roadmap
Create:
- `docs/roadmap/README.md`
- `docs/roadmap/documentation-refactor-plan.md`
- `docs/roadmap/architecture-refactor-plan.md`

## File Disposition
### Rewrite
- `README.md`
- `CLAUDE.md`
- `STRATEGY.md`
- `docs/README.md`
- `docs/getting-started.md`
- `docs/concepts.md`

### Keep with terminology cleanup
- `CONTRIBUTING.md`
- `HOTFIX.MD`
- `docs/faq.md`
- `docs/configuration/app-yaml.md`
- `docs/configuration/gateway-yaml.md`
- `docs/sdk/react-hooks.md`
- `docs/sdk/studio.md`

### Split, extract, then reduce to an entrypoint
- `docs/architecture.md` -> split into `docs/architecture/*`, then reduce to a short index/redirect or delete once links are updated

### Merge and absorb into new root research docs
- `docs/research/coordination-intelligence.md`
- `docs/research/biological-kiln/*`

### Rewrite to match new terminology
- `docs/guides/coordination-intelligence.md`
- `docs/guides/memory.md`
- `docs/guides/safety.md`
- `docs/guides/tool-use.md`
- `docs/guides/multi-agent.md`
- `docs/guides/model-routing.md`

### Keep, but relocate or normalize under the final guide taxonomy
- `docs/guides/cli-wrapper.md` -> normalize into `docs/guides/cli.md` or keep under current name if the guide remains wrapper-specific
- `docs/guides/channels.md`
- `docs/guides/delegation.md`
- `docs/guides/domains.md`
- `docs/guides/enrichment.md`
- `docs/guides/eval.md`
- `docs/guides/eval-benchmarking.md`
- `docs/guides/global-config.md`
- `docs/guides/hooks.md`
- `docs/guides/knowledge.md`
- `docs/guides/multi-tenant.md`
- `docs/guides/observability.md`
- `docs/guides/plan-mode.md`
- `docs/guides/skills.md`
- `docs/guides/triggers.md`
- `docs/guides/tui.md`

### Rework or renumber
- `docs/adr/ADR-001-neural-field-orchestration.md`
- `docs/adr/ADR-003-meta-orchestrator-model.md`
- duplicate `ADR-002` files in `docs/adr/`

### Explicit target ADR end-state
- `ADR-001-kiln-control-plane-identity.md` -> new canonical identity decision replacing meta-orchestrator framing
- `ADR-002-subprocess-integration.md` -> preserve if still valid, rewrite only for terminology alignment
- `ADR-003-tui-gateway-architecture.md` -> preserve current TUI/gateway decision under clean numbering
- `ADR-004-budgeted-context-governance.md` -> preserve the budgeted-context decision under clean numbering
- `ADR-001-neural-field-orchestration.md` -> rewrite into a narrower chain-governor or chain-termination decision, or delete if fully superseded by canonical architecture and no longer needed as a decision record
- `ADR-003-meta-orchestrator-model.md` -> remove or replace; old framing must not survive as an active ADR title

## Execution Phases
### Phase 1. Taxonomy and freeze
- Confirm the final doc map.
- Freeze canonical terminology.
- Stop adding new conceptual docs until the split is defined.

Exit criteria:
- target structure agreed
- naming rules agreed

### Phase 2. Extract architecture
- Split `docs/architecture.md` into `docs/architecture/*`.
- Keep a short architecture entrypoint only if needed.
- Fix doctrinal gaps during extraction, not after.

Exit criteria:
- architecture is modular
- one canonical architecture path exists

### Phase 3. Synthesize research
- Consolidate the useful content from `docs/research/biological-kiln/*` into root-level research docs.
- Move the coordination research under the same root-level synthesis.
- Delete the old research subtree after absorption.

Exit criteria:
- no final synthesis remains under `biological-kiln`
- research is organized by theme, not by prompt sequence

### Phase 4. Align root docs
- Rewrite `README.md`, `CLAUDE.md`, and `STRATEGY.md` to the new identity.
- Remove historical framing that conflicts with the control-plane model.
- Remove `meta-orchestrator` as an identity label from root docs. If mentioned at all, it may appear only as historical context or deprecated framing.

Exit criteria:
- root docs agree on Kiln identity
- no conflicting framing remains in the entry docs

### Phase 5. Clean guides and ADRs
- Recast guides as usage and operations docs.
- Normalize ADR numbering and titles.
- Remove obsolete concept spillover from guides.

Exit criteria:
- guides do not define doctrine
- ADR set is internally consistent

### Phase 6. Final cleanup
- Delete superseded docs.
- Update all internal links.
- Remove empty or redundant sections.

Exit criteria:
- one source of truth per concern
- no parallel old/new narrative remains

## Naming Rules
- Replace old names instead of aliasing them.
- Prefer control terms over metaphor terms.
- Use canonical names consistently across docs and code references.

Examples:
- `Router` -> `IngressGovernor`
- `ContextFormatter` -> `ContextGovernor`
- `ThresholdAllocator` -> `DemandAllocator`
- `CascadeController` -> `ChainGovernor`
- `TaskChannel` -> `TaskRegistry`
- `SwarmStore` -> `CoordinationStore`

## Link Update Checklist
- Root README links
- Docs index links
- Architecture cross-links
- Research cross-links
- Guide cross-links
- ADR references
- Strategy references

## Risks
- Splitting the architecture document can create temporary inconsistency if partial edits ship.
- Root docs may continue to drift if updated before the modular architecture lands.
- ADR renumbering can break references if not done in one pass.
- Deleting old research too early can lose useful synthesis if content is not fully absorbed.

## Recommended Execution Order
1. Freeze taxonomy and names.
2. Split `docs/architecture.md`.
3. Build root research synthesis.
4. Define the final location of `docs/getting-started.md` and rewrite it under the guides taxonomy.
5. Rewrite `README.md`, `CLAUDE.md`, and `STRATEGY.md`.
6. Clean guides.
7. Clean ADRs.
8. Delete superseded docs.
9. Run link audit.

## Acceptance Criteria
- Kiln has one canonical identity across all entry docs.
- Architecture is modular and documented by concern.
- Research synthesis lives at `docs/research` root.
- Guides are operational, not doctrinal.
- ADRs are consistent and current.
- No active doc relies on obsolete terminology as its primary framing.
- No concern is owned by more than one canonical document.
- Every current Markdown document has an explicit disposition: keep, rewrite, split, merge, relocate, or delete.
