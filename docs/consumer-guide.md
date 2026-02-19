# Building a Consumer App

A Kiln consumer app provides domain-specific configuration to the engine. The engine handles everything else: CLI, MCP server, web console, session management, memory, events, cost tracking.

## What You Provide

| Component | Format | Purpose |
|-----------|--------|---------|
| Domain configs | YAML files | What your app "knows about" -- detection patterns, quality gates, examples |
| Preset | YAML file | Team composition: agents, workflow phases, capabilities, memory scopes |
| System prompt builder | TypeScript function | How the AI should behave in your domain |
| Entry point | TypeScript (~20 lines) | Wire everything into `createCli()` |

## Recommended Structure

```
my-app/
  src/
    index.ts                    # Entry point
    system-prompt.ts            # System prompt builder
    domain/
      configs/
        my-domain.yaml          # One YAML per domain
        another-domain.yaml
    presets/
      my-app.yaml               # Preset definition
  tests/
    presets/my-app-preset.test.ts
  package.json
  tsconfig.json
  vitest.config.ts
```

No monorepo needed. A single flat package is sufficient.

## Step 1: Domain Configs (YAML)

A domain config tells the engine how to detect and guide work in a specific context. Create one YAML file per domain in `src/domain/configs/`:

```yaml
# src/domain/configs/python.yaml
name: python
displayName: Python
detectPatterns:
  - pyproject.toml
  - setup.py
  - requirements.txt
toolTags:
  - python
  - testing
  - linting
qualityGates:
  - name: lint
    command: "ruff check ."
    description: Lint Python source with ruff
    required: true
  - name: tests
    command: pytest
    description: Run Python tests
    required: true
multishotExamples: |
  <example>
  <user>Add input validation to the registration endpoint</user>
  <assistant>I'll add Pydantic validation with proper error messages and test coverage.</assistant>
  </example>
phaseExamples: |
  <phase name="planning">Identify affected modules and their test files.</phase>
  <phase name="implementation">Use type hints on all public functions.</phase>
  <phase name="verification">Run ruff, mypy, and pytest. All must pass.</phase>
```

**Fields:**
- `detectPatterns` -- exact filenames checked in the project root. If any match, this domain activates
- `toolTags` -- capability filter tags for the MCP tool registry
- `qualityGates` -- commands the verification loop runs. `required: true` means the gate must pass
- `multishotExamples` -- XML examples injected into the system prompt for few-shot guidance
- `phaseExamples` -- per-phase guidance injected into the system prompt

Domains are non-coding too. A fitness app might detect `workout.yaml`, a trading app might detect `strategy.toml`.

**Multi-stack detection:** If a project matches multiple domains (e.g., `tsconfig.json` + `build.gradle.kts`), the engine merges them automatically -- union of tool tags, concatenated quality gates.

See [marketplace.md](marketplace.md) for the domain package format and distribution.

## Step 2: Preset (YAML)

The preset defines your app's team composition, workflow, and capabilities. Create it at `src/presets/my-app.yaml`:

```yaml
name: my-app
channels: [cli, web]

memory:
  scopes: [user, "agent:planner", "agent:worker", "project:default"]
  backend: sqlite+fts5
  sync: git

router:
  rules: []
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
        tools:
          - kiln_memory_save
          - kiln_memory_recall
          - kiln_phase_gate
          - kiln_verify
          - kiln_task_create
          - kiln_task_action
          - kiln_cost_track
        count: 2
        sandbox: true
      summarizer:
        tier: fast
        tools:
          - kiln_memory_save
          - kiln_cost_summary

    workflow:
      phases: [analyze, plan, execute, verify, report]
      gates:
        plan:
          requires: [human_approval]
        verify:
          requires: [tests_pass]
      maxIterations: 3

    capabilities:
      - name: kiln_memory_save
        description: Save a memory entry
        tags: [memory]
      # ... list all capabilities your agents reference

    qualityGates:
      - name: tests
        command: "bun test"
        description: Run test suite
        required: true
```

**Agent tiers:** `reasoning` (Opus -- plans, zero tools), `coding` (Sonnet -- implements, tool access), `fast` (Haiku -- summarizes, read-only).

**Phases are strings.** Define any sequence. The engine enforces gate transitions.

See [preset-format.md](preset-format.md) for the full YAML schema reference.

## Step 3: System Prompt Builder

Create a function that builds the system prompt from runtime context. The engine calls this during session setup with the detected domain and task:

```typescript
// src/system-prompt.ts
import type { SystemPromptOptions } from "@kilnai/cli";

export function buildMyAppSystemPrompt(options: SystemPromptOptions): string {
  const { task, domain, memorySnapshot, projectPath } = options;

  const gates = domain.qualityGates.map((g) => g.name).join(", ");

  return `<session>
