# 04 - Config Projection Unification

## 1. Doctrine

`~/.kiln/config.yaml` is the **single source of truth** for Kiln-managed harness
and operator configuration. Every provider credential, permission policy, MCP
server, hook, agent, skill, model selection, and component set that Kiln
projects into supported harnesses is declared there. Harness configs —
`~/.claude/settings.json`, `~/.codex/config.toml`, and
`~/.config/opencode/opencode.json` — are **projected artifacts**.
They are never sources. They are never edited by hand for Kiln-managed concerns.
Projection is **one-way**: Kiln writes them; harnesses read them.

This is not a convenience sync layer. It is the config surface of a
biocybernetic control plane. A control plane governs its execution surfaces; it
does not negotiate with them. Drift is an error condition, not a valid
steady-state. When a harness config deviates from the last projection, Kiln
warns loudly, refuses to sync further, and offers `kiln import-native <target>`
as an opt-in one-shot to acknowledge and absorb the drift.

This does not replace `gateway.yaml` or `app.yaml`. Deployable apps still use
`gateway.yaml` plus bound `app.yaml` files as the App Gateway runtime contract.
Global config may declare how local operator surfaces and harnesses attach to or
project that runtime, but it is not the source of app topology.

The engine registry is a first-class Kiln primitive. Session-start availability
probing replaces the `~/.claude/hooks/check-engines.sh` shell workaround.
`check-engines.sh` is deleted at slice close; nothing references it after.

**V1 targets: claude, codex, opencode.** Three harnesses. No others. Additional
targets are deferred to future roadmap slices if adoption warrants them.

## 2. Problem Statement

### 2.1 Current sync/ is flat and hardcoded

`packages/cli/src/sync/` contains five independent modules — `agent-sync.ts`,
`hook-sync.ts`, `skill-sync.ts`, `security-sync.ts`, `agents-md-sync.ts` — each
with hardcoded target paths for exactly three harnesses (claude, codex,
opencode). Each module is a one-shot write with no record of what it wrote, no
hash of what it wrote against, and no ability to undo.

### 2.2 No install state or provenance

After `kiln sync` runs, nothing records which files were written, at which
paths, with which content hash. Subsequent runs cannot detect drift.
`kiln uninstall` does not exist. There is no way to know whether
`.claude/settings.json` was last written by Kiln or by the user.

### 2.3 No schema validation at boundaries

`KilnGlobalConfig` (v1) at `packages/cli/src/config/global-config.ts:25` is a
TypeScript interface validated only at parse time inside the process. There is
no JSON Schema that external tooling, tests, or the migration command can
reference. Malformed fields are silently ignored.

### 2.4 No drift detection

If the user edits `~/.codex/config.toml` after `kiln sync`, the next
`kiln sync` overwrites those edits silently. Conversely, if the user runs
`codex config set ...` between Kiln syncs, Kiln has no record that the file
changed. The control plane has lost the invariant that harness configs are
projected artifacts.

### 2.5 No unified engine registry

`~/.claude/hooks/check-engines.sh` is a shell script that probes for codex and
opencode binaries. It is Claude Code-specific, has no programmatic API, cannot
be consumed by the GUI or runtime, and has no integration with the session
routing logic. Starting a harness directly — running `claude`, `codex`, or
`opencode` without going through Kiln — yields a different config than
Kiln-managed invocations. The control plane does not govern these surfaces.

### 2.6 Divergent model namespaces

Model IDs are not interchangeable across harnesses. `claude-opus-4-7` is valid
for `claude` but not for `codex` or `opencode`. Today there is no per-harness
model override in `KilnGlobalConfig`. A single `model` field is projected as-is
to all targets, silently producing invalid configs for harnesses that do not
recognize that model name.

## 3. Architecture

### 3.1 KilnGlobalConfig v2 Shape

