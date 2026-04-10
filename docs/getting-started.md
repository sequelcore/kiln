# Getting Started

This document is the shortest safe entry into Kiln's current documentation.

Kiln is a cybernetic control plane for governed AI work. If you start from older
material that frames it as an orchestration engine, a meta-orchestrator, or a
set of biological primitives, you will inherit the wrong model.

## Read This First

Start in this order:

1. [Architecture Index](architecture/README.md)
2. [Identity](architecture/identity.md)
3. [Control Model](architecture/control-model.md)
4. [Invariants](architecture/invariants.md)
5. [Research Synthesis](research/kiln-research-synthesis.md)

Then continue with the subsystem and flow docs:

- [Subsystems](architecture/subsystems.md)
- [Flows](architecture/flows.md)
- [Safety](architecture/safety.md)
- [Coordination](architecture/coordination.md)
- [Memory](architecture/memory.md)
- [Context Governance](architecture/context-governance.md)
- [Adaptation](architecture/adaptation.md)

## What To Understand First

Before touching code, keep these points fixed:

- Kiln regulates work; it does not merely dispatch prompts.
- Context is governed, budgeted, and safety-bounded.
- Coordination is explicit and stateful, not magical prompt inheritance.
- Safety defaults to fail-closed on ambiguous dangerous work.
- Memory is layered and revision-aware.
- Biological metaphors may explain mechanisms, but cybernetics is the governing framework.

## Current Documentation State

The architecture and research docs under [`docs/architecture/`](architecture/README.md)
and [`docs/research/`](research/README.md) are the active source of truth.

Some operational guides under `docs/guides/` still contain older terminology and
are being rewritten. If a guide conflicts with the modular architecture docs,
trust the architecture docs.

## Where To Go Next

- If you need doctrine: [Architecture](architecture/README.md)
- If you need rationale: [Research](research/README.md)
- If you need sequencing: [Roadmap](roadmap/README.md)
- If you need runtime configuration details: [Configuration](configuration/app-yaml.md)
