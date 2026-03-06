# Getting Started

## Prerequisites

- **Bun 1.1+** -- runtime and package manager (`curl -fsSL https://bun.sh/install | bash`)
- **API key** -- Anthropic recommended (`ANTHROPIC_API_KEY`). Alternatively: OpenAI, DeepSeek, or Ollama (local, no key)
- **Node.js 20+** -- required only if using MCP tools that depend on the Node.js runtime

## Installation

```bash
bun add @kilnai/core @kilnai/runtime @kilnai/cli
```

## Interactive Setup

The `kiln init` wizard generates `app.yaml` and `gateway.yaml` for your project:

```bash
bunx kiln init
```

The wizard asks:

| Question | What it configures |
|----------|--------------------|
| App name | Top-level `name` field in `app.yaml` |
| Provider | Which LLM provider (`anthropic`, `openai`, `deepseek`, `ollama`) and which API key env var |
| Domain | Auto-detects your tech stack (react-ts, python, docs, support, data-pipeline) or lets you skip |
| Channels | Which channel adapters to activate (`cli`, `web`, `api`, `whatsapp`, `slack`) |
| Team mode | How agents collaborate: `sequential`, `supervisor`, or `swarm` |
| Quality gates | Which verification commands to run (test, lint, typecheck) |

After the wizard completes, you have:

```
my-app/
  app.yaml        # App definition (agents, workflow, memory, channels)
  gateway.yaml    # Gateway server config (port, app bindings)
```

## Manual Setup

If you prefer to write configuration by hand, here is a minimal `app.yaml` with annotations:

```yaml
# Unique identifier for this App
name: my-app

# Channel adapters to activate
channels: [cli, web]

# Memory configuration
memory:
  # Active scopes -- each scope maps to a separate storage namespace
  scopes: [user, "agent:planner", "agent:worker", "project:default"]
  # sqlite+fts5 is the default; use postgresql for multi-node deployments
  backend: sqlite+fts5

# Router: determines which team handles an incoming message
router:
  # Pattern rules are regex-tested first (fastest path)
  rules:
    - match: "^(plan|design|architect)"
      team: main
  # fallback handles anything that doesn't match a rule
  fallback: main

teams:
  main:
    # supervisor: planner delegates tasks to worker by name
    mode: supervisor
    manager: planner

    agents:
      planner:
        name: Aria
        role: Solutions Architect
        goal: Produce clear, validated plans before any implementation starts
        backstory: Methodical thinker who identifies failure modes early.
        tier: reasoning    # reasoning = Opus; zero tools; structured JSON output
        tools: []
        structured: true

      worker:
        name: Marcus
        role: Implementation Engineer
        goal: Write clean, tested code following the agreed plan
        tier: coding       # coding = Sonnet; full tool access
        tools: [memory_save, memory_recall]
        count: 2           # two parallel worker instances
        sandbox: true      # filesystem/network isolation

    workflow:
      phases: [plan, implement, verify]
      gates:
        plan:
          requires: [human_approval]   # pauses for user review
        verify:
          requires: [tests_pass, typecheck]
      maxIterations: 3    # retry limit for the verification loop

    capabilities:
      - name: memory_save
        description: Save a memory entry to scoped storage
        tags: [memory]
        annotations:
          readOnly: false
          idempotent: false
      - name: memory_recall
        description: Recall memories by query
        tags: [memory]
        annotations:
          readOnly: true
          idempotent: true

    qualityGates:
      - name: tests_pass
        command: "bun run test"
        description: Run test suite
        required: true
      - name: typecheck
        command: "tsc --noEmit"
        description: Type-check TypeScript source
        required: true
```

And a minimal `gateway.yaml`:

```yaml
port: 4800

apps:
  - name: my-app
    config: ./app.yaml
    channels:
      - type: api
        path: /api/my-app
      - type: web
```

## Running

Start the development server with file watching and hot-reload:

```bash
bunx kiln dev
```

You will see output similar to:

```
Dev server started on port 4800
Studio: http://localhost:4800/studio/
```

If a `gateway.yaml` exists, the full gateway starts instead:

```
Gateway started on port 4800 with 1 apps: my-app
Studio: http://localhost:4800/studio/
```

Any save to `app.yaml` or `gateway.yaml` restarts the affected app within ~300ms.

## What Just Happened

When you run `kiln dev`, the following sequence executes:

1. **Config detected** -- if `gateway.yaml` exists, the full gateway starts; otherwise a lightweight dev server starts
2. **YAML parsed** -- `app.yaml` is read and mapped to raw typed structures
3. **App validated** -- `validateApp()` checks all cross-references: agent tools must name declared capabilities, gate phase keys must exist in the workflow phase list, router fallback must name a real team
4. **Server started** -- a Bun/Hono server binds to port 4800 (override with `--port`)
5. **Studio available** -- the dev UI is served at `/studio` with graph view, playground, timeline, memory inspector, and eval dashboard
6. **Event stream open** -- `GET /dev/events` provides an SSE stream of all engine events