```yaml
version: "2"

identity:
  name: "Ricardo Armenta"
  timezone: "America/Tijuana"

engines:
  claude:
    enabled: true
    billing: subscription
  codex:
    enabled: true
    billing: plus-quota
  opencode:
    enabled: true
    billing: free

routing:
  defaultWorker: codex
  fallback: opencode
  budgetAware: true
  budget:
    codex:
      dailyTokenCeiling: 500000
      onCeiling: fallback
    opencode:
      dailyTokenCeiling: null

permissions:
  approval: on-request
  sandbox: read-only

mcp:
  servers:
    kiln-gateway:
      type: http
      url: "http://localhost:3800/mcp"
    bundled-tool:
      type: kiln-bundled
      module: "@kilnai/cli/mcp/bundled-tool"
    my-custom:
      type: stdio
      command: node
      args: ["/path/to/server.js"]

hooks:
  pre-commit:
    command: sh
    args: [".kiln/hooks/autoformat.sh"]

agents:
  - name: context-scout
    role: Maps affected files and dependencies before implementation
    model: gpt-5.4-mini
  - name: planner
    role: Produces implementation specs before any code
    model: gpt-5.4

skills:
  - name: frontend
    path: ~/.kiln/skills/frontend
  - name: sequel-spring
    path: ~/.kiln/skills/sequel-spring

models:
  default: claude-opus-4-7
  codex: gpt-5.4
  opencode: "openai/gpt-4o:free"

components:
  include:
    - baseline:core
    - lang:typescript
    - framework:react
    - capability:tdd
```

`version: "2"` is the v2 discriminant. The parser rejects any document where
`version` is absent or not `"2"` unless the migration command is running.

**MCP server types.** Three types are recognized in v1:

| Type | Resolved by | Notes |
|---|---|---|
| `http` | translator at sync time | URL written directly into harness config |
| `stdio` | translator at sync time | `command` + `args` written into harness config |
| `kiln-bundled` | CLI at sync time via `module` path | Resolved from CLI package installation; no runtime magic |

The `kiln-bundled` type replaces the runtime `mcpServerEntryPath` pattern
currently at `packages/cli/src/wrapper/opencode-session.ts:399`. The entry path
is resolved once at `kiln sync` time and written as a `stdio` block in the
harness config. No deferred resolution at session start.

**Budget-aware routing.** When `routing.budgetAware: true`, the engine registry
consults the existing cost-tracker (per-session tokens aggregated to a daily
rollup) against `routing.budget.<engine>.dailyTokenCeiling`. When the ceiling
for `defaultWorker` is crossed, the next task routes to `routing.fallback`. If
`dailyTokenCeiling: null`, that engine is unbounded. `budgetAware: false`
disables routing decisions entirely — honest default when no ceilings are
declared. No live API probes. No network calls. Declarative and deterministic.

### 3.2 Component Hierarchy

Components are the unit of harness content management. Four families are
defined for v1:

| Family | Semantics | Example IDs |
|---|---|---|
| `baseline:` | Always-applicable rules and workflows | `baseline:core`, `baseline:git` |
| `lang:` | Language-specific rules | `lang:typescript`, `lang:java`, `lang:rust` |
| `framework:` | Framework-specific rules | `framework:react`, `framework:spring` |
| `capability:` | Cross-cutting capabilities | `capability:tdd`, `capability:security` |

`components.include` is the active selection. The translator resolves each
`family:id` string to a set of source files (rules, workflows, agents) that
the harness-specific translator maps to target paths.

No profiles in v1. Profiles require composition semantics that introduce
ordering ambiguity. Components only.

**Component source.** Components ship bundled inside the `@kilnai/cli` package.
The bundled set is the default and requires no network access. User override
path: `~/.kiln/components/<family>/<id>.yaml` — when a file is present at
that path it overrides the bundled version and the CLI logs a warning in
install-state at sync time to make the override visible. No registry or remote
fetch in v1. Third-party component ecosystems are deferred to v2 only if
adoption warrants them.

### 3.3 Translation Layer

One translator per target. Each implements a single interface:

```typescript
interface HarnessTranslator<T> {
  readonly target: "claude" | "codex" | "opencode";
  translate(config: KilnGlobalConfig, components: ResolvedComponents): T;
}
```

`ResolvedComponents` is the output of component resolution: the flat list of
source files selected by `components.include`.

**Translator output is a managed patch, not a full file.** Each translator
declares only the fields it owns. The `kiln sync` command merges the managed
patch into the existing native file, preserving all keys it does not own
byte-for-byte. Non-Kiln keys (e.g., a user-added `custom_theme` in codex TOML)
are invisible to Kiln and pass through unchanged.

**Claude translator** produces a managed patch for `~/.claude/settings.json`:

```json
{
  "permissions": { "allow": ["Read", "WebFetch"], "deny": [] },
  "mcpServers": {
    "kiln-gateway": { "type": "http", "url": "http://localhost:3800/mcp" },
    "my-custom": { "type": "stdio", "command": "node", "args": ["/path/to/server.js"] }
  },
  "hooks": { "pre-commit": { "command": "sh", "args": [".kiln/hooks/autoformat.sh"] } },
  "kiln": { "projectedAt": "2026-04-24T00:00:00Z", "configHash": "sha256:abc123" }
}
```

MCP server projection per type:
- `http` → `{ "type": "http", "url": "<url>" }`
- `stdio` → `{ "type": "stdio", "command": "<cmd>", "args": [...] }`
- `kiln-bundled` → resolved to a `stdio` block with the CLI package path at sync time

**Codex translator** produces a managed patch for `~/.codex/config.toml`. Always
emits `[windows] sandbox = "unelevated"` when the host platform is `win32`:

```toml
approval_policy = "on-request"
sandbox_mode = "read-only"
model = "gpt-5.4"

[windows]
sandbox = "unelevated"

[kiln]
projected_at = "2026-04-24T00:00:00Z"
config_hash = "sha256:abc123"
```

**OpenCode translator** produces a managed patch for
`~/.config/opencode/opencode.json`:

```json
{
  "permission": { "edit": "ask", "bash": "ask", "webfetch": "ask" },
  "model": "openai/gpt-4o:free",
  "mcp": {
    "kiln-gateway": { "type": "http", "url": "http://localhost:3800/mcp" },
    "my-custom": { "type": "stdio", "command": "node", "args": ["/path/to/server.js"] }
  },
  "kiln": { "projectedAt": "2026-04-24T00:00:00Z", "configHash": "sha256:abc123" }
}
```

OpenCode `permission.edit: allow` and `permission.bash: allow` are emitted
unconditionally when `permissions.approval === "never"`.

### 3.4 Verified Windows Harness Constraints (2026-04-25)

The following constraints were verified on a real Windows operator machine and
should inform Kiln's config projection and wrapper behavior. These are
cross-engine integration constraints, not local folklore:

- **Claude hook reload semantics are real.** Updating
  `~/.claude/settings.json` changes what Claude will load next, but the process
  does not pick up new hook definitions until Claude Code is restarted. Kiln
  should treat Claude hook projection as "written on disk" and "active after
  restart" as two separate states in operator messaging.
- **Claude hook policy may need transcript-aware gating.** A practical
  orchestrator policy on Windows may block top-level writes while still
  allowing delegated subagent writes. Kiln should not assume every projected
  Claude hook is a flat allow/deny shell command; the translator must support
  hook commands that inspect hook payload fields such as `transcript_path`.
- **Codex on Windows must not rely on bare `bash` for hooks.** Hook commands
  that assume `bash` resolves to Git Bash are not portable on Windows. On a
  real machine, bare `bash` resolved to the Windows launcher and caused hook
  failure before any hook logic ran. Kiln should project Codex hooks through
  explicit host-native commands (`cmd.exe`, `py -3`, `node`, or a fully
  resolved shell path), not through an implicit `bash`.
- **Codex Windows sandbox projection remains mandatory.** The existing
  `[windows] sandbox = "unelevated"` requirement is still a known-good default
  and should remain unconditional for Windows hosts.
