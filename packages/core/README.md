<p align="center">
  <img src="https://raw.githubusercontent.com/sequelcore/kiln/main/docs/assets/mascot.png" alt="Kiln" width="120" />
</p>

<h1 align="center">@kilnai/core</h1>

<p align="center">
  <a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License: Apache-2.0" /></a>
</p>

<p align="center">Core contracts and services for the Kiln governed AI control plane.</p>

---

## What is this?

> [!IMPORTANT]
> This is a provisional workspace package in a source-only development tree.
> There is no supported package installation for the current repository state.

`@kilnai/core` is the contract and domain package behind
[Kiln](https://github.com/sequelcore/kiln), a control plane for governed AI
work. It provides:

- Agent, capability, workflow, memory, task, channel, trigger, routing, and app
  contracts
- Provider adapter boundaries for direct and executable provider routes
- Governed execution, approval, authority, and verification contracts
- **MCP client** (Streamable HTTP) for external tool integration
- **Memory Lattice** governed memory records with scopes, layers, provenance, revisions, relations, lifecycle policy, recall, and bounded resource projection
- **Knowledge (RAG)** with chunkers, embedding adapters, and retrieval pipeline
- **Safety pipeline**: PII detection (6 types), content classification (6 categories), 4 policy rails
- **Eval framework**: 12 scorer types, YAML-configured experiments
- Typed error codes with context-aware suggestions

## Use in this workspace

```bash
bun install --frozen-lockfile
bun run --filter @kilnai/core test
```

Workspace consumers declare `@kilnai/core` with `workspace:*`. The coordinate
is expected to change before the next public release.

## Usage

Define your app in YAML:

```yaml
name: my-agent
runtime: provider-adapter
channels: [web]

provider:
  name: anthropic
  model: claude-haiku-4-5-20251001
  apiKeyEnv: ANTHROPIC_API_KEY

memory:
  scopes: [user]
  backend: sqlite+fts5

router:
  fallback: main

teams:
  main:
    agents:
      assistant:
        name: Assistant
        role: Helpful AI assistant
        goal: Answer questions clearly
        tier: fast
        tools: []
    workflow:
      phases: [respond]
    capabilities: []
    qualityGates: []
```

Load and validate it programmatically:

```typescript
import { Engine } from "@kilnai/core";

const app = Engine.parseAppYaml(yamlString);
Engine.validateApp(app);
```

## Key exports

| Namespace | Purpose |
|-----------|---------|
| `Engine` | 7 primitives, 3 composites, YAML loader, error catalog |
| `Orchestrator` | Phase machine, checkpoint/resume, strategies |
| `Agents` | Provider adapters, MCP client, tool cache, circuit breaker |
| `Memory` | Governed Memory Lattice records, repository-backed persistence, SQLite adapter, lifecycle policy, recall, resources |
| `Safety` | PII scanner, content classifier, policy rails, pipeline |
| `Knowledge` | Chunkers, embedding adapters, vector store, retrieval |
| `Eval` | 12 scorers, dataset loader, experiment runner |
| `Events` | EventBus (32 typed events), EventStore |
| `Security` | Audit log, prompt injection detection, secrets |
| `Cost` | Per-role, cache-aware cost tracking |

## Documentation

- [Getting started](../../docs/getting-started.md)
- [Core concepts](../../docs/concepts.md)
- [Application configuration](../../docs/configuration/app-yaml.md)
- [Architecture](../../docs/architecture/README.md)

## License

[Apache 2.0](../../LICENSE)
