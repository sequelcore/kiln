# Gateway YAML Reference

This document is a transitional reference for the current gateway configuration
surface.

`gateway.yaml` describes how the present runtime is wired, but it does not
define Kiln's architecture. The control-plane doctrine lives in
[`docs/architecture/`](../architecture/README.md).

## Purpose

Use this page to understand the current deployment and wiring surface for:

- app bindings
- channel bindings
- auth configuration
- MCP exposure
- session and handoff-related runtime wiring

## Architectural Position

The gateway is an execution and hosting surface. It is not the product identity.

That means this file should be read as:

- a runtime binding layer
- a deployment surface
- an operator-facing infrastructure interface

It should not be read as the place where Kiln's conceptual model originates.

## Canonical Crosswalk

When reading `gateway.yaml`, map it into the current architecture:

- app and channel bindings belong to runtime surfaces
- auth and policy wiring belong to safety and control boundaries
- session and handoff wiring belong to governed flows and operational modes
- provider selection belongs to execution policy, not identity

Relevant docs:

- [Flows](../architecture/flows.md)
- [Safety](../architecture/safety.md)
- [Tool Execution](../architecture/tool-execution.md)
- [Control Model](../architecture/control-model.md)

## Transitional Status

The older exhaustive deployment narrative centered Kiln too strongly around the
gateway/runtime stack. That is no longer acceptable as the primary framing.

The gateway remains important, but as one execution surface beneath the control
plane.

## Future Direction

If this reference is rebuilt in detail later, it should:

- align configuration terms to the frozen taxonomy
- distinguish stable doctrine from implementation residue
- describe runtime surfaces as subordinate to the control plane
