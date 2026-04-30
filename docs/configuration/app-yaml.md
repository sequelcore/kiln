# App YAML Reference

This document is now a transitional configuration reference.

`app.yaml` remains an important implementation surface, but it is not the
architectural source of truth for Kiln. The source of truth is the modular
architecture under [`docs/architecture/`](../architecture/README.md).

It is a first-class deployable app declaration. When bound by `gateway.yaml`, an
`app.yaml` is instantiated by the App Gateway and participates in the same
session, memory, safety, tool, event, and cost control plane as other runtime
surfaces. GUI, CLI, and TUI operate that runtime; they do not replace the app
declaration with parallel surface-specific behavior.

If the configuration surface and the architecture diverge, the architecture wins
and the configuration must eventually be refactored to match it.

## What This File Is For

Use `app.yaml` documentation when you need to understand the currently supported
runtime configuration surface:

- routing and execution declarations
- memory and knowledge configuration
- safety and tool configuration
- channel and trigger wiring
- evaluation and model-routing settings

Do not use `app.yaml` as the primary way to infer what Kiln fundamentally is.

## Current Status

The configuration model still reflects earlier generations of Kiln in places:

- team-centric execution structure
- workflow and gate declarations
- capability lists
- app-first configuration language

Those concepts may still exist in the running product, but they should be read
as implementation-era structures, not as the final architectural vocabulary.

## Canonical Crosswalk

When reading configuration, reinterpret it through the current architecture:

- routing declarations map to admission and allocation concerns
- workflow and gates map to governed execution flows
- tool and permission declarations map to safety and tool-execution concerns
- memory and knowledge blocks map to layered memory and context governance
- model routing maps to control and adaptation policy, not product identity

Relevant architecture docs:

- [Identity](../architecture/identity.md)
- [Subsystems](../architecture/subsystems.md)
- [Flows](../architecture/flows.md)
- [Safety](../architecture/safety.md)
- [Memory](../architecture/memory.md)
- [Context Governance](../architecture/context-governance.md)
- [Tool Execution](../architecture/tool-execution.md)
- [Runtime Surfaces](../architecture/runtime-surfaces.md)

## Usage Guidance

If you are:

- designing architecture, start in `docs/architecture/`
- justifying a concept, start in `docs/research/`
- sequencing change, start in `docs/roadmap/`
- checking what the current parser/runtime accepts, use this config reference layer

## Transitional Note

The old exhaustive schema-first narrative has been intentionally removed from
this page because it preserved the outdated product frame too strongly.

If a detailed field-by-field reference is still needed during refactor, it
should be rebuilt later in a way that:

- matches the canonical taxonomy
- clearly marks implementation residue
- avoids reintroducing the old identity through documentation structure