- **OpenCode write permissions are necessary but not sufficient.** Projecting
  `permission.edit: allow` and `permission.bash: allow` is required when Kiln
  expects OpenCode to edit files, but successful writes still depend on the
  surrounding execution environment.
- **OpenCode sandbox failures must be surfaced as environment failures.** On
  Windows, OpenCode may fail in restricted environments because it cannot spawn
  `git`. Kiln should report that as an execution-environment limitation, not as
  config drift or a translator defect.
- **Do not promote machine-specific ACL quirks into doctrine.** Local issues
  such as a denied temp directory are operational diagnostics, not config
  rules. Kiln should record them in troubleshooting if needed, but must not
  encode them into shared config projection behavior.
- **Codex local models are not selected through the normal `/model` picker.**
  The Codex TUI model picker lists managed OpenAI models and legacy model-name
  entry points. A local LM Studio model is invoked through OSS provider
  selection, e.g. `codex --oss --local-provider lmstudio -m qwen/qwen3.5-9b`
  or the equivalent `codex exec` flags. Projecting `oss_provider = "lmstudio"`
  is necessary but should not lead Kiln to expect the local models to appear
  in the regular Codex model picker.
- **Claude Code local LM Studio profiles need context-aware projection.** A
  normal Claude Code startup context can exceed 16k tokens even for a trivial
  prompt. A verified local profile required `qwen/qwen3.5-9b` loaded at
  roughly `40960` context; `--bare` worked with less, but normal mode did not.
  Kiln should distinguish "minimal local smoke test" from "normal harness
  session" when recommending LM Studio load parameters.
- **OpenCode should not be smoke-tested from the operator home directory.**
  Running OpenCode from `C:\Users\R3XED` caused slow snapshot behavior and
  stale `index.lock` failures. The same LM Studio provider succeeded from a
  small project workspace with a longer timeout. Kiln should run OpenCode
  probes from the target project root or a bounded temporary workspace, not the
  user's home directory.
- **Bundled Kiln MCP projection must resolve a real entrypoint and runtime.**
  A stale Codex config pointed `mcp_servers.kiln` at `node
  .kiln/mcp/index.js`, which failed because the relative file did not exist in
  the operator home. A discovered packaged MCP entrypoint required Bun-specific
  module support, so blindly projecting `node <entrypoint>` is also unsafe.
  The `kiln-bundled` MCP type must resolve both the absolute entrypoint path
  and the required runtime (`bun`, `node`, or other) at sync time, then verify
  startup before writing harness config.

### 3.5 Install State

`~/.kiln/state/install-state.json` tracks what was projected and when. Schema:

```typescript
interface KilnInstallState {
  schemaVersion: "kiln.install.v1";
  syncedAt: string;           // ISO 8601
  kilnVersion: string;
  configHash: string;         // sha256 of serialized KilnGlobalConfig
  targets: Record<string, TargetState>;
}

interface TargetState {
  id: "claude" | "codex" | "opencode";
  files: FileRecord[];
  managedFields: string[];        // dotted paths Kiln owns, e.g. "permissions.allow", "mcpServers.kiln-gateway"
  componentsInstalled: string[];  // family:id list
  lastSyncedAt: string;
}

interface FileRecord {
  path: string;
  hash: string;   // sha256 of file content at projection time
}
```

`managedFields` records the dotted key paths that Kiln projected into each
native file (e.g., `permissions.allow`, `mcpServers.kiln-gateway`,
`mcpServers.my-custom`). Drift detection fires **only on managed fields** —
a user-added `custom_theme` key in codex TOML is not in `managedFields` and
is therefore invisible to Kiln's drift check. `kiln uninstall <target>` strips
only managed sections from the native files; user-added keys are left intact.

At `kiln sync` start, each `FileRecord.hash` is compared against the current
disk hash. Any mismatch on a managed field is drift. Drift on a file owned by
a Kiln target blocks the sync and surfaces a warning per target.
`kiln import-native <target>` is the only path to absorb drift.

