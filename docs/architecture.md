# Kiln Architecture

> Status: temporary entrypoint during modular extraction.

The canonical architecture has moved into the modular documents under
`docs/architecture/`.

Use these files as the active source of truth:

- [Architecture Index](architecture/README.md)
- [Identity](architecture/identity.md)
- [Control Model](architecture/control-model.md)
- [Subsystems](architecture/subsystems.md)
- [Flows](architecture/flows.md)
- [Memory](architecture/memory.md)
- [Context Governance](architecture/context-governance.md)
- [Safety](architecture/safety.md)
- [Coordination](architecture/coordination.md)
- [Tool Execution](architecture/tool-execution.md)
- [Adaptation](architecture/adaptation.md)
- [Invariants](architecture/invariants.md)

## Transitional Rule

During the documentation refactor:

- new architecture content belongs in `docs/architecture/`
- this file should not receive new doctrine
- this file exists only to preserve links until the refactor reaches the final
  cleanup slice

## Canonical Summary

Kiln is a biocybernetic control plane for autonomous agent sessions.

Its primary architectural concerns are:

- bounded control over session lifecycle
- context governance and token-budget management
- layered memory with explicit retention policy
- layered safety with explicit escalation
- coordination, tool execution, and adaptation under observable control loops

Biological and cybernetic research informs the design, but biological metaphor
is not the implementation contract or the product identity.
