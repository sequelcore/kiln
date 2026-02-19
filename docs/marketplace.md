# Domain Marketplace

## Overview

The Domain Marketplace is the extension system for the Kiln engine. It allows stack-specific tooling, quality gates, detection patterns, skills, and knowledge to be packaged into portable `domain.yaml` files and distributed via npm. Installed packages integrate directly with the auto-detection system: when a project's files match a domain's detection patterns, that domain's tool tags and quality gates activate automatically.

The marketplace separates two concerns:

- **Built-in domains** — first-party configs shipped with each consumer application and loaded at startup
- **Installable packages** — third-party or community packages fetched from npm, stored in `{projectDir}/domains/`, and registered at session start

Both are expressed as `domain.yaml` and share the same schema. Installable packages may additionally declare `skills`, `tools`, and `knowledge` sections that the engine loads alongside the base config.

All domain infrastructure lives in `@kilnai/core`.

---

## Built-in Domains

Built-in domains are loaded from application-specific config directories at `DomainRegistry` construction time. They cannot be overridden by installed packages (the registry skips names that already exist).

The registry accepts any `DomainConfig` objects at construction time. Consumer applications provide their own set of built-in configs appropriate for their domain.

| Field | Description |
|-------|-------------|
| `name` | Unique identifier (e.g., `python`, `react-ts`) |
| `detectPatterns` | Filenames whose presence activates this domain |
| `toolTags` | Tags for filtering available MCP tools |
| `qualityGates` | Commands executed during the verification loop |

Tool tags determine which MCP capabilities are surfaced to agents. Quality gates are executed sequentially by the verification loop. A gate with `required: false` generates a warning on failure rather than halting the loop.

---

## Auto-Detection

`DomainRegistry` drives detection. On initialization it loads built-in configs. Before a session starts, `loadInstalledDomains(projectPath)` scans `{projectDir}/domains/*.yaml` and registers any additional configs.

Detection operates on file presence. For each registered config, the registry checks whether any of its `detectPatterns` filenames exist under `projectPath`. Glob patterns in `detectPatterns` are ignored by the current implementation — only exact filename checks are performed.

```
DomainRegistry.detectAndMerge(projectPath)
  -> detect(projectPath)          # returns all matching DomainConfig[]
  -> mergeDomainConfigs(matched)  # union of toolTags, concat of qualityGates
  -> returns merged DomainConfig  # or GENERIC_FALLBACK if none match
```

**Multi-stack merge** handles hybrid projects. A project containing both `tsconfig.json` and `pyproject.toml` activates both `react-ts` and `python`. The merge produces a combined config with:

- `name`: `react-ts+python`
- `toolTags`: union of both sets
- `qualityGates`: concatenation of both gate lists (preserving order)
- `multishotExamples` / `phaseExamples`: joined with a blank line

Installed domain packages participate in detection on equal footing with built-ins. Their `detectPatterns` entries are checked against `projectPath` the same way.

Source: `packages/core/src/domain/domain-registry.ts`

---

## Domain Package Format

A domain package is an npm package containing a `domain.yaml` at its root. The package name must be scoped: either a recognized scope prefix (e.g., `@kiln-domains/<name>`) or another `@<scope>/<name>` format.

### Minimum viable `domain.yaml`

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
  - name: tests
    command: "my-stack test"
    description: Run test suite
    required: true
  - name: lint
    command: "my-stack lint"
    description: Lint source files
    required: true
```

### Extended package with skills, tools, and knowledge

```yaml
# yaml-language-server: $schema=https://kiln.dev/schemas/domain.schema.json
name: my-stack
displayName: My Stack
version: 1.2.0
author: Your Name <you@example.com>

detectPatterns:
  - my-stack.config.yaml

toolTags:
  - my-stack
  - testing
  - linting

qualityGates:
  - name: tests
    command: "my-stack test"
    description: Run test suite
    required: true
  - name: lint
    command: "my-stack lint"
    description: Lint source files
    required: true

# Skills: paths to markdown files loaded into agent context
skills:
  - skills/create-component.md
  - skills/write-test.md

# Tools: path to an MCP server entry point
tools:
  server: tools/server.ts

# Knowledge: supplemental files for examples and gate definitions
knowledge:
  examples: knowledge/examples.yaml
  gates: knowledge/gates.yaml
```

### `DomainPackageManifest` type

When a package is parsed via `parseDomainPackageYaml()`, the result is a `DomainPackageManifest`:

```typescript
interface DomainPackageManifest {
  readonly config: DomainConfig;       // runtime config (toolTags as Set, typed gates)
  readonly version: string;            // defaults to "0.0.0"
  readonly author: string;             // defaults to ""
  readonly installPath: string;        // absolute path to installed package root
  readonly skills: readonly string[];  // skill file paths (defaults to [])
  readonly tools: DomainToolsYaml | null;
  readonly knowledge: DomainKnowledgeYaml | null;
  readonly contentHash: string;        // SHA-256 of raw domain.yaml content
}
```

### Recommended package layout

```
my-package/
  domain.yaml          # required — package root manifest
  package.json         # npm metadata (no lifecycle scripts)
  skills/
    create-component.md
    write-test.md
  tools/
    server.ts          # MCP server entry point
  knowledge/
    examples.yaml
    gates.yaml
  README.md