`~/.kiln/state/` is created by `kiln sync` on first run. It is not committed
to source control.

### 3.5 Engine Registry

Engines are declared in `config.yaml` under `engines`. At session start (not
at shell hook invocation), the runtime probes each enabled engine:

1. Resolve binary path (same lookup as `CodexSession._findCodexBinary` at
   `packages/cli/src/wrapper/codex-session.ts:589`).
2. Run `<binary> --version` with a 2-second timeout.
3. Mark engine `available: true | false` in a transient in-memory registry.

**Routing decisions** use the engine registry combined with the cost-tracker
daily rollup. When `routing.budgetAware: true` and `defaultWorker`'s
`dailyTokenCeiling` is crossed, the registry marks that engine as
budget-exhausted and routes to `fallback`. The cost-tracker is the signal
source — no live API probes, no network calls at routing time.

The result is surfaced via:

- `kiln status` — tabular output with availability, billing, budget usage, and routing role.
- `kiln route` — prints the resolved worker for the current session context.
- TUI/GUI — engine availability bar, updated once per session start.

`check-engines.sh` is deleted at slice 04.G close. No code may reference it
after that slice ships.

### 3.6 Schema Validation

JSON Schemas live at `packages/core/src/config/schemas/`:

- `kiln-global-config.v2.schema.json` — validates `KilnGlobalConfig` v2.
- `kiln-install-state.v1.schema.json` — validates `~/.kiln/state/install-state.json`.

Both use JSON Schema Draft-07 (`$schema: http://json-schema.org/draft-07/schema#`).
The parser in `packages/cli/src/config/global-config.ts` validates against the
schema immediately after YAML parse. Any violation throws a `KilnConfigError`
with the violating path and expected type. No silent coercion. Fail fast.

## 4. Commands

**`kiln sync`**
Projects `~/.kiln/config.yaml` to all enabled harness targets. Checks drift on
managed fields for each target first; aborts with per-target diagnostics if
drift is detected. For each target, translates config to a managed patch, merges
the patch into the existing native file preserving non-managed keys, and updates
`managedFields` in install-state. Writes `~/.kiln/state/install-state.json` on
success. Accepts `--target <id>` to limit scope. Exits non-zero on any target
failure.

**`kiln status`**
Reads engine registry (probes if stale), reads install state, and prints:
engine availability + billing + daily budget usage, last sync timestamp, config
hash, drift status per target, and active routing assignment. No writes.

**`kiln uninstall [target]`**
Strips only managed sections (those listed in `managedFields`) from each target's
native files. Leaves user-added keys intact. Removes the target's entry from
install state. Does not delete files outright — it surgically removes managed
keys. Without `[target]`, uninstalls all enabled targets.

**`kiln import-native <target>`**
One-shot opt-in drift absorption. Reads the harness native config, extracts
Kiln-relevant fields (engines, model, permissions, MCP servers), merges into a
candidate `KilnGlobalConfig` v2, and presents a diff for confirmation. On
acceptance, writes the merged config and re-projects. Does not recurse.

**`kiln migrate`**
Upgrades `KilnGlobalConfig` v1 → v2 in place. See §6.

## 5. Slices

### 04.A - KilnGlobalConfig v2 Schema and Parser

Scope: `packages/core/src/config/schemas/kiln-global-config.v2.schema.json`,
updated `packages/cli/src/config/global-config.ts`.

- Add `version: "2"` discriminant to the interface.
- Add `engines`, `routing`, `routing.budget`, `models`, `components` fields.
- Move `tui`/`gui` theme prefs to `ui.theme` (neutral key).
- Write JSON Schema file. Parser validates against it on read.
- Unit tests: valid v2 doc passes; missing `version` throws; unknown field
  in strict mode throws; `engines` with unknown billing mode throws;
  `routing.budget` with `dailyTokenCeiling: null` passes.

Verification: `bun run typecheck` clean; `bun run test` clean; grep for
`KilnGlobalConfig` shows no consumer passing a v1 shape without migration.