If validation fails, the process exits immediately with a detailed error listing every violation found.

## Testing Your Configuration

Test that your YAML is valid before running:

```typescript
// tests/app.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAppYaml, validateAppGraph, validateApp } from "@kilnai/core";

const content = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../app.yaml"),
  "utf-8"
);
const app = parseAppYaml(content);

describe("app.yaml", () => {
  it("parses without errors", () => {
    expect(app.name).toBe("my-app");
  });

  it("has no cross-reference violations", () => {
    const error = validateAppGraph(app);
    expect(error).toBeNull();
  });

  it("passes full engine validation", () => {
    expect(() => validateApp(app)).not.toThrow();
  });
});
```

Run with:

```bash
bun run test
```

## Next Steps

- [Core Concepts](concepts.md) -- understand primitives, composites, and how the engine works
- [App Configuration](configuration/app-yaml.md) -- full `app.yaml` schema reference
- [Channels](guides/channels.md) -- configure WhatsApp, Slack, and other adapters
- [Knowledge](guides/knowledge.md) -- RAG pipeline, vector stores, contact memory, speech-to-text

## Examples

- [`examples/whatsapp-bot/`](../examples/whatsapp-bot/) -- complete WhatsApp business chatbot with persistent memory, real pricing, and owner notification

---

## Building a Consumer App

A consumer app wraps Kiln to provide domain-specific configuration. You write domain configs, a preset YAML, a system prompt builder, and a 20-line entry point. The engine handles everything else.

### Recommended Structure

```
my-app/
  src/
    index.ts                  # Entry point (~20 lines)
    system-prompt.ts          # System prompt builder function
    domain/
      configs/
        my-domain.yaml        # One YAML per domain
  tests/
    app.test.ts               # Preset + domain validation tests
  app.yaml                    # App preset
  package.json
  tsconfig.json
```

### Step 1: Domain Config

A domain config teaches the engine how to detect and guide work in a specific context:

```yaml
# src/domain/configs/python.yaml
name: python
displayName: Python
detectPatterns:
  - pyproject.toml
  - requirements.txt
toolTags:
  - python
  - testing
qualityGates:
  - name: lint
    command: "ruff check ."
    description: Lint Python source
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
```

- `detectPatterns` -- filenames checked in the project root; any match activates this domain
- `toolTags` -- capability filter tags for tool registry discovery
- `qualityGates` -- commands the verification loop runs
- `multishotExamples` -- XML examples injected into the system prompt for few-shot guidance

If a project matches multiple domains (e.g., `tsconfig.json` and `build.gradle.kts`), the engine merges them: union of tool tags, concatenated quality gates.

### Step 2: System Prompt Builder

```typescript
// src/system-prompt.ts
import type { SystemPromptOptions } from "@kilnai/cli";

export function buildSystemPrompt(options: SystemPromptOptions): string {
  const { task, domain, memorySnapshot, projectPath } = options;
  const gates = domain.qualityGates.map((g) => g.name).join(", ");

  return `<session>
<role>Follow the phased workflow and use MCP tools to track progress.</role>
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

`SystemPromptOptions` provides: `task`, `domain` (detected DomainConfig), `memorySnapshot` (recalled memory as text), and `projectPath`.

### Step 3: Entry Point

```typescript
// src/index.ts
#!/usr/bin/env bun

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createCli } from "@kilnai/cli";
import type { KilnAppConfig } from "@kilnai/cli";
import { DomainRegistry, loadDomainYaml } from "@kilnai/core";
import { buildSystemPrompt } from "./system-prompt.js";

const configsDir = join(dirname(fileURLToPath(import.meta.url)), "domain/configs");

const config: KilnAppConfig = {
  appName: "my-app",
  dirName: ".my-app",
  version: "1.0.0",
  description: "My AI-powered app",
  createRegistry: () => new DomainRegistry({
    builtinConfigs: [loadDomainYaml(join(configsDir, "my-domain.yaml"))],
    domainsDir: ".my-app/domains",
  }),
  buildSystemPrompt,
  mcpServerName: "my-app",
};

await createCli(config);
```

### What You Get from createCli()

| Command | Behavior |
|---------|---------|
| `my-app` (no args) | Starts dev mode (Studio dashboard at `:4800`) |
| `my-app run "task"` | CLI session via Claude Code Agent SDK |
| `my-app init` | Creates `.my-app/` in the current project |
| `my-app serve` | Standalone MCP server over stdio |
| `my-app memory` | View memory layer statistics |
| `my-app status` | Show phase, tasks, costs |
| `my-app domain install` | Install domain packages |
| `my-app gateway` | Multi-app hosting via Gateway |