<role>You are in a MyApp session. Follow the phased workflow and use MCP tools to track progress.</role>
<project>${projectPath}</project>
<domain name="${domain.displayName}">
  <quality-gates>${gates || "None"}</quality-gates>
  <guidance>${domain.multishotExamples || "No examples."}</guidance>
</domain>
<memory>${memorySnapshot ?? "No prior memory."}</memory>
<task>${task}</task>
</session>`;
}
```

The `SystemPromptOptions` interface:
- `task` -- the user's task description
- `domain` -- the detected (and possibly merged) `DomainConfig`
- `memorySnapshot` -- recalled memory formatted as text (optional)
- `projectPath` -- absolute path to the project being worked on

## Step 4: Entry Point

Wire everything together in ~20 lines:

```typescript
// src/index.ts
#!/usr/bin/env bun

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createCli } from "@kilnai/cli";
import type { KilnAppConfig } from "@kilnai/cli";
import { DomainRegistry, loadDomainYaml } from "@kilnai/core";
import { buildMyAppSystemPrompt } from "./system-prompt.js";

const configsDir = join(dirname(fileURLToPath(import.meta.url)), "domain/configs");

function createRegistry(): DomainRegistry {
  return new DomainRegistry({
    builtinConfigs: [
      loadDomainYaml(join(configsDir, "my-domain.yaml")),
    ],
    domainsDir: ".my-app/domains",
  });
}

const config: KilnAppConfig = {
  appName: "my-app",
  dirName: ".my-app",
  version: "1.0.0",
  description: "My AI-powered app",
  createRegistry: createRegistry,
  buildSystemPrompt: buildMyAppSystemPrompt,
  mcpServerName: "my-app",
};

await createCli(config);
```

**`KilnAppConfig` fields:**
- `appName` -- used in CLI help, log messages, error output
- `dirName` -- project-local config directory (e.g., `.my-app/`)
- `createRegistry` -- factory returning a `DomainRegistry` with your built-in configs
- `buildSystemPrompt` -- function that produces the system prompt from runtime context
- `mcpServerName` -- MCP server registration name for client config generation

## Step 5: package.json

```json
{
  "name": "my-app",
  "private": true,
  "type": "module",
  "scripts": {
    "my-app": "bun run src/index.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "build": "tsc"
  },
  "dependencies": {
    "@kilnai/core": "file:../kiln/packages/core",
    "@kilnai/cli": "file:../kiln/packages/cli"
  },
  "devDependencies": {
    "@types/bun": "^1.3.9",
    "typescript": "^5.6.0",
    "vitest": "^4.0.0"
  }
}
```

`@kilnai/runtime` is a transitive dependency through `@kilnai/cli` -- no need to list it directly.

## What You Get for Free

From `createCli()`, your app automatically has:

| Feature | How it works |
|---------|-------------|
| `my-app` (no args) | Launches web console on port 4800 with React 19 SPA |
| `my-app run "task"` | CLI-only session via Claude Code Agent SDK |
| `my-app init` | Creates `.my-app/` in the current project |
| `my-app serve` | Standalone MCP server over stdio |
| `my-app memory` | Browse and search memory layers |
| `my-app status` | Show phase, tasks, costs |
| `my-app config` | Edit domain and provider settings |
| `my-app domain install` | Install marketplace domain packages |
| `my-app gateway` | Multi-app hosting via Gateway |
| MCP server | 13 tools for memory, phases, tasks, verification, cost, domain |
| Web console | Real-time dashboard with phase progress, task tree, cost panel |
| Memory system | SQLite + FTS5 (local), gzipped JSONL (git-synced) |
| Multi-provider | Anthropic, OpenAI, DeepSeek, Ollama via provider adapters |
| Event streaming | 15 event types broadcast to WebSocket and CLI |

## Testing Your App

Test your preset and domain configs:

```typescript
// tests/presets/my-app-preset.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAppYaml, validateAppGraph } from "@kilnai/core";
import * as engine from "@kilnai/core";

const presetPath = join(dirname(fileURLToPath(import.meta.url)), "../../src/presets/my-app.yaml");
const content = readFileSync(presetPath, "utf-8");
const app = parseAppYaml(content);

describe("my-app preset", () => {
  it("parses without errors", () => {
    expect(app.name).toBe("my-app");
  });

  it("validates the app graph", () => {
    const errors = validateAppGraph(app);
    expect(errors).toHaveLength(0);
  });

  it("passes full engine validation", () => {
    expect(() => engine.validateApp(app)).not.toThrow();
  });
});
```

## Reference

- [Architecture](architecture.md) -- engine design, primitives, composites
- [Preset Format](preset-format.md) -- full YAML schema for presets
- [Gateway](gateway.md) -- multi-app hosting, Mode A/B, delegation
- [Channels](channels.md) -- platform adapters (CLI, web, WhatsApp, Slack, API)
- [Marketplace](marketplace.md) -- domain package format and security
