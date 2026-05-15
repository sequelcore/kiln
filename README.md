<p align="center">
  <img src="docs/assets/logo.svg" alt="Kiln" width="150" />
</p>

<h1 align="center">Kiln</h1>

<p align="center">
  <a href="https://github.com/sequelcore/kiln/actions/workflows/ci.yml"><img src="https://github.com/sequelcore/kiln/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License: Apache-2.0" /></a>
</p>

<p align="center">Biocybernetic control plane for governed AI work.</p>

---

Kiln is a biocybernetic control plane, not an orchestration engine, agent
shell, or literal organism model. Its contracts are expressed through
cybernetic control structures, and its architecture is informed by biological
and neural regulation.

It regulates AI work the way a thermostat regulates temperature: sense state,
compare it against policy and goals, apply bounded control, and recover safely
when conditions drift.

Its job is to govern execution, context, coordination, safety, and adaptation across tools and agents without letting any single model, prompt, or workflow become the system's source of truth.

## Thesis

Kiln exists to answer one question reliably:

**Given the current task, state, constraints, and risk posture, what work should be admitted, what context should be exposed, what coordination pattern should be activated, and what actions should be allowed right now?**

That framing changes the product boundary:

- Kiln is not "a wrapper around models"
- Kiln is not "a literal multi-agent organism"
- Kiln is not "a bag of orchestration primitives"
- Kiln is a regulatory layer over AI work with biocybernetic and neurotech
  lineage

## Architecture

The canonical architecture is modular and documented in [`docs/architecture/`](docs/architecture/README.md).

Core subsystems:

- **IngressGovernor** admits or rejects work and routes it into the proper control path
- **ContextGovernor** decides what context is sufficient, affordable, and safe to expose
- **DemandAllocator** decides whether work stays local, parallelizes, defers, or escalates
- **ChainGovernor** regulates multi-step execution and prevents unstable chains
- **TaskRegistry** tracks execution state, ownership, lifecycle, and recovery
- **CoordinationStore** provides the shared substrate for handoff, signals, claims, and state
- **SafetyKernel** enforces hard boundaries with fail-closed defaults
- **ModeController** manages operating modes such as `NORMAL`, `DEGRADED`, and `LOCKED`
- **TelemetryLoop** closes feedback loops through measurement, anomaly detection, and tuning
- **AdaptationEngine** updates policy and behavior without letting the system drift into self-corruption

## Documentation

Start here:

- [Documentation Index](docs/README.md)
- [Architecture Overview](docs/architecture/README.md)
- [Research Index](docs/research/README.md)
- [Roadmap](docs/roadmap/README.md)

Most important architecture documents:

- [Identity](docs/architecture/identity.md)
- [Control Model](docs/architecture/control-model.md)
- [Invariants](docs/architecture/invariants.md)
- [Subsystems](docs/architecture/subsystems.md)
- [Flows](docs/architecture/flows.md)
- [Safety](docs/architecture/safety.md)
- [Coordination](docs/architecture/coordination.md)
- [Memory](docs/architecture/memory.md)
- [Context Governance](docs/architecture/context-governance.md)
- [Adaptation](docs/architecture/adaptation.md)

Most important research documents:

- [Kiln Research Synthesis](docs/research/01-kiln-research-synthesis.md)
- [Cybernetic Foundations](docs/research/02-cybernetic-foundations.md)
- [Biological Mechanisms](docs/research/03-biological-mechanisms.md)
- [Current State Mapping](docs/research/04-current-state-mapping.md)
- [Memory Systems](docs/research/05-memory-systems.md)
- [Safety Defense](docs/research/06-safety-defense.md)
- [Regulation And Adaptation](docs/research/07-regulation-and-adaptation.md)
- [Context Governance](docs/research/08-context-governance.md)
- [Tool Execution And Trust](docs/research/09-tool-execution-and-trust.md)
- [Coordination Intelligence](docs/research/10-coordination-intelligence.md)

## Packages

| Package | Description |
|---------|-------------|
| [`@kilnai/gateway-contracts`](packages/gateway-contracts) | Shared HTTP, WebSocket, projection, and operator-surface contracts |
| [`@kilnai/core`](packages/core) | Core control-plane types, policies, safety, memory, routing, evaluation, and runtime contracts |
| [`@kilnai/runtime`](packages/runtime) | Runtime surfaces, channel handling, registries, triggers, and execution plumbing |
| [`@kilnai/cli`](packages/cli) | CLI surface for local operation, inspection, and controlled execution |
| [`@kilnai/tui`](packages/tui) | Terminal interface for interacting with Kiln as an operator-facing control surface |
| [`@kilnai/react`](packages/sdk) | React integration surface for applications using Kiln capabilities |
| [`@kilnai/widget`](packages/widget) | Embeddable interface components |
| [`@kilnai/gui`](packages/gui) | Primary private web operator surface |
| [`@kilnai/native`](packages/native) | Private Electron-backed native operator surface |
| [`@kilnai/studio`](packages/studio) | Internal and development-facing inspection tooling |
| [`@kilnai/tools`](packages/tools) | Vendored developer-tool resolver and platform package coordinator |

## Development

```bash
git clone https://github.com/sequelcore/kiln.git
cd kiln
bun install
bun run typecheck
bun run test
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache-2.0](LICENSE)
