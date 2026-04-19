# Taxonomy Freeze

This document is the Slice 1 taxonomy freeze for the Kiln documentation
refactor.

Its purpose is to:

- freeze canonical terminology
- define the target documentation map
- assign an explicit disposition to each active repository Markdown document

This file excludes third-party Markdown under `node_modules/`.

## Canonical Identity

Kiln is a biocybernetic control plane for autonomous agent sessions.

Kiln is not:

- a meta-orchestrator as primary identity
- a literal organism
- a consumer application
- a workflow engine as its canonical definition

## Canonical Terminology

- `control plane`
- `IngressGovernor`
- `ContextGovernor`
- `DemandAllocator`
- `ChainGovernor`
- `TaskRegistry`
- `CoordinationStore`
- `operational mode`
- `safety pipeline`
- `active shared medium`

Terms to remove from active framing:

- `meta-orchestrator`
- `organism` as a literal identity label
- `neural field orchestration` as a totalizing system identity
- `Router` as canonical architecture term
- `ContextFormatter` as canonical architecture term
- `ThresholdAllocator` as canonical architecture term
- `CascadeController` as canonical architecture term
- `TaskChannel` as canonical architecture term
- `SwarmStore` as canonical architecture term

These terms may still appear in migration notes, ADR history, or contrastive
sentences that explicitly reject the older framing. They must not appear as the
active doctrine, canonical identity, or current subsystem vocabulary.

## Target Documentation Map

### Root

- `README.md`
- `CLAUDE.md`
- `CONTRIBUTING.md`
- `STRATEGY.md`
- `HOTFIX.MD`

### Docs Index

- `docs/README.md`

### Docs Root

- `docs/changelog.md`
- `docs/concepts.md`
- `docs/faq.md`
- `docs/getting-started.md`

### Architecture

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

- `docs/research/README.md`
- `docs/research/01-kiln-research-synthesis.md`
- `docs/research/02-cybernetic-foundations.md`
- `docs/research/03-biological-mechanisms.md`
- `docs/research/04-current-state-mapping.md`
- `docs/research/05-memory-systems.md`
- `docs/research/06-safety-defense.md`
- `docs/research/07-regulation-and-adaptation.md`
- `docs/research/08-context-governance.md`
- `docs/research/09-tool-execution-and-trust.md`
- `docs/research/10-coordination-intelligence.md`

### Guides

- `docs/guides/channels.md`
- `docs/guides/cli-wrapper.md`
- `docs/guides/coordination-intelligence.md`
- `docs/guides/delegation.md`
- `docs/guides/domains.md`
- `docs/guides/enrichment.md`
- `docs/guides/eval.md`
- `docs/guides/eval-benchmarking.md`
- `docs/guides/global-config.md`
- `docs/guides/hooks.md`
- `docs/guides/knowledge.md`
- `docs/guides/memory.md`
- `docs/guides/model-routing.md`
- `docs/guides/multi-agent.md`
- `docs/guides/multi-tenant.md`
- `docs/guides/observability.md`
- `docs/guides/plan-mode.md`
- `docs/guides/safety.md`
- `docs/guides/skills.md`
- `docs/guides/tool-use.md`
- `docs/guides/triggers.md`
- `docs/guides/tui.md`

### Configuration

- `docs/configuration/app-yaml.md`
- `docs/configuration/gateway-yaml.md`

### SDK

- `docs/sdk/react-hooks.md`
- `docs/sdk/studio.md`

### ADR

- `docs/adr/ADR-001-neural-field-orchestration.md`
- `docs/adr/ADR-002-subprocess-integration.md`
- `docs/adr/ADR-003-meta-orchestrator-model.md`
- `docs/adr/ADR-004-budgeted-sufficient-context-orchestration.md`
- `docs/adr/ADR-005-freeze-tui-prioritize-gui.md`
- `docs/adr/ADR-006-gui-stack-and-binding-contract.md`
- `docs/adr/ADR-007-tui-gateway-architecture.md`

### Roadmap

- `docs/roadmap/README.md`
- `docs/roadmap/01-taxonomy-freeze.md`
- `docs/roadmap/02-module-mapping.md`
- `docs/roadmap/03-bounded-context-decisions.md`
- `docs/roadmap/04-orchestrator-refactor-roadmap.md`
- `docs/roadmap/05-gui-phase-1-parity-checklist.md`
- `docs/roadmap/06-external-benchmark-validation.md`