### 04.B - Install State Schema and Store

Scope: `packages/core/src/config/schemas/kiln-install-state.v1.schema.json`,
`packages/cli/src/config/install-state-store.ts`.

- JSON Schema for `KilnInstallState` including `managedFields: string[]` per
  target.
- `InstallStateStore` class: `read()`, `write(state)`, `readTargetState(id)`,
  `detectDrift(id): DriftReport`.
- Drift detection computes sha256 of each tracked file, compares to stored hash,
  and scopes field-level drift to `managedFields` dotted paths only.
  Returns a `DriftReport` with `clean: boolean` and `driftedFiles`.
- Unit tests: round-trip write/read; drift detected on mutated managed field;
  non-managed user key does not trigger drift; drift on missing file.

Verification: `bun run typecheck` clean; `bun run test` clean; no file write
outside `~/.kiln/state/` in store code.

### 04.C.1 - Claude Translator

Scope: `packages/cli/src/config/translators/claude-translator.ts`.

- Implements `HarnessTranslator` for target `claude`.
- Reads `models.default` (no per-harness override for claude — it owns the
  default).
- Maps `permissions` → `{ allow, deny }` arrays. Logic extracted from
  `security-sync.ts:syncClaudePermissions`.
- Maps `mcp.servers` → `mcpServers` block. Dispatches by type: `http` → http
  block; `stdio` → stdio block; `kiln-bundled` → resolves module path at sync
  time and emits stdio block.
- Maps `hooks` → `hooks` block.
- Embeds `kiln.projectedAt` and `kiln.configHash` in output.
- Returns patch object and `managedFields` list for install-state.
- Unit tests: permission mapping for all three approval modes; MCP type dispatch
  for all three types; hook round trip; configHash presence; managedFields list
  is accurate.

### 04.C.2 - Codex Translator

Scope: `packages/cli/src/config/translators/codex-translator.ts`.

- Implements `HarnessTranslator` for target `codex`.
- Uses `models.codex` if set, falls back to `models.default`.
- Always emits `[windows] sandbox = "unelevated"` when `process.platform ===
  "win32"`. This is unconditional — the control plane enforces the known-good
  Windows config without asking.
- Maps `permissions` → `approval_policy` + `sandbox_mode`. Logic extracted from
  `security-sync.ts:syncCodexPermissions`.
- Embeds `[kiln] projected_at` and `config_hash`.
- Returns patch object and `managedFields` list for install-state.
- Unit tests: Windows sandbox injection; model selection precedence; approval
  mode mapping; TOML round trip; managedFields list is accurate.

### 04.C.3 - OpenCode Translator

Scope: `packages/cli/src/config/translators/opencode-translator.ts`.

- Implements `HarnessTranslator` for target `opencode`.
- Uses `models.opencode` if set.
- Maps `permissions` → `{ edit, bash, webfetch }` permission values.
- Maps `mcp.servers` → opencode MCP block. Dispatches by type: `http` → http
  block with URL; `stdio` → stdio block; `kiln-bundled` → resolves module path
  at sync time and emits stdio block. Replaces the runtime `mcpServerEntryPath`
  pattern at `packages/cli/src/wrapper/opencode-session.ts:399`.
- Emits `permission.edit: allow` and `permission.bash: allow` unconditionally
  when `permissions.approval === "never"`.
- Returns patch object and `managedFields` list for install-state.
- Unit tests: permission mapping; model selection; MCP type dispatch for all
  three types; managedFields list is accurate.

### 04.D - Engine Registry and kiln status / kiln route

Scope: `packages/cli/src/engines/engine-registry.ts`,
`packages/cli/src/commands/status.ts`, `packages/cli/src/commands/route.ts`.

- `EngineRegistry` class: `probe(engineId)` resolves binary and runs
  `--version`; `probeAll(config)` probes all enabled engines; `getAvailable()`
  returns availability map. Results cached for session lifetime.
