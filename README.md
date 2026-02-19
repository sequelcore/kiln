# Kiln

[![CI](https://github.com/sequelcore/kiln/actions/workflows/ci.yml/badge.svg)](https://github.com/sequelcore/kiln/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

A domain-agnostic AI orchestration engine for building multi-agent, multi-tenant applications -- configured entirely via YAML.

## Why Kiln?

- **YAML-first configuration** -- define agents, workflows, tools, and quality gates in a single file
- **Multi-provider** -- Anthropic, OpenAI, DeepSeek, Ollama adapters out of the box
- **Multi-tenant gateway** -- host multiple apps in a single Bun/Hono process with per-app isolation and budget enforcement
- **Multi-channel** -- CLI, Web, WhatsApp, Slack, and REST API adapters
- **Phased workflows** -- configurable phase sequences with approval gates and quality gates (test, lint, typecheck)
- **Scoped memory** -- user, agent, team, project, and org scopes backed by SQLite + FTS5
- **Task tree** -- scoring, selection, deepen/branch/prune operations for structured exploration
- **Cross-app delegation** -- apps can delegate tasks to other apps with schema contracts
- **Domain detection and marketplace** -- auto-detect tech stacks from file patterns, distribute domain configs as packages with content hashing and security validation
- **Cost tracking** -- per-role, cache-aware token usage and pricing

## Quick Start

```bash
bun add @kilnai/core @kilnai/runtime
```

Define your app in YAML:

```yaml
name: my-app
channels: [cli, web]

memory:
  scopes: [user, "agent:planner", "agent:worker"]
  backend: sqlite+fts5

router:
  fallback: main

teams:
  main:
    agents:
      planner:
        tier: reasoning
        tools: []
        structured: true
      worker:
        tier: coding
        tools: [memory_save, memory_recall, verify]
        count: 2
        sandbox: true

    workflow:
      phases: [analyze, plan, implement, verify]
      gates:
        plan:
          requires: [human_approval]
        verify:
          requires: [tests_pass, typecheck]

    capabilities:
      - name: memory_save
        description: Save a memory entry to scoped storage
        tags: [memory]
      - name: memory_recall
        description: Recall memories by query
        tags: [memory]
      - name: verify
        description: Execute quality gates
        tags: [verification]

    qualityGates:
      - name: typecheck
        command: "tsc --noEmit"
        required: true
      - name: test
        command: "vitest run"
        required: true
```

## Domain Configuration

Kiln auto-detects your project's tech stack and applies the right tool tags, quality gates, and examples. Define domain configs in YAML:

```yaml
name: react-ts
displayName: React + TypeScript
detectPatterns: [tsconfig.json, package.json]
toolTags: [typescript, react, css, testing]

qualityGates:
  - name: typecheck
    command: "tsc --noEmit"
    description: Type-check TypeScript source
    required: true
  - name: test
    command: "vitest run"
    description: Run test suite
    required: true
  - name: lint
    command: "biome check"
    description: Lint and format
    required: true
```

The `DomainRegistry` detects configs from file patterns and merges them for multi-stack projects:

```typescript
import { DomainRegistry, loadDomainYaml } from "@kilnai/core";

const registry = new DomainRegistry({
  builtinConfigs: [loadDomainYaml("./domains/react-ts.yaml")],
});

const config = registry.detectAndMerge("/path/to/project");
// -> merged DomainConfig with union of tool tags and quality gates
```

### Marketplace

Domain configs can be distributed as packages with built-in security:

- **Content hashing** -- SHA-256 integrity verification via `computeContentHash()` / `verifyContentHash()`
- **Security validation** -- blocks forbidden lifecycle scripts, detects path traversal and absolute paths
- **Default annotations** -- unannotated capabilities default to `destructive: true` for safety
- **File validation** -- only allows standard extensions (`.yaml`, `.yml`, `.md`, `.ts`, `.json`, `.txt`)

```typescript
import { parseDomainPackageYaml, validatePackageSecurity, validatePackageFiles } from "@kilnai/core";

const manifest = parseDomainPackageYaml(yamlContent, "/install/path");
const security = validatePackageSecurity(packageJson, fileList);
const files = validatePackageFiles(fileList);
```

## Packages

| Package | Description |
|---------|-------------|
| [`@kilnai/core`](packages/core) | Engine primitives, composites, YAML loader, provider adapters, memory, task tree, orchestrator, domain config, marketplace, events, cost tracking |
| [`@kilnai/runtime`](packages/runtime) | Multi-app gateway server, Mode B sessions, multi-tenant management, channel adapters |

## Architecture

6 primitives + 3 composites, all defined as pure TypeScript interfaces:

```
App (YAML-configured)
├── Router (pattern rules → classifier → fallback)
├── Teams[]
│   └── Team = Agents + Workflow + Capabilities + QualityGates
├── Memory (scoped: user, agent, team, project, org)
├── Channels[] (CLI, Web, WhatsApp, Slack, API)
└── DomainRegistry (detect → merge → marketplace packages)
```

**Primitives:** Agent, Capability, Workflow, Memory, Task, Channel.
**Composites:** Team, Router, App.

The runtime hosts multiple Apps in a single process. Each app gets its own routes, memory namespace, and budget enforcement. The DomainRegistry detects tech stacks, merges configs for hybrid projects, and loads marketplace packages from a configurable directory.

## Development

```bash
git clone https://github.com/sequelcore/kiln.git
cd kiln
bun install
bun run typecheck    # Type-check all packages
bun run test         # Run all tests
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
