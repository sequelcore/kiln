# Domains

Domains provide stack-specific tooling, quality gates, detection patterns, and agent context to the engine. When a project's files match a domain's detection patterns, the domain's tool tags and quality gates activate automatically. Domains have no effect on the engine's primitive interfaces — they only influence which tools are surfaced and which verification commands run.

All domain infrastructure lives in `@kilnai/core`. Source: `packages/core/src/domain/`.

## Built-in Domains

Five domain kits are bundled with Kiln. They are loaded at `DomainRegistry` construction time and cannot be overridden by installed packages.

| Name | Detects | Purpose |
|------|---------|---------|
| `react-ts` | `tsconfig.json`, `package.json` | TypeScript/React projects. Surfaces browser, DOM, and component tooling. Gates: type-check, lint, test. |
| `python` | `pyproject.toml`, `requirements.txt`, `setup.py` | Python projects. Surfaces Python interpreter and package tooling. Gates: lint (ruff/flake8), test (pytest), type-check (mypy). |
| `docs` | `mkdocs.yml`, `docusaurus.config.js`, `.mdx` files | Documentation projects. Surfaces markdown and link-checking tools. Gates: build, link-check. |
| `support` | `support.yaml`, `knowledge-base.yaml` | Customer support bots. Surfaces knowledge retrieval tools. No file-system gates. |
| `data-pipeline` | `dbt_project.yml`, `airflow.cfg`, `prefect.yaml` | Data engineering projects. Surfaces SQL and pipeline tooling. Gates: test, validate. |

Built-in domain YAML files are located at `packages/core/src/domains/*.yaml`.

## Auto-Detection

Before a session starts, `DomainRegistry.detectAndMerge(projectPath)` scans the project directory:

```
DomainRegistry.detectAndMerge(projectPath)
  -> detect(projectPath)         # checks detectPatterns filenames against projectPath
  -> mergeDomainConfigs(matched) # union of toolTags, concat of qualityGates
  -> returns merged DomainConfig # or GENERIC_FALLBACK if nothing matches
```

Detection checks exact filename presence only — glob patterns in `detectPatterns` are not evaluated.

**Multi-stack merge:** A project with both `tsconfig.json` and `pyproject.toml` activates both `react-ts` and `python`. The merged config combines:
- `name`: `react-ts+python`
- `toolTags`: union of both sets
- `qualityGates`: concatenation of both gate lists (order preserved)
- `multishotExamples` / `phaseExamples`: joined with a blank line

Installed domain packages participate in detection on equal footing with built-ins.

## Domain YAML Format

### Field Reference

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | `string` | yes | — | Unique identifier (e.g., `react-ts`, `my-stack`) |
| `displayName` | `string` | yes | — | Human-readable label |
| `detectPatterns` | `string[]` | yes | — | Filenames whose presence activates this domain |
| `toolTags` | `string[]` | yes | — | Tags for filtering available MCP tools |
| `qualityGates` | `QualityGateYaml[]` | yes | — | Commands executed during the verification loop |
| `multishotExamples` | `string` | no | `""` | Few-shot examples injected into agent context (XML format) |
| `phaseExamples` | `string` | no | `""` | Phase guidance injected into agent context (XML format) |
| `version` | `string` | no | `"0.0.0"` | Semver package version |
| `author` | `string` | no | `""` | Author name or email |
| `skills` | `string[]` | no | `[]` | Paths to skill markdown files relative to package root |
| `tools` | `{ server: string }` | no | `null` | MCP server entry point path |
| `knowledge` | `{ examples?: string, gates?: string }` | no | `null` | Supplemental file references |

### QualityGate Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | `string` | yes | — | Gate identifier (e.g., `lint`, `tests`) |
| `command` | `string` | yes | — | Shell command executed by the verification loop |
| `description` | `string` | yes | — | Human-readable description |
| `required` | `boolean` | no | `true` | `false` makes failures a warning rather than a hard stop |

### Minimal Example

```yaml
# yaml-language-server: $schema=https://kiln.dev/schemas/domain.schema.json
name: my-stack
displayName: My Stack
version: 1.0.0
author: Your Name <you@example.com>

detectPatterns:
  - my-stack.config.yaml

toolTags:
  - my-stack
  - testing

qualityGates:
  - name: lint
    command: "my-stack lint"
    description: Lint source files
    required: true
  - name: tests
    command: "my-stack test"
    description: Run test suite
    required: true
```

## Creating a Domain Package

### 1. Create package.json

```json
{
  "name": "@scope/my-stack",
  "version": "1.0.0",
  "description": "Kiln domain package for My Stack",
  "main": "domain.yaml",
  "files": ["domain.yaml", "skills/", "tools/", "knowledge/", "README.md"]
}
```

