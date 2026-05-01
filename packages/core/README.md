<p align="center">
  <img src="https://raw.githubusercontent.com/sequelcore/kiln/main/docs/assets/mascot.png" alt="Kiln" width="120" />
</p>

<h1 align="center">@kilnai/core</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@kilnai/core"><img src="https://img.shields.io/npm/v/@kilnai/core.svg" alt="npm version" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
</p>

<p align="center">Domain-agnostic AI orchestration engine. 7 primitives, 3 composites, YAML-configured.</p>

---

## What is this?

`@kilnai/core` is the engine behind [Kiln](https://github.com/sequelcore/kiln) -- a control-plane core for building governed AI agents, teams, and workflows. It provides:

- **7 primitives**: Agent, Capability, Workflow, Memory, Task, Channel, Trigger
- **3 composites**: Team, Router, App
- **4 provider adapters**: Anthropic, OpenAI, DeepSeek, Ollama
- **Phase-gated orchestrator** with checkpoint/resume, 3 team strategies
- **MCP client** (Streamable HTTP) for external tool integration
- **Memory Lattice** governed memory records with scopes, layers, provenance, revisions, relations, lifecycle policy, recall, and bounded resource projection
- **Knowledge (RAG)** with chunkers, embedding adapters, and retrieval pipeline
- **Safety pipeline**: PII detection (6 types), content classification (6 categories), 4 policy rails
- **Eval framework**: 12 scorer types, YAML-configured experiments
- **55 typed error codes** with context-aware suggestions

## Install

```bash
bun add @kilnai/core
```

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
| `Memory` | Governed Memory Lattice records, SQLite persistence, lifecycle policy, recall, resources |
| `Safety` | PII scanner, content classifier, policy rails, pipeline |
| `Knowledge` | Chunkers, embedding adapters, vector store, retrieval |
| `Eval` | 12 scorers, dataset loader, experiment runner |
| `Events` | EventBus (32 typed events), EventStore |
| `Security` | Audit log, prompt injection detection, secrets |
| `Cost` | Per-role, cache-aware cost tracking |

## Documentation

- [Getting Started](https://github.com/sequelcore/kiln/blob/main/docs/getting-started.md)
- [Core Concepts](https://github.com/sequelcore/kiln/blob/main/docs/concepts.md)
- [App Configuration](https://github.com/sequelcore/kiln/blob/main/docs/configuration/app-yaml.md)
- [Architecture](https://github.com/sequelcore/kiln/blob/main/docs/architecture.md)

## License

[MIT](https://github.com/sequelcore/kiln/blob/main/LICENSE)
