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

Kiln is a biocybernetic control plane for governed AI work. Its contracts are
expressed through cybernetic control structures, and its architecture is
informed by biological and neural regulation.

It regulates AI work the way a thermostat regulates temperature: sense state,
compare it against policy and goals, apply bounded control, and recover safely
when conditions drift.

Its job is to govern execution, context, coordination, safety, and adaptation
across tools and agents without letting any single model, prompt, or workflow
become the system's source of truth.

In practical terms, Kiln is for running governed local or remote agent sessions
with explicit admission, bounded context, auditable tool use, memory evidence,
provider routing, and operator-facing control surfaces.

## Current Baseline

Kiln `2.1.0` is the current supported public package line for the control-plane
architecture. The `2.0.0` release remains the first supported public baseline.
The repository is public and buildable from source. The
[`3.0.0-beta.1` note](docs/releases/3.0.0-beta.1.md) describes an unpublished
candidate; it is not package or installation evidence.

Use this repo today if you want to:

- inspect or contribute to the control-plane architecture
- run workspace verification from source
- work on the CLI, GUI, TUI, runtime, gateway contracts, or native surface
- evaluate Kiln's governance model before integrating a published package
- try governed external engagement workflows that turn bounded X community
  evidence into provider-neutral feature intake

## First Path

```bash
git clone https://github.com/sequelcore/kiln.git
cd kiln
bun install
bun run typecheck
bun run test
bun run build
```

For normal use from any project, install the public CLI package. It brings the
official CLI, GUI, TUI, runtime, gateway contracts, and GUI static assets:

```bash
bun add -g @kilnai/cli@2.1.0
kiln tui
kiln gui
```

When contributing inside this repository, use the source entry point:

```bash
bun --cwd packages/cli src/index.ts tui
bun --cwd packages/cli src/index.ts gui
bun --cwd packages/cli src/index.ts run "Inspect this repository"
```

## Thesis

Kiln exists to answer one question reliably:

**Given the current task, state, constraints, and risk posture, what work should be admitted, what context should be exposed, what coordination pattern should be activated, and what actions should be allowed right now?**

That framing changes the product boundary:

- Kiln admits, routes, and constrains work through explicit control policy.
- Kiln governs context as a bounded resource.
- Kiln coordinates agents and tools through auditable runtime contracts.
- Kiln keeps safety, memory, telemetry, and adaptation inside one regulatory
  layer.

## Architecture

The canonical architecture is modular and documented in [`docs/architecture/`](docs/architecture/README.md).

Core subsystems:

- **IngressGovernor** admits or rejects work and routes it into the proper control path
- **ContextGovernor** decides what context is sufficient, affordable, and safe to expose
- **Managed coordination policy** selects direct, sequential, centralized, or independent-review execution from governed signals
- **GoalRunStore and WorkItemStore** own durable goal, dependency, execution, evidence, and recovery state
- **Foreground goal control** keeps one active or operator-paused goal per session, with canonical active-time accounting and shared GUI/CLI lifecycle events
- **Managed orchestration lifecycle** resolves each admitted specialist and route, executes dependency-ready children, propagates bounded handoffs, and records terminal evidence
- **SafetyKernel** enforces hard boundaries with fail-closed defaults
- **ModeController** manages operating modes such as `NORMAL`, `DEGRADED`, and `LOCKED`
- **TelemetryLoop** closes feedback loops through measurement, anomaly detection, and tuning
- **AdaptationEngine** updates policy and behavior without letting the system drift into self-corruption

## Supported Surfaces

| Surface | Status | Use it for |
|---------|--------|------------|
| CLI | Public npm + source | Automation, local runs, config, auth, sync, project context, gateway launch |
| TUI | Public npm + source | Terminal-first supervision over the shared runtime session path |
| GUI | Public npm + source | Rich local or gateway-attached operator supervision |
| Runtime | Public npm + source | Gateway, sessions, channels, triggers, interactive tools, provider routing |
| Gateway contracts | Public npm + source | Shared HTTP, WebSocket, projection, and operator-surface contracts |
| React SDK | Public npm + source | React integration over Kiln gateway contracts |
| Widget | Public npm + source | Embeddable interface components |
| Native | Experimental/private | Electron-backed desktop capability and projection work |
| Studio | Internal/private | Development inspection and topology views |

See [Operator Surfaces](docs/guides/operator-surfaces.md) for when to use GUI,
native, TUI, CLI, IDE, or gateway integrations. See
[Gateway App Runtime](docs/guides/gateway-app-runtime.md) when Kiln should power
AI behavior inside an app.

## Documentation

Start here:

- [Documentation Index](docs/README.md)
- [Getting Started](docs/getting-started.md)
- [Examples](docs/examples/README.md)
- [Architecture Overview](docs/architecture/README.md)
- [Research Index](docs/research/README.md)
- [Roadmap](docs/roadmap/README.md)
- [Changelog](docs/changelog.md)
- [Release Runbook](docs/operations/release.md)

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

Operator guides:

- [Governed External Engagement](docs/guides/external-engagement.md)

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
| [`@kilnai/gui`](packages/gui) | Public web operator surface served by the runtime |
| [`@kilnai/native`](packages/native) | Experimental Electron-backed native operator surface |
| [`@kilnai/studio`](packages/studio) | Internal and development-facing inspection tooling |

## Examples

Start with [docs/examples](docs/examples/README.md) for source-run examples of
gateway apps, MCP tools, tenant isolation, widget embedding, WhatsApp channels,
and multi-app hosting.

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
