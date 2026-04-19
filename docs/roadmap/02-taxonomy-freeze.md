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

## Target Documentation Map

### Root

- `README.md`
- `CLAUDE.md`
- `CONTRIBUTING.md`
- `STRATEGY.md`
- `HOTFIX.MD`

### Docs Index

- `docs/README.md`

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
- `docs/research/kiln-research-synthesis.md`
- `docs/research/cybernetic-foundations.md`
- `docs/research/biological-mechanisms.md`
- `docs/research/current-state-mapping.md`

### Guides

- `docs/guides/README.md`
- `docs/guides/getting-started.md`
- `docs/guides/cli.md`
- `docs/guides/channels.md`
- `docs/guides/delegation.md`
- `docs/guides/domains.md`
- `docs/guides/enrichment.md`
- `docs/guides/eval.md`
- `docs/guides/eval-benchmarking.md`
- `docs/guides/global-config.md`
- `docs/guides/hooks.md`
- `docs/guides/knowledge.md`
- `docs/guides/runtime-operations.md`
- `docs/guides/multi-tenant.md`
- `docs/guides/observability.md`
- `docs/guides/plan-mode.md`
- `docs/guides/skills.md`
- `docs/guides/triggers.md`
- `docs/guides/tui.md`

### Configuration

- `docs/configuration/app-yaml.md`
- `docs/configuration/gateway-yaml.md`

### SDK

- `docs/sdk/react-hooks.md`
- `docs/sdk/studio.md`

### ADR

- `docs/adr/ADR-001-kiln-control-plane-identity.md`
- `docs/adr/ADR-002-subprocess-integration.md`
- `docs/adr/ADR-003-tui-gateway-architecture.md`
- `docs/adr/ADR-004-budgeted-context-governance.md`

### Roadmap

- `docs/roadmap/README.md`
- `docs/roadmap/01-docs-reset-plan.md`
- `docs/roadmap/02-taxonomy-freeze.md`
- `docs/roadmap/03-module-mapping.md`
- `docs/roadmap/04-bounded-context-decisions.md`
- `docs/roadmap/05-orchestrator-refactor-roadmap.md`
- `docs/roadmap/06-gui-phase-1-parity-checklist.md`
- `docs/roadmap/07-external-benchmark-validation.md`

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
  Disposition: rewrite and reduce to a terminology glossary only
  Destination: keep at `docs/concepts.md` only if it remains a non-doctrinal glossary; otherwise absorb into `docs/architecture/identity.md` and delete

- `docs/faq.md`
  Disposition: keep with terminology cleanup
  Destination: keep at `docs/faq.md`

- `docs/getting-started.md`
  Disposition: relocate and rewrite
  Destination: `docs/guides/getting-started.md`

### ADR

- `docs/adr/ADR-001-neural-field-orchestration.md`
  Disposition: rewrite into a narrower decision or delete if superseded
  Destination: likely replaced by a chain-governor or chain-termination ADR

- `docs/adr/ADR-002-subprocess-integration.md`
  Disposition: keep with terminology cleanup
  Destination: `docs/adr/ADR-002-subprocess-integration.md`

- `docs/adr/ADR-007-tui-gateway-architecture.md`
  Disposition: renumber and keep
  Destination: `docs/adr/ADR-003-tui-gateway-architecture.md`

- `docs/adr/ADR-003-meta-orchestrator-model.md`
  Disposition: delete or replace
  Destination: superseded by control-plane identity ADR

- `docs/adr/ADR-004-budgeted-sufficient-context-orchestration.md`
  Disposition: retitle and keep
  Destination: `docs/adr/ADR-004-budgeted-context-governance.md`

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
  Disposition: rename or absorb
  Destination: `docs/guides/cli.md`

- `docs/guides/coordination-intelligence.md`
  Disposition: split
  Destination: architecture detail to `docs/architecture/coordination.md`; operational residue to `docs/guides/runtime-operations.md`

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
  Disposition: split
  Destination: doctrine to `docs/architecture/memory.md`; operational content to `docs/guides/runtime-operations.md`

- `docs/guides/model-routing.md`
  Disposition: rewrite
  Destination: likely absorbed into `docs/architecture/coordination.md` plus a smaller operational guide if still needed

- `docs/guides/multi-agent.md`
  Disposition: rewrite
  Destination: operational content to `docs/guides/runtime-operations.md`; doctrine to `docs/architecture/coordination.md`

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
  Disposition: split
  Destination: doctrine to `docs/architecture/safety.md`; operational residue to `docs/guides/runtime-operations.md`

- `docs/guides/skills.md`
  Disposition: keep with terminology cleanup
  Destination: `docs/guides/skills.md`

- `docs/guides/tool-use.md`
  Disposition: split
  Destination: doctrine to `docs/architecture/tool-execution.md`; operational residue to `docs/guides/runtime-operations.md`