```

---

## YAML Schema

### `DomainYaml` interface

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | `string` | yes | — | Unique identifier (e.g., `python`, `react-ts`) |
| `displayName` | `string` | yes | — | Human-readable label |
| `detectPatterns` | `string[]` | yes | — | Filenames whose presence activates this domain |
| `toolTags` | `string[]` | yes | — | Tags for filtering available MCP tools |
| `qualityGates` | `QualityGateYaml[]` | yes | — | Gates executed during verification |
| `multishotExamples` | `string` | no | `""` | Few-shot examples injected into agent context (XML) |
| `phaseExamples` | `string` | no | `""` | Phase guidance injected into agent context (XML) |
| `version` | `string` | no | `"0.0.0"` | Semver package version |
| `author` | `string` | no | `""` | Author name or email |
| `skills` | `string[]` | no | `[]` | Paths to skill markdown files |
| `tools` | `DomainToolsYaml` | no | `null` | MCP server configuration |
| `knowledge` | `DomainKnowledgeYaml` | no | `null` | Supplemental file references |

### `QualityGateYaml` interface

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | `string` | yes | — | Gate identifier (e.g., `lint`, `tests`) |
| `command` | `string` | yes | — | Shell command executed by the verification loop |
| `description` | `string` | yes | — | Human-readable description |
| `required` | `boolean` | no | `true` | If `false`, failure is a warning, not a hard stop |

### `DomainToolsYaml` interface

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `server` | `string` | yes | Relative path to the MCP server entry point |

### `DomainKnowledgeYaml` interface

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `examples` | `string` | no | Relative path to multishot examples file |
| `gates` | `string` | no | Relative path to gate definitions file |

### Validation rules

`validateDomainYaml()` enforces the following before any parse proceeds:

- Root must be a non-null, non-array object
- `name`, `displayName`, `detectPatterns`, `toolTags`, and `qualityGates` must all be present
- `detectPatterns` and `toolTags` must be arrays
- `qualityGates` must be an array; each entry must contain `name`, `command`, and `description`
- `version` and `author`, when present, must be strings
- `skills`, when present, must be a string array
- `tools`, when present, must be an object with a string `server` field
- `knowledge`, when present, must be an object; `examples` and `gates` (if present) must be strings

Validation errors include the field path and a descriptive message. `DomainYamlError` aggregates all errors into a single thrown exception rather than stopping at the first failure.

Source: `packages/core/src/domain/yaml-schema.ts`, `packages/core/src/domain/yaml-parser.ts`

### JSON Schema for IDE autocomplete

The schema is published at `packages/core/src/domain/schema/domain.schema.json` (draft-07). Add the `$schema` directive to the top of any `domain.yaml` to enable autocomplete and inline validation in VS Code and other editors:

```yaml
# yaml-language-server: $schema=https://kiln.dev/schemas/domain.schema.json
```

---

## Security Model

The marketplace enforces four independent security controls. All controls are checked during `install` before any file is copied to the project's domains directory.

### 1. Lifecycle script prohibition (`validatePackageSecurity`)

npm lifecycle scripts execute arbitrary code at install time. The marketplace blocks all of them. If a package's `package.json` declares any of the following scripts, the install is rejected with a hard error:

`preinstall`, `install`, `postinstall`, `preuninstall`, `uninstall`, `postuninstall`, `preprepare`, `prepare`, `postprepare`, `prepublish`, `prepublishOnly`, `postpublish`

Domain packages must be static-resource-only. No install-time code executes.

### 2. Capability annotation defaults (`applyDefaultAnnotations`)

When a domain package declares MCP tools, every capability must carry explicit safety annotations. `applyDefaultAnnotations()` enforces a safe-by-default policy: any capability with missing or null annotations is treated as fully destructive.

| Annotation | Default when absent |
|------------|---------------------|
| `destructive` | `true` |
| `readOnly` | `false` |
| `idempotent` | `false` |

This means unannotated tools will be subject to the same restrictions as tools that explicitly declare `destructive: true`. Authors must explicitly opt into `readOnly: true` or `idempotent: true`.

### 3. File path validation (`validatePackageFiles`)

Package file lists are checked for three categories of path security violation, each treated as a hard error:

- **Path traversal**: any path matching `(^|[\\/])\.\.($|[\\/])` (e.g., `../../etc/passwd`) is rejected
- **Absolute Unix paths**: any path beginning with `/`
- **Absolute Windows paths**: any path beginning with a drive letter followed by `:\`

Non-standard file extensions (anything outside `.yaml`, `.yml`, `.md`, `.ts`, `.json`, `.txt`) generate a warning but do not block installation.

### 4. Content integrity (`computeContentHash` / `verifyContentHash`)

`parseDomainPackageYaml()` computes a SHA-256 hash of the raw `domain.yaml` content and stores it in the `DomainPackageManifest.contentHash` field. `verifyContentHash(filePath, expectedHash)` re-reads the file from disk and compares hashes, returning `false` if the content has changed since install. This allows the engine to detect tampering with installed domain configs.

```typescript
// Verify a domain.yaml has not been modified since install
const unchanged = verifyContentHash(
  "{projectDir}/domains/my-stack.yaml",
  manifest.contentHash,
);
```

Source: `packages/core/src/domain/marketplace.ts`

---

## CLI Integration

Consumer applications that expose domain management commands typically implement the following operations. The working directory determines which project's `{projectDir}/domains/` directory is used.

### Install a domain package

Install a domain package from npm and register it with the project.

```
{appName} domain install @scope/my-domain-package
```

The install pipeline executes these steps in order:

1. Validates the package name is scoped. Unscoped names are rejected.
2. Runs `bun add <package>` to fetch from npm into `node_modules/`.
3. Locates `domain.yaml` in the installed package directory. Fails if absent.
4. Parses and validates `domain.yaml` via `parseDomainPackageYaml()`. Fails on any schema error.
5. Runs `validatePackageSecurity()` against the package's `package.json` and file list. Fails on any error; prints warnings for non-standard extensions.
6. Copies `domain.yaml` to `{projectDir}/domains/<name>.yaml`. Creates the directory if absent.

Only the `domain.yaml` is copied to the project's domains directory. The full package remains in `node_modules/` for MCP server and skill file resolution.

### List installed domains

Lists all domain packages installed in the current project's domains directory.

Output columns: display name, version, detection patterns. Files that fail to parse are skipped with a warning rather than aborting the list.

### Search for packages

Queries the npm registry for domain packages matching a search query.

Returns package name, version, and description. Results come directly from `npm search --json`.

### Show package info

Shows metadata for an installed domain package. Looks up by the `name` field in `domain.yaml` or by filename (without extension). Searches the project domains directory first, then `node_modules/`.

Output includes: display name, version, author, detection patterns, skills, tools server path, and quality gate names.

### Remove a domain package

Removes a domain package from the project. Accepts the domain `name` field or the filename (without `.yaml`).

Deletes the matching file from the project domains directory and runs `bun remove <package>` (best-effort — does not fail if the npm package is not present). If no matching domain is found, reports that the domain was not found.

---

## Integration with Auto-Detection

Installed domains register with `DomainRegistry` before any detection occurs. The call sequence in a session is:

```
DomainRegistry.loadInstalledDomains(projectPath)
  -> scans {projectDir}/domains/*.yaml
  -> parses each file via loadDomainYaml()
  -> skips names already registered (built-ins take precedence)
  -> registers remaining configs

DomainRegistry.detectAndMerge(projectPath)
  -> checks all registered configs (built-in + installed)
  -> returns merged DomainConfig for matched stacks
```

`loadInstalledDomains()` returns the count of successfully loaded packages. Invalid files are silently skipped during detection (the `list` command surfaces those errors explicitly).

Both project initialization and session preparation call `loadInstalledDomains()` before running detection, ensuring installed domains are always visible to the engine.

---

## Creating a Domain Package

The following steps produce a distributable domain package.

**1. Create the package directory and `package.json`.**

```json
{
  "name": "@scope/my-stack",
  "version": "1.0.0",
  "description": "Kiln domain package for My Stack",
  "main": "domain.yaml",
  "files": ["domain.yaml", "skills/", "tools/", "knowledge/", "README.md"]
}
```

Do not add any lifecycle scripts (`preinstall`, `postinstall`, etc.). The marketplace will reject the package at install time.

**2. Author `domain.yaml`.**

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
  - linting

qualityGates:
  - name: lint
    command: "my-stack lint"
    description: Lint source files with my-stack linter
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

**3. Add skill markdown files.**

Skill files are injected into agent context. Keep them concise and task-focused.

```markdown
# Create Feature

1. Identify the bounded context for the feature.
2. Create the handler in `src/handlers/`.
3. Register the route in `src/router.ts`.
4. Write integration tests in `tests/`.
5. Verify all quality gates pass before marking complete.
```

**4. Add an MCP server (optional).**

If the package provides custom tools, implement a standard MCP server at the path declared in `tools.server`. All tool capabilities must carry explicit `readOnly`, `destructive`, and `idempotent` annotations. Unannotated tools default to `destructive: true`.

**5. Validate file paths.**

Ensure no file in the package uses `..` path segments, absolute paths, or extensions outside the allowed set (`.yaml`, `.yml`, `.md`, `.ts`, `.json`, `.txt`).

**6. Publish to npm.**

```
npm publish --access public
```

**7. Install and verify.**

```
{appName} domain install @scope/my-stack
{appName} domain info my-stack
{appName} domain list
```

Confirm the domain appears in the list and that detection activates when the project contains one of the declared `detectPatterns` files.