## File Inventory And Disposition

### Root Docs

- `README.md`
  Disposition: rewrite
  Destination: keep at root

- `CLAUDE.md`
  Disposition: rewrite
  Destination: keep at root

- `CONTRIBUTING.md`
  Disposition: keep with terminology cleanup
  Destination: keep at root

- `STRATEGY.md`
  Disposition: rewrite
  Destination: keep at root

- `HOTFIX.MD`
  Disposition: keep with terminology cleanup
  Destination: keep at root

### Docs Root

- `docs/README.md`
  Disposition: rewrite
  Destination: keep at `docs/README.md`

- `docs/architecture.md`
  Disposition: split then reduce to entrypoint or delete
  Destination: `docs/architecture/*`

- `docs/changelog.md`
  Disposition: keep
  Destination: keep at `docs/changelog.md`

- `docs/concepts.md`
  Disposition: keep as high-level terminology guide
  Destination: keep at `docs/concepts.md`

- `docs/faq.md`
  Disposition: keep with terminology cleanup
  Destination: keep at `docs/faq.md`

- `docs/getting-started.md`
  Disposition: keep as entry guide
  Destination: keep at `docs/getting-started.md`

### ADR

- `docs/adr/ADR-001-neural-field-orchestration.md`
  Disposition: keep
  Destination: current path

- `docs/adr/ADR-002-subprocess-integration.md`
  Disposition: keep
  Destination: `docs/adr/ADR-002-subprocess-integration.md`

- `docs/adr/ADR-003-meta-orchestrator-model.md`
  Disposition: keep
  Destination: `docs/adr/ADR-003-meta-orchestrator-model.md`

- `docs/adr/ADR-004-budgeted-sufficient-context-orchestration.md`
  Disposition: keep
  Destination: `docs/adr/ADR-004-budgeted-sufficient-context-orchestration.md`

- `docs/adr/ADR-005-freeze-tui-prioritize-gui.md`
  Disposition: keep
  Destination: `docs/adr/ADR-005-freeze-tui-prioritize-gui.md`

- `docs/adr/ADR-006-gui-stack-and-binding-contract.md`
  Disposition: keep
  Destination: `docs/adr/ADR-006-gui-stack-and-binding-contract.md`

- `docs/adr/ADR-007-tui-gateway-architecture.md`
  Disposition: keep
  Destination: `docs/adr/ADR-007-tui-gateway-architecture.md`

### Configuration

- `docs/configuration/app-yaml.md`
  Disposition: keep with terminology cleanup
  Destination: keep at current path

- `docs/configuration/gateway-yaml.md`
  Disposition: keep with terminology cleanup
  Destination: keep at current path

### Guides

- `docs/guides/channels.md`
  Disposition: keep with terminology cleanup
  Destination: `docs/guides/channels.md`

- `docs/guides/cli-wrapper.md`
  Disposition: keep
  Destination: `docs/guides/cli-wrapper.md`

- `docs/guides/coordination-intelligence.md`
  Disposition: keep as operational coordination guide
  Destination: `docs/guides/coordination-intelligence.md`

- `docs/guides/delegation.md`
  Disposition: keep with terminology cleanup
  Destination: `docs/guides/delegation.md`

- `docs/guides/domains.md`
  Disposition: keep with terminology cleanup
  Destination: `docs/guides/domains.md`

- `docs/guides/enrichment.md`
  Disposition: keep with terminology cleanup
  Destination: `docs/guides/enrichment.md`

- `docs/guides/eval-benchmarking.md`
  Disposition: keep with terminology cleanup
  Destination: `docs/guides/eval-benchmarking.md`

- `docs/guides/eval.md`
  Disposition: keep with terminology cleanup
  Destination: `docs/guides/eval.md`

- `docs/guides/global-config.md`
  Disposition: keep with terminology cleanup
  Destination: `docs/guides/global-config.md`

- `docs/guides/hooks.md`
  Disposition: keep with terminology cleanup
  Destination: `docs/guides/hooks.md`

- `docs/guides/knowledge.md`
  Disposition: keep with terminology cleanup
  Destination: `docs/guides/knowledge.md`