- Budget-aware routing: `getBudgetStatus(engineId)` reads the cost-tracker daily
  rollup and compares against `routing.budget.<engine>.dailyTokenCeiling`.
  Returns `{ withinBudget: boolean, tokensUsed: number, ceiling: number | null }`.
- `kiln status` command prints: engine table (id / enabled / billing /
  available / daily tokens used / ceiling), last sync timestamp, config hash,
  drift status per target.
- `kiln route` prints the resolved `defaultWorker` or `fallback` based on
  availability and budget status when `budgetAware: true`.
- Unit tests: probe timeout (2s) surfaces `available: false`; binary-not-found
  surfaces `available: false`; budget ceiling crossed routes to fallback;
  `budgetAware: false` ignores budget and routes to defaultWorker.

Verification: `check-engines.sh` is not called from any code path after this
slice.

### 04.E - kiln sync + Drift Detection + kiln import-native

Scope: `packages/cli/src/commands/sync.ts` (rewrite),
`packages/cli/src/commands/import-native.ts`.

- `kiln sync` orchestrates: read config → validate schema → probe engines →
  per-target: detect drift on managed fields → if drift warn + abort target →
  translate → merge patch into native file preserving non-managed keys →
  update install state with new managedFields. `--target` flag limits scope.
  `--force` overrides drift abort (must confirm interactively).
- `kiln import-native <target>` reads native config, extracts Kiln fields,
  merges into v2 candidate, prints unified diff, confirms, writes, re-projects.
- Unit tests: drift detected on managed field → target aborted; non-managed
  user key preserved through sync; clean state → all targets written; import-
  native extracts model from codex TOML; import-native merges without
  clobbering unrelated Kiln fields.

### 04.F - kiln uninstall + kiln migrate

Scope: `packages/cli/src/commands/uninstall.ts`,
`packages/cli/src/commands/migrate.ts`.

- `kiln uninstall [target]` reads install state, strips managed sections
  (by `managedFields` dotted paths) from each native file, leaves user-added
  keys intact. Warns on hash mismatch without stripping (drift). Accepts
  `--force` to strip regardless of hash.
- `kiln migrate` reads v1 config, applies the migration transform (see §6),
  writes v2. Does not delete v1 fields that have no v2 equivalent — logs them
  as "unmapped" for the operator to review. Runs schema validation on the
  produced v2 doc before writing.
- Unit tests: uninstall strips only managed fields, non-managed keys survive;
  uninstall with drifted file warns and skips without `--force`; migrate v1→v2
  preserves identity, permissions, mcp, hooks; migrate rejects when v2 schema
  validation fails.

### 04.G - Delete Old sync/, Delete check-engines.sh, Prune Docs

Scope: `packages/cli/src/sync/` (entire directory),
`~/.claude/hooks/check-engines.sh`, any doc or comment referencing them.

- Delete: `agent-sync.ts`, `agent-sync.test.ts`, `hook-sync.ts`,
  `skill-sync.ts`, `skill-sync.test.ts`, `security-sync.ts`,
  `agents-md-sync.ts`, `agents-md-sync.test.ts`.
- Delete: `check-engines.sh` from the user home hook path. Remove any reference
  to it in CLAUDE.md memory files (those are outside this repo; document the
  deletion in the commit message).
- Remove any import of `sync/` modules from CLI command files. Verify with
  grep: no `from.*sync/agent-sync`, `from.*sync/hook-sync`, etc.
- Update `packages/cli/src/index.ts` exports to remove deleted modules.
- Verification: `bun run typecheck` clean; `bun run test` clean; grep for
  `check-engines.sh` in the repo returns zero results; grep for
  `packages/cli/src/sync/` in imports returns zero results.

Each slice: one atomic concern. No slice merges translator work with registry
work. No slice deletes old code before the replacement is verified.

## 6. Migration

`kiln migrate` upgrades v1 → v2 in place. Steps:

1. Read `~/.kiln/config.yaml`. Confirm `version: "1"` (or absent).
2. Read native harness configs (if accessible) to pre-populate `engines` and
   per-harness `models` overrides. Codex TOML at `~/.codex/config.toml`
   provides `approval_policy`, `sandbox_mode`, and model. OpenCode JSON at
   `~/.config/opencode/opencode.json` provides `permission` and `model`.
3. Apply transform:
   - `version: "1"` → `version: "2"`.
   - `provider` → `engines.<provider>.enabled: true`; all other engines
     default to `enabled: false` unless found in native configs. V1 engines
     are scoped to claude, codex, opencode only.
   - `model` → `models.default`; per-harness overrides from native configs.
   - `permissions`, `mcp`, `hooks`, `identity` → carried forward unchanged.
   - `tui.theme` / `gui.theme` → `ui.theme` (last one wins if both present).
   - `components.include` initialized to `["baseline:core"]`.
   - `routing.budgetAware` initialized to `false` (no ceilings declared by default).
4. Validate the produced v2 doc against the JSON Schema. Abort if invalid.
5. Write to `~/.kiln/config.yaml`. Create a `.kiln/config.yaml.v1.bak` backup.
6. Run `kiln sync` automatically on success.

No back-compat shim after migration. The v1 parser path is removed when the
migration command ships. Any caller that tries to load a v1 doc after 04.F
receives a `KilnConfigError` instructing them to run `kiln migrate`.

## 7. Non-Goals

- **Reverse sync.** Harness configs are projected artifacts. Reading them back
  is only available as the one-shot `kiln import-native` command.
- **Profiles.** Composition of named config profiles is not in v1 scope.
  Components only.
- **Targets beyond the v1 three.** Claude, codex, opencode. Additional harnesses
  require a new roadmap slice when adoption warrants it.
- **Auto-reconciliation.** When drift is detected on managed fields, Kiln warns
  and stops. It never silently overwrites. Reconciliation is always an explicit
  operator action.
- **GUI config editor.** Config mutation via the GUI surface is not in this
  slice. The GUI reads `kiln status` output; it does not write config.
- **Antigravity target.** Deferred to v2 until adoption warrants it. No
  translator, no slice, no migration path in v1.
- **Remote component registry or fetch.** Components ship bundled in
  `@kilnai/cli`. Third-party component ecosystems are deferred to v2.

## 8. Open Questions

1. **`kiln sync` execution order and atomicity.** Should translators run in
   parallel (faster) or serial (easier to reason about partial failure)? If one
   target fails mid-sync — for example, codex drift is detected after claude has
   already been written — does Kiln roll back the claude write, or does it
   commit what succeeded and report the failure? The current spec says "exits
   non-zero on any target failure" but does not define atomicity guarantees.

2. **Native file backup policy.** When `kiln sync` is about to merge managed
   sections into an existing native file, should it write a backup before
   touching it? A natural location is `~/.kiln/backups/<target>/<timestamp>.bak`.
   Questions: is backup opt-in or always-on? What is the pruning policy (count
   limit, age limit, or manual `kiln prune-backups`)? Does `kiln import-native`
   also create a backup before overwriting the Kiln config?

3. **Migration without prior sync (no install-state).** If a user has a v1
   `~/.kiln/config.yaml` that was never synced — so no `install-state.json`
   exists — `kiln migrate` still needs to produce a valid v2 doc and then run
   `kiln sync`. What does the state file look like after migration of a
   never-synced config? Is the absence of install-state a normal condition
   `kiln migrate` handles gracefully, or does it require `kiln sync` to have
   run at least once before migration is valid?

4. **`engines.<id>.enabled: false` and projected config removal.** If an
   operator sets `engines.codex.enabled: false` in `config.yaml` and runs
   `kiln sync`, should Kiln immediately strip the codex managed sections from
   `~/.codex/config.toml`, or should it only stop projecting future changes and
   leave the existing config in place? The strip behavior is cleaner but
   requires tracking which targets were previously enabled. The leave-in-place
   behavior is safer but leaves stale Kiln metadata in the native file.