Do not add any lifecycle scripts. The marketplace rejects packages that declare `preinstall`, `postinstall`, `prepare`, `prepublish`, or any other npm lifecycle script.

### 2. Author domain.yaml

```yaml
# yaml-language-server: $schema=https://kiln.dev/schemas/domain.schema.json
name: my-stack
displayName: My Stack
version: 1.0.0
author: Your Name <you@example.com>

detectPatterns:
  - my-stack.config.yaml
  - my-stack.json

toolTags:
  - my-stack
  - testing

qualityGates:
  - name: lint
    command: "my-stack lint"
    description: Lint source files
    required: true
  - name: tests
    command: "my-stack test"
    description: Run test suite
    required: true
  - name: coverage
    command: "my-stack test --coverage"
    description: Check test coverage
    required: false

skills:
  - skills/create-feature.md
  - skills/write-test.md

tools:
  server: tools/server.ts

knowledge:
  examples: knowledge/examples.yaml

multishotExamples: |
  <example>
  <user>Add a new API endpoint</user>
  <assistant>I'll create the handler, register it with the router, and add integration tests.</assistant>
  </example>

phaseExamples: |
  <phase name="planning">Identify affected handlers and their test files.</phase>
  <phase name="implementation">Follow existing handler patterns. Validate all inputs at the boundary.</phase>
  <phase name="verification">Run my-stack lint and my-stack test. All gates must pass.</phase>
```

### 3. Add skill files

Skill files are markdown injected into agent context. Keep them concise and task-focused.

```markdown
# Create Feature

1. Identify the bounded context for the feature.
2. Create the handler in `src/handlers/`.
3. Register the route in `src/router.ts`.
4. Write integration tests in `tests/`.
5. Verify all quality gates pass before marking complete.
```

### 4. Add an MCP server (optional)

If the package provides custom tools, implement a standard MCP server at `tools.server`. All capabilities must carry explicit `readOnly`, `destructive`, and `idempotent` annotations. Missing annotations default to `destructive: true`.

### 5. Publish to npm

```bash
npm publish --access public
```

### Recommended package layout

```
my-package/
  domain.yaml
  package.json
  skills/
    create-feature.md
    write-test.md
  tools/
    server.ts
  knowledge/
    examples.yaml
  README.md
```

## CLI Commands

```bash
kiln domain install @scope/my-stack   # Install from npm
kiln domain list                      # List installed domains
kiln domain info my-stack             # Show domain details
kiln domain remove my-stack           # Remove domain
```

**Install pipeline:**
1. Validates the package name is scoped. Unscoped names are rejected.
2. Runs `bun add <package>` to fetch from npm into `node_modules/`.
3. Locates `domain.yaml` in the installed package.
4. Parses and validates via `parseDomainPackageYaml()`.
5. Runs `validatePackageSecurity()` against `package.json` and file list.
6. Copies `domain.yaml` to `{projectDir}/domains/<name>.yaml`.

The full package stays in `node_modules/` for MCP server and skill file resolution. Only `domain.yaml` is copied to the project.

## Security Model

Four security controls are enforced during install:

**1. Lifecycle script prohibition.** Any package declaring `preinstall`, `postinstall`, `prepare`, `prepublish`, or any other npm lifecycle script is rejected before any file is copied.

**2. Capability annotation defaults.** When a domain package declares MCP tools, missing annotations default to `destructive: true, readOnly: false, idempotent: false`. Authors must explicitly declare `readOnly: true` or `idempotent: true`.

**3. File path validation.** Three categories are hard errors: path traversal (`..` segments), absolute Unix paths (starting with `/`), absolute Windows paths (starting with a drive letter). Extensions outside `.yaml`, `.yml`, `.md`, `.ts`, `.json`, `.txt` generate warnings but do not block install.

**4. Content integrity.** `parseDomainPackageYaml()` computes a SHA-256 hash of the raw `domain.yaml` content and stores it in `DomainPackageManifest.contentHash`. `verifyContentHash(filePath, expectedHash)` re-reads from disk and compares, detecting tampering since install.

```typescript
const unchanged = verifyContentHash(
  "{projectDir}/domains/my-stack.yaml",
  manifest.contentHash,
);
```

## JSON Schema for IDE Autocomplete

The schema is published at `packages/core/src/domain/schema/domain.schema.json` (draft-07). Add the `$schema` directive to any `domain.yaml` to enable autocomplete and inline validation in VS Code:

```yaml
# yaml-language-server: $schema=https://kiln.dev/schemas/domain.schema.json
```
