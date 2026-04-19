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