- `docs/guides/memory.md`
  Disposition: keep as operational memory guide
  Destination: `docs/guides/memory.md`

- `docs/guides/model-routing.md`
  Disposition: keep as operational routing guide
  Destination: `docs/guides/model-routing.md`

- `docs/guides/multi-agent.md`
  Disposition: keep as operational role-routing guide
  Destination: `docs/guides/multi-agent.md`

- `docs/guides/multi-tenant.md`
  Disposition: keep with terminology cleanup
  Destination: `docs/guides/multi-tenant.md`

- `docs/guides/observability.md`
  Disposition: keep with terminology cleanup
  Destination: `docs/guides/observability.md`

- `docs/guides/plan-mode.md`
  Disposition: keep with terminology cleanup
  Destination: `docs/guides/plan-mode.md`

- `docs/guides/safety.md`
  Disposition: keep as operational safety guide
  Destination: `docs/guides/safety.md`

- `docs/guides/skills.md`
  Disposition: keep with terminology cleanup
  Destination: `docs/guides/skills.md`

- `docs/guides/tool-use.md`
  Disposition: keep as operational tool-use guide
  Destination: `docs/guides/tool-use.md`

- `docs/guides/triggers.md`
  Disposition: keep with terminology cleanup
  Destination: `docs/guides/triggers.md`

- `docs/guides/tui.md`
  Disposition: keep with terminology cleanup
  Destination: `docs/guides/tui.md`

### Research

- `docs/research/01-kiln-research-synthesis.md`
  Disposition: keep
  Destination: current path

- `docs/research/02-cybernetic-foundations.md`
  Disposition: keep
  Destination: current path

- `docs/research/03-biological-mechanisms.md`
  Disposition: keep
  Destination: current path

- `docs/research/04-current-state-mapping.md`
  Disposition: keep
  Destination: current path

- `docs/research/05-memory-systems.md`
  Disposition: keep
  Destination: current path

- `docs/research/06-safety-defense.md`
  Disposition: keep
  Destination: current path

- `docs/research/07-regulation-and-adaptation.md`
  Disposition: keep
  Destination: current path

- `docs/research/08-context-governance.md`
  Disposition: keep
  Destination: current path

- `docs/research/09-tool-execution-and-trust.md`
  Disposition: keep
  Destination: current path

- `docs/research/10-coordination-intelligence.md`
  Disposition: keep as supporting reference
  Destination: current path

- Former `docs/research/biological-kiln/*`
  Disposition: absorbed and deleted
  Destination: content merged into the numbered research docs above

### Roadmap

- `docs/roadmap/README.md`
  Disposition: keep
  Destination: current path

- `docs/roadmap/01-taxonomy-freeze.md`
  Disposition: keep
  Destination: current path

- `docs/roadmap/02-module-mapping.md`
  Disposition: keep
  Destination: current path

- `docs/roadmap/03-bounded-context-decisions.md`
  Disposition: keep
  Destination: current path

- `docs/roadmap/04-orchestrator-refactor-roadmap.md`
  Disposition: keep
  Destination: current path

- `docs/roadmap/05-gui-phase-1-parity-checklist.md`
  Disposition: keep
  Destination: current path

- `docs/roadmap/06-external-benchmark-validation.md`
  Disposition: keep
  Destination: current path

### SDK

- `docs/sdk/react-hooks.md`
  Disposition: keep with terminology cleanup
  Destination: current path

- `docs/sdk/studio.md`
  Disposition: keep with terminology cleanup
  Destination: current path

## Notes

- Example project READMEs under `examples/*` are excluded from this Slice 1
  taxonomy because the current documentation refactor scope is the primary
  repository documentation system.
- Package READMEs are also excluded from this Slice 1 taxonomy unless they are
  later pulled into the primary docs refactor scope.

## Closure Standard

This taxonomy freeze is closed when all of the following are true:

- the target documentation map and active-file inventory describe the same
  in-scope documentation set
- canonical identity wording is consistent across primary docs
- terms marked for removal no longer appear as active doctrine or canonical
  subsystem vocabulary
- transitional entrypoints are reduced to link-preserving stubs only
- absorbed legacy subtrees have been removed from the active documentation tree