- `docs/guides/triggers.md`
  Disposition: keep with terminology cleanup
  Destination: `docs/guides/triggers.md`

- `docs/guides/tui.md`
  Disposition: keep with terminology cleanup
  Destination: `docs/guides/tui.md`

### Research

- `docs/research/coordination-intelligence.md`
  Disposition: merge and absorb
  Destination: root-level research docs under `docs/research/*`

- `docs/research/biological-kiln/PROGRAM.md`
  Disposition: absorb or delete
  Destination: no final destination; execution prompt scaffold is not part of the final research taxonomy

- `docs/research/biological-kiln/01-global-framing.md`
  Disposition: merge and absorb
  Destination: `docs/research/biological-mechanisms.md` and `docs/research/kiln-research-synthesis.md`

- `docs/research/biological-kiln/02-master-kiln-mapping.md`
  Disposition: merge and absorb
  Destination: `docs/research/kiln-research-synthesis.md` and `docs/research/current-state-mapping.md`

- `docs/research/biological-kiln/03-nervous-system-routing-control.md`
  Disposition: merge and absorb
  Destination: `docs/research/biological-mechanisms.md`

- `docs/research/biological-kiln/04-neuroscience-attention-salience.md`
  Disposition: merge and absorb
  Destination: `docs/research/biological-mechanisms.md`

- `docs/research/biological-kiln/05-layered-memory-architecture.md`
  Disposition: merge and absorb
  Destination: `docs/research/biological-mechanisms.md` and `docs/research/current-state-mapping.md`

- `docs/research/biological-kiln/06-reconsolidation-mutable-memory.md`
  Disposition: merge and absorb
  Destination: `docs/research/biological-mechanisms.md` and `docs/research/current-state-mapping.md`

- `docs/research/biological-kiln/07-immune-system-safety-threat-detection.md`
  Disposition: merge and absorb
  Destination: `docs/research/biological-mechanisms.md` and `docs/research/current-state-mapping.md`

- `docs/research/biological-kiln/08-homeostasis-resource-regulation.md`
  Disposition: merge and absorb
  Destination: `docs/research/cybernetic-foundations.md` and `docs/research/kiln-research-synthesis.md`

- `docs/research/biological-kiln/09-swarm-coordination-intelligence.md`
  Disposition: merge and absorb
  Destination: `docs/research/biological-mechanisms.md` and `docs/research/current-state-mapping.md`

- `docs/research/biological-kiln/10-fungal-distributed-context-substrate.md`
  Disposition: merge and absorb
  Destination: `docs/research/biological-mechanisms.md` and `docs/research/kiln-research-synthesis.md`

- `docs/research/biological-kiln/11-morphogenesis-growth-differentiation.md`
  Disposition: merge and absorb
  Destination: `docs/research/biological-mechanisms.md`

- `docs/research/biological-kiln/12-cybernetic-control-loops.md`
  Disposition: merge and absorb
  Destination: `docs/research/cybernetic-foundations.md`

- `docs/research/biological-kiln/13-kiln-memory-applied-today.md`
  Disposition: merge and absorb
  Destination: `docs/research/current-state-mapping.md`

- `docs/research/biological-kiln/14-kiln-context-governance-applied-today.md`
  Disposition: merge and absorb
  Destination: `docs/research/current-state-mapping.md`

- `docs/research/biological-kiln/15-kiln-safety-applied-today.md`
  Disposition: merge and absorb
  Destination: `docs/research/current-state-mapping.md`

- `docs/research/biological-kiln/16-kiln-coordination-intelligence-applied-today.md`
  Disposition: merge and absorb
  Destination: `docs/research/current-state-mapping.md`

- `docs/research/biological-kiln/17-kiln-tool-execution-applied-today.md`
  Disposition: merge and absorb
  Destination: `docs/research/current-state-mapping.md`

- `docs/research/biological-kiln/18-reading-list-generator.md`
  Disposition: delete after synthesis
  Destination: none

- `docs/research/biological-kiln/19-research-notes-normalizer.md`
  Disposition: delete after synthesis
  Destination: none

### Roadmap

- `docs/roadmap/01-docs-reset-plan.md`
  Disposition: keep
  Destination: current path

- `docs/roadmap/README.md`
  Disposition: keep
  Destination: current path

- `docs/roadmap/02-taxonomy-freeze.md`
  Disposition: keep
  Destination: current path

- `docs/roadmap/03-module-mapping.md`
  Disposition: keep
  Destination: current path

- `docs/roadmap/04-bounded-context-decisions.md`
  Disposition: keep
  Destination: current path

- `docs/roadmap/05-orchestrator-refactor-roadmap.md`
  Disposition: keep
  Destination: current path

- `docs/roadmap/06-gui-phase-1-parity-checklist.md`
  Disposition: keep
  Destination: current path

- `docs/roadmap/07-external-benchmark-validation.md`
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
